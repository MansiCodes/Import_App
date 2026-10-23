/**
 * Small helpers shared by the quote request screen and its tests.
 *
 * Tokens themselves live in freight-token.ts (server-only). This file is safe
 * to import from Client Components: it never reads credentials.
 */

/** Zip extra company names with the phone typed on the same row. */
export function pairNamedPhones(
  names: string[],
  phones: string[],
): Array<{ name: string; phone: string | null }> {
  return names.map((name, index) => {
    const phone = phones[index]?.trim() || null
    return { name, phone }
  })
}

/** Recipients who should appear as Pending in a comparison that already has quotes. */
export function pendingVendors<T extends { id: string; status: string }>(
  recipients: T[],
  submittedRecipientIds: Iterable<string>,
): T[] {
  const submitted = new Set(submittedRecipientIds)
  return recipients.filter((recipient) => recipient.status !== 'Revoked' && !submitted.has(recipient.id))
}

/**
 * Opens a WhatsApp chat with a pre-filled message.
 *
 * `e164Digits` is digits only, no plus — the same shape Meta's Cloud API uses.
 * Each call must pass THAT recipient's message (and therefore their unique link).
 */
export function whatsappChatUrl(e164Digits: string, text: string): string {
  return `https://wa.me/${e164Digits}?text=${encodeURIComponent(text)}`
}
