'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Filter,
  Landmark,
  MoreVertical,
  Package,
  Search,
  Ship,
  Sun,
  Warehouse,
} from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { NewImportButton } from '@/app/(app)/imports/new-import-dialog'
import {
  daysOverdue,
  type PipelineStage,
  type Severity,
} from '@/lib/import-status'
import { cn, formatDate, formatMoney } from '@/lib/utils'

type StageId = PipelineStage

type StageCount = { id: StageId; count: number }

type MoneyChip = { currency: string; total: number }

export type DashboardRow = {
  key: string
  href: string
  importNo: string
  title: string
  subtitle: string | null
  supplier: string | null
  agent: string | null
  severity: Severity | 'in_progress'
  dueDate: string | null
}

const STAGE_META: {
  id: StageId
  label: string
  icon: typeof Package
  bar: string
  track: string
  iconWrap: string
}[] = [
  {
    id: 'order',
    label: 'Ordering',
    icon: Package,
    bar: 'bg-accent',
    track: 'bg-accent-soft',
    iconWrap: 'bg-accent-soft text-accent',
  },
  {
    id: 'make',
    label: 'Production',
    icon: Warehouse,
    bar: 'bg-due',
    track: 'bg-due-soft',
    iconWrap: 'bg-due-soft text-due',
  },
  {
    id: 'ship',
    label: 'Shipping',
    icon: Ship,
    bar: 'bg-upcoming',
    track: 'bg-upcoming-soft',
    iconWrap: 'bg-upcoming-soft text-upcoming',
  },
  {
    id: 'arrive',
    label: 'Arrival',
    icon: Landmark,
    bar: 'bg-done',
    track: 'bg-done-soft',
    iconWrap: 'bg-done-soft text-done',
  },
]

const TABS: { id: 'all' | Severity; label: string }[] = [
  { id: 'all', label: 'All Imports' },
  { id: 'critical', label: 'Overdue' },
  { id: 'due_today', label: 'Today' },
  { id: 'upcoming', label: 'Later' },
]

const PAGE_SIZE = 6

const STATUS_STYLE: Record<
  Severity | 'in_progress',
  { label: string; className: string; dot: string }
> = {
  critical: {
    label: 'Overdue',
    className: 'bg-critical-soft text-critical',
    dot: 'bg-critical',
  },
  due_today: {
    label: 'Today',
    className: 'bg-due-soft text-due',
    dot: 'bg-due',
  },
  upcoming: {
    label: 'In Progress',
    className: 'bg-accent-soft text-accent',
    dot: 'bg-accent',
  },
  in_progress: {
    label: 'In Progress',
    className: 'bg-accent-soft text-accent',
    dot: 'bg-accent',
  },
}

