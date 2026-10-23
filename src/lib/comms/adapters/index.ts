/**
 * Which provider is speaking to us.
 *
 * Selected from WHATSAPP_PROVIDER so a second intake — a phone-side automation
 * posting the same shape, or another business API — is a new file and one case
 * here, never a change to matching, parsing or the Inbox.
 *
 * Server-only: this reads the app secret and the verify token, so importing it
 * into a Client Component would put both into a browser bundle.
 */

import 'server-only'

import { createMetaCloudAdapter } from './meta-cloud'
import type { WhatsAppProviderAdapter } from './types'

export type { InboundAttachment, InboundMessage, WhatsAppProviderAdapter } from './types'

export function getAdapter(name = process.env.WHATSAPP_PROVIDER): WhatsAppProviderAdapter | null {
  const env = {
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  }

  switch (name ?? 'meta_cloud') {
    case 'meta_cloud':
      return createMetaCloudAdapter(env)
    default:
      // An unrecognised name is a configuration mistake. Returning null makes
      // the route answer 503 and say so, rather than silently accepting posts
      // it cannot authenticate.
      return null
  }
}
