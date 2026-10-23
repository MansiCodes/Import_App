#!/usr/bin/env node
/**
 * Load the reviewed archive CSVs into the database.
 *
 * Reads archive-scan/imports.csv and archive-scan/documents.csv — AFTER a human
 * has corrected them. Rows whose `action` is not exactly `import` are skipped,
 * which is how the duplicate folders and the value-less ones stay out until
 * someone has decided what they are.
 *
 *   npm run archive:load -- --dry-run     # show what would happen
 *   npm run archive:load
 *
 * Safe to re-run: every import and document carries the archive path it came
 * from, and anything already loaded is skipped rather than duplicated.
 *
 * Imports land as status `Closed` with is_archived = false: these are finished
 * orders being recorded for history, and marking them active would fill the
 * Action Centre with alerts about shipments that arrived months ago.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const DRY_RUN = process.argv.includes('--dry-run')
const SCAN_DIR = 'archive-scan'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Minimal CSV reader — handles quoted fields containing commas. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field !== '' || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''))
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
}

async function main() {
  const importRows = parseCsv(await readFile(path.join(SCAN_DIR, 'imports.csv'), 'utf8'))
  const documentRows = parseCsv(await readFile(path.join(SCAN_DIR, 'documents.csv'), 'utf8'))

  const toLoad = importRows.filter((r) => r.action.trim().toLowerCase() === 'import')
  const skipped = importRows.length - toLoad.length

  console.log(`\n${importRows.length} candidate imports, ${toLoad.length} marked for loading.`)
  if (skipped) console.log(`${skipped} skipped — action is not "import".`)
  if (DRY_RUN) console.log('\nDRY RUN — nothing will be written.\n')

  // --- reference data ------------------------------------------------------
  const { data: companies } = await supabase.from('companies').select('id, short_code')
  const companyByCode = new Map((companies ?? []).map((c) => [c.short_code, c.id]))

  const { data: suppliers } = await supabase.from('suppliers').select('id, name')
  const supplierByName = new Map((suppliers ?? []).map((s) => [s.name.toLowerCase(), s.id]))

  const { data: docTypes } = await supabase.from('document_types').select('id, code')
  const typeByCode = new Map((docTypes ?? []).map((t) => [t.code, t.id]))

  const { data: existingImports } = await supabase
    .from('imports')
    .select('id, source_folder')
    .not('source_folder', 'is', null)
  const importBySource = new Map((existingImports ?? []).map((i) => [i.source_folder, i.id]))

  const { data: existingDocs } = await supabase
    .from('documents')
    .select('source_path')
    .not('source_path', 'is', null)
  const loadedDocPaths = new Set((existingDocs ?? []).map((d) => d.source_path))

  let created = 0
  let alreadyThere = 0
  let docsCreated = 0
  const problems = []

  for (const row of toLoad) {
    const companyId = companyByCode.get(row.company_code)
    if (!companyId) {
      problems.push(`${row.source_path}: unknown company "${row.company_code}"`)
      continue
    }

    if (importBySource.has(row.source_path)) {
      alreadyThere++
      continue
    }

    // Match the supplier by folder name; the 14 suppliers are already seeded.
    const supplierId =
      supplierByName.get(row.supplier_folder.toLowerCase()) ??
      [...supplierByName.entries()].find(
        ([name]) =>
          name.startsWith(row.supplier_folder.toLowerCase().slice(0, 8)) ||
          row.supplier_folder.toLowerCase().startsWith(name.slice(0, 8)),
      )?.[1]

    if (!supplierId) problems.push(`${row.source_path}: no supplier matching "${row.supplier_folder}"`)

    if (DRY_RUN) {
      // Register a placeholder so the document pass can still be counted —
      // otherwise a dry run reports zero documents, which is the half of the
      // load you most want previewed.
      importBySource.set(row.source_path, `dry-run:${row.source_path}`)
      created++
      continue
    }

    const year = row.financial_year ? 2000 + Number(row.financial_year.slice(0, 2)) : 2026
    const { data: numberRow } = await supabase.rpc('next_import_no', { p_year: year })

    const { data: created_, error } = await supabase
      .from('imports')
      .insert({
        import_no: numberRow,
        company_id: companyId,
        supplier_id: supplierId ?? null,
        currency: row.currency || 'USD',
        pi_value: row.pi_value === '' ? null : Number(row.pi_value),
        title: row.import_folder,
        status: 'Closed',
        source_folder: row.source_path,
        notes: `Loaded from the historical archive: ${row.source_path}`,
      })
      .select('id')
      .single()

    if (error) {
      problems.push(`${row.source_path}: ${error.message}`)
      continue
    }

    importBySource.set(row.source_path, created_.id)
    created++
  }

  // --- documents -----------------------------------------------------------
  for (const doc of documentRows) {
    const importId = importBySource.get(doc.import_source_path)
    if (!importId) continue
    if (loadedDocPaths.has(doc.relative_path)) continue
    if (DRY_RUN) {
      docsCreated++
      continue
    }

    const { data: document, error } = await supabase
      .from('documents')
      .insert({
        import_id: importId,
        title: doc.file_name,
        source_path: doc.relative_path,
      })
      .select('id')
      .single()

    if (error) {
      problems.push(`${doc.relative_path}: ${error.message}`)
      continue
    }

    const typeId = typeByCode.get(doc.detected_type) ?? typeByCode.get('misc')
    if (typeId) {
      await supabase
        .from('document_type_map')
        .insert({ document_id: document.id, document_type_id: typeId })
    }

    await supabase.rpc('add_document_version', {
      p_document_id: document.id,
      p_drive_url: doc.drive_url || null,
      p_drive_file_id: null,
      p_file_name: doc.file_name,
      p_received_at: null,
      p_notes: null,
    })

    docsCreated++
  }

  console.log(`\nImports  ${created} ${DRY_RUN ? 'would be created' : 'created'}, ${alreadyThere} already loaded`)
  console.log(`Documents ${docsCreated} ${DRY_RUN ? 'would be created' : 'created'}`)

  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`)
    problems.slice(0, 20).forEach((p) => console.log(`  ${p}`))
    if (problems.length > 20) console.log(`  … and ${problems.length - 20} more`)
  }

  if (!DRY_RUN && created > 0) {
    console.log('\nLoaded as status "Closed" — finished orders recorded for history, so')
    console.log('they do not fill the Action Centre with alerts about past shipments.')
  }
}

main().catch((error) => {
  console.error(`\nLoad failed: ${error.message}`)
  process.exitCode = 1
})