function greetingFor(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatHeaderDate(date = new Date()): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function daysLeftLabel(dueDate: string | null): { text: string; className: string } {
  const overdue = daysOverdue(dueDate)
  if (overdue === null) return { text: '—', className: 'text-ink-faint' }
  if (overdue > 0) {
    return {
      text: overdue === 1 ? '1 day' : `${overdue} days`,
      className: 'font-medium text-critical',
    }
  }
  if (overdue === 0) return { text: 'Due today', className: 'font-medium text-due' }
  const ahead = Math.abs(overdue)
  return {
    text: ahead === 1 ? '1 day' : `${ahead} days`,
    className: 'font-medium text-ink-muted',
  }
}

export function DashboardView({
  userName,
  activeCount,
  stages,
  values,
  rows,
}: {
  userName: string
  activeCount: number
  stages: StageCount[]
  values: MoneyChip[]
  rows: DashboardRow[]
}) {
  const [tab, setTab] = useState<'all' | Severity>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const firstName = (userName ?? 'there').trim().split(/\s+/)[0] || 'there'

  const stageCounts = useMemo(() => {
    const map = new Map(stages.map((s) => [s.id, s.count]))
    return STAGE_META.map((s) => ({ ...s, count: map.get(s.id) ?? 0 }))
  }, [stages])

  const stageTotal = Math.max(
    stageCounts.reduce((sum, s) => sum + s.count, 0),
    1,
  )

  const overdue = rows.filter((r) => r.severity === 'critical').length
  const today = rows.filter((r) => r.severity === 'due_today').length
  const later = rows.filter((r) => r.severity === 'upcoming').length

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (tab === 'critical' && row.severity !== 'critical') return false
      if (tab === 'due_today' && row.severity !== 'due_today') return false
      if (tab === 'upcoming' && row.severity !== 'upcoming' && row.severity !== 'in_progress') {
        return false
      }
      if (!needle) return true
      return (
        row.importNo.toLowerCase().includes(needle) ||
        row.title.toLowerCase().includes(needle) ||
        (row.supplier?.toLowerCase().includes(needle) ?? false) ||
        (row.agent?.toLowerCase().includes(needle) ?? false) ||
        (row.subtitle?.toLowerCase().includes(needle) ?? false)
      )
    })
  }, [rows, tab, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, filtered.length)

  function setTabAndReset(next: 'all' | Severity) {
    setTab(next)
    setPage(1)
  }

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAllOnPage() {
    const keys = pageRows.map((r) => r.key)
    const allSelected = keys.length > 0 && keys.every((k) => selected.has(k))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) keys.forEach((k) => next.delete(k))
      else keys.forEach((k) => next.add(k))
      return next
    })
  }

  const pageNumbers = paginationWindow(safePage, totalPages)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {greetingFor()}, {firstName}!{' '}
            <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-ink-muted">
            Here&apos;s what&apos;s happening with your imports today.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-faint">{formatHeaderDate()}</p>
          <NewImportButton />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Active Imports"
          value={activeCount}
          hint="Currently in progress"
          icon={Package}
          tone="accent"
          href="/imports"
        />
        <KpiCard
          label="Overdue"
          value={overdue}
          hint="Needs your attention"
          icon={AlertTriangle}
          tone="critical"
          active={tab === 'critical'}
          onClick={() => setTabAndReset(tab === 'critical' ? 'all' : 'critical')}
        />
        <KpiCard
          label="Due Today"
          value={today}
          hint="Due by tonight"
          icon={Sun}
          tone="due"
          active={tab === 'due_today'}
          onClick={() => setTabAndReset(tab === 'due_today' ? 'all' : 'due_today')}
        />
        <KpiCard
          label="Later"
          value={later}
          hint="Coming up"
          icon={CalendarClock}
          tone="upcoming"
          active={tab === 'upcoming'}
          onClick={() => setTabAndReset(tab === 'upcoming' ? 'all' : 'upcoming')}
        />
      </div>

      {activeCount > 0 && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {stageCounts.map((s) => {
            const pct = Math.round((s.count / stageTotal) * 100)
            const Icon = s.icon
            return (
              <div
                key={s.id}
                className="min-w-0 rounded-2xl border bg-surface-raised px-3 py-3 shadow-sm"
              >
                <p className="truncate text-sm font-medium text-ink-muted">{s.label}</p>
                <div className="mt-2 flex items-center gap-2.5">
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-xl',
                      s.iconWrap,
                    )}
                  >
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                  </span>
                  <p className="text-2xl font-semibold tnum text-ink">{s.count}</p>
                </div>
                <div className={cn('mt-2 h-1.5 overflow-hidden rounded-full', s.track)}>
                  <div
                    className={cn('h-full rounded-full transition-all', s.bar)}
                    style={{ width: `${Math.max(pct, s.count > 0 ? 8 : 0)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {values.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-faint">Open value</span>
          {values.map(({ currency, total }) => (
            <span
              key={currency}
              className="rounded-full bg-surface-raised px-3.5 py-1.5 text-sm font-semibold shadow-sm ring-1 ring-border tnum"
            >
              {formatMoney(total, currency)}
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={activeCount === 0 ? 'No active imports' : 'All clear'}
          description={
            activeCount === 0
              ? 'Create an import to start tracking orders.'
              : 'Nothing is due in the next few days.'
          }
          action={
            activeCount === 0 ? (
              <NewImportButton />
            ) : undefined
          }
        />
      ) : (
        <section className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 pt-2 pb-0">
            <div className="flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTabAndReset(t.id)}
                  aria-pressed={tab === t.id}
                  className={cn(
                    'relative px-3 pb-3 pt-2 text-sm font-medium whitespace-nowrap transition',
                    tab === t.id
                      ? 'text-accent after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:rounded-full after:bg-accent'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1 sm:flex-none">
                <Search
                  size={14}
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  }}
                  placeholder="Search by import ID..."
                  className="w-full rounded-xl border border-border bg-surface-sunken py-2 pr-3 pl-9 text-sm outline-none focus:border-accent focus:bg-white sm:w-56"
                />
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
              >
                <Filter size={14} aria-hidden />
                Filters
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="px-4 py-14 text-center">
              <p className="font-medium">Nothing in this view</p>
              <p className="mt-1 text-ink-muted">Try another tab or clear the search.</p>
              {(tab !== 'all' || query.trim()) && (
                <button
                  type="button"
                  onClick={() => {
                    setTab('all')
                    setQuery('')
                    setPage(1)
                  }}
                  className="mt-3 text-accent hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b bg-surface-sunken/60 text-xs font-medium tracking-wide text-ink-faint uppercase">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label="Select all on page"
                          checked={
                            pageRows.length > 0 &&
                            pageRows.every((r) => selected.has(r.key))
                          }
                          onChange={toggleAllOnPage}
                          className="h-3.5 w-3.5 rounded border-border-strong accent-[var(--color-accent)]"
                        />
                      </th>
                      <th className="px-3 py-3 font-medium">Import ID</th>
                      <th className="px-3 py-3 font-medium">Description</th>
                      <th className="px-3 py-3 font-medium">Supplier</th>
                      <th className="px-3 py-3 font-medium">Agent / CHA</th>
                      <th className="px-3 py-3 font-medium">Status</th>
                      <th className="px-3 py-3 font-medium">Due Date</th>
                      <th className="px-3 py-3 font-medium">Days Left</th>
                      <th className="w-12 px-3 py-3 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((row) => {
                      const status = STATUS_STYLE[row.severity]
                      const days = daysLeftLabel(row.dueDate)
                      return (
                        <tr
                          key={row.key}
                          className="border-b last:border-b-0 hover:bg-surface-sunken/40"
                        >
                          <td className="px-4 py-3.5">
                            <input
                              type="checkbox"
                              aria-label={`Select ${row.importNo}`}
                              checked={selected.has(row.key)}
                              onChange={() => toggleRow(row.key)}
                              className="h-3.5 w-3.5 rounded border-border-strong accent-[var(--color-accent)]"
                            />
                          </td>
                          <td className="px-3 py-3.5">
                            <Link
                              href={row.href}
                              className="font-semibold text-ink hover:text-accent"
                            >
                              {row.importNo}
                            </Link>
                          </td>
                          <td className="max-w-[220px] px-3 py-3.5">
                            <Link href={row.href} className="block min-w-0">
                              <p className="truncate font-medium text-ink">{row.title}</p>
                              {row.subtitle && (
                                <p className="truncate text-xs text-ink-faint">
                                  {row.subtitle}
                                </p>
                              )}
                            </Link>
                          </td>
                          <td className="px-3 py-3.5">
                            {row.supplier ? (
                              <span className="inline-flex rounded-lg bg-accent-soft/80 px-2 py-1 text-xs font-medium text-accent">
                                {row.supplier}
                              </span>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5">
                            {row.agent ? (
                              <span className="inline-flex rounded-lg bg-waiting-soft px-2 py-1 text-xs font-medium text-waiting">
                                {row.agent}
                              </span>
                            ) : (
                              <span className="text-ink-faint">—</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5">
                            <span
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                                status.className,
                              )}
                            >
                              <span
                                className={cn('h-1.5 w-1.5 rounded-full', status.dot)}
                              />
                              {status.label}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 whitespace-nowrap text-ink-muted tnum">
                            {formatDate(row.dueDate)}
                          </td>
                          <td className={cn('px-3 py-3.5 whitespace-nowrap tnum', days.className)}>
                            {days.text}
                          </td>
                          <td className="px-3 py-3.5">
                            <Link
                              href={row.href}
                              aria-label={`Open ${row.importNo}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-sunken hover:text-ink"
                            >
                              <MoreVertical size={16} aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                <p className="text-sm text-ink-muted">
                  Showing{' '}
                  <span className="font-medium text-ink tnum">
                    {from}–{to}
                  </span>{' '}
                  of{' '}
                  <span className="font-medium text-ink tnum">{filtered.length}</span>{' '}
                  imports
                </p>
                <div className="flex items-center gap-1">
                  <PaginationButton
                    ariaLabel="Previous page"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft size={16} aria-hidden />
                  </PaginationButton>
                  {pageNumbers.map((n, i) =>
                    n === '…' ? (
                      <span
                        key={`ellipsis-${i}`}
                        className="px-1.5 text-ink-faint"
                      >
                        …
                      </span>
                    ) : (
                      <PaginationButton
                        key={n}
                        ariaLabel={`Page ${n}`}
                        active={n === safePage}
                        onClick={() => setPage(n)}
                      >
                        {n}
                      </PaginationButton>
                    ),
                  )}
                  <PaginationButton
                    ariaLabel="Next page"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight size={16} aria-hidden />
                  </PaginationButton>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
  active,
  onClick,
}: {
  label: string
  value: number
  hint: string
  icon: typeof Package
  tone: 'accent' | 'critical' | 'due' | 'upcoming'
  href?: string
  active?: boolean
  onClick?: () => void
}) {
  const visualTone = value === 0 && tone !== 'accent' ? 'muted' : tone

  const shells = {
    accent: 'border-border bg-surface-raised',
    critical: 'border-border bg-surface-raised',
    due: 'border-border bg-surface-raised',
    upcoming: 'border-border bg-surface-raised',
    muted: 'border-border bg-surface-raised',
  } as const

  const icons = {
    accent: 'bg-accent-soft text-accent',
    critical: 'bg-critical-soft text-critical',
    due: 'bg-due-soft text-due',
    upcoming: 'bg-upcoming-soft text-upcoming',
    muted: 'bg-surface-sunken text-ink-muted',
  } as const

  const rings = {
    accent: 'ring-accent',
    critical: 'ring-critical',
    due: 'ring-due',
    upcoming: 'ring-upcoming',
    muted: 'ring-border-strong',
  } as const

  const body = (
    <>
      <p className="truncate text-sm font-medium text-ink-muted">{label}</p>
      <div className="mt-2 flex items-center gap-2.5">
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            icons[visualTone],
          )}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <p className="text-2xl font-semibold tracking-tight tnum text-ink">{value}</p>
      </div>
      <p className="mt-1 text-xs leading-snug text-ink-faint">{hint}</p>
    </>
  )

  const className = cn(
    'min-w-0 rounded-2xl border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
    shells[visualTone],
    active && `ring-2 ${rings[tone]}`,
  )

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {body}
    </button>
  )
}

function PaginationButton({
  children,
  onClick,
  disabled,
  active,
  ariaLabel,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition',
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

function paginationWindow(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages = new Set<number>([1, total, current, current - 1, current + 1, 2, 3, 4, 5])
  const sorted = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)

  const result: Array<number | '…'> = []
  for (let i = 0; i < sorted.length; i++) {
    const n = sorted[i]!
    if (i > 0 && n - sorted[i - 1]! > 1) result.push('…')
    result.push(n)
  }
  return result
}
