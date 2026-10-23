'use client'

import { useActionState, useRef, useState } from 'react'
import { Button, Input, Select } from '@/components/ui'
import { IMPORT_STATUSES } from '@/lib/import-status'
import { changeStatus, setNextActionPriority, type ActionResult } from '../actions'
import { cn } from '@/lib/utils'

const CONFIRM_REQUIRED = new Set(['Closed', 'Cancelled'])

const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'normal', label: 'Medium' },
  { id: 'high', label: 'High' },
] as const

export function StatusChanger({
  importId,
  status,
  priority,
}: {
  importId: string
  status: string
  priority?: string | null
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    changeStatus,
    null,
  )
  const [, priorityAction, priorityPending] = useActionState<ActionResult | null, FormData>(
    setNextActionPriority,
    null,
  )

  const [next, setNext] = useState(status)
  const [confirmed, setConfirmed] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const changed = next !== status
  const needsConfirm = changed && CONFIRM_REQUIRED.has(next)
  const blocked = needsConfirm && !confirmed
  const currentPriority = priority === 'critical' ? 'high' : priority || 'normal'

  return (
    <div className="space-y-4 rounded-2xl border bg-surface-raised p-4 shadow-sm">
      <form ref={formRef} action={formAction} className="space-y-2">
        <input type="hidden" name="import_id" value={importId} />

        <label htmlFor="status-select" className="text-[13px] font-medium text-ink">
          Move to
        </label>

        <Select
          id="status-select"
          name="status"
          value={next}
          onChange={(e) => {
            const value = e.target.value
            setNext(value)
            setConfirmed(false)
            if (!CONFIRM_REQUIRED.has(value) && value !== status) {
              // Auto-submit non-terminal moves so the control matches the screenshot.
              queueMicrotask(() => formRef.current?.requestSubmit())
            }
          }}
          className="mt-1.5 rounded-xl"
        >
          {IMPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        {needsConfirm && (
          <>
            <Input name="note" placeholder="Why? (optional)" className="rounded-xl" />
            <label className="flex items-start gap-2 text-sm text-critical">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                Confirm marking this import <strong>{next}</strong>.
              </span>
            </label>
            <Button
              type="submit"
              variant="danger"
              disabled={pending || blocked}
              className="w-full rounded-xl"
            >
              {pending ? 'Saving…' : `Save ${next}`}
            </Button>
          </>
        )}

        {pending && !needsConfirm && (
          <p className="text-xs text-ink-faint">Updating…</p>
        )}
        {state?.error && <p className="text-sm text-critical">{state.error}</p>}
      </form>

      <div>
        <p className="mb-2 text-[13px] font-medium text-ink">Priority</p>
        <div className="grid grid-cols-3 gap-1.5">
          {PRIORITY_OPTIONS.map((opt) => {
            const active = currentPriority === opt.id
            return (
              <form key={opt.id} action={priorityAction}>
                <input type="hidden" name="import_id" value={importId} />
                <input type="hidden" name="priority" value={opt.id} />
                <button
                  type="submit"
                  disabled={priorityPending}
                  className={cn(
                    'w-full rounded-xl border px-2 py-2 text-sm font-medium transition',
                    active && opt.id === 'high'
                      ? 'border-critical bg-critical-soft text-critical'
                      : active
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-surface-raised text-ink-muted hover:bg-surface-sunken',
                  )}
                >
                  {opt.label}
                </button>
              </form>
            )
          })}
        </div>
      </div>
    </div>
  )
}
