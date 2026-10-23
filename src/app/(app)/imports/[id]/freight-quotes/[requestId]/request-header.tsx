'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { FREIGHT_MODE_LABELS, type FreightQuoteRequestSummary } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { RequestChip } from '../freight-ui'
import { setRequestState, type ActionResult } from '../actions'

/**
 * The request at a glance.
 *
 * Replaces a card that spread eight labelled fields across a four-column grid
 * and pushed the recipients — the only thing anyone comes here to act on —
 * below the fold. Facts belong on one line; actions belong next to them.
 */
export function RequestHeader({
  importId,
  request,
}: {
  importId: string
  request: FreightQuoteRequestSummary
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setRequestState,
    null,
  )
  const [confirming, setConfirming] = useState(false)

  const closed = ['Closed', 'Cancelled'].includes(request.status)
  const awaiting = request.recipient_count - request.submitted_count

  const facts = [
    request.incoterm,
    request.gross_weight_kg && `${Number(request.gross_weight_kg).toLocaleString('en-IN')} kg gross`,
    request.mode === 'AIR'
      ? request.chargeable_weight_kg &&
        `${Number(request.chargeable_weight_kg).toLocaleString('en-IN')} kg chargeable`
      : request.cbm && `${request.cbm} CBM`,
    request.package_count && `${request.package_count} packages`,
    request.pallet_count && `${request.pallet_count} pallets`,
    request.response_deadline && `reply by ${formatDate(request.response_deadline)}`,
  ].filter(Boolean)

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/imports/${importId}/freight-quotes`}
              className="text-ink-muted hover:underline"
            >
              Freight quotes
            </Link>
            <span className="text-ink-faint">/</span>
            <span className="font-mono text-lg font-semibold">{request.request_no}</span>
            <span className="rounded-md bg-surface-sunken px-1.5 py-0.5 text-xs font-medium">
              {FREIGHT_MODE_LABELS[request.mode] ?? request.mode}
            </span>
            <RequestChip status={request.status} />
          </div>

          <p className="mt-1 font-medium">
            {[request.origin, request.destination].filter(Boolean).join(' → ') || 'Route not set'}
          </p>

          {facts.length > 0 && <p className="text-ink-muted">{facts.join(' · ')}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="text-right">
            <p className="tnum text-lg font-semibold">
              {request.submitted_count} / {request.recipient_count}
            </p>
            <p className="text-ink-muted">
              submitted{awaiting > 0 ? ` · ${awaiting} awaiting` : ''}
            </p>
          </div>

          {closed ? (
            <form action={formAction}>
              <input type="hidden" name="id" value={request.id} />
              <input type="hidden" name="import_id" value={importId} />
              <input type="hidden" name="action" value="reopen" />
              <Button type="submit" disabled={pending}>
                Reopen
              </Button>
            </form>
          ) : confirming ? (
            <form action={formAction} className="flex items-center gap-2">
              <input type="hidden" name="id" value={request.id} />
              <input type="hidden" name="import_id" value={importId} />
              <input type="hidden" name="action" value="close" />
              <span className="text-ink-muted">Close to new quotes?</span>
              <Button type="submit" variant="primary" disabled={pending}>
                Close
              </Button>
              <Button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button onClick={() => setConfirming(true)}>Close request</Button>
          )}
        </div>
      </div>

      {state?.error && <p className="mt-2 text-critical">{state.error}</p>}
    </Card>
  )
}
