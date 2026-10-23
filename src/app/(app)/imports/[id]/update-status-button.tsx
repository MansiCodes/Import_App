'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui'
import { IMPORT_STATUSES } from '@/lib/import-status'
import { cn } from '@/lib/utils'
import { changeStatus, type ActionResult } from '../actions'

export function UpdateStatusButton({
  importId,
  status,
}: {
  importId: string
  status: string
}) {
  const [open, setOpen] = useState(false)
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    changeStatus,
    null,
  )
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  useEffect(() => {
    if (state?.ok) setOpen(false)
  }, [state])

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        variant="primary"
        className="rounded-xl px-4 py-2.5 text-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Update Status
        <ChevronDown size={15} aria-hidden />
      </Button>

      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border bg-surface-raised shadow-lg">
          <p className="border-b px-3 py-2 text-xs font-medium text-ink-faint">
            Move to status
          </p>
          <div className="max-h-72 overflow-y-auto py-1">
            {IMPORT_STATUSES.map((s) => (
              <form key={s} action={formAction}>
                <input type="hidden" name="import_id" value={importId} />
                <input type="hidden" name="status" value={s} />
                <button
                  type="submit"
                  disabled={pending || s === status}
                  className={cn(
                    'flex w-full px-3 py-2 text-left text-sm hover:bg-surface-sunken',
                    s === status && 'bg-accent-soft font-medium text-accent',
                  )}
                >
                  {s}
                </button>
              </form>
            ))}
          </div>
          {state?.error && (
            <p className="border-t px-3 py-2 text-xs text-critical">{state.error}</p>
          )}
        </div>
      )}
    </div>
  )
}

const MORE_LINKS = [
  { segment: '', label: 'Overview' },
  { segment: '/edit', label: 'PO & PI' },
  { segment: '/payments', label: 'Payments' },
  { segment: '/production', label: 'Production' },
  { segment: '/shipments', label: 'Shipments' },
  { segment: '/documents', label: 'Checklist' },
  { segment: '/customs', label: 'Customs' },
  { segment: '/delivery', label: 'Delivery' },
  { segment: '/costs', label: 'Costs' },
  { segment: '/product-costing', label: 'Product Costing' },
  { segment: '/freight-quotes', label: 'Freight quotes' },
  { segment: '/tasks', label: 'Tasks' },
  { segment: '/emails', label: 'Emails' },
  { segment: '/timeline', label: 'Timeline' },
  { segment: '/audit', label: 'Audit log' },
] as const

export function ImportMoreMenu({
  importId,
  driveUrl,
}: {
  importId: string
  driveUrl?: string | null
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-xl border border-border bg-surface-raised text-ink-muted shadow-sm hover:bg-surface-sunken"
        aria-label="More actions"
        aria-expanded={open}
      >
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 max-h-96 w-56 overflow-y-auto rounded-xl border bg-surface-raised py-1 shadow-lg">
          {MORE_LINKS.map((link) => (
            <Link
              key={link.label}
              href={`/imports/${importId}${link.segment}`}
              className="block px-3 py-2 text-sm hover:bg-surface-sunken"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block border-t px-3 py-2 text-sm hover:bg-surface-sunken"
              onClick={() => setOpen(false)}
            >
              Open Drive folder
            </a>
          )}
        </div>
      )}
    </div>
  )
}
