/**
 * Which import is this message about?
 *
 * The rule the whole module rests on: **never guess silently**. Every answer is
 * one of three, and the difference between them is what the operator sees.
 *
 *   matched    one import, on evidence strong enough to preselect
 *   ambiguous  several plausible imports — the operator picks
 *   unmatched  no evidence worth showing; the message waits
 *
 * A wrong confident match is far more damaging than no match: it files a
 * supplier's promise against the wrong order, and the operator has no reason to
 * doubt it. So an unmatched message is a success condition here, not a failure.
 *
 * Scoring is deliberately not additive. Signals combine as a noisy-OR —
 * 1 - Π(1 - w) — so a second weak signal raises confidence a little and can
 * never manufacture certainty out of two guesses. Only a strong signal, which
 * is an identifier that could not plausibly belong to another import, gets near
 * the top of the range.
 */

import { extractAwbNumbers, extractContainerNumbers, extractImportNumbers, findKnown, normalise, splitContainerList } from './identifiers'

export type SignalKind =
  | 'import_no'
  | 'po_number'
  | 'pi_number'
  | 'awb'
  | 'bl_no'
  | 'container'
  | 'boe_no'
  | 'tracking_no'
  | 'sender_supplier'

export interface MatchSignal {
  kind: SignalKind
  value: string
  weight: number
}

/** One import, flattened with everything a message might quote about it. */
export interface MatchCandidate {
  importId: string
  importNo: string
  poNumber?: string | null
  piNumber?: string | null
  supplierId?: string | null
  isActive?: boolean
  awbs?: Array<string | null | undefined>
  blNumbers?: Array<string | null | undefined>
  trackingNumbers?: Array<string | null | undefined>
  containerNumbers?: Array<string | null | undefined>
  boeNumbers?: Array<string | null | undefined>
}

export interface MatchAlternative {
  importId: string
  importNo: string
  confidence: number
  signals: MatchSignal[]
}

export interface MatchResult {
  status: 'matched' | 'ambiguous' | 'unmatched'
  importId: string | null
  confidence: number
  signals: MatchSignal[]
  /** Every candidate that scored anything, best first. Shown when the operator has to choose. */
  alternatives: MatchAlternative[]
}

export interface MatchOptions {
  /** Below this, nothing is preselected. Comes from app_settings.comm_match_min_confidence. */
  minConfidence?: number
  /** The supplier the sender was recognised as, if any. A weak signal on its own. */
  senderSupplierId?: string | null
}

/**
 * Weights are "how sure would I be if this were the only thing I knew".
 *
 * An import number is ours and unique. A PO or PI is close behind. Transport
 * references are strong but occasionally shared across split consignments. The
 * sender's supplier is deliberately far below the default threshold: knowing
 * who sent a message narrows the field, it does not identify the order.
 */
const WEIGHTS: Record<SignalKind, number> = {
  import_no: 0.99,
  po_number: 0.95,
  pi_number: 0.92,
  boe_no: 0.9,
  awb: 0.9,
  bl_no: 0.88,
  container: 0.86,
  tracking_no: 0.82,
  sender_supplier: 0.3,
}

/** Two candidates this close together are a choice for a human, not a winner. */
const AMBIGUITY_MARGIN = 0.15

export function matchImport(
  text: string,
  candidates: MatchCandidate[],
  options: MatchOptions = {},
): MatchResult {
  const minConfidence = options.minConfidence ?? 0.6
  const senderSupplierId = options.senderSupplierId ?? null

  // Extracted once, then offered to every candidate.
  const importNos = extractImportNumbers(text)
  const awbs = extractAwbNumbers(text)
  const containers = extractContainerNumbers(text)

  const scored: MatchAlternative[] = []

  for (const candidate of candidates) {
    const signals: MatchSignal[] = []

    if (importNos.some((no) => normalise(no) === normalise(candidate.importNo))) {
      signals.push(signal('import_no', candidate.importNo))
    }

    for (const value of findKnown(text, [candidate.poNumber])) {
      signals.push(signal('po_number', value))
    }
    for (const value of findKnown(text, [candidate.piNumber])) {
      signals.push(signal('pi_number', value))
    }
    for (const value of findKnown(text, candidate.blNumbers ?? [])) {
      signals.push(signal('bl_no', value))
    }
    for (const value of findKnown(text, candidate.boeNumbers ?? [])) {
      signals.push(signal('boe_no', value))
    }
    for (const value of findKnown(text, candidate.trackingNumbers ?? [])) {
      signals.push(signal('tracking_no', value))
    }

    // Transport references are compared against what was extracted by shape,
    // not by substring: an eleven-digit run inside a longer number is not an
    // air waybill.
    const candidateAwbs = new Set((candidate.awbs ?? []).map((a) => normalise(a)).filter(Boolean))
    for (const found of awbs) {
      if (candidateAwbs.has(found)) signals.push(signal('awb', found))
    }

    const candidateContainers = new Set(
      (candidate.containerNumbers ?? []).flatMap((value) => splitContainerList(value)),
    )
    for (const found of containers) {
      if (candidateContainers.has(found)) signals.push(signal('container', found))
    }

    // Weak, and only offered for an import still in flight. A closed order is
    // not what a supplier is messaging about today.
    if (
      senderSupplierId &&
      candidate.supplierId === senderSupplierId &&
      candidate.isActive !== false
    ) {
      signals.push(signal('sender_supplier', senderSupplierId))
    }

    if (signals.length === 0) continue

    scored.push({
      importId: candidate.importId,
      importNo: candidate.importNo,
      confidence: combine(signals),
      signals,
    })
  }

  scored.sort((a, b) => b.confidence - a.confidence)

  const best = scored[0]
  const runnerUp = scored[1]

  if (!best || best.confidence < minConfidence) {
    // Still hand back what was considered. "Nothing was certain enough" and
    // "nothing was found" look identical to the operator otherwise, and the
    // first deserves a shortlist.
    return {
      status: 'unmatched',
      importId: null,
      confidence: best?.confidence ?? 0,
      signals: [],
      alternatives: scored,
    }
  }

  if (runnerUp && best.confidence - runnerUp.confidence < AMBIGUITY_MARGIN) {
    return {
      status: 'ambiguous',
      importId: null,
      confidence: best.confidence,
      signals: best.signals,
      alternatives: scored,
    }
  }

  return {
    status: 'matched',
    importId: best.importId,
    confidence: best.confidence,
    signals: best.signals,
    alternatives: scored,
  }
}

function signal(kind: SignalKind, value: string): MatchSignal {
  return { kind, value, weight: WEIGHTS[kind] }
}

/**
 * Noisy-OR: the chance that at least one signal is telling the truth.
 *
 * Rounded to three places to match `communication_parses.match_confidence`,
 * which is numeric(4,3) — storing more precision than the column holds would
 * make the stored value differ from the one shown at review.
 */
function combine(signals: MatchSignal[]): number {
  const doubt = signals.reduce((acc, s) => acc * (1 - s.weight), 1)
  return Math.round((1 - doubt) * 1000) / 1000
}
