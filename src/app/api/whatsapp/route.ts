import { after, NextResponse, type NextRequest } from 'next/server'
import { getAdapter } from '@/lib/comms/adapters'
import { ingestMessages } from '@/lib/comms/ingest'
import { applyDeliveryStatuses } from '@/lib/comms/outbound'
import { runPipeline } from '@/lib/comms/pipeline'

/**
 * WhatsApp intake.
 *
 * This is the first request path in the application that is simultaneously
 * unauthenticated and writing with the service-role key, so it is deliberately
 * narrow: verify, store, answer. It may reach ingest and nothing else. It
 * cannot create an import, a supplier, a contact or a CHA — a message from a
 * number nobody recognises produces a communication row and stops there.
 *
 * The work is split at the point of durability:
 *
 *   Stage A  signature → parse → store.   Must succeed. No outbound network,
 *            so it costs milliseconds and cannot hang on someone else's server.
 *   Stage B  matching, via after().       Best effort. Runs once the response
 *            has already gone, and failures land in the Inbox as "Parse failed"
 *            rather than as a lost message.
 *
 * Meta reads any non-2xx as delivery failure, retries, and eventually disables
 * the subscription — so answering quickly and honestly matters more than
 * finishing the interpretation inside the request.
 *
 * Note src/proxy.ts: this path is listed in UNREDIRECTABLE_PATHS so it reaches
 * this handler even when the app is unconfigured, and answers 503 below rather
 * than redirecting a machine to a setup page it cannot read.
 */

// node:crypto for the HMAC, so this cannot run on the edge runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Meta's payloads are a few KB. Anything of this size is not one of theirs. */
const MAX_BODY_BYTES = 256 * 1024

export async function GET(request: NextRequest) {
  const adapter = getAdapter()
  if (!adapter) return new NextResponse('Not configured', { status: 503 })

  const challenge = adapter.verifyChallenge(request.nextUrl.searchParams)

  // No explanation on refusal. A verification endpoint that says why it said no
  // is a tool for guessing the token.
  return challenge
    ? new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
    : new NextResponse('Forbidden', { status: 403 })
}

export async function POST(request: NextRequest) {
  const adapter = getAdapter()
  if (!adapter) return new NextResponse('Not configured', { status: 503 })

  // Cheap rejection before reading a body we have no intention of trusting.
  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) {
    return new NextResponse('Payload too large', { status: 413 })
  }

  // The RAW body, before any JSON parsing. The signature covers the exact bytes
  // sent; re-serialising a parsed object changes key order and whitespace and
  // would never verify.
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return new NextResponse('Payload too large', { status: 413 })
  }

  if (!adapter.verifySignature(raw, request.headers)) {
    // Nothing has touched the database at this point, and nothing will.
    return new NextResponse('Unauthorised', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    // Signed but unparseable is Meta's problem, not a delivery failure. A 400
    // stops it being retried forever.
    return new NextResponse('Malformed body', { status: 400 })
  }

  /*
   * Delivery callbacks for messages WE sent.
   *
   * Handled before ingest and kept entirely separate: this updates only
   * freight_quote_messages, never a quote, a recipient's submission state or
   * anything in the Inbox. Delivery is communication metadata — a message
   * reaching a CHA says nothing about whether they quoted.
   *
   * A failure here must not cost us an inbound message, so it is swallowed:
   * losing a read receipt is trivial, making Meta redeliver a real message is
   * not.
   */
  try {
    await applyDeliveryStatuses(payload)
  } catch (error) {
    console.error('[whatsapp] delivery status update failed:', error)
  }

  let created: string[] = []

  try {
    const messages = adapter.toInbound(payload)

    // Status callbacks and read receipts arrive here too. Acknowledge them.
    if (messages.length > 0) {
      const result = await ingestMessages(messages)
      created = result.created

      // The message could not be stored, so it WOULD be lost if we said 200.
      // A 500 makes Meta redeliver, and the unique index makes that safe.
      if (result.errors.length > 0 && result.created.length === 0) {
        console.error('[whatsapp] ingest failed:', result.errors.join('; '))
        return new NextResponse('Storage failed', { status: 500 })
      }
    }
  } catch (error) {
    console.error('[whatsapp] ingest threw:', error)
    return new NextResponse('Storage failed', { status: 500 })
  }

  // Past this line the message is durable, so interpretation runs after the
  // response and can fail without costing anything.
  if (created.length > 0) {
    after(async () => {
      try {
        await runPipeline(created)
      } catch (error) {
        console.error('[whatsapp] pipeline threw:', error)
      }
    })
  }

  // Never echo request content back. The reply says only that we have it.
  return NextResponse.json({ ok: true, received: created.length })
}
