import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format an amount in its transaction currency.
 *
 * Amounts are always stored and displayed in the currency they were transacted
 * in. INR equivalents are shown only where a human has entered an explicit FX
 * rate — the app never invents a conversion.
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined || amount === '') return '—'

  const value = typeof amount === 'string' ? Number(amount) : amount
  if (!Number.isFinite(value)) return '—'

  const formatted = value.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return currency ? `${currency} ${formatted}` : formatted
}

/** Short date for dense tables: "14 Aug 2026". */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
