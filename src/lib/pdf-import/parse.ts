/**
 * Reading a supplier's commercial invoice or packing list.
 *
 * These arrive as PDFs laid out as tables, and a PDF has no table — only text
 * at coordinates. Extraction flattens that back into lines, and the flattening
 * is lossy in a specific way: a value in a narrow right-hand column can land in
 * the middle of the NEXT row's line. In the real packing list here, the gross
 * weight and volume totals land inside the second item's quantity, turning 360
 * into 25360.
 *
 * So this parser does not trust column positions. It reads:
 *
 *   THE LABELLED TOTALS — "Gross Weight Total: 66.60 kgs", "Total: 5 cartons",
 *   "Volume Total: 0.25 m3". These are written as sentences, survive the
 *   flattening intact, and are the figures the forms actually need.
 *
 *   THE TOTAL ROW, as a cross-check and a fallback.
 *
 *   LINE ITEMS, anchored on something unmistakable — a unit price written as
 *   "4.00 /pc", or a dimension written as "53.5*41.5*21.6" — and bounded to the
 *   row they were found on.
 *
 * Where a row cannot be read confidently it is left out and a warning says so.
 * A missing line the operator can see is recoverable; a quantity of 25,360 that
 * looks like data is not.
 *
 * Everything here is pure text-in, data-out, so the awkward real documents are
 * fixtures in parse.test.ts rather than something to try by hand.
 */

export type DocumentKind = 'commercial_invoice' | 'packing_list' | 'unknown'

export interface ExtractedItem {
  /** The supplier's part code, e.g. NF5260. */
  specification: string | null
  description: string
  quantity: number | null
  unitPrice: number | null
  amount: number | null
  /** As printed, e.g. "53.5*41.5*21.6". Not converted — units vary. */
  dimensionsCm: string | null
  packages: number | null
  netWeightKg: number | null
}

export interface ExtractedDocument {
  kind: DocumentKind
  supplierName: string | null
  buyerName: string | null
  /** ISO date, and only when the document wrote one that cannot be misread. */
  documentDate: string | null
  piNumber: string | null
  invoiceNumber: string | null
  currency: string | null
  totalValue: number | null
  totalQuantity: number | null
  incoterm: string | null
  originCountry: string | null
  modeHint: 'AIR' | 'SEA_LCL' | null
  grossWeightKg: number | null
  netWeightKg: number | null
  cbm: number | null
  packageCount: number | null
  items: ExtractedItem[]
  /** Anything a person should look at before trusting the rest. */
  warnings: string[]
}

const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** Currency written as a symbol, a code, or the two run together as "US$". */
const CURRENCY_MARKS: Array<[RegExp, string]> = [
  [/\bUS\s?\$|\bUSD\b/i, 'USD'],
  [/\bEUR\b|€/, 'EUR'],
  [/\bGBP\b|£/, 'GBP'],
  [/\bCNY\b|\bRMB\b|￥|¥/i, 'CNY'],
  [/\bJPY\b/i, 'JPY'],
  [/\bAED\b/i, 'AED'],
  [/\bSGD\b/i, 'SGD'],
  [/\bCHF\b/i, 'CHF'],
  [/\bINR\b|₹/, 'INR'],
]

/**
 * Full-width punctuation is normal in documents typed in China: "Date：" and
 * "Total：" both appear in these files. Folded early so every pattern below can
 * be written once.
 */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
}

function toNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, '').trim()
  if (!/^\d*\.?\d+$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/**
 * A reference number, with the spaces the layout introduced taken back out.
 *
 * The same purchase order prints as "ATC/PO/26-27/013" on the invoice and
 * "ATC/PO/26 -27/013" on the packing list. Those are one number, and treating
 * them as two would mean the pair of documents no longer agrees.
 */
export function tidyReference(raw: string): string {
  return raw
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
}

/**
 * A date, but only one that cannot be read two ways.
 *
 * "Sep.03, 2026" and "2026-09-03" are unambiguous. "03/09/2026" is not — it is
 * the third of September to the supplier and the ninth of March to a US reader
 * — so it is refused rather than guessed at, and the caller warns.
 */
export function parseDocumentDate(raw: string): string | null {
  const text = raw.trim()

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // "Sep.03, 2026", "Sep 3 2026", "September 3, 2026"
  const named = text.match(/\b([A-Za-z]{3,9})\.?\s*(\d{1,2})\s*,?\s*(\d{4})\b/)
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()]
    if (month) {
      return `${named[3]}-${String(month).padStart(2, '0')}-${named[2].padStart(2, '0')}`
    }
  }

  // "3 Sep 2026"
  const dayFirst = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})\b/)
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].slice(0, 3).toLowerCase()]
    if (month) {
      return `${dayFirst[3]}-${String(month).padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`
    }
  }

  return null
}

