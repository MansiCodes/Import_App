/**
 * Sending a quote link, end to end, with the provider replaced.
 *
 * `fetch` is stubbed in every test, so no message can leave this process even
 * if a real WHATSAPP_ACCESS_TOKEN happens to be in the environment. Supabase is
 * replaced by a small in-memory store that enforces the one constraint this
 * code leans on for correctness: (recipient_id, attempt_no) is unique.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const tables: Record<string, Row[]> = {}

/** The unique index from migration 018, which is the idempotency guard. */
function violatesUnique(table: string, row: Row): boolean {
  if (table !== 'freight_quote_messages') return false
  return tables[table].some(
    (r) => r.recipient_id === row.recipient_id && r.attempt_no === row.attempt_no,
  )
}

function matches(row: Row, filters: Array<[string, unknown, 'eq' | 'in']>): boolean {
  return filters.every(([col, value, op]) =>
    op === 'in' ? (value as unknown[]).includes(row[col]) : row[col] === value,
  )
}

function builder(table: string) {
  tables[table] ??= []
  const filters: Array<[string, unknown, 'eq' | 'in']> = []
  let pending: { kind: 'update'; values: Row } | null = null
  let inserted: Row | null = null
  let insertFailed = false
  let sort: { column: string; ascending: boolean } | null = null
  let take: number | null = null

  function rows(): Row[] {
    let out = tables[table].filter((r) => matches(r, filters))
    if (sort) {
      const { column, ascending } = sort
      out = [...out].sort((a, b) => {
        const l = Number(a[column])
        const r = Number(b[column])
        return ascending ? l - r : r - l
      })
    }
    if (take !== null) out = out.slice(0, take)
    return out
  }

  function apply() {
    if (pending) {
      for (const row of tables[table]) {
        if (matches(row, filters)) Object.assign(row, pending.values)
      }
      pending = null
    }
  }

  const api = {
    select() {
      return api
    },
    eq(column: string, value: unknown) {
      filters.push([column, value, 'eq'])
      return api
    },
    in(column: string, values: unknown[]) {
      filters.push([column, values, 'in'])
      return api
    },
    order(column: string, options?: { ascending?: boolean }) {
      sort = { column, ascending: options?.ascending ?? true }
      return api
    },
    limit(n: number) {
      take = n
      return api
    },
    insert(values: Row) {
      if (violatesUnique(table, values)) {
        insertFailed = true
      } else {
        inserted = { id: `${table}-${tables[table].length + 1}`, ...values }
        tables[table].push(inserted)
      }
      return api
    },
    update(values: Row) {
      pending = { kind: 'update', values }
      return api
    },
    async maybeSingle() {
      apply()
      return { data: rows()[0] ?? null, error: null }
    },
    async single() {
      if (insertFailed) {
        return { data: null, error: { code: '23505', message: 'duplicate key value' } }
      }
      apply()
      return { data: inserted ?? rows()[0] ?? null, error: null }
    },
    // Awaiting the builder is how an update with no terminal selector runs.
    then(resolve: (value: { data: Row[]; error: null }) => unknown) {
      apply()
      return Promise.resolve(resolve({ data: rows(), error: null }))
    },
  }

  return api
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (table: string) => builder(table) }),
}))

const { applyDeliveryStatuses, maskDestination, plainMessage, resolveDestination, sendQuoteLink, templateParameters } =
  await import('./outbound')

const CONTEXT = {
  recipientName: 'DV Logistics',
  importNo: 'IMP-2026-0048',
  mode: 'AIR',
  origin: 'PVG',
  destination: 'DEL',
  grossWeight: '420 kg',
  packages: '6',
  incoterm: 'FOB',
  quoteLink: 'https://app.example.com/q/token-dv',
  deadlineLine: 'Please submit by 12 Sept 2026.',
}

let fetchCalls: string[]

function stubProvider(response: { status: number; body: unknown }) {
  fetchCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      fetchCalls.push(String(init?.body ?? ''))
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        text: async () => JSON.stringify(response.body),
      } as Response
    }),
  )
}

