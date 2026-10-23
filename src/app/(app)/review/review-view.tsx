'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  Search,
  Wallet,
} from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import type { VerificationItem } from '@/lib/types'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 8

export type ReviewImport = {
  id: string
  import_no: string
  supplier_name: string | null
  company_code: string
  status: string
}

type Kind = VerificationItem['kind']
type FilterId = 'all' | Kind

const KIND_LABELS: Record<Kind, string> = {
  bank_account: 'Bank details',
  document: 'Documents',
  payment_schedule: 'Payment schedules',
}

const KIND_PATHS: Record<Kind, (importId: string) => string> = {
  bank_account: () => '/suppliers',
  document: (importId) => `/imports/${importId}/documents`,
  payment_schedule: (importId) => `/imports/${importId}/payments`,
}

const KIND_ORDER: Kind[] = ['bank_account', 'payment_schedule', 'document']

const KIND_META: Record<Kind, { icon: typeof Building2; wrap: string; tone: 'critical' | 'due' | 'upcoming' }> =
  {
    bank_account: {
      icon: Building2,
      wrap: 'bg-critical-soft text-critical',
      tone: 'critical',
    },
    payment_schedule: {
      icon: Wallet,
      wrap: 'bg-due-soft text-due',
      tone: 'due',
    },
    document: {
      icon: FileCheck2,
      wrap: 'bg-upcoming-soft text-upcoming',
      tone: 'upcoming',
    },
  }

function ageInDays(since: string): number {
  const then = new Date(since)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / 86_400_000)
}

function ageLabel(age: number): string {
  if (age === 0) return 'Today'
  if (age === 1) return '1 day'
  return `${age} days`
}