function detectKind(text: string): DocumentKind {
  if (/COMMERCIAL\s*INVOICE/i.test(text)) return 'commercial_invoice'
  if (/PACKING\s*LIST/i.test(text)) return 'packing_list'
  if (/\bPROFORMA\b|\bPRO\s*FORMA\b/i.test(text)) return 'commercial_invoice'
  return 'unknown'
}

function detectCurrency(text: string): string | null {
  for (const [pattern, code] of CURRENCY_MARKS) {
    if (pattern.test(text)) return code
  }
  return null
}

/**
 * The company that issued the document.
 *
 * Taken from the trading-name line near the top rather than from a "FROM:"
 * label, because these documents do not carry one — the letterhead is the
 * sender.
 */
function findSupplier(lines: string[]): string | null {
  const suffix =
    /\b(co\.?,?\s*ltd|company limited|limited|llc|inc\.?|corp\.?|gmbh|pte\.?\s*ltd|trading)\b/i
  const billToAt = lines.findIndex((l) => /^BILL\s*TO/i.test(l))
  const searchable = billToAt > 0 ? lines.slice(0, billToAt) : lines

  return searchable.find((line) => suffix.test(line) && line.length > 6)?.trim() ?? null
}

/** The first real line after a "BILL TO:" / "SHIP TO:" label. */
function findAfterLabel(lines: string[], label: RegExp): string | null {
  const index = lines.findIndex((line) => label.test(line))
  if (index === -1) return null

  // The name can sit on the label's own line ("BILL TO: ACME") or under it.
  const sameLine = lines[index].replace(label, '').replace(/^:\s*/, '').trim()
  if (sameLine) return sameLine

  return lines.slice(index + 1).find((line) => line.trim())?.trim() ?? null
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim()
}

/**
 * The country the goods leave from.
 *
 * Preferred from the incoterm line, because "FOB CHINA BY AIR" states it as a
 * term of the sale. The supplier's own address is the fallback.
 */
function findOrigin(text: string, lines: string[]): string | null {
  const term = text.match(
    new RegExp(
      `\\b(?:${INCOTERMS.join('|')})\\b[\\s,]+([A-Za-z][A-Za-z .'-]{2,30}?)(?=\\s+BY\\b|\\s*$|\\n)`,
      'i',
    ),
  )
  if (term) return titleCase(term[1].trim())

  const billToAt = lines.findIndex((l) => /^BILL\s*TO/i.test(l))
  const header = (billToAt > 0 ? lines.slice(0, billToAt) : lines).join(' ')
  const country = header.match(
    /\b(CHINA|INDIA|VIETNAM|TAIWAN|KOREA|JAPAN|GERMANY|ITALY|TURKEY|THAILAND|MALAYSIA|SINGAPORE|INDONESIA|SWITZERLAND|USA|UNITED STATES)\b/i,
  )
  return country ? titleCase(country[1]) : null
}

/**
 * The rows of a table, rebuilt from flattened lines.
 *
 * A row is found by its anchor — the thing that can only appear on a real row,
 * such as a unit price written "4.00 /pc". A description that wrapped onto its
 * own line is picked up by looking one line back, and only when that line
 * starts like a row and carries no anchor of its own.
 *
 * Bounded to at most two lines on purpose. An earlier version matched across
 * the whole document and read a row out of the supplier's street address,
 * because a lazy match will still span a hundred lines if that is what it takes
 * to succeed.
 */
