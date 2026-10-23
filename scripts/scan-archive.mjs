#!/usr/bin/env node
/**
 * Read the historical import folder and produce a DRAFT for review.
 *
 * This writes no database rows. It reads the archive, works out what it thinks
 * each folder is, and writes two CSVs for a human to correct. That separation
 * is the whole point: the folder names are the very thing this app exists to
 * replace, so importing them unexamined would faithfully reproduce the mess.
 *
 * Known to be wrong in the source data, and flagged rather than guessed:
 *   - `TC FIRE USD $102000.00` and `TC FIRE USD 102,000.00` are ONE order in
 *     two folders.
 *   - `SECURITON EURO 185094.00` and `SECURITON EURO 300 PCS 185094.00` look
 *     like the same order described two ways.
 *   - `INV- 300 PCS` carries no value at all.
 *   - `GPB 45750` is a typo for GBP.
 *
 *   npm run archive:scan -- "C:/Users/Lenovo/Desktop/import"
 *
 * Output: archive-scan/imports.csv and archive-scan/documents.csv
 */

import { readdir, mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.argv[2] ?? 'C:/Users/Lenovo/Desktop/import'
const OUT_DIR = 'archive-scan'

/** Top-level folder → the short_code seeded in `companies`. */
const COMPANIES = [
  { match: /atc|atlanta/i, code: 'ATC' },
  { match: /noto/i, code: 'NOTO' },
  { match: /valuecon/i, code: 'VCON' },
]

/** Subfolders that hold documents for a parent import, not a new import. */
const SUBFOLDER = /^(payments?|paymets|misc[\s-]*pi|original\s*doc(ument)?s?|others?|refund|euro_?|\$[\d,.]+)$/i

const FY = /^\d{2}\s*-\s*\d{2}$/

/**
 * Currency tokens as they actually appear, including the GPB typo. Order
 * matters: US$ must be tried before $.
 */
const CURRENCIES = [
  { token: /\bRMB\b|\bCNY\b/i, code: 'CNY' },
  { token: /\bEUROS?\b|\bEUR\b|€/i, code: 'EUR' },
  { token: /\bUS\$|\bUSD\b|\$/i, code: 'USD' },
  { token: /\bGBP\b|\bGPB\b|£/i, code: 'GBP' },
]

/** Windows and Drive litter — never a document. */
const JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store)$/i

/**
 * Filename keyword → document_types.code. First match wins, so order matters.
 *
 * Patterns are deliberately forgiving, because the real filenames are typed by
 * hand and misspelt: "Remittenec", "Remitence", "pfoforma", "Packlist",
 * "Air_way_bill". Matching only the correct spelling leaves a third of the
 * archive untyped.
 */
const DOC_TYPES = [
  [/remit/i, 'payment_request'],
  [/debit[\s_-]*advice/i, 'debit_advice'],
  [/swift/i, 'swift_copy'],
  [/fx[\s_-]*advice|exchange/i, 'fx_advice'],
  [/bank[\s_-]*(detail|imaging)/i, 'bank_details'],
  [/signed[\s_-]*(pi|p.?ro.?forma|pfoforma)/i, 'signed_pi'],
  [/pro.?forma|pfoforma|profroma|\bpi[\s_-]*\d|^pi[\s_-]/i, 'pi'],
  [/purchase[\s_-]*order|[\s_-]po[\s_-]|^po[\s_-]|_po_|\bpo[\s_-]*\d/i, 'po'],
  [/sales[\s_-]*order/i, 'sales_order'],
  [/commercial[\s_-]*invoice|^ci[\s_-]|_ci_|^iv\d|\binvoice\b/i, 'commercial_invoice'],
  [/pack.?list|packing|^pl[\s_-]|\bpl\d/i, 'packing_list'],
  [/insurance/i, 'insurance'],
  [/air.?way|awb/i, 'awb'],
  [/bill[\s_-]*of[\s_-]*lading|\bbl\b/i, 'bl'],
  [/freight[\s_-]*quot|quotation/i, 'freight_quotation'],
  [/freight[\s_-]*(bill|invoice)/i, 'freight_invoice'],
  [/post[\s_-]*clear/i, 'post_clearance_bill'],
  [/cha[\s_-]*bill/i, 'cha_bill'],
  [/do[\s_-]*charge/i, 'do_charges'],
  [/boe|bill[\s_-]*of[\s_-]*entry/i, 'boe'],
  [/duty|challan/i, 'duty_challan'],
  [/icegate/i, 'icegate_receipt'],
  [/oocc|out[\s_-]*of[\s_-]*charge/i, 'oocc'],
  [/terminal/i, 'terminal_receipt'],
  [/aai/i, 'aai_receipt'],
  [/gate[\s_-]*pass|gatepass/i, 'gate_pass'],
  [/e-?way/i, 'eway_bill'],
  [/material[\s_-]*receipt/i, 'material_receipt'],
  [/test[\s_-]*cert/i, 'test_certificate'],
  [/batch|spool/i, 'batch_certificate'],
  [/catalog/i, 'catalogue'],
  [/declaration/i, 'declaration'],
  [/certificate/i, 'certificate'],
]

