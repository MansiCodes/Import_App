/**
 * Meta WhatsApp Cloud API.
 *
 * Two things here are security-critical and easy to get subtly wrong:
 *
 *   1. The signature is HMAC-SHA256 over the RAW request body. Calling
 *      request.json() first consumes the stream, and re-serialising will not
 *      reproduce the bytes Meta signed — key order, whitespace and unicode
 *      escaping all differ. The failure looks exactly like a wrong secret,
 *      which is why it costs people days.
 *
 *   2. Comparison is timing-safe. A plain === leaks how much of a forged
 *      signature was correct, one byte at a time.
 *
 * On identity: a message forwarded into the bot chat arrives `from` the
 * operator's own handset, and Meta does not tell us who originally wrote it.
 * That is recorded honestly — `forwardedByPhone` is set, `senderPhone` is null
 * — rather than attributing a supplier's promise to whoever pressed forward.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  InboundAttachment,
  InboundMessage,
  InboundMessageType,
  WhatsAppProviderAdapter,
} from './types'

const PROVIDER = 'meta_cloud'

/** Media types Meta sends that carry a file we should record. */
const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'] as const

export function createMetaCloudAdapter(env: {
  appSecret?: string
  verifyToken?: string
}): WhatsAppProviderAdapter {
  return {
    name: PROVIDER,

    verifyChallenge(params) {
      const mode = params.get('hub.mode')
      const token = params.get('hub.verify_token')
      const challenge = params.get('hub.challenge')

      if (!env.verifyToken) return null
      if (mode !== 'subscribe' || !challenge) return null

      return safeEqual(token ?? '', env.verifyToken) ? challenge : null
    },

    verifySignature(rawBody, headers) {
      // No secret configured means no way to tell friend from forgery. Refuse
      // rather than accept everything — an open write endpoint is worse than a
      // broken one.
      if (!env.appSecret) return false

      const header = headers.get('x-hub-signature-256')
      if (!header?.startsWith('sha256=')) return false

      const expected = createHmac('sha256', env.appSecret).update(rawBody, 'utf8').digest('hex')
      return safeEqual(header.slice('sha256='.length), expected)
    },

    toInbound(payload) {
      const messages: InboundMessage[] = []
      const root = payload as MetaWebhook

      for (const entry of asArray(root?.entry)) {
        for (const change of asArray(entry?.changes)) {
          const value = change?.value
          if (!value) continue

          // Delivery receipts and read markers arrive on the same webhook and
          // are not communications. Ignore rather than store noise.
          for (const message of asArray(value.messages)) {
            const inbound = toMessage(message, value)
            if (inbound) messages.push(inbound)
          }
        }
      }

      return messages
    },
  }
}

function toMessage(message: MetaMessage, value: MetaValue): InboundMessage | null {
  if (!message?.id) return null

  const from = message.from ?? null
  const forwarded = Boolean(message.context?.forwarded || message.context?.frequently_forwarded)

  // The profile name Meta supplies belongs to the account that sent it to us,
  // which on a forward is the operator.
  const contact = asArray(value.contacts).find((c) => c?.wa_id === from)
  const profileName = contact?.profile?.name ?? null

  const type = normaliseType(message.type)
  const media = mediaOf(message)

  return {
    provider: PROVIDER,
    providerMessageId: message.id,

    forwardedByPhone: from,
    forwardedByName: profileName,

    // Only claim a sender when the payload actually identifies one.
    senderPhone: forwarded ? null : from,
    senderName: forwarded ? null : profileName,

    forwarded,
    messageType: type,
    bodyText: bodyOf(message),
    sentAt: timestampOf(message.timestamp),
    attachments: media ? [media] : [],
    raw: message,
  }
}

function bodyOf(message: MetaMessage): string | null {
  if (message.text?.body) return message.text.body

  // A caption is the operator's own words about the file and is the only text
  // a media message carries.
  for (const key of MEDIA_TYPES) {
    const caption = (message[key] as MetaMedia | undefined)?.caption
    if (caption) return caption
  }

  if (message.button?.text) return message.button.text
  if (message.interactive?.list_reply?.title) return message.interactive.list_reply.title
  if (message.interactive?.button_reply?.title) return message.interactive.button_reply.title

  return null
}

function mediaOf(message: MetaMessage): InboundAttachment | null {
  for (const key of MEDIA_TYPES) {
    const media = message[key] as MetaMedia | undefined
    if (!media?.id) continue

    return {
      providerMediaId: media.id,
      fileName: media.filename ?? null,
      mimeType: media.mime_type ?? null,
      sizeBytes: typeof media.file_size === 'number' ? media.file_size : null,
      sha256: media.sha256 ?? null,
      caption: media.caption ?? null,
    }
  }

  return null
}

function normaliseType(type: string | undefined): InboundMessageType {
  switch (type) {
    case 'text':
    case 'image':
    case 'document':
    case 'audio':
    case 'video':
    case 'contact':
    case 'location':
      return type
    case 'contacts':
      return 'contact'
    case 'sticker':
      return 'image'
    default:
      return 'other'
  }
}

/** Meta sends seconds since the epoch, as a string. */
function timestampOf(value: string | number | undefined): string | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}

/**
 * Constant-time comparison that also tolerates a length mismatch — which
 * timingSafeEqual throws on rather than returning false.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

// --- The shape Meta sends. Only the parts this adapter reads. ---------------

interface MetaMedia {
  id?: string
  mime_type?: string
  sha256?: string
  filename?: string
  caption?: string
  file_size?: number
}

interface MetaMessage {
  id?: string
  from?: string
  timestamp?: string | number
  type?: string
  text?: { body?: string }
  context?: { forwarded?: boolean; frequently_forwarded?: boolean }
  button?: { text?: string }
  interactive?: {
    list_reply?: { title?: string }
    button_reply?: { title?: string }
  }
  [key: string]: unknown
}

interface MetaValue {
  messages?: MetaMessage[]
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
}

interface MetaWebhook {
  entry?: Array<{ changes?: Array<{ value?: MetaValue }> }>
}