function tableRows(lines: string[], anchor: RegExp, starter: RegExp): string[] {
  const rows: string[] = []

  lines.forEach((line, index) => {
    if (!anchor.test(line)) return

    const previous = index > 0 ? lines[index - 1] : ''
    const continued = previous !== '' && starter.test(previous) && !anchor.test(previous)

    rows.push(continued ? `${previous} ${line}` : line)
  })

  return rows
}

const ITEM_START = /^\d[\d,]*\s+[A-Z][A-Z0-9-]{2,}\b/
const UNIT_PRICE = /[\d,]*\.?\d+\s*\/\s*[A-Za-z]+\s+[\d,]*\.?\d+/
const DIMENSION = /\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?\s*[*x×]\s*\d+(?:\.\d+)?/

/**
 * Line items from a commercial invoice.
 *
 * Anchored on the unit price, which these documents write with its unit
 * attached — "4.00 /pc". That token appears once per row and nowhere else.
 */
function invoiceItems(lines: string[]): ExtractedItem[] {
  const pattern =
    /^(\d{1,3})\s+([A-Z][A-Z0-9-]{2,})\s+(.+?)\s+(\d[\d,]*)\s+([\d,]*\.?\d+)\s*\/\s*[A-Za-z]+\s+([\d,]*\.?\d+)\b/

  const items: ExtractedItem[] = []
  for (const row of tableRows(lines, UNIT_PRICE, ITEM_START)) {
    const match = row.match(pattern)
    if (!match) continue

    items.push({
      specification: match[2],
      description: match[3].replace(/\s+/g, ' ').trim(),
      quantity: toNumber(match[4]),
      unitPrice: toNumber(match[5]),
      amount: toNumber(match[6]),
      dimensionsCm: null,
      packages: null,
      netWeightKg: null,
    })
  }
  return items
}

/**
 * Line items from a packing list.
 *
 * Anchored on the printed dimension, "53.5*41.5*21.6". The leading quantity
 * must not be preceded by a digit or a decimal point, which is what stops a
 * total that bled into the row ("0.25360 NF5260") from being read as a quantity
 * of 25,360. A row lost that way is reported, never guessed.
 */
function packingItems(lines: string[]): ExtractedItem[] {
  const pattern = new RegExp(
    String.raw`(?<![\d.])(\d[\d,]*)\s+([A-Z][A-Z0-9-]{2,})\s+(.+?)\s+(${DIMENSION.source})\s+(\d+)(?:\s+([\d,]*\.?\d+))?`,
  )

  const items: ExtractedItem[] = []
  for (const row of tableRows(lines, DIMENSION, ITEM_START)) {
    const match = row.match(pattern)
    if (!match) continue

    items.push({
      specification: match[2],
      description: match[3].replace(/\s+/g, ' ').trim(),
      quantity: toNumber(match[1]),
      unitPrice: null,
      amount: null,
      dimensionsCm: match[4].replace(/\s+/g, ''),
      packages: toNumber(match[5]),
      netWeightKg: toNumber(match[6]),
    })
  }
  return items
}

/**
 * The number written on the line that carries this label.
 *
 * Line-scoped, and it skips a line that carries the label but no number — the
 * packing list has a column HEADER reading "VOLUME" several lines above the
 * sentence "Volume Total: 0.25 m3", and that header is followed by the first
 * item's quantity. Searching the whole document for the label and then for the
 * next number read that quantity as the volume.
 */
function labelledNumber(lines: string[], label: RegExp): number | null {
  for (const line of lines) {
    if (!label.test(line)) continue
    const found = line.replace(label, ' ').match(/[\d,]*\.?\d+/)
    const value = toNumber(found?.[0])
    if (value !== null) return value
  }
  return null
}

/** A count written before its unit, as in "5 cartons". */
function countOf(lines: string[], unit: RegExp): number | null {
  const pattern = new RegExp(String.raw`([\d,]+)\s*(?:${unit.source})`, 'i')

  for (const line of lines) {
    const match = line.match(pattern)
    if (match) return toNumber(match[1])
  }
  return null
}