function seedRecipient(overrides: Row = {}) {
  const recipient = {
    id: 'rcpt-dv',
    quote_request_id: 'req-1',
    phone: '98100 00002',
    revoked_at: null,
    status: 'Pending',
    chas: null,
    ...overrides,
  }
  tables.freight_quote_request_recipients = [recipient]
  tables.freight_quote_messages = []
  return recipient
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-token')
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '111222333')
  vi.stubEnv('WHATSAPP_QUOTE_TEMPLATE_NAME', 'freight_quote_request')
  vi.stubEnv('WHATSAPP_QUOTE_TEMPLATE_LANGUAGE', 'en')
  stubProvider({ status: 200, body: { messages: [{ id: 'wamid.ONE' }] } })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the message itself', () => {
  it('carries the shipment facts and the recipient’s own link', () => {
    const body = plainMessage(CONTEXT)
    expect(body).toContain('DV Logistics')
    expect(body).toContain('PVG')
    expect(body).toContain('https://app.example.com/q/token-dv')
  })

  it('says the PI and packing list come separately, because they are never sent', () => {
    expect(plainMessage(CONTEXT)).toContain('shared separately')
  })

  it('sends the wording an operator configured, not a second copy of it', async () => {
    vi.stubEnv('WHATSAPP_QUOTE_TEMPLATE_NAME', '')
    seedRecipient()
    tables.app_settings = [
      {
        key: 'freight_quote_message_template',
        value: 'Hi, quote for {{import_no}} ({{mode}}) here: {{quote_link}}. {{deadline_line}}',
      },
    ]

    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    const body = JSON.parse(fetchCalls[0]).text.body
    expect(body).toBe(
      'Hi, quote for IMP-2026-0048 (AIR) here: https://app.example.com/q/token-dv. Please submit by 12 Sept 2026.',
    )
    // And what was sent is what the audit trail records.
    expect(tables.freight_quote_messages[0].body_preview).toBe(body)
  })

  it('falls back to built-in wording when the setting is empty', async () => {
    vi.stubEnv('WHATSAPP_QUOTE_TEMPLATE_NAME', '')
    seedRecipient()
    tables.app_settings = [{ key: 'freight_quote_message_template', value: '   ' }]

    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(JSON.parse(fetchCalls[0]).text.body).toContain('shared separately')
  })

  it('substitutes dashes rather than leaving a template hole', () => {
    const params = templateParameters({ ...CONTEXT, incoterm: '', origin: '' })
    expect(params[2]).toBe('-')
    expect(params[6]).toBe('-')
    // The link is the last parameter and is never blanked.
    expect(params[7]).toBe(CONTEXT.quoteLink)
    expect(params).toHaveLength(8)
  })
})

describe('resolveDestination', () => {
  it('prefers the recipient’s own number, then the CHA’s WhatsApp, then its phone', () => {
    expect(resolveDestination({ phone: '9810000002', cha: { whatsapp_phone: '9820000003' } })).toBe(
      '919810000002',
    )
    expect(resolveDestination({ phone: null, cha: { whatsapp_phone: '9820000003' } })).toBe(
      '919820000003',
    )
    expect(resolveDestination({ phone: null, cha: { phone: '9830000004' } })).toBe('919830000004')
  })

  it('returns nothing when there is nothing usable, which is a normal state', () => {
    expect(resolveDestination({ phone: null, cha: null })).toBeNull()
    expect(resolveDestination({ phone: 'n/a', cha: null })).toBeNull()
  })
})

describe('maskDestination', () => {
  it('shows enough to recognise the number and not enough to reuse it', () => {
    const masked = maskDestination('919810000002')
    expect(masked).toBe('+91 ••••••0002')
    expect(masked).not.toContain('98100')
    expect(maskDestination(null)).toBeNull()
  })
})

