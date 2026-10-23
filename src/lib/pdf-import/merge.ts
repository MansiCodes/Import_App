/**
 * Turning one or two supplier documents into the figures a form needs.
 *
 * An invoice and a packing list are two views of one shipment, and each is
 * authoritative for different things: the invoice for money, the packing list
 * for weight and volume. Neither is authoritative for both, so merging is not
 * "last one wins" — each field is taken from the document that is actually
 * entitled to state it.
 *
 * Where the two disagree about something they SHOULD agree on — the PI number,
 * the invoice number — the disagreement is reported rather than resolved. Two
 * documents from different shipments loaded together is a real mistake, and it
 * should not silently produce a plausible-looking merge.
 */

import type { ExtractedDocument, ExtractedItem } from './parse'

export interface MergedShipment {
  supplierName: string | null
  buyerName: string | null
  documentDate: string | null
  piNumber: string | null
  invoiceNumber: string | null
  currency: string | null
  totalValue: number | null
  totalQuantity: number | null
  incoterm: string | null
  originCountry: string | null
  mode: 'AIR' | 'SEA_LCL' | null
  grossWeightKg: number | null
  netWeightKg: number | null
  cbm: number | null
  packageCount: number | null
  /** Worked out, not read — see chargeableWeightKg. Null when it cannot be. */
  chargeableWeightKg: number | null
  volumetricWeightKg: number | null
  cargoDescription: string | null
  items: ExtractedItem[]
  /** Which document each figure came from, so the form can say. */
  sources: Record<string, string>
  warnings: string[]
}

/**
 * The IATA volumetric divisor: 6000 cubic centimetres to the kilo.
 *
 * Written as a constant with its unit because a wrong divisor is invisible —
 * 5000 is used for courier traffic and would inflate every chargeable weight by
 * a fifth without anything looking odd.
 */
export const AIR_VOLUMETRIC_DIVISOR_CM3_PER_KG = 6000

const CM3_PER_M3 = 1_000_000

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** What the volume alone would weigh, for air. */
export function volumetricWeightKg(cbm: number | null): number | null {
  if (cbm === null || !(cbm > 0)) return null
  return round2((cbm * CM3_PER_M3) / AIR_VOLUMETRIC_DIVISOR_CM3_PER_KG)
}

/**
 * What an airline will charge on: the greater of actual and volumetric weight.
 *
 * Only for air. Sea LCL is priced on the cubic metre, so there is no chargeable
 * WEIGHT to state and this returns null rather than a number that would be
 * quietly wrong.
 */
export function chargeableWeightKg(
  mode: 'AIR' | 'SEA_LCL' | null,
  grossWeightKg: number | null,
  cbm: number | null,
): number | null {
  if (mode !== 'AIR') return null
  const volumetric = volumetricWeightKg(cbm)
  if (grossWeightKg === null) return volumetric
  if (volumetric === null) return round2(grossWeightKg)
  return round2(Math.max(grossWeightKg, volumetric))
}

/** A one-line summary of what is in the boxes, for the cargo description. */
export function describeCargo(items: ExtractedItem[], totalQuantity: number | null): string | null {
  const names = [...new Set(items.map((i) => i.description).filter(Boolean))]
  if (names.length === 0) return null

  const listed = names.slice(0, 4).join(', ')
  const rest = names.length > 4 ? ` and ${names.length - 4} more` : ''
  const count = totalQuantity !== null ? `${totalQuantity.toLocaleString('en-IN')} pcs — ` : ''

  return `${count}${listed}${rest}`
}

/**
 * Line items from both documents, joined on the supplier's part code.
 *
 * The invoice knows what each line costs; the packing list knows how it is
 * boxed. Matching on the code rather than on row order means a packing list
 * that lists items in a different sequence still lines up.
 */
function mergeItems(invoice: ExtractedItem[], packing: ExtractedItem[]): ExtractedItem[] {
  if (invoice.length === 0) return packing
  if (packing.length === 0) return invoice

  const byCode = new Map(packing.filter((i) => i.specification).map((i) => [i.specification, i]))

  return invoice.map((item) => {
    const packed = item.specification ? byCode.get(item.specification) : undefined
    if (!packed) return item

    return {
      ...item,
      dimensionsCm: packed.dimensionsCm,
      packages: packed.packages,
      netWeightKg: packed.netWeightKg,
    }
  })
}

/** Note a field's origin, so the form can show where a figure came from. */
function pick<T>(
  sources: Record<string, string>,
  field: string,
  candidates: Array<[T | null, string]>,
): T | null {
  for (const [value, source] of candidates) {
    if (value !== null && value !== undefined && value !== '') {
      sources[field] = source
      return value
    }
  }
  return null
}

const KIND_LABELS: Record<string, string> = {
  commercial_invoice: 'commercial invoice',
  packing_list: 'packing list',
  unknown: 'document',
}

