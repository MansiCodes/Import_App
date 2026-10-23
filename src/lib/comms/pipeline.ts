import 'server-only'

/**
 * Turning stored messages into a proposed match.
 *
 * Runs after the webhook has already answered, and after the raw message is
 * durable. That ordering is the whole safety argument: if anything in here
 * fails, nothing is lost — the communication is on record and the Inbox offers
 * a Parse button.
 *
 * So this function does not throw. Ever. A failure becomes a
 * `communication_parses` row with status 'failed' and a reason the operator can
 * read, because a message that vanished silently is the one outcome the spec
 * forbids outright.
 *
 * Scope note: at this phase the "parse" is only sender resolution and import
 * matching. Reading meaning out of the words — events, dates, suggestions —
 * is a later phase, and writing it against imagined phrasings before there is a
 * corpus of real messages would produce rules that only prove themselves.
 */

import { getSetting } from '@/lib/settings'
import { createClient } from '@/lib/supabase/server'
import { matchImport } from './matcher'
import { identifySender } from './sender'
import { loadSnapshot } from './snapshot'

/**
 * Bumped whenever matching changes in a way that would produce a different
 * answer. Stored on every parse so an old proposal is never confused with what
 * today's code would say.
 */
export const PIPELINE_VERSION = 'match-1'

export interface PipelineResult {
  processed: number
  matched: number
  ambiguous: number
  unmatched: number
  failed: number
}

export async function runPipeline(communicationIds: string[]): Promise<PipelineResult> {
  const result: PipelineResult = {
    processed: 0,
    matched: 0,
    ambiguous: 0,
    unmatched: 0,
    failed: 0,
  }
  if (communicationIds.length === 0) return result

  const supabase = await createClient()

  let snapshot
  let minConfidence = 0.6

  try {
    ;[snapshot, minConfidence] = await Promise.all([
      loadSnapshot(),
      getSetting('comm_match_min_confidence').then((value) => Number(value) || 0.6),
    ])
  } catch (error) {
    // Could not even read the candidates. Record it against every message so
    // none of them looks merely unread.
    await Promise.all(communicationIds.map((id) => recordFailure(id, describe(error))))
    result.failed = communicationIds.length
    return result
  }

  const { data: communications, error } = await supabase
    .from('communications')
    .select('id, body_text, sender_phone, forwarded_by_phone, message_type')
    .in('id', communicationIds)

  if (error || !communications) {
    await Promise.all(communicationIds.map((id) => recordFailure(id, error?.message ?? 'unknown')))
    result.failed = communicationIds.length
    return result
  }

  for (const communication of communications) {
    result.processed += 1

    try {
      // Sender identity belongs to the message, not to the interpretation, so
      // it is written back onto the communication itself.
      const sender = identifySender(communication.sender_phone, snapshot.directory)

      await supabase
        .from('communications')
        .update({
          sender_role: sender.role,
          sender_match_method: sender.method,
          sender_supplier_id: sender.supplierId,
          sender_contact_id: sender.contactId,
          sender_cha_id: sender.chaId,
          sender_cha_agent_id: sender.chaAgentId,
        })
        .eq('id', communication.id)

      const match = matchImport(communication.body_text ?? '', snapshot.candidates, {
        minConfidence,
        senderSupplierId: sender.supplierId,
      })

      const { data: parse, error: parseError } = await supabase
        .from('communication_parses')
        .insert({
          provider_name: 'rules',
          provider_version: PIPELINE_VERSION,
          status: 'parsed',
          matched_import_id: match.importId,
          match_confidence: match.confidence || null,
          match_status: match.status === 'matched' ? 'proposed' : match.status,
          // Kept so the review screen can say WHY, not just how sure. A
          // confidence with no reasons behind it is a number to rubber-stamp.
          match_signals: {
            signals: match.signals,
            alternatives: match.alternatives.slice(0, 5),
          },
          parsed_at: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (parseError || !parse) throw new Error(parseError?.message ?? 'parse row not created')

      await supabase.from('communication_parse_members').insert({
        parse_id: parse.id,
        communication_id: communication.id,
        seq: 1,
      })

      if (match.status === 'matched') result.matched += 1
      else if (match.status === 'ambiguous') result.ambiguous += 1
      else result.unmatched += 1
    } catch (error) {
      await recordFailure(communication.id, describe(error))
      result.failed += 1
    }
  }

  return result

  async function recordFailure(communicationId: string, reason: string) {
    try {
      const { data: parse } = await supabase
        .from('communication_parses')
        .insert({
          provider_name: 'rules',
          provider_version: PIPELINE_VERSION,
          status: 'failed',
          // Truncated: a stack trace in a database column helps nobody, and the
          // Inbox has to render this next to a Parse again button.
          failure_reason: reason.slice(0, 500),
        })
        .select('id')
        .single()

      if (parse) {
        await supabase
          .from('communication_parse_members')
          .insert({ parse_id: parse.id, communication_id: communicationId, seq: 1 })
      }
    } catch {
      // If even recording the failure fails, the message is still on record
      // with no parse at all — which the Inbox renders as "Not parsed" and
      // offers to retry. Nothing is lost either way.
    }
  }
}

/**
 * Find everything that has never been interpreted.
 *
 * There is no scheduler in this application by design, so the retry trigger is
 * a human opening the Inbox and pressing the button. That is the same principle
 * as the alert engine: the work happens when someone looks.
 */
export async function findUnparsed(limit = 50): Promise<string[]> {
  const supabase = await createClient()

  const { data: members } = await supabase.from('communication_parse_members').select('communication_id')
  const parsed = new Set((members ?? []).map((row) => row.communication_id))

  const { data: communications } = await supabase
    .from('communications')
    .select('id')
    .order('received_at', { ascending: false })
    .limit(500)

  return (communications ?? [])
    .map((row) => row.id)
    .filter((id) => !parsed.has(id))
    .slice(0, limit)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
