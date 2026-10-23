/**
 * PO number rendering.
 *
 * The historical POs use at least three incompatible formats:
 *   ATC_PO_006_26-27      ATC_26_27_004_Securiton      PO_VCON_Thermo_034
 *
 * Rather than impose one, each company carries a template and the app only ever
 * SUGGESTS the rendered value — the operator can overwrite it entirely. The
 * sequence is claimed on save only when the saved number still matches the
 * suggestion, so abandoning a draft form never burns a number.
 */

import { financialYear } from './fy'

export interface PoTemplateContext {
  /** Company short code, e.g. ATC / NOTO / VCON. */
  companyCode: string
  /** Sequence number for this company and financial year. */
  seq: number
  /** Date the PO is dated; drives {FY} and {YYYY}. */
  date: Date
  /** Month the company's financial year starts (1-12). */
  fyStartMonth: number
  /** Optional supplier name for templates that include it. */
  supplierName?: string | null
}

/** Placeholders understood by a PO number template. */
export const PO_PLACEHOLDERS = [
  '{COMPANY}',
  '{SEQ}',
  '{SEQ:n}',
  '{FY}',
  '{FYYY}',
  '{YYYY}',
  '{SUPPLIER}',
] as const

/**
 * Suppliers appear in PO numbers as compact tokens ("Thermo" for Thermocable),
 * so we upper-case and strip anything that would be awkward in a document name.
 */
function supplierToken(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Render a company's PO template.
 *
 * Unknown placeholders are left untouched rather than silently blanked — a
 * visible `{FOO}` in the suggestion tells the operator the template is wrong,
 * where an empty string would hide it.
 */
export function renderPoNumber(template: string, ctx: PoTemplateContext): string {
  const fy = financialYear(ctx.date, ctx.fyStartMonth)

  return template.replace(/\{(\w+)(?::(\d+))?\}/g, (match, token: string, width?: string) => {
    switch (token.toUpperCase()) {
      case 'COMPANY':
        return ctx.companyCode
      case 'SEQ':
        return width ? String(ctx.seq).padStart(Number(width), '0') : String(ctx.seq)
      case 'FY':
        return fy.label
      case 'FYYY':
        return fy.longLabel
      case 'YYYY':
        return String(ctx.date.getFullYear())
      case 'SUPPLIER':
        return ctx.supplierName ? supplierToken(ctx.supplierName) : ''
      default:
        return match
    }
  })
}
