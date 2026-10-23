/**
 * Deterministic `{{placeholder}}` substitution.
 *
 * There is no model call here and there must never be one. The spec forbids AI
 * in v1, and this is the one place in the system where "just have it draft the
 * email" would be tempting — which is exactly why the substitution is dumb,
 * total and testable.
 *
 * Two rules follow from that:
 *
 *   - An UNKNOWN placeholder is left standing. Blanking it would produce an
 *     email with a hole in it that reads as finished; leaving `{{whatsit}}`
 *     visible makes a broken template obvious on the review screen, before it
 *     reaches a supplier.
 *
 *   - A KNOWN placeholder with no value becomes the empty string. That is a
 *     value the caller supplied deliberately, not a template error.
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export type Placeholders = Record<string, string | null | undefined>

export function renderTemplate(template: string, values: Placeholders): string {
  return template.replace(PLACEHOLDER, (match, key: string) =>
    Object.hasOwn(values, key) ? (values[key] ?? '') : match,
  )
}

/** Every distinct placeholder a template refers to, in first-appearance order. */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>()
  for (const match of template.matchAll(PLACEHOLDER)) found.add(match[1])
  return [...found]
}

/**
 * Placeholders a template asks for that the caller cannot supply.
 *
 * Surfaced before sending rather than after: an email that went out saying
 * "Dear {{supplier_contact}}" cannot be unsent.
 */
export function missingPlaceholders(template: string, values: Placeholders): string[] {
  return extractPlaceholders(template).filter((key) => !Object.hasOwn(values, key))
}

/** Placeholders that resolved to nothing — supplied, but empty. */
export function emptyPlaceholders(template: string, values: Placeholders): string[] {
  return extractPlaceholders(template).filter(
    (key) => Object.hasOwn(values, key) && (values[key] ?? '') === '',
  )
}

/**
 * A Gmail compose URL for the rendered draft.
 *
 * Opens a compose window with the fields filled; it does NOT send. The app
 * never sends on anyone's behalf — writing to a supplier is a commercial act.
 */
export function gmailComposeUrl({
  to,
  cc,
  subject,
  body,
}: {
  to?: string | null
  cc?: string | null
  subject: string
  body: string
}): string {
  const params = new URLSearchParams({ view: 'cm', fs: '1', su: subject, body })
  if (to) params.set('to', to)
  if (cc) params.set('cc', cc)
  return `https://mail.google.com/mail/?${params.toString()}`
}
