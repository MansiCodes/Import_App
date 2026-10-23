'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Link2Off,
  MessageSquarePlus,
  Paperclip,
  Search,
  Sparkles,
} from 'lucide-react'
import { Badge, Button, EmptyState } from '@/components/ui'
import { COMMUNICATION_STATUS_LABELS, type InboxRow } from '@/lib/types'
import { cn, formatDate } from '@/lib/utils'
import { ParseButton } from './parse-button'

export const INBOX_VIEWS = {
  review: 'Needs review',
  unmatched: 'Unmatched',
  problems: 'Parse problems',
  actioned: 'Actioned',
  all: 'Everything',
} as const

export type InboxViewId = keyof typeof INBOX_VIEWS

function timeOf(row: InboxRow): string {
  const stamp = row.sent_at ?? row.received_at
  const time = new Date(stamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatDate(stamp)} · ${time}`
}

function confidenceLabel(row: InboxRow): string | null {
  if (!row.match_confidence) return null
  return `${Math.round(Number(row.match_confidence) * 100)}%`
}

function filterRows(all: InboxRow[], view: InboxViewId): InboxRow[] {
  return all.filter((row) => {
    switch (view) {
      case 'review':
        return row.status === 'new' || row.status === 'in_review'
      case 'unmatched':
        return !row.import_id && row.match_status !== 'proposed'
      case 'problems':
        return row.parse_status === 'failed' || row.parse_status === null
      case 'actioned':
        return row.status === 'actioned' || row.status === 'ignored'
      default:
        return true
    }
  })
}

export function InboxView({
  rows,
  view,
  unparsedCount,
}: {
  rows: InboxRow[]
  view: InboxViewId
  unparsedCount: number
}) {
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    return {
      review: filterRows(rows, 'review').length,
      unmatched: filterRows(rows, 'unmatched').length,
      problems: filterRows(rows, 'problems').length,
      actioned: filterRows(rows, 'actioned').length,
      all: rows.length,
    }
  }, [rows])

  const visible = useMemo(() => {
    const base = filterRows(rows, view)
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter((row) => {
      const hay = [
        row.body_text,
        row.sender_name,
        row.sender_phone,
        row.import_no,
        row.matched_import_no,
        row.supplier_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, view, query])

  const stats = [
    {
      id: 'review' as const,
      label: 'Needs review',
      count: counts.review,
      icon: Inbox,
      wrap: 'bg-due-soft text-due',
    },
    {
      id: 'unmatched' as const,
      label: 'Unmatched',
      count: counts.unmatched,
      icon: Link2Off,
      wrap: 'bg-waiting-soft text-waiting',
    },
    {
      id: 'problems' as const,
      label: 'Parse issues',
      count: counts.problems,
      icon: AlertTriangle,
      wrap: 'bg-critical-soft text-critical',
    },
    {
      id: 'actioned' as const,
      label: 'Actioned',
      count: counts.actioned,
      icon: CheckCircle2,
      wrap: 'bg-done-soft text-done',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Inbox</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            What suppliers, factories, CHAs and agents have told us — captured and waiting.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unparsedCount > 0 && <ParseButton count={unparsedCount} />}
          <Link href="/inbox/new">
            <Button variant="primary" className="rounded-xl">
              <MessageSquarePlus size={16} aria-hidden />
              Add a message
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          const active = view === stat.id
          return (
            <Link
              key={stat.id}
              href={`/inbox?view=${stat.id}`}
              className={cn(
                'rounded-2xl border bg-surface-raised p-4 shadow-sm transition',
                active
                  ? 'border-accent ring-2 ring-accent/20'
                  : 'hover:border-border-strong hover:bg-surface-sunken/40',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-medium text-ink-faint">{stat.label}</p>
                  <p className="mt-1 text-2xl font-bold tnum text-ink">{stat.count}</p>
                </div>
                <span
                  className={cn(
                    'flex size-10 items-center justify-center rounded-xl',
                    stat.wrap,
                  )}
                >
                  <Icon size={18} aria-hidden />
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(INBOX_VIEWS) as InboxViewId[]).map((id) => (
              <Link
                key={id}
                href={id === 'review' ? '/inbox' : `/inbox?view=${id}`}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                  view === id
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {INBOX_VIEWS[id]}
                <span className="ml-1.5 text-ink-faint tnum">{counts[id]}</span>
              </Link>
            ))}
          </div>

          <label className="relative block w-full max-w-xs">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sender, import, text…"
              className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
        </div>

        {visible.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nothing here"
              description={
                query
                  ? 'No messages match that search.'
                  : view === 'review'
                    ? 'Forward a message to the import bot chat and it will appear here.'
                    : 'Try another filter.'
              }
              action={
                <Link href="/inbox/new">
                  <Button variant="primary" className="rounded-xl">
                    Add a message
                  </Button>
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y">
            {visible.map((row) => {
              const confidence = confidenceLabel(row)
              const needsAttention =
                row.status === 'new' ||
                row.status === 'in_review' ||
                row.parse_status === 'failed' ||
                (!row.import_id && row.match_status !== 'proposed')

              return (
                <li key={row.id}>
                  <Link
                    href={`/inbox/${row.id}`}
                    className={cn(
                      'block px-4 py-4 transition hover:bg-surface-sunken/60',
                      needsAttention && 'bg-critical-soft/20',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={row.source === 'manual' ? 'neutral' : 'accent'}>
                            {row.source === 'manual' ? 'Manual' : 'WhatsApp'}
                          </Badge>
                          <span className="text-[12px] text-ink-faint">{timeOf(row)}</span>
                          {row.attachment_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
                              <Paperclip size={12} aria-hidden />
                              {row.attachment_count}
                            </span>
                          )}
                        </div>

                        <p className="mt-1.5 text-[15px] font-semibold text-ink">
                          {row.sender_name ?? row.sender_phone ?? 'Unknown sender'}
                          {row.sender_role && row.sender_role !== 'Unknown' && (
                            <span className="ml-2 text-[12px] font-medium text-ink-faint">
                              {row.sender_role}
                            </span>
                          )}
                        </p>

                        <p className="mt-1 line-clamp-2 text-[14px] whitespace-pre-wrap text-ink-muted">
                          {row.body_text ?? (
                            <span className="text-ink-faint italic">No text</span>
                          )}
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {row.import_no ? (
                            <>
                              <span className="font-mono text-[13px] font-semibold text-ink">
                                {row.import_no}
                              </span>
                              <Badge tone="done">Linked</Badge>
                            </>
                          ) : row.matched_import_no ? (
                            <>
                              <span className="font-mono text-[13px]">{row.matched_import_no}</span>
                              <Badge tone="upcoming">
                                Suggested{confidence ? ` · ${confidence}` : ''}
                              </Badge>
                            </>
                          ) : row.parse_status === 'failed' ? (
                            <Badge tone="critical">Parse failed</Badge>
                          ) : row.parse_status === null ? (
                            <Badge tone="neutral">
                              <Sparkles size={11} aria-hidden />
                              Not parsed
                            </Badge>
                          ) : (
                            <Badge tone="waiting">Match required</Badge>
                          )}
                          <span className="text-[12px] text-ink-faint">
                            {COMMUNICATION_STATUS_LABELS[row.status]}
                          </span>
                        </div>
                      </div>

                      <span className="text-[12px] font-medium text-accent">Open →</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
