import 'server-only'

/**
 * Getting an inbound message into the database, exactly once.
 *
 * This is the only thing the webhook is allowed to do, and it must be the part
 * that cannot fail quietly. Once a row is here the message can no longer be
 * lost, whatever happens to the interpretation afterwards.
 *
 * Idempotency is the database's job, not this function's: the unique index on
 * (provider, provider_message_id) means a redelivered webhook conflicts instead
 * of duplicating. `ignoreDuplicates` then makes the returned rows exactly the
 * ones that were genuinely new, which is what the caller needs to know to avoid
 * parsing the same message twice.
 *
 * Nothing here may create an import, a supplier, a contact or a CHA. A message
 * from a number nobody recognises produces a communication and nothing else.
 */

import { createClient } from '@/lib/supabase/server'
import type { InboundMessage } from './adapters/types'

export interface IngestResult {
  received: number
  created: string[]
  duplicates: number
  errors: string[]
}

export async function ingestMessages(messages: InboundMessage[]): Promise<IngestResult> {
  const result: IngestResult = { received: messages.length, created: [], duplicates: 0, errors: [] }
  if (messages.length === 0) return result

  const supabase = await createClient()

  const rows = messages.map((message) => ({
    source: 'whatsapp',
    provider: message.provider,
    provider_message_id: message.providerMessageId,
    direction: 'inbound',
    forwarded_by_phone: message.forwardedByPhone,
    forwarded_by_name: message.forwardedByName,
    sender_phone: message.senderPhone,
    sender_name: message.senderName,
    message_type: message.messageType,
    body_text: message.bodyText,
    sent_at: message.sentAt,
    raw_payload: message.raw ?? {},
    status: 'new',
  }))

  const { data, error } = await supabase
    .from('communications')
    .upsert(rows, {
      onConflict: 'provider,provider_message_id',
      ignoreDuplicates: true,
    })
    .select('id, provider_message_id')

  if (error) {
    result.errors.push(error.message)
    return result
  }

  const created = data ?? []
  result.created = created.map((row) => row.id)
  result.duplicates = messages.length - created.length

  // Attachments hang off the communications that were actually inserted. On a
  // redelivery there is nothing to attach, because the file rows already exist.
  const byProviderId = new Map(created.map((row) => [row.provider_message_id, row.id]))
  const attachments = messages.flatMap((message) => {
    const communicationId = byProviderId.get(message.providerMessageId)
    if (!communicationId) return []

    return message.attachments.map((attachment) => ({
      communication_id: communicationId,
      provider_media_id: attachment.providerMediaId,
      file_name: attachment.fileName,
      mime_type: attachment.mimeType,
      size_bytes: attachment.sizeBytes,
      sha256: attachment.sha256,
      caption: attachment.caption,
      storage: 'none',
      fetch_status: 'not_fetched',
      // WhatsApp keeps media about 30 days. Recording when it goes turns a file
      // silently vanishing into a dated prompt on the Inbox.
      provider_expires_at: expiryOf(message.sentAt),
    }))
  })

  if (attachments.length > 0) {
    const { error: attachmentError } = await supabase
      .from('communication_attachments')
      .insert(attachments)

    // The message is already safe. A failed attachment row is worth reporting
    // but must not make the webhook look like it lost the message.
    if (attachmentError) result.errors.push(attachmentError.message)
  }

  return result
}

const MEDIA_RETENTION_DAYS = 30

function expiryOf(sentAt: string | null): string {
  const base = sentAt ? new Date(sentAt) : new Date()
  const expiry = new Date(base)
  expiry.setDate(expiry.getDate() + MEDIA_RETENTION_DAYS)
  return expiry.toISOString()
}
