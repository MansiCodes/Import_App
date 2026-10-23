'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Package,
  Plane,
  Search,
  Ship,
  Truck,
} from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import type { ShipmentBoardRow } from '@/lib/types'
import { cn, formatDate } from '@/lib/utils'

const PAGE_SIZE = 10

const MODE_LABELS: Record<string, string> = {
  air: 'Air',
  sea: 'Sea',
  courier: 'Courier',
  road: 'Road',
}

type Bucket = 'overdue' | 'arriving' | 'transit' | 'planned' | 'landed'
type FilterId = 'all' | Bucket

function bucketOf(row: ShipmentBoardRow): Bucket {
  if (row.actual_arrival || row.status === 'Delivered' || row.status === 'Customs Cleared') {
    return 'landed'
  }
  if (row.days_to_eta === null) return row.status === 'Planned' ? 'planned' : 'transit'
  if (row.days_to_eta < 0) return 'overdue'
  if (row.days_to_eta <= 7) return 'arriving'
  return 'transit'
}

function etaLabel(row: ShipmentBoardRow): string {
  if (row.actual_arrival) return `Arrived ${formatDate(row.actual_arrival)}`
  if (row.effective_eta === null) return 'No ETA'
  if (row.days_to_eta === null) return formatDate(row.effective_eta)
  if (row.days_to_eta < 0) return `${Math.abs(row.days_to_eta)}d overdue`
  if (row.days_to_eta === 0) return 'Arriving today'
  return `in ${row.days_to_eta}d · ${formatDate(row.effective_eta)}`
}

const BUCKET_META: Record<
  Bucket,
  { label: string; note: string; icon: typeof Ship; wrap: string; tone: 'critical' | 'due' | 'upcoming' | 'neutral' | 'done' }
> = {
  overdue: {
    label: 'Overdue',
    note: 'Past ETA and not marked arrived',
    icon: AlertTriangle,
    wrap: 'bg-critical-soft text-critical',
    tone: 'critical',
  },
  arriving: {
    label: 'Arriving',
    note: 'ETA within 7 days',
    icon: CalendarClock,
    wrap: 'bg-due-soft text-due',
    tone: 'due',
  },
  transit: {
    label: 'In transit',
    note: 'On the water / in the air',
    icon: Ship,
    wrap: 'bg-upcoming-soft text-upcoming',
    tone: 'upcoming',
  },
  planned: {
    label: 'Planned',
    note: 'Not yet moving',
    icon: Package,
    wrap: 'bg-surface-sunken text-ink-muted',
    tone: 'neutral',
  },
  landed: {
    label: 'Arrived',
    note: 'Awaiting clearance or delivery',
    icon: CheckCircle2,
    wrap: 'bg-done-soft text-done',
    tone: 'done',
  },
}

export function ShipmentsBoardView({ rows }: { rows: ShipmentBoardRow[] }) {
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const buckets = useMemo(() => {
    const map: Record<Bucket, ShipmentBoardRow[]> = {
      overdue: [],
      arriving: [],
      transit: [],
      planned: [],
      landed: [],
    }
    for (const row of rows) map[bucketOf(row)].push(row)
    return map
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = filter === 'all' ? rows : buckets[filter]
    return base.filter((row) => {
      if (!q) return true
      return [
        row.import_no,
        row.supplier_name,
        row.company_code,
        row.awb,
        row.bl_no,
        row.tracking_no,
        row.shipment_no,
        row.origin_port,
        row.destination_port,
        row.status,
        MODE_LABELS[row.mode],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [rows, buckets, filter, query])

  // Prefer actionable buckets when showing "all"
  const sorted = useMemo(() => {
    if (filter !== 'all') return filtered
    const order: Bucket[] = ['overdue', 'arriving', 'transit', 'planned', 'landed']
    return [...filtered].sort(
      (a, b) => order.indexOf(bucketOf(a)) - order.indexOf(bucketOf(b)),
    )
  }, [filtered, filter])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, sorted.length)

  useEffect(() => setPage(1), [filter, query])

  const stats: { id: FilterId; label: string; count: number; icon: typeof Ship; wrap: string }[] = [
    {
      id: 'all',
      label: 'All active',
      count: rows.length,
      icon: Plane,
      wrap: 'bg-accent-soft text-accent',
    },
    ...(Object.keys(BUCKET_META) as Bucket[]).map((id) => ({
      id: id as FilterId,
      label: BUCKET_META[id].label,
      count: buckets[id].length,
      icon: BUCKET_META[id].icon,
      wrap: BUCKET_META[id].wrap,
    })),
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Shipments</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          In transit, arriving and under customs clearance — current the moment you open it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
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
                  <p className="mt-1 text-2xl font-bold tnum">{stat.count}</p>
                </div>
                <span className={cn('flex size-10 items-center justify-center rounded-xl', stat.wrap)}>
                  <Icon size={18} aria-hidden />
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {buckets.overdue.length > 0 && filter !== 'overdue' && (
        <button
          type="button"
          onClick={() => setFilter('overdue')}
          className="flex w-full items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3 text-left"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
          <p className="text-[14px] text-critical">
            <span className="font-semibold">
              {buckets.overdue.length} shipment{buckets.overdue.length === 1 ? '' : 's'}
            </span>{' '}
            past ETA and not marked arrived.
          </p>
        </button>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing in transit"
          description="Shipments appear here as soon as they are added to an import."
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
                  {stat.label}
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
                placeholder="Search import, AWB, BL, route…"
                className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
          </div>

          {pageRows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nothing matches" description="Try another filter or clear search." />
            </div>
          ) : (
            <ul className="divide-y">
              {pageRows.map((row) => {
                const bucket = bucketOf(row)
                const meta = BUCKET_META[bucket]
                const identifier = row.awb ?? row.bl_no ?? row.tracking_no ?? row.shipment_no
                const ModeIcon =
                  row.mode === 'air' ? Plane : row.mode === 'road' || row.mode === 'courier' ? Truck : Ship

                return (
                  <li key={row.id}>
                    <Link
                      href={`/imports/${row.import_id}/shipments`}
                      className={cn(
                        'flex flex-wrap items-center gap-4 px-4 py-3.5 transition hover:bg-surface-sunken/55',
                        bucket === 'overdue' && 'bg-critical-soft/20',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-10 shrink-0 items-center justify-center rounded-xl',
                          meta.wrap,
                        )}
                      >
                        <ModeIcon size={17} aria-hidden />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold text-accent">
                            {row.import_no}
                          </span>
                          <Badge tone="accent">{MODE_LABELS[row.mode] ?? row.mode}</Badge>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          {row.eta_revised && <Badge tone="due">ETA moved</Badge>}
                        </div>
                        <p className="mt-1 text-[14px] font-medium text-ink">
                          {row.supplier_name ?? 'Supplier not set'}
                          <span className="font-normal text-ink-faint"> · {row.company_code}</span>
                        </p>
                        <p className="mt-0.5 text-[13px] text-ink-muted">
                          {row.origin_port ?? row.origin_country ?? '—'} →{' '}
                          {row.destination_port ?? '—'}
                          {identifier && (
                            <span className="ml-2 font-mono text-[12px] text-ink-faint">
                              {identifier}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={cn(
                            'text-[13px] font-semibold',
                            bucket === 'overdue' ? 'text-critical' : 'text-ink',
                          )}
                        >
                          {etaLabel(row)}
                        </span>
                        <span className="text-[12px] text-ink-faint">{row.status}</span>
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
              of <span className="font-medium text-ink tnum">{sorted.length}</span> shipments
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
        active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  )
}
