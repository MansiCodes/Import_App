#!/usr/bin/env node
/**
 * Put the Drive link on every archived document.
 *
 * The archive load recorded WHERE each document came from (`documents.source_path`,
 * a path relative to the archive root) but left `drive_url` empty, because at
 * that point the files existed only on the laptop. Once the archive is uploaded
 * to Drive, this matches the two by path and fills in the pointer.
 *
 *   npm run archive:drive -- --dry-run     # show what would change
 *   npm run archive:drive
 *
 * Needs archive-scan/drive-manifest.csv — produced by scripts/drive-manifest.gs,
 * which you run inside your own Google account. See that file for the steps.
 *
 * Matching is on the full archive path, never the file name: dozens of imports
 * each contain a "PROFORMA INVOICE.pdf", so a name match would scatter the
 * wrong links across the archive.
 *
 * Safe to re-run: documents that already carry a link are left alone unless
 * --force is passed, and it only ever updates the current version in place —
 * a missing pointer is a gap being filled, not a revision of the document.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local', override: true })

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')

const manifestArg = process.argv.find((a) => a.startsWith('--manifest='))
const MANIFEST = manifestArg
  ? manifestArg.slice('--manifest='.length)
  : path.join('archive-scan', 'drive-manifest.csv')

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
function parseCsv(input) {
  // Excel and PowerShell both write a BOM. Left in place it becomes part of the
  // first header name, and every lookup on that column silently misses.
  const text = input.replace(/^﻿/, '')

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

/** Windows separators, stray leading slashes and doubled slashes all mean the same path. */
function normalizePath(value) {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/$/, '')
}

function dropFirstSegment(value) {
  const cut = value.indexOf('/')
  return cut === -1 ? '' : value.slice(cut + 1)
}

/** Supabase caps a select at 1000 rows; the archive will outgrow that. */
async function fetchAll(table, columns, refine = (q) => q) {
  const pageSize = 1000
  const out = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await refine(supabase.from(table).select(columns)).range(
      from,
      from + pageSize - 1,
    )
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < pageSize) return out
  }
}