export function mergeDocuments(documents: ExtractedDocument[]): MergedShipment {
  const invoice = documents.find((d) => d.kind === 'commercial_invoice') ?? null
  const packing = documents.find((d) => d.kind === 'packing_list') ?? null
  const any = documents[0] ?? null

  const sources: Record<string, string> = {}
  const warnings = documents.flatMap((doc) =>
    doc.warnings.map((w) => `${KIND_LABELS[doc.kind]}: ${w}`),
  )

  // Two documents that name different shipments is a loading mistake, not
  // something to average out.
  const disagreement = (field: keyof ExtractedDocument, label: string) => {
    const values = [...new Set(documents.map((d) => d[field]).filter(Boolean))]
    if (values.length > 1) {
      warnings.push(`The documents disagree about the ${label}: ${values.join(' and ')}.`)
    }
  }
  disagreement('piNumber', 'PI number')
  disagreement('invoiceNumber', 'invoice number')

  const inv = (get: (d: ExtractedDocument) => unknown) => (invoice ? get(invoice) : null)
  const pack = (get: (d: ExtractedDocument) => unknown) => (packing ? get(packing) : null)
  const fallback = (get: (d: ExtractedDocument) => unknown) => (any ? get(any) : null)

  const mode = pick<'AIR' | 'SEA_LCL'>(sources, 'mode', [
    [inv((d) => d.modeHint) as 'AIR' | 'SEA_LCL' | null, 'commercial invoice'],
    [pack((d) => d.modeHint) as 'AIR' | 'SEA_LCL' | null, 'packing list'],
  ])

  // Weight and volume belong to the packing list. The invoice is only consulted
  // when there is no packing list at all.
  const grossWeightKg = pick<number>(sources, 'grossWeightKg', [
    [pack((d) => d.grossWeightKg) as number | null, 'packing list'],
    [inv((d) => d.grossWeightKg) as number | null, 'commercial invoice'],
  ])
  const cbm = pick<number>(sources, 'cbm', [
    [pack((d) => d.cbm) as number | null, 'packing list'],
    [inv((d) => d.cbm) as number | null, 'commercial invoice'],
  ])

  const items = mergeItems(invoice?.items ?? [], packing?.items ?? [])
  const totalQuantity = pick<number>(sources, 'totalQuantity', [
    [inv((d) => d.totalQuantity) as number | null, 'commercial invoice'],
    [pack((d) => d.totalQuantity) as number | null, 'packing list'],
  ])

  const computedChargeable = chargeableWeightKg(mode, grossWeightKg, cbm)
  if (computedChargeable !== null) sources.chargeableWeightKg = 'worked out from weight and volume'

  return {
    supplierName: pick(sources, 'supplierName', [
      [inv((d) => d.supplierName) as string | null, 'commercial invoice'],
      [fallback((d) => d.supplierName) as string | null, 'document'],
    ]),
    buyerName: pick(sources, 'buyerName', [
      [inv((d) => d.buyerName) as string | null, 'commercial invoice'],
      [fallback((d) => d.buyerName) as string | null, 'document'],
    ]),
    documentDate: pick(sources, 'documentDate', [
      [inv((d) => d.documentDate) as string | null, 'commercial invoice'],
      [fallback((d) => d.documentDate) as string | null, 'document'],
    ]),
    piNumber: pick(sources, 'piNumber', [
      [inv((d) => d.piNumber) as string | null, 'commercial invoice'],
      [fallback((d) => d.piNumber) as string | null, 'document'],
    ]),
    invoiceNumber: pick(sources, 'invoiceNumber', [
      [inv((d) => d.invoiceNumber) as string | null, 'commercial invoice'],
      [fallback((d) => d.invoiceNumber) as string | null, 'document'],
    ]),
    // Money is the invoice's to state.
    currency: pick(sources, 'currency', [
      [inv((d) => d.currency) as string | null, 'commercial invoice'],
      [fallback((d) => d.currency) as string | null, 'document'],
    ]),
    totalValue: pick(sources, 'totalValue', [
      [inv((d) => d.totalValue) as number | null, 'commercial invoice'],
      [fallback((d) => d.totalValue) as number | null, 'document'],
    ]),
    totalQuantity,
    incoterm: pick(sources, 'incoterm', [
      [inv((d) => d.incoterm) as string | null, 'commercial invoice'],
      [fallback((d) => d.incoterm) as string | null, 'document'],
    ]),
    originCountry: pick(sources, 'originCountry', [
      [inv((d) => d.originCountry) as string | null, 'commercial invoice'],
      [fallback((d) => d.originCountry) as string | null, 'document'],
    ]),
    mode,
    grossWeightKg,
    netWeightKg: pick(sources, 'netWeightKg', [
      [pack((d) => d.netWeightKg) as number | null, 'packing list'],
      [inv((d) => d.netWeightKg) as number | null, 'commercial invoice'],
    ]),
    cbm,
    packageCount: pick(sources, 'packageCount', [
      [pack((d) => d.packageCount) as number | null, 'packing list'],
      [inv((d) => d.packageCount) as number | null, 'commercial invoice'],
    ]),
    chargeableWeightKg: computedChargeable,
    volumetricWeightKg: volumetricWeightKg(cbm),
    cargoDescription: describeCargo(items, totalQuantity),
    items,
    sources,
    warnings,
  }
}