export function ReviewView({
  items,
  imports,
}: {
  items: VerificationItem[]
  imports: ReviewImport[]
}) {
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const importMap = useMemo(
    () => new Map(imports.map((i) => [i.id, i])),
    [imports],
  )

  const counts = useMemo(
    () => ({
      all: items.length,
      bank_account: items.filter((i) => i.kind === 'bank_account').length,
      payment_schedule: items.filter((i) => i.kind === 'payment_schedule').length,
      document: items.filter((i) => i.kind === 'document').length,
    }),
    [items],
  )

  const stale = useMemo(
    () => items.filter((i) => ageInDays(i.since) > 3).length,
    [items],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items
      .filter((item) => (filter === 'all' ? true : item.kind === filter))
      .filter((item) => {
        if (!q) return true
        const imp = importMap.get(item.import_id)
        return [item.title, item.detail, imp?.import_no, imp?.supplier_name, KIND_LABELS[item.kind]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) => {
        // Oldest / stale first, bank details before everything else on equal age
        const ageDiff = ageInDays(b.since) - ageInDays(a.since)
        if (ageDiff !== 0) return ageDiff
        return KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      })
  }, [items, filter, query, importMap])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, filtered.length)

  useEffect(() => {
    setPage(1)
  }, [filter, query])

  const stats: {
    id: FilterId
    label: string
    count: number
    icon: typeof ClipboardCheck
    wrap: string
  }[] = [
    {
      id: 'all',
      label: 'Waiting on you',
      count: counts.all,
      icon: ClipboardCheck,
      wrap: 'bg-accent-soft text-accent',
    },
    ...KIND_ORDER.map((kind) => ({
      id: kind as FilterId,
      label: KIND_LABELS[kind],
      count: counts[kind],
      icon: KIND_META[kind].icon,
      wrap: KIND_META[kind].wrap,
    })),
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Review</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Everything that has arrived or been calculated, but not yet checked by you.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          const active = filter === stat.id
          return (
            <button
              key={stat.id}
              type="button"
              onClick={() => setFilter(stat.id)}
              className={cn(
                'rounded-2xl border bg-surface-raised p-4 text-left shadow-sm transition',
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
            </button>
          )
        })}
      </div>

      {stale > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
          <p className="text-[14px] text-critical">
            <span className="font-semibold">
              {stale} item{stale === 1 ? '' : 's'}
            </span>{' '}
            waiting more than 3 days — start with bank details if any are open.
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title="Nothing waiting on you"
          description="Documents appear here when they arrive, bank details when they change, and payment schedules when they are calculated."
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex flex-wrap gap-1">
              {stats.map((stat) => (
                <button
                  key={stat.id}
                  type="button"
                  onClick={() => setFilter(stat.id)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                    filter === stat.id
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )}
                >
                  {stat.id === 'all' ? 'All' : KIND_LABELS[stat.id]}
                  <span className="ml-1.5 text-ink-faint tnum">{stat.count}</span>
                </button>
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
                placeholder="Search import, supplier, title…"
                className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
          </div>

          {filter === 'bank_account' && counts.bank_account > 0 && (
            <p className="border-b bg-critical-soft/70 px-4 py-2.5 text-[13px] text-critical">
              Check bank details against a source you already trust — a signed PI, or a call to a
              number you already had. Not the email that sent them.
            </p>
          )}

          {pageRows.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nothing matches"
                description="Try another filter or clear the search."
              />
            </div>
          ) : (
            <ul className="divide-y">
              {pageRows.map((item) => {
                const imp = importMap.get(item.import_id)
                const age = ageInDays(item.since)
                const meta = KIND_META[item.kind]
                const Icon = meta.icon

                return (
                  <li key={`${item.kind}-${item.record_id}`}>
                    <Link
                      href={KIND_PATHS[item.kind](item.import_id)}
                      className={cn(
                        'flex flex-wrap items-center gap-4 px-4 py-3.5 transition hover:bg-surface-sunken/55',
                        age > 3 && 'bg-critical-soft/20',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-xl',
                          meta.wrap,
                        )}
                      >
                        <Icon size={17} aria-hidden />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-ink">
                            {imp?.import_no ?? '—'}
                          </span>
                          <span className="text-[13px] text-ink-muted">
                            {imp?.supplier_name ?? imp?.company_code ?? '—'}
                          </span>
                          <Badge tone={meta.tone}>{KIND_LABELS[item.kind]}</Badge>
                          {age > 3 && <Badge tone="critical">Stale</Badge>}
                        </div>
                        <p className="mt-1 text-[14px] font-medium text-ink">{item.title}</p>
                        {item.detail && (
                          <p className="mt-0.5 line-clamp-1 text-[13px] text-ink-muted">
                            {item.detail}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={cn(
                            'text-[13px] font-semibold',
                            age > 3 ? 'text-critical' : 'text-ink-muted',
                          )}
                        >
                          {ageLabel(age)}
                        </span>
                        <span className="text-[12px] font-medium text-accent">Review →</span>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <p className="text-sm text-ink-muted">
              Showing{' '}
              <span className="font-medium text-ink tnum">
                {from}–{to}
              </span>{' '}
              of <span className="font-medium text-ink tnum">{filtered.length}</span> items
            </p>
            <div className="flex items-center gap-1">
              <PageBtn
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                label="Previous"
              >
                <ChevronLeft size={16} />
              </PageBtn>
              {pageNumbers(safePage, totalPages).map((n, i) =>
                n === '…' ? (
                  <span key={`e-${i}`} className="px-1 text-ink-faint">
                    …
                  </span>
                ) : (
                  <PageBtn
                    key={n}
                    active={n === safePage}
                    onClick={() => setPage(n)}
                    label={`Page ${n}`}
                  >
                    {n}
                  </PageBtn>
                ),
              )}
              <PageBtn
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                label="Next"
              >
                <ChevronRight size={16} />
              </PageBtn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 3) return [1, 2, 3, 4, '…', total]
  if (current >= total - 2) return [1, '…', total - 3, total - 2, total - 1, total]
  return [1, '…', current - 1, current, current + 1, '…', total]
}

function PageBtn({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition',
        active
          ? 'bg-accent text-white'
          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  )
}
