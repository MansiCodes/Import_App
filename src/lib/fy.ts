/**
 * Financial-year helpers.
 *
 * Only ATC currently files by financial year — its folders are literally named
 * "26-27" — so the start month is a per-company setting rather than a global
 * assumption. A company with fy_start_month = 1 runs on calendar years and gets
 * a single-year label instead of a spanning one.
 */

export interface FinancialYear {
  /** Calendar year in which the financial year starts. */
  startYear: number
  /** Calendar year in which it ends. Equals startYear for calendar-year companies. */
  endYear: number
  /** Short label, matching the existing folder convention: "26-27" (or "2026"). */
  label: string
  /** Long label: "2026-27" (or "2026"). */
  longLabel: string
}

/**
 * Resolve the financial year a date falls in.
 *
 * @param date        the date to classify
 * @param startMonth  1-12, the month the financial year begins (April = 4)
 */
export function financialYear(date: Date, startMonth: number): FinancialYear {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error(`fy_start_month must be 1-12, received ${startMonth}`)
  }

  const year = date.getFullYear()
  const month = date.getMonth() + 1 // getMonth() is 0-based

  // January start means the financial year is the calendar year.
  if (startMonth === 1) {
    return {
      startYear: year,
      endYear: year,
      label: String(year),
      longLabel: String(year),
    }
  }

  const startYear = month >= startMonth ? year : year - 1
  const endYear = startYear + 1

  const twoDigit = (y: number) => String(y % 100).padStart(2, '0')

  return {
    startYear,
    endYear,
    label: `${twoDigit(startYear)}-${twoDigit(endYear)}`,
    longLabel: `${startYear}-${twoDigit(endYear)}`,
  }
}
