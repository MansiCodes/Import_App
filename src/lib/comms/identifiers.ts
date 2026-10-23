/**
 * Recognising the references a supplier quotes in a message.
 *
 * Two different jobs live here, and the distinction matters:
 *
 *   SELF-DESCRIBING formats — an import number, an air waybill, a container —
 *   can be recognised from the text alone, because the shape itself is the
 *   evidence. A container number carries a check digit; either it computes or
 *   the eleven characters were never a container number.
 *
 *   EVERYTHING ELSE — PO, PI, BL, BOE — has no reliable shape. `po_number` is
 *   rendered from a company-editable template, and the real archive holds
 *   ATC_PO_005_26-27, ATC_PTS_PO_003 and ATLANTA _PO_006_PTS side by side. A
 *   regex for that is a regex for anything. Those are found by looking for
 *   values we already hold, which is `findKnown`.
 *
 * Everything is compared on a normalised form, because a human typing an AWB
 * writes "020-1234 5678" and the database holds "020-12345678". There is no
 * model call here and there must never be one.
 */

/** Uppercase, and strip everything that is not a letter or a digit. */
export function normalise(value: string | null | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Import numbers are ours, so the format is exact: IMP-YYYY-NNNN.
 * Returned in canonical form regardless of how they were typed.
 */
export function extractImportNumbers(text: string): string[] {
  const matches = (text ?? '').toUpperCase().matchAll(/\bIMP[\s_-]?(\d{4})[\s_-]?(\d{4})\b/g)
  return unique([...matches].map((m) => `IMP-${m[1]}-${m[2]}`))
}

/**
 * Air waybills are three digits of airline prefix and eight of serial, written
 * with any mix of spaces and hyphens. Eleven digits in a row is the only shape.
 */
export function extractAwbNumbers(text: string): string[] {
  const matches = (text ?? '').matchAll(/\b(\d{3})[\s-]?(\d{4})[\s-]?(\d{4})\b/g)
  return unique([...matches].map((m) => `${m[1]}${m[2]}${m[3]}`))
}

// ISO 6346 letter values. J, K and the rest skip every multiple of 11, which is
// why this is a table and not arithmetic on the character code.
const CONTAINER_LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
}

/**
 * Is this eleven-character string a real container number?
 *
 * Four letters, six digits and a check digit computed over the first ten
 * characters. Without this test any eleven alphanumerics in a message — a bank
 * reference, an order code — would read as a container and match the wrong
 * import.
 */
export function isValidContainerNumber(value: string): boolean {
  const candidate = normalise(value)
  if (!/^[A-Z]{4}\d{7}$/.test(candidate)) return false

  // The fourth letter is the equipment category: U, J or Z. Nothing else is a
  // freight container.
  if (!'UJZ'.includes(candidate[3])) return false

  let sum = 0
  for (let i = 0; i < 10; i++) {
    const char = candidate[i]
    const value = /\d/.test(char) ? Number(char) : CONTAINER_LETTER_VALUES[char]
    sum += value * 2 ** i
  }

  const check = sum % 11 === 10 ? 0 : sum % 11
  return check === Number(candidate[10])
}

export function extractContainerNumbers(text: string): string[] {
  const matches = (text ?? '').toUpperCase().matchAll(/\b([A-Z]{4})[\s-]?(\d{6})[\s-]?(\d)\b/g)
  return unique(
    [...matches].map((m) => `${m[1]}${m[2]}${m[3]}`).filter((c) => isValidContainerNumber(c)),
  )
}

/**
 * Which of the values we already hold appear in this message?
 *
 * Both sides are normalised and compared by containment, so "as per
 * ATC_PO_005_26-27" finds the stored `ATC_PO_005_26-27`.
 *
 * `minLength` is the safety catch. Without it a stored BOE of "12" would match
 * any message containing the digits one and two — which is to say, most of
 * them. Short references are not evidence and are skipped rather than guessed
 * at.
 */
export function findKnown(
  text: string,
  candidates: Array<string | null | undefined>,
  minLength = 5,
): string[] {
  const haystack = normalise(text)
  if (!haystack) return []

  const found = candidates.filter((candidate) => {
    const needle = normalise(candidate)
    return needle.length >= minLength && haystack.includes(needle)
  })

  return unique(found as string[])
}

/**
 * `shipments.container_nos` is one free-text column that may hold several
 * numbers, so a stored value is split before comparison rather than matched
 * whole.
 */
export function splitContainerList(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[\s,;/]+/)
    .map((part) => normalise(part))
    .filter((part) => part.length > 0)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
