'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import {
  SEVERITY_LABELS,
  SEVERITY_TONES,
  dueLabel,
  type Severity,
} from '@/lib/import-status'
import type { NotificationItem } from '@/lib/notifications'
import { Badge } from '@/components/ui'

export type { NotificationItem }

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  due_today: 1,
  upcoming: 2,
}

export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const sorted = [...items].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const actionable = sorted.filter(
    (item) => item.severity === 'critical' || item.severity === 'due_today',
  )
  const badgeCount = actionable.length > 0 ? actionable.length : sorted.length

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={
          badgeCount > 0 ? `Notifications, ${badgeCount} open` : 'Notifications'
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
      >
        <Bell size={18} strokeWidth={1.75} aria-hidden />
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-white ring-2 ring-white">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute top-full right-0 z-40 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="text-[14px] font-semibold text-ink">Notifications</p>
            <Link
              href="/"
              onClick={() => setOpen(false)}
              className="text-[12px] font-medium text-accent hover:underline"
            >
              Dashboard
            </Link>
          </div>

          {sorted.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-ink-muted">
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {sorted.slice(0, 25).map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 transition hover:bg-surface-sunken"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-[13px] font-medium text-ink">
                        {item.title}
                      </p>
                      <Badge tone={SEVERITY_TONES[item.severity]} className="shrink-0">
                        {SEVERITY_LABELS[item.severity]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-muted">
                      {item.importNo ?? 'General'}
                      {item.dueDate ? ` · ${dueLabel(item.dueDate)}` : ''}
                      {item.waitingOn && item.waitingOn !== 'Internal'
                        ? ` · ${item.waitingOn}`
                        : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {sorted.length > 25 && (
            <div className="border-t border-border px-4 py-2 text-center text-[12px] text-ink-faint">
              Showing 25 of {sorted.length}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