function companyOf(name) {
  return COMPANIES.find((c) => c.match.test(name))?.code ?? ''
}

function currencyOf(name) {
  return CURRENCIES.find((c) => c.token.test(name))?.code ?? ''
}

/**
 * Pull the order value out of a folder name.
 *
 * Has to cope with `$102000.00`, `102,000.00`, `124'123.20` (Swiss apostrophe),
 * `RMB- 268550` and `CNY - 86050`. Returns null when there is no value at all,
 * which is a real case: `INV- 300 PCS`.
 */
function valueOf(name) {
  // Strip currency words first so "EURO 300 PCS 185094.00" cannot read "300".
  const cleaned = name
    .replace(/\b(RMB|CNY|EUROS?|EUR|USD|US\$|GBP|GPB|INV|LOT|PCS|ND|RD|TH)\b/gi, ' ')
    .replace(/[$€£]/g, ' ')

  // Candidate numbers, allowing , . ' as separators.
  const matches = cleaned.match(/\d[\d,'’.]*\d|\d+/g)
  if (!matches) return null

  const values = matches
    .map((raw) => {
      // Apostrophes are always thousands separators; commas are too when
      // followed by exactly three digits.
      const normalised = raw.replace(/['’]/g, '').replace(/,(?=\d{3}\b)/g, '')
      return Number.parseFloat(normalised.replace(/,/g, '.'))
    })
    .filter((n) => Number.isFinite(n))

  if (values.length === 0) return null

  // The order value is the largest number present — "300 PCS" and lot numbers
  // are always smaller than the amount.
  return Math.max(...values)
}

function docTypeOf(fileName) {
  return DOC_TYPES.find(([pattern]) => pattern.test(fileName))?.[1] ?? ''
}

async function listDirs(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

async function listFilesDeep(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listFilesDeep(full, base)))
    } else if (!entry.name.startsWith('~$') && !JUNK.test(entry.name)) {
      out.push({ full, relative: path.relative(base, full).replace(/\\/g, '/') })
    }
  }
  return out
}

/** Reader for our own output — handles quoted fields containing commas. */
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
        } else quoted = false
      } else field += char
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
    } else field += char
  }

  if (field !== '' || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }

  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''))
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
}

function csv(rows, columns) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.join(','), ...rows.map((r) => columns.map((c) => escape(r[c])).join(','))].join(
    '\n',
  )
}

const imports = []
const documents = []

for (const companyDir of await listDirs(ROOT)) {
  const company = companyOf(companyDir)

  for (const second of await listDirs(path.join(ROOT, companyDir))) {
    // ATC nests a financial year; Noto and Valuecon do not.
    const hasFy = FY.test(second)
    const fy = hasFy ? second.replace(/\s/g, '') : ''
    const supplierParent = hasFy ? path.join(ROOT, companyDir, second) : path.join(ROOT, companyDir)
    const suppliers = hasFy ? await listDirs(supplierParent) : [second]

    for (const supplier of suppliers) {
      const supplierPath = path.join(supplierParent, supplier)

      let candidates
      try {
        candidates = await listDirs(supplierPath)
      } catch {
        continue
      }

      // A supplier folder that holds files directly is itself the import.
      if (candidates.length === 0) candidates = ['.']

      for (const candidate of candidates) {
        if (SUBFOLDER.test(candidate)) continue

        const importPath = candidate === '.' ? supplierPath : path.join(supplierPath, candidate)
        const folderName = candidate === '.' ? supplier : candidate

        const files = await listFilesDeep(importPath)
        if (files.length === 0) continue

        const currency = currencyOf(folderName) || currencyOf(supplier)

        // A number with no currency beside it is not money. `INV- 300 PCS` is a
        // quantity, and reading it as £300 would be worse than reading nothing.
        const value = currency ? valueOf(folderName) : null

        const key = `${company}|${supplier.toUpperCase()}|${value ?? '?'}`

        imports.push({
          key,
          company_code: company,
          financial_year: fy,
          supplier_folder: supplier,
          import_folder: folderName,
          currency,
          pi_value: value ?? '',
          file_count: files.length,
          duplicate_of: '',
          action: 'import',
          source_path: path.relative(ROOT, importPath).replace(/\\/g, '/'),
        })

        for (const file of files) {
          const isPaymentDoc = /payments?|paymets/i.test(file.relative)
          documents.push({
            import_source_path: path.relative(ROOT, importPath).replace(/\\/g, '/'),
            file_name: path.basename(file.relative),
            // Relative to the ARCHIVE ROOT, not the import folder. Dozens of
            // imports each contain a file called "PROFORMA INVOICE.pdf", so a
            // path relative to the import folder is not unique and collides on
            // the provenance index.
            relative_path: path.relative(ROOT, file.full).replace(/\\/g, '/'),
            detected_type: docTypeOf(path.basename(file.relative)),
            attaches_to: isPaymentDoc ? 'payment' : 'import',
            drive_url: '',
          })
        }
      }
    }
  }
}