/** Read one document's text into fields. */
export function parseDocument(rawText: string): ExtractedDocument {
  const text = normalise(rawText)
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const warnings: string[] = []

  const kind = detectKind(text)
  if (kind === 'unknown') {
    warnings.push('Could not tell whether this is an invoice or a packing list.')
  }

  const dateLine = text.match(/\bDate\s*:?\s*([^\n]+)/i)
  const documentDate = dateLine ? parseDocumentDate(dateLine[1]) : null
  if (dateLine && !documentDate) {
    warnings.push(`Could not read the date "${dateLine[1].trim()}" without guessing at it.`)
  }

  const piMatch = text.match(/\bP\.?\s?I\.?\s*NO\.?\s*:?\s*([^\n]+)/i)
  const invoiceMatch = text.match(/\bInvoice\s*No\.?\s*:?\s*([^\n]+)/i)

  // "580 TOTAL: 5 61.60 66.60 0.25" on a packing list, "580 Total" on an
  // invoice. The trailing figures follow the printed column order: packages,
  // net weight, gross weight, volume.
  const totalRowLine = lines.find((line) => /^\d[\d,]*\s+TOTAL\b/i.test(line))
  const totalRow = totalRowLine?.match(/^(\d[\d,]*)\s+TOTAL\b\s*:?\s*(.*)$/i) ?? null
  const totalRowNumbers = totalRow
    ? (totalRow[2].match(/[\d,]*\.?\d+/g) ?? []).map((n) => toNumber(n))
    : []

  // The labelled sentence wins; the total row fills anything it did not say.
  const [rowPackages, rowNet, rowGross, rowVolume] = totalRowNumbers

  const grossWeightKg =
    labelledNumber(lines, /gross\s*weight\s*(?:total)?\s*:?/i) ?? rowGross ?? null
  const netWeightKg = labelledNumber(lines, /net\s*weight\s*(?:total)?\s*:?/i) ?? rowNet ?? null
  const cbm =
    labelledNumber(lines, /(?:volume|measurement|cbm)\s*(?:total)?\s*:?/i) ?? rowVolume ?? null
  const packageCount =
    countOf(lines, /cartons?|ctns?|packages?|pkgs?|boxes|cases/i) ?? rowPackages ?? null

  const totalValueMatch = text.match(
    /Total\s*amount\s*:?\s*(?:US\s?\$|USD|EUR|GBP|CNY|RMB|INR|₹|€|£|\$)?\s*([\d,]+\.?\d*)/i,
  )
  const totalQuantity = totalRow ? toNumber(totalRow[1]) : null

  const incotermMatch = text.match(new RegExp(`\\b(${INCOTERMS.join('|')})\\b`, 'i'))

  const items = kind === 'packing_list' ? packingItems(lines) : invoiceItems(lines)

  // Every row should add up to the stated total. When it does not, say so
  // rather than quietly presenting a short list as the whole shipment.
  const itemQuantity = items.reduce((sum, item) => sum + (item.quantity ?? 0), 0)
  if (totalQuantity !== null && items.length > 0 && itemQuantity !== totalQuantity) {
    warnings.push(
      `Read ${items.length} line${items.length === 1 ? '' : 's'} totalling ${itemQuantity} against a stated total of ${totalQuantity}. Check the lines against the document.`,
    )
  }

  if (items.length === 0) {
    warnings.push('No line items could be read from this document.')
  }

  return {
    kind,
    supplierName: findSupplier(lines),
    buyerName: findAfterLabel(lines, /^BILL\s*TO\s*:?/i),
    documentDate,
    piNumber: piMatch ? tidyReference(piMatch[1]) : null,
    invoiceNumber: invoiceMatch ? tidyReference(invoiceMatch[1]) : null,
    currency: detectCurrency(text),
    totalValue: toNumber(totalValueMatch?.[1]),
    totalQuantity,
    incoterm: incotermMatch ? incotermMatch[1].toUpperCase() : null,
    originCountry: findOrigin(text, lines),
    modeHint: /\bBY\s*AIR\b|\bAIR\s*FREIGHT\b/i.test(text)
      ? 'AIR'
      : /\bBY\s*SEA\b|\bOCEAN\s*FREIGHT\b|\bLCL\b|\bFCL\b/i.test(text)
        ? 'SEA_LCL'
        : null,
    grossWeightKg,
    netWeightKg,
    cbm,
    packageCount,
    items,
    warnings,
  }
}
