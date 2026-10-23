/**
 * The outbound half of the WhatsApp adapter.
 *
 * NOTHING HERE TALKS TO META. `fetch` is replaced for every test, so the suite
 * cannot send a real message however it is run — on a laptop with live
 * credentials in the environment, or in CI. The assertions are about the
 * request we would have made, which is the part that can be wrong.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMetaCloudSender, metaSenderConfigured, toE164 } from './meta-cloud-sender'

const ENV = { accessToken: 'test-token', phoneNumberId: '111222333', apiVersion: 'v21.0' }

let calls: Array<{ url: string; init: RequestInit }>

/** Stand in for the Graph API, and record what it was asked to do. */
function stubFetch(response: { status: number; body: unknown }) {
  calls = []
  const fake = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => JSON.stringify(response.body),
    } as Response
  })
  vi.stubGlobal('fetch', fake)
  return fake
}

beforeEach(() => {
  calls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('toE164', () => {
  it('adds the country code to a bare Indian mobile, which is how the master data is written', () => {
    expect(toE164('98100 00002')).toBe('919810000002')
    expect(toE164('9810000002')).toBe('919810000002')
  })

  it('keeps a number that already carries its country code', () => {
    expect(toE164('+91 98100 00002')).toBe('919810000002')
    expect(toE164('+86 138 0000 0001')).toBe('8613800000001')
  })

  it('refuses to guess rather than dialling something wrong', () => {
    // A landline-shaped ten digits starting 0 is not a mobile country-code case.
    expect(toE164('0114000123')).toBe('0114000123')
    expect(toE164('12345')).toBeNull()
    expect(toE164('')).toBeNull()
    expect(toE164(null)).toBeNull()
    expect(toE164(undefined)).toBeNull()
    expect(toE164('1234567890123456')).toBeNull()
  })
})

describe('metaSenderConfigured', () => {
  it('needs both halves of the credential, not one', () => {
    expect(metaSenderConfigured(ENV)).toBe(true)
    expect(metaSenderConfigured({ accessToken: 'x' })).toBe(false)
    expect(metaSenderConfigured({ phoneNumberId: '1' })).toBe(false)
    expect(metaSenderConfigured({})).toBe(false)
  })
})

describe('sendTemplate', () => {
  it('posts an approved template with its parameters in order', async () => {
    stubFetch({ status: 200, body: { messages: [{ id: 'wamid.SENT_ONE' }] } })

    const result = await createMetaCloudSender(ENV).sendTemplate({
      to: '919810000002',
      templateName: 'freight_quote_request',
      languageCode: 'en',
      parameters: ['DV Logistics', 'AIR', 'PVG', 'DEL', '420 kg', '6', 'FOB', 'https://x/q/tok'],
    })

    expect(result.ok).toBe(true)
    expect(result.providerMessageId).toBe('wamid.SENT_ONE')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://graph.facebook.com/v21.0/111222333/messages')

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')

    const body = JSON.parse(String(calls[0].init.body))
    expect(body.messaging_product).toBe('whatsapp')
    expect(body.type).toBe('template')
    expect(body.to).toBe('919810000002')
    expect(body.template.name).toBe('freight_quote_request')
    expect(body.template.language).toEqual({ code: 'en' })
    // The order is the contract with the approved template: {{8}} is the link.
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      'DV Logistics',
      'AIR',
      'PVG',
      'DEL',
      '420 kg',
      '6',
      'FOB',
      'https://x/q/tok',
    ])
  })

  it('never sends a document, an image or an attachment of any kind', async () => {
    stubFetch({ status: 200, body: { messages: [{ id: 'wamid.X' }] } })

    await createMetaCloudSender(ENV).sendTemplate({
      to: '919810000002',
      templateName: 'freight_quote_request',
      languageCode: 'en',
      parameters: ['A', 'AIR', 'PVG', 'DEL', '-', '-', '-', 'https://x/q/t'],
    })

    // The PI and packing list are shared by hand, on purpose. A media payload
    // appearing here would mean that decision had been undone by accident.
    const raw = String(calls[0].init.body)
    expect(raw).not.toMatch(/"document"|"image"|"media"|"link":/)
  })
})

describe('sendText', () => {
  it('keeps the link preview on, so the quote link stays clickable', async () => {
    stubFetch({ status: 200, body: { messages: [{ id: 'wamid.TEXT' }] } })

    await createMetaCloudSender(ENV).sendText({ to: '919810000002', body: 'Quote link: https://x' })

    const body = JSON.parse(String(calls[0].init.body))
    expect(body.type).toBe('text')
    expect(body.text.preview_url).toBe(true)
  })
})

describe('failures', () => {
  it('reports a rejected send without pretending it went out', async () => {
    stubFetch({
      status: 400,
      body: {
        error: {
          code: 132001,
          message: 'Template name does not exist in the translation',
          error_data: { details: 'template name (freight_quote_request) not found in en' },
        },
      },
    })

    const result = await createMetaCloudSender(ENV).sendTemplate({
      to: '919810000002',
      templateName: 'freight_quote_request',
      languageCode: 'en',
      parameters: [],
    })

    expect(result.ok).toBe(false)
    expect(result.providerMessageId).toBeNull()
    expect(result.errorCode).toBe('132001')
    expect(result.errorReason).toContain('not found in en')
  })

  it('treats an unreachable network as a failure to send, not a send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND graph.facebook.com')
      }),
    )

    const result = await createMetaCloudSender(ENV).sendText({ to: '919810000002', body: 'hi' })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('network_error')
  })

  it('refuses to call the API at all without credentials', async () => {
    const fake = stubFetch({ status: 200, body: {} })

    const result = await createMetaCloudSender({}).sendText({ to: '919810000002', body: 'hi' })

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('not_configured')
    expect(fake).not.toHaveBeenCalled()
  })
})

describe('parseDeliveryStatuses', () => {
  const sender = createMetaCloudSender(ENV)

  function statusPayload(statuses: unknown[]) {
    return { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses } }] }] }
  }

  it('reads sent, delivered and read callbacks', () => {
    const parsed = sender.parseDeliveryStatuses(
      statusPayload([
        { id: 'wamid.A', status: 'sent', timestamp: '1786780800' },
        { id: 'wamid.A', status: 'delivered', timestamp: '1786780830' },
        { id: 'wamid.A', status: 'read', timestamp: '1786781000' },
      ]),
    )

    expect(parsed.map((s) => s.state)).toEqual(['sent', 'delivered', 'read'])
    expect(parsed[0].at).toBe(new Date(1786780800 * 1000).toISOString())
  })

  it('carries the reason a message failed', () => {
    const parsed = sender.parseDeliveryStatuses(
      statusPayload([
        {
          id: 'wamid.B',
          status: 'failed',
          timestamp: '1786780800',
          errors: [{ code: 131026, title: 'Message undeliverable', message: 'Receiver incapable' }],
        },
      ]),
    )

    expect(parsed).toHaveLength(1)
    expect(parsed[0].state).toBe('failed')
    expect(parsed[0].errorCode).toBe('131026')
    expect(parsed[0].errorReason).toBe('Receiver incapable')
  })

  it('ignores an inbound message payload, which is the other adapter’s job', () => {
    const inbound = {
      entry: [{ changes: [{ value: { messages: [{ id: 'wamid.IN', type: 'text' }] } }] }],
    }
    expect(sender.parseDeliveryStatuses(inbound)).toEqual([])
    expect(sender.parseDeliveryStatuses(null)).toEqual([])
    expect(sender.parseDeliveryStatuses({ entry: 'nonsense' })).toEqual([])
  })
})