async function main() {
  // --- the manifest --------------------------------------------------------
  let manifestText
  try {
    manifestText = await readFile(MANIFEST, 'utf8')
  } catch {
    console.error(`Cannot read ${MANIFEST}.`)
    console.error('Run scripts/drive-manifest.gs in your Google account first — it')
    console.error('explains the steps at the top of the file — then save its CSV there.')
    process.exitCode = 1
    return
  }

  const manifestRows = parseCsv(manifestText)
  if (!manifestRows.length) {
    console.error(`${MANIFEST} has no rows.`)
    process.exitCode = 1
    return
  }

  for (const column of ['path', 'file_id']) {
    if (!(column in manifestRows[0])) {
      console.error(`${MANIFEST} has no "${column}" column — expected path,file_id,web_view_link.`)
      process.exitCode = 1
      return
    }
  }

  // --- what is in the database --------------------------------------------
  const documents = await fetchAll('documents', 'id, source_path', (q) =>
    q.not('source_path', 'is', null),
  )
  const versions = await fetchAll(
    'document_versions',
    'id, document_id, drive_url, drive_file_id, status',
    (q) => q.eq('status', 'current'),
  )

  const currentByDoc = new Map(versions.map((v) => [v.document_id, v]))
  const wanted = new Set(documents.map((d) => normalizePath(d.source_path)))

  // --- which prefix does the manifest use? ---------------------------------
  // Uploading `Import - ATC` on its own and uploading a parent that contains it
  // give paths differing by one leading segment. Rather than guess, try both
  // and keep whichever actually lines up with the archive.
  const strategies = [
    { name: 'as listed', key: (p) => p },
    { name: 'first folder stripped', key: (p) => dropFirstSegment(p) },
  ]

  let best = null
  for (const strategy of strategies) {
    const byPath = new Map()
    const ambiguous = new Set()

    for (const row of manifestRows) {
      const key = normalizePath(strategy.key(normalizePath(row.path)))
      if (!key || !row.file_id) continue

      const existing = byPath.get(key)
      // Same path twice pointing at different files: no way to tell which the
      // document means, so link neither.
      if (existing && existing.file_id !== row.file_id) ambiguous.add(key)
      byPath.set(key, { file_id: row.file_id, web_view_link: row.web_view_link || '' })
    }

    let hits = 0
    for (const key of byPath.keys()) if (wanted.has(key)) hits++

    if (!best || hits > best.hits) best = { ...strategy, byPath, ambiguous, hits }
  }

  console.log(`\n${manifestRows.length} files in the manifest, ${documents.length} archived documents.`)
  console.log(`Matching paths ${best.name} — ${best.hits} line up.`)
  if (DRY_RUN) console.log('\nDRY RUN — nothing will be written.\n')

  if (best.hits === 0) {
    console.error('\nNo path in the manifest matches any archived document.')
    console.error('The manifest is probably from a different folder, or was made with')
    console.error('INCLUDE_ROOT_NAME set oddly. A database path looks like:')
    console.error(`  ${documents[0]?.source_path ?? '(none)'}`)
    console.error('and a manifest path looks like:')
    console.error(`  ${manifestRows[0]?.path ?? '(none)'}`)
    process.exitCode = 1
    return
  }

  // A case-only difference is a real match on Windows, where the CSV came from.
  const byLower = new Map()
  const lowerAmbiguous = new Set()
  for (const [key, value] of best.byPath) {
    const lower = key.toLowerCase()
    const existing = byLower.get(lower)
    if (existing && existing.file_id !== value.file_id) lowerAmbiguous.add(lower)
    byLower.set(lower, value)
  }

  // --- match and update ----------------------------------------------------
  let updated = 0
  let alreadyLinked = 0
  let caseInsensitive = 0
  const unmatched = []
  const skippedAmbiguous = []
  const noVersion = []
  const problems = []

  for (const doc of documents) {
    const key = normalizePath(doc.source_path)

    if (best.ambiguous.has(key)) {
      skippedAmbiguous.push(doc.source_path)
      continue
    }

    let hit = best.byPath.get(key)
    if (!hit) {
      const lower = key.toLowerCase()
      if (lowerAmbiguous.has(lower)) {
        skippedAmbiguous.push(doc.source_path)
        continue
      }
      hit = byLower.get(lower)
      if (hit) caseInsensitive++
    }

    if (!hit) {
      unmatched.push(doc.source_path)
      continue
    }

    const version = currentByDoc.get(doc.id)
    if (!version) {
      noVersion.push(doc.source_path)
      continue
    }

    if (version.drive_file_id && !FORCE) {
      alreadyLinked++
      continue
    }

    if (DRY_RUN) {
      updated++
      continue
    }

    const { error } = await supabase
      .from('document_versions')
      .update({
        drive_url: hit.web_view_link || `https://drive.google.com/file/d/${hit.file_id}/view`,
        drive_file_id: hit.file_id,
      })
      .eq('id', version.id)

    if (error) {
      problems.push(`${doc.source_path}: ${error.message}`)
      continue
    }

    updated++
  }

  // --- what happened -------------------------------------------------------
  console.log('')
  console.log(`Linked          ${updated} ${DRY_RUN ? 'would be updated' : 'updated'}`)
  if (caseInsensitive) console.log(`  of which ${caseInsensitive} matched only ignoring case`)
  if (alreadyLinked) console.log(`Already linked  ${alreadyLinked} (pass --force to overwrite)`)
  if (unmatched.length) console.log(`Not in Drive    ${unmatched.length}`)
  if (skippedAmbiguous.length) console.log(`Ambiguous       ${skippedAmbiguous.length}`)
  if (noVersion.length) console.log(`No version row  ${noVersion.length}`)

  const report = (label, list) => {
    if (!list.length) return
    console.log(`\n${label}:`)
    list.slice(0, 15).forEach((p) => console.log(`  ${p}`))
    if (list.length > 15) console.log(`  … and ${list.length - 15} more`)
  }

  report('Archived documents with no file in Drive', unmatched)
  report('Skipped — two Drive files share this path', skippedAmbiguous)
  report('Skipped — no current version row', noVersion)
  report('Failed to update', problems)

  const extra = [...best.byPath.keys()].filter((k) => !wanted.has(k)).length
  if (extra) {
    console.log(`\n${extra} file(s) in Drive are not archived documents — expected if the`)
    console.log('upload includes folders whose imports were not marked "import".')
  }

  if (problems.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\nBackfill failed: ${error.message}`)
  process.exitCode = 1
})
