'use client'

import {
  METHOD_LABELS,
  STATUS_LABELS,
  type CalculationMethod,
  type ChargeStatus,
} from '@/lib/freight-quote'

/**
 * One line of a quotation: a name and an amount.
 *
 * The table behind this still carries rate, basis, quantity, currency and
 * status, and the comparison engine still reads all of it. None of that is
 * asked for here. Whoever is entering a quotation is reading a PDF from a CHA
 * and copying figures across; every extra control on the line is a decision
 * they have to make about our pricing model instead of their quotation.
 *
 * So a line writes a fixed INR amount, and the flexible columns keep their
 * defaults. Two things are still SHOWN, never asked:
 *
 *   The currency, when a line already carries one that is not rupees. That
 *   only happens on a quotation submitted before this form was simplified,
 *   and mislabelling those figures as rupees would be worse than showing the
 *   code.
 *
 *   A status such as "at actual", for the same reason. It is carried through a
 *   revision rather than silently dropped, so a charge that was flagged as
 *   unknown does not come back as nothing.
 */

export interface ChargeLine {
  key: string
  charge_type: string
  /** The charge type's name, from the master list. */
  label: string
  /** Set only on a line the quoting company added themselves. */
  custom_label: string
  /*
   * Whether this line is one they added rather than one of ours.
   *
   * Decided by the data, not by how the line got here: a custom charge that is
   * being reopened from an earlier submission is still theirs to rename and to
   * remove. Keying off "was it added in this session" made a reopened custom
   * charge show up under the charge type's own name instead of the one they
   * gave it.
   */
  is_custom: boolean
  /** Almost always INR. Read-only, and only visible when it is not. */
  currency: string
  /** Carried from a previous submission; QUOTED for anything entered here. */
  charge_status: ChargeStatus
  total_amount: string

  /*
   * What an earlier submission said, when it said it in a way this form no
   * longer offers — a rate per chargeable kilo, say. Kept so that revising a
   * quotation does not quietly drop the only figure the line ever carried, and
   * shown so that whoever is revising can see what they are replacing.
   */
  carried_rate: number | null
  carried_method: CalculationMethod
}

/** How an older line described itself, in words. Null when there is nothing to say. */
export function carriedNote(line: ChargeLine): string | null {
  if (line.carried_rate === null) return null
  const amount = `${currencyMark(line.currency)} ${line.carried_rate.toLocaleString('en-IN')}`
  const basis = METHOD_LABELS[line.carried_method].toLowerCase()
  return line.carried_method === 'FIXED' ? `previously ${amount}` : `previously ${amount} ${basis}`
}

/** What one line is worth, or null when nobody has said. */
export function lineAmount(line: ChargeLine): number | null {
  const trimmed = line.total_amount?.toString().trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Whether a line has anything to say at all.
 *
 * A blank line is NOT a charge of zero. Sending one would put a free line into
 * the comparison, and the quotation with the most blanks would win.
 */
export function lineIsMeaningful(line: ChargeLine): boolean {
  return lineAmount(line) !== null || line.charge_status !== 'QUOTED' || line.carried_rate !== null
}

export interface ChargePayload {
  charge_type: string
  custom_label: string | null
  currency: string
  calculation_method: CalculationMethod
  charge_status: ChargeStatus
  rate: number | null
  quantity: null
  total_amount: number | null
  remarks: null
  sort_order: number
}

/**
 * One line, as the database takes it.
 *
 * An amount typed on this form is a plain fixed figure in the line's currency.
 * Left blank, the line keeps whatever an earlier submission gave it — a rate,
 * a status like "at actual" — so that revising a quotation through the
 * simplified form cannot quietly turn a known cost into nothing.
 */
export function toChargePayload(line: ChargeLine, sortOrder: number): ChargePayload {
  const amount = lineAmount(line)

  return {
    charge_type: line.charge_type,
    custom_label: line.custom_label.trim() || null,
    currency: line.currency,
    calculation_method:
      amount !== null ? 'FIXED' : line.carried_rate !== null ? line.carried_method : 'NONE',
    charge_status: amount !== null ? 'QUOTED' : line.charge_status,
    rate: amount !== null ? null : line.carried_rate,
    quantity: null,
    total_amount: amount,
    remarks: null,
    sort_order: sortOrder,
  }
}

const inputClass =
  'w-full rounded-lg border border-border-strong bg-surface-raised px-2.5 py-2 tnum outline-none focus:border-accent'

/** The symbol for the money on this line, or the code when there is none. */
export function currencyMark(currency: string): string {
  return currency === 'INR' ? '₹' : currency
}

export function ChargeRow({
  line,
  onChange,
  onRemove,
}: {
  line: ChargeLine
  onChange: (patch: Partial<ChargeLine>) => void
  onRemove?: () => void
}) {
  const carriedStatus = line.charge_status !== 'QUOTED' ? line.charge_status : null
  const note = line.total_amount ? null : carriedNote(line)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 last:border-0">
      <div className="min-w-40 flex-1">
        {line.is_custom ? (
          <input
            type="text"
            value={line.custom_label}
            placeholder="Charge name"
            onChange={(e) => onChange({ custom_label: e.target.value })}
            className={`${inputClass} max-w-64`}
            aria-label="Charge name"
          />
        ) : (
          <span className="font-medium">{line.label}</span>
        )}

        {carriedStatus && (
          <span className="ml-2 text-ink-faint">{STATUS_LABELS[carriedStatus].toLowerCase()}</span>
        )}
        {note && <span className="ml-2 text-ink-faint">{note}</span>}
      </div>

      <div className="flex items-center gap-2">
        <span className="tnum w-8 text-right text-ink-muted">{currencyMark(line.currency)}</span>
        <input
          type="number"
          step="0.01"
          min="0"
          inputMode="decimal"
          placeholder="Amount"
          value={line.total_amount}
          onChange={(e) => onChange({ total_amount: e.target.value })}
          className={`${inputClass} w-40`}
          aria-label={`${line.custom_label || line.label} amount`}
        />

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="px-1 text-ink-faint hover:text-critical"
            aria-label={`Remove ${line.custom_label || line.label}`}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