describe('sendQuoteLink', () => {
  it('sends the approved template and records what happened', async () => {
    seedRecipient()

    const outcome = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: 'user-1' })

    expect(outcome).toMatchObject({ ok: true, providerMessageId: 'wamid.ONE' })
    expect(fetchCalls).toHaveLength(1)

    const sent = JSON.parse(fetchCalls[0])
    expect(sent.type).toBe('template')
    expect(sent.to).toBe('919810000002')

    const record = tables.freight_quote_messages[0]
    expect(record).toMatchObject({
      status: 'SENT',
      attempt_no: 1,
      destination: '919810000002',
      message_type: 'template',
      provider_message_id: 'wamid.ONE',
      sent_by: 'user-1',
    })
  })

  it('moves the recipient to Sent only after the provider accepted it', async () => {
    seedRecipient()
    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })
    expect(tables.freight_quote_request_recipients[0].status).toBe('Sent')
  })

  it('falls back to free text when no template is configured', async () => {
    vi.stubEnv('WHATSAPP_QUOTE_TEMPLATE_NAME', '')
    seedRecipient()

    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(JSON.parse(fetchCalls[0]).type).toBe('text')
    expect(tables.freight_quote_messages[0].message_type).toBe('text')
  })

  it('does not call the provider when there is no number on file', async () => {
    seedRecipient({ phone: null, chas: null })

    const outcome = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(outcome).toMatchObject({ ok: false, reason: 'no_destination' })
    expect(fetchCalls).toHaveLength(0)
    expect(tables.freight_quote_messages).toHaveLength(0)
  })

  it('falls back to the CHA’s number for a recipient added by name alone', async () => {
    seedRecipient({ phone: null, chas: { whatsapp_phone: '98200 00003' } })

    const outcome = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(outcome.ok).toBe(true)
    expect(tables.freight_quote_messages[0].destination).toBe('919820000003')
  })

  it('refuses to message a revoked link', async () => {
    seedRecipient({ revoked_at: '2026-09-01T00:00:00Z' })

    const outcome = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(outcome).toMatchObject({ ok: false, reason: 'no_destination' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('sends once when the button is pressed twice', async () => {
    seedRecipient()

    const [first, second] = await Promise.all([
      sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null }),
      sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect(fetchCalls).toHaveLength(1)
    expect(tables.freight_quote_messages).toHaveLength(1)
  })

  it('will not send again on its own after a successful send', async () => {
    seedRecipient()
    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    const again = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(again).toMatchObject({ ok: false, reason: 'already_sent' })
    expect(fetchCalls).toHaveLength(1)
  })

  it('sends again when a person explicitly asks for a resend', async () => {
    seedRecipient()
    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    const resend = await sendQuoteLink({
      recipientId: 'rcpt-dv',
      context: CONTEXT,
      actorId: null,
      resend: true,
    })

    expect(resend.ok).toBe(true)
    expect(fetchCalls).toHaveLength(2)
    expect(tables.freight_quote_messages.map((m) => m.attempt_no)).toEqual([1, 2])
  })

  it('retries a failed send without needing a resend, since nothing was delivered', async () => {
    seedRecipient()
    stubProvider({ status: 400, body: { error: { code: 131026, message: 'Undeliverable' } } })

    const failed = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(failed).toMatchObject({ ok: false, reason: 'provider_error' })
    expect(tables.freight_quote_messages[0]).toMatchObject({
      status: 'FAILED',
      failure_code: '131026',
    })
    // A failed attempt must not claim the recipient was sent to.
    expect(tables.freight_quote_request_recipients[0].status).toBe('Pending')

    stubProvider({ status: 200, body: { messages: [{ id: 'wamid.RETRY' }] } })
    const retry = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })
    expect(retry.ok).toBe(true)
  })

  it('does nothing at all when the deployment has no credentials', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')
    seedRecipient()

    const outcome = await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })

    expect(outcome).toMatchObject({ ok: false, reason: 'not_configured' })
    expect(fetchCalls).toHaveLength(0)
    expect(tables.freight_quote_messages).toHaveLength(0)
  })

  it('gives each recipient only their own link', async () => {
    tables.freight_quote_request_recipients = [
      { id: 'rcpt-a', quote_request_id: 'req-1', phone: '9810000002', revoked_at: null, status: 'Pending' },
      { id: 'rcpt-b', quote_request_id: 'req-1', phone: '9820000003', revoked_at: null, status: 'Pending' },
    ]
    tables.freight_quote_messages = []

    await sendQuoteLink({
      recipientId: 'rcpt-a',
      context: { ...CONTEXT, recipientName: 'A', quoteLink: 'https://app/q/token-a' },
      actorId: null,
    })
    await sendQuoteLink({
      recipientId: 'rcpt-b',
      context: { ...CONTEXT, recipientName: 'B', quoteLink: 'https://app/q/token-b' },
      actorId: null,
    })

    expect(fetchCalls[0]).toContain('token-a')
    expect(fetchCalls[0]).not.toContain('token-b')
    expect(fetchCalls[1]).toContain('token-b')
    expect(fetchCalls[1]).not.toContain('token-a')
  })

  it('never puts a document or attachment on the wire', async () => {
    seedRecipient()
    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })
    expect(fetchCalls[0]).not.toMatch(/"document"|"image"|proforma|packing/i)
  })
})

