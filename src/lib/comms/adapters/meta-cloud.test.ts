import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createMetaCloudAdapter } from './meta-cloud'

const APP_SECRET = 'test-app-secret'
const VERIFY_TOKEN = 'test-verify-token'

const adapter = createMetaCloudAdapter({ appSecret: APP_SECRET, verifyToken: VERIFY_TOKEN })

function sign(body: string, secret = APP_SECRET): Headers {
  const digest = createHmac('sha256', secret).update(body, 'utf8').digest('hex')
  return new Headers({ 'x-hub-signature-256': `sha256=${digest}` })
}

/** A message the operator forwarded into the bot chat from a supplier group. */
const FORWARDED_TEXT = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '1234567890',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '919000000000', phone_number_id: '111' },
            contacts: [{ profile: { name: 'Ridh' }, wa_id: '919876543210' }],
            messages: [
              {
                from: '919876543210',
                id: 'wamid.FORWARDED_ONE',
                timestamp: '1786780800',
                type: 'text',
                text: { body: 'Container picked up. Stuffing tomorrow.' },
                context: { forwarded: true, frequently_forwarded: false },
              },
            ],
          },
        },
      ],
    },
  ],
}

/** A supplier writing to the bot number directly, with a PDF. */
const DIRECT_DOCUMENT = {
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            contacts: [{ profile: { name: 'Mr Zhang' }, wa_id: '8613800000001' }],
            messages: [
              {
                from: '8613800000001',
                id: 'wamid.DIRECT_DOC',
                timestamp: '1786780900',
                type: 'document',
                document: {
                  id: 'media-9911',
                  mime_type: 'application/pdf',
                  sha256: 'abc123',
                  filename: 'BOE 9068987.pdf',
                  caption: 'BOE attached, please check duty.',
                },
              },
            ],
          },
        },
      ],
    },
  ],
}

describe('verifySignature', () => {
  it('accepts a body signed with the app secret', () => {
    const body = JSON.stringify(FORWARDED_TEXT)
    expect(adapter.verifySignature(body, sign(body))).toBe(true)
  })

  it('rejects a body that was altered after signing', () => {
    // The signature is over the exact bytes. This is the whole reason the route
    // reads request.text() before any JSON.parse.
    const body = JSON.stringify(FORWARDED_TEXT)
    const headers = sign(body)
    const tampered = body.replace('Stuffing tomorrow', 'Please pay USD 44,724.30')

    expect(adapter.verifySignature(tampered, headers)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    const body = JSON.stringify(FORWARDED_TEXT)
    expect(adapter.verifySignature(body, sign(body, 'not-the-secret'))).toBe(false)
  })

  it('rejects a missing or malformed header', () => {
    const body = JSON.stringify(FORWARDED_TEXT)

    expect(adapter.verifySignature(body, new Headers())).toBe(false)
    expect(
      adapter.verifySignature(body, new Headers({ 'x-hub-signature-256': 'deadbeef' })),
    ).toBe(false)
    expect(adapter.verifySignature(body, new Headers({ 'x-hub-signature-256': 'sha256=' }))).toBe(
      false,
    )
  })

  it('refuses everything when no secret is configured', () => {
    // An unauthenticated write endpoint is worse than a broken one.
    const open = createMetaCloudAdapter({ verifyToken: VERIFY_TOKEN })
    const body = JSON.stringify(FORWARDED_TEXT)

    expect(open.verifySignature(body, sign(body))).toBe(false)
  })
})

describe('verifyChallenge', () => {
  it('echoes the challenge when the token matches', () => {
    const params = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': '99887766',
    })
    expect(adapter.verifyChallenge(params)).toBe('99887766')
  })

  it('refuses a wrong token, a wrong mode, or a missing challenge', () => {
    const base = { 'hub.mode': 'subscribe', 'hub.challenge': '1' }

    expect(
      adapter.verifyChallenge(new URLSearchParams({ ...base, 'hub.verify_token': 'wrong' })),
    ).toBeNull()
    expect(
      adapter.verifyChallenge(
        new URLSearchParams({ ...base, 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN }),
      ),
    ).toBeNull()
    expect(
      adapter.verifyChallenge(
        new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN }),
      ),
    ).toBeNull()
  })
})

describe('toInbound', () => {
  it('reads a forwarded message without inventing who wrote it', () => {
    // Meta tells us who pressed forward, never who originally spoke. Attributing
    // the supplier's promise to the operator would be a lie with consequences.
    const [message] = adapter.toInbound(FORWARDED_TEXT)

    expect(message.providerMessageId).toBe('wamid.FORWARDED_ONE')
    expect(message.forwarded).toBe(true)
    expect(message.forwardedByPhone).toBe('919876543210')
    expect(message.forwardedByName).toBe('Ridh')
    expect(message.senderPhone).toBeNull()
    expect(message.senderName).toBeNull()
    expect(message.bodyText).toBe('Container picked up. Stuffing tomorrow.')
    expect(message.messageType).toBe('text')
  })

  it('names the sender when the message came straight from them', () => {
    const [message] = adapter.toInbound(DIRECT_DOCUMENT)

    expect(message.forwarded).toBe(false)
    expect(message.senderPhone).toBe('8613800000001')
    expect(message.senderName).toBe('Mr Zhang')
  })

  it('records an attachment and uses its caption as the body', () => {
    const [message] = adapter.toInbound(DIRECT_DOCUMENT)

    expect(message.messageType).toBe('document')
    expect(message.bodyText).toBe('BOE attached, please check duty.')
    expect(message.attachments).toHaveLength(1)
    expect(message.attachments[0]).toMatchObject({
      providerMediaId: 'media-9911',
      fileName: 'BOE 9068987.pdf',
      mimeType: 'application/pdf',
      sha256: 'abc123',
    })
  })

  it('converts the provider timestamp, which relative dates are read against', () => {
    const [message] = adapter.toInbound(FORWARDED_TEXT)
    expect(message.sentAt).toBe(new Date(1786780800 * 1000).toISOString())
  })

  it('ignores status callbacks, which are not communications', () => {
    // Delivery receipts arrive on the same webhook. Storing them would fill the
    // Inbox with things nobody needs to read.
    const statuses = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.X', status: 'delivered', timestamp: '1786780800' }],
              },
            },
          ],
        },
      ],
    }

    expect(adapter.toInbound(statuses)).toEqual([])
  })

  it('survives payloads it has never seen without throwing', () => {
    expect(adapter.toInbound({})).toEqual([])
    expect(adapter.toInbound(null)).toEqual([])
    expect(adapter.toInbound({ entry: 'not an array' })).toEqual([])
    expect(adapter.toInbound({ entry: [{ changes: [{ value: { messages: [{}] } }] }] })).toEqual([])
  })

  it('reads several messages from one delivery', () => {
    const batch = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'wamid.A', from: '1', timestamp: '1786780800', type: 'text', text: { body: 'One' } },
                  { id: 'wamid.B', from: '1', timestamp: '1786780801', type: 'text', text: { body: 'Two' } },
                ],
              },
            },
          ],
        },
      ],
    }

    const messages = adapter.toInbound(batch)
    expect(messages.map((m) => m.bodyText)).toEqual(['One', 'Two'])
  })
})
