import 'server-only'

import type { DeliveryStatus, SendResult, WhatsAppSender } from './types'

/**
 * Sending through Meta's WhatsApp Cloud API.
 *
 * Kept apart from the inbound adapter because the two need different
 * credentials and fail in different ways: receiving needs an app secret and a
 * verify token, sending needs an access token and a phone number id. A project
 * can legitimately have one and not the other — and this one currently does.
 *
 * TWO THINGS THAT DECIDE WHETHER A SEND WORKS AT ALL:
 *
 *   Business-initiated messages must use an APPROVED TEMPLATE. A CHA has not
 *   messaged us first, so free-form text is rejected by Meta rather than
 *   delivered. sendText exists for the 24-hour service window that follows a
 *   reply, and is not the normal path.
 *
 *   Groups are not addressable. The Cloud API has no group concept, so a quote
 *   link goes to an individual number or it does not go through this at all.
 */

const DEFAULT_API_VERSION = 'v21.0'

export interface MetaSenderEnv {
  accessToken?: string
  phoneNumberId?: string
  apiVersion?: string
}

export function metaSenderConfigured(env: MetaSenderEnv): boolean {
  return Boolean(env.accessToken && env.phoneNumberId)
}

/**
 * E.164, which is what the Cloud API expects: digits only, no plus, no spaces,
 * country code included.
 *
 * Returns null rather than guessing. A number we cannot be confident about is
 * better reported as missing than dialled wrongly — the operator still has
 * Copy link.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null

  const digits = raw.replace(/[^\d]/g, '')
  if (digits.length < 8 || digits.length > 15) return null

  // A ten-digit Indian mobile written without its country code is the common
  // case in this master data. Anything else must already carry one.
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`

  return digits
}

export function createMetaCloudSender(env: MetaSenderEnv): WhatsAppSender {
  const version = env.apiVersion ?? DEFAULT_API_VERSION

  async function post(body: unknown): Promise<SendResult> {
    if (!metaSenderConfigured(env)) {
      return {
        ok: false,
        providerMessageId: null,
        errorCode: 'not_configured',
        errorReason:
          'WhatsApp sending is not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.',
      }
    }

    let response: Response
    try {
      response = await fetch(
        `https://graph.facebook.com/${version}/${env.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      )
    } catch (error) {
      // A network failure is not a delivery failure — nothing was accepted, so
      // the attempt can be retried without risking a duplicate message.
      return {
        ok: false,
        providerMessageId: null,
        errorCode: 'network_error',
        errorReason: error instanceof Error ? error.message : 'Could not reach WhatsApp',
      }
    }

    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      const error = (payload as { error?: { code?: number; message?: string; error_data?: { details?: string } } })
        ?.error
      return {
        ok: false,
        providerMessageId: null,
        errorCode: error?.code ? String(error.code) : String(response.status),
        errorReason: error?.error_data?.details ?? error?.message ?? text.slice(0, 300),
      }
    }

    const id = (payload as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null

    return { ok: true, providerMessageId: id, errorCode: null, errorReason: null }
  }

  return {
    async sendTemplate({ to, templateName, languageCode, parameters }) {
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: parameters.length
            ? [
                {
                  type: 'body',
                  parameters: parameters.map((text) => ({ type: 'text', text })),
                },
              ]
            : [],
        },
      })
    },

    async sendText({ to, body }) {
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        // The quote link must stay clickable, so previews are left enabled.
        text: { preview_url: true, body },
      })
    },

    parseDeliveryStatuses(payload) {
      const out: DeliveryStatus[] = []
      const entries = (payload as { entry?: unknown[] })?.entry
      if (!Array.isArray(entries)) return out

      for (const entry of entries) {
        const changes = (entry as { changes?: unknown[] })?.changes
        if (!Array.isArray(changes)) continue

        for (const change of changes) {
          const statuses = (change as { value?: { statuses?: unknown[] } })?.value?.statuses
          if (!Array.isArray(statuses)) continue

          for (const raw of statuses) {
            const status = raw as {
              id?: string
              status?: string
              timestamp?: string
              errors?: Array<{ code?: number; title?: string; message?: string }>
            }

            if (!status.id || !status.status) continue
            if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) continue

            const error = status.errors?.[0]

            out.push({
              providerMessageId: status.id,
              state: status.status as DeliveryStatus['state'],
              at: status.timestamp
                ? new Date(Number(status.timestamp) * 1000).toISOString()
                : null,
              errorCode: error?.code ? String(error.code) : null,
              errorReason: error?.message ?? error?.title ?? null,
            })
          }
        }
      }

      return out
    },
  }
}

/** The configured sender, or null when outbound is not set up. */
export function getSender(): WhatsAppSender | null {
  const env: MetaSenderEnv = {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION,
  }

  if ((process.env.WHATSAPP_PROVIDER ?? 'meta_cloud') !== 'meta_cloud') return null
  if (!metaSenderConfigured(env)) return null

  return createMetaCloudSender(env)
}