// Flag likely duplicates rather than merging them: which of the two folders is
// the real order is a judgement about the business, not about the filesystem.
const byKey = new Map()
for (const row of imports) {
  const existing = byKey.get(row.key)
  if (existing) {
    row.duplicate_of = existing.import_folder
    row.action = 'REVIEW — same supplier and value as another folder'
  } else {
    byKey.set(row.key, row)
  }
}

for (const row of imports) {
  if (row.pi_value === '') row.action = 'REVIEW — no value in folder name'
  delete row.key
}

await mkdir(OUT_DIR, { recursive: true })

// Never discard review decisions. Re-scanning after someone has spent an hour
// deciding which duplicate folder is the real order should not silently reset
// every action back to the guess.
try {
  const previous = await readFile(path.join(OUT_DIR, 'imports.csv'), 'utf8')

  // Parsed properly rather than split on commas: the rows most likely to carry
  // a decision are exactly the ones containing a comma inside a quoted field —
  // "TC FIRE USD 102,000.00" — and a naive split misaligns every column on them.
  const decided = new Map()
  for (const row of parseCsv(previous)) {
    if (row.action && !row.action.startsWith('REVIEW')) {
      decided.set(row.source_path, { action: row.action, note: row.duplicate_of })
    }
  }

  let kept = 0
  for (const row of imports) {
    const previous = decided.get(row.source_path)
    if (previous && previous.action !== row.action) {
      row.action = previous.action
      row.duplicate_of = previous.note || row.duplicate_of
      kept++
    }
  }

  if (kept) console.log(`Kept ${kept} existing decision(s) from the previous scan.`)
} catch {
  // No previous scan — nothing to preserve.
}

const importColumns = [
  'company_code', 'financial_year', 'supplier_folder', 'import_folder',
  'currency', 'pi_value', 'file_count', 'duplicate_of', 'action', 'source_path',
]
const documentColumns = [
  'import_source_path', 'file_name', 'relative_path', 'detected_type',
  'attaches_to', 'drive_url',
]

await writeFile(path.join(OUT_DIR, 'imports.csv'), csv(imports, importColumns), 'utf8')
await writeFile(path.join(OUT_DIR, 'documents.csv'), csv(documents, documentColumns), 'utf8')

const needsReview = imports.filter((r) => r.action.startsWith('REVIEW'))
const untyped = documents.filter((d) => d.detected_type === '')

console.log(`\nScanned ${ROOT}`)
console.log(`  ${imports.length} candidate imports`)
console.log(`  ${documents.length} documents`)
console.log(`  ${new Set(imports.map((i) => i.supplier_folder)).size} suppliers`)

if (needsReview.length) {
  console.log(`\n${needsReview.length} need a decision before import:`)
  for (const row of needsReview) {
    console.log(`  ${row.company_code}/${row.supplier_folder}/${row.import_folder}`)
    console.log(`      ${row.action}`)
  }
}

console.log(`\n${untyped.length} file(s) whose type could not be guessed.`)
console.log(`\nWritten to ${OUT_DIR}/imports.csv and ${OUT_DIR}/documents.csv`)
console.log('Correct them, then load with:  npm run archive:load')