describe('applyDeliveryStatuses', () => {
  function callback(id: string, status: string, extra: Row = {}) {
    return {
      entry: [
        {
          changes: [
            { value: { statuses: [{ id, status, timestamp: '1786780800', ...extra }] } },
          ],
        },
      ],
    }
  }

  async function seedSentMessage() {
    seedRecipient()
    await sendQuoteLink({ recipientId: 'rcpt-dv', context: CONTEXT, actorId: null })
  }

  it('marks a message delivered', async () => {
    await seedSentMessage()

    expect(await applyDeliveryStatuses(callback('wamid.ONE', 'delivered'))).toBe(1)
    expect(tables.freight_quote_messages[0]).toMatchObject({ status: 'DELIVERED' })
    expect(tables.freight_quote_messages[0].delivered_at).toBeTruthy()
  })

  it('marks a message read', async () => {
    await seedSentMessage()
    await applyDeliveryStatuses(callback('wamid.ONE', 'delivered'))

    expect(await applyDeliveryStatuses(callback('wamid.ONE', 'read'))).toBe(1)
    expect(tables.freight_quote_messages[0]).toMatchObject({ status: 'READ' })
  })

  it('does not walk a message backwards when callbacks arrive out of order', async () => {
    await seedSentMessage()
    await applyDeliveryStatuses(callback('wamid.ONE', 'read'))

    expect(await applyDeliveryStatuses(callback('wamid.ONE', 'sent'))).toBe(0)
    expect(tables.freight_quote_messages[0].status).toBe('READ')
  })

  it('records a failure reported after the fact', async () => {
    await seedSentMessage()

    const applied = await applyDeliveryStatuses(
      callback('wamid.ONE', 'failed', {
        errors: [{ code: 131049, message: 'Message not delivered to maintain healthy ecosystem' }],
      }),
    )

    expect(applied).toBe(1)
    expect(tables.freight_quote_messages[0]).toMatchObject({
      status: 'FAILED',
      failure_code: '131049',
    })
  })

  it('ignores a callback for a message this app did not send', async () => {
    await seedSentMessage()
    expect(await applyDeliveryStatuses(callback('wamid.SOMEONE_ELSE', 'delivered'))).toBe(0)
    expect(tables.freight_quote_messages[0].status).toBe('SENT')
  })

  it('does nothing when sending is not configured, so inbound still works', async () => {
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', '')
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '')
    expect(await applyDeliveryStatuses(callback('wamid.ONE', 'delivered'))).toBe(0)
  })

  it('is unmoved by an inbound message payload', async () => {
    await seedSentMessage()
    const inbound = { entry: [{ changes: [{ value: { messages: [{ id: 'wamid.IN' }] } }] }] }
    expect(await applyDeliveryStatuses(inbound)).toBe(0)
  })
})
