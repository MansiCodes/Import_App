'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Clock, Megaphone } from 'lucide-react'
import { Badge, Button } from '@/components/ui'
import { dueLabel } from '@/lib/import-status'
import { cn } from '@/lib/utils'
import { completeNextAction, type ActionResult } from '../actions'

export function NextActionBanner({
  importId,
  title,
  dueDate,
  waitingOn,
  priority,
  overdue,
  detail,
}: {
  importId: string
  title: string | null
  dueDate: string | null
  waitingOn: string | null
  priority: string | null
  overdue: boolean
  detail?: string | null
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    completeNextAction,
    null,
  )

  if (!title) {
    return (
      <div className="rounded-2xl border border-dashed bg-surface-raised px-5 py-4">
        <p className="text-sm font-medium text-ink-muted">No next action queued</p>
        <Link
          href={`/imports/${importId}/edit`}
          className="mt-1 inline-block text-sm font-medium text-accent hover:underline"
        >
          Add a next action
        </Link>
      </div>
    )
  }

  const high = priority === 'high' || priority === 'critical'
  const subtitle =
    detail ||
    (waitingOn && waitingOn !== 'Internal'
      ? `${title} and confirm document submission status.`
      : null)

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-2xl border px-5 py-4',
        overdue
          ? 'border-critical/20 bg-[#FEF2F2]'
          : 'border-accent/15 bg-accent-soft/70',
      )}
    >
      <div
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full',
          overdue ? 'bg-critical/10 text-critical' : 'bg-accent/10 text-accent',
        )}
      >
        <Megaphone size={20} aria-hidden />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[11px] font-semibold tracking-wide uppercase',
            overdue ? 'text-critical' : 'text-accent',
          )}
        >
          Next Action
        </p>
        <p className="mt-0.5 text-lg font-semibold text-ink">{title}</p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium',
              overdue ? 'bg-critical/10 text-critical' : 'bg-white/80 text-ink-muted',
            )}
          >
            {overdue ? <AlertTriangle size={12} aria-hidden /> : <Clock size={12} aria-hidden />}
            {dueLabel(dueDate)}
          </span>
          {waitingOn && waitingOn !== 'Internal' && (
            <span className="rounded-md bg-white/90 px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-border">
              {waitingOn}
            </span>
          )}
          {high && (
            <Badge tone={priority === 'critical' ? 'critical' : 'due'} className="capitalize">
              {priority === 'critical' ? 'Critical' : 'High'}
            </Badge>
          )}
        </div>

        {subtitle && (
          <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>
        )}
        {state?.error && <p className="mt-2 text-sm text-critical">{state.error}</p>}
      </div>

      <form action={formAction} className="shrink-0">
        <input type="hidden" name="import_id" value={importId} />
        <Button
          type="submit"
          variant="danger"
          disabled={pending}
          className="rounded-xl px-4 py-2.5 shadow-sm"
        >
          <Check size={16} strokeWidth={2.5} aria-hidden />
          {pending ? 'Saving…' : 'Mark as Done'}
        </Button>
      </form>
    </div>
  )
}
