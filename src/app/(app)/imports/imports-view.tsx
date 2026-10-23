'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Factory,
  FileText,
  Filter,
  Package,
  Plane,
  Search,
  Ship,
} from 'lucide-react'
import { EmptyState } from '@/components/ui'
import { daysOverdue, dueLabel, type PipelineStage } from '@/lib/import-status'
import { cn, formatDate } from '@/lib/utils'
import { NewImportButton } from './new-import-dialog'

export type ImportRow = {
  id: string
  importNo: string
  companyId: string
  companyCode: string
  supplier: string
  agent: string | null
  poNumber: string | null
  piNumber: string | null
  title: string | null
  status: string
  value: string
  nextAction: string | null
  dueDate: string | null
  waitingOn: string | null
  criticalCount: number
  dueTodayCount: number
  stage: PipelineStage
}

export type CompanyChip = {
  id: string
  name: string
  shortCode: string
}

const PAGE_SIZE = 8

const STAGE_CARDS: {
  id: PipelineStage
  label: string
  icon: typeof Package
  iconWrap: string
  iconColor: string
}[] = [
  {
    id: 'order',
    label: 'Ordering',
    icon: FileText,
    iconWrap: 'bg-accent-soft',
    iconColor: 'text-accent',
  },
  {
    id: 'make',
    label: 'Production',
    icon: Factory,
    iconWrap: 'bg-due-soft',
    iconColor: 'text-due',
  },
  {
    id: 'ship',
    label: 'Shipping',
    icon: Ship,
    iconWrap: 'bg-upcoming-soft',
    iconColor: 'text-upcoming',
  },
  {
    id: 'arrive',
    label: 'Arrival',
    icon: Plane,
    iconWrap: 'bg-done-soft',
    iconColor: 'text-done',
  },
]

type Attention = 'all' | 'critical' | 'today'

function attentionStatus(row: ImportRow): {
  label: string
  className: string
  dot: string
} {
  if (row.criticalCount > 0) {
    return {
      label: 'Overdue',
      className: 'bg-critical-soft text-critical',
      dot: 'bg-critical',
    }
  }
  if (row.dueTodayCount > 0) {
    return {
      label: 'Today',
      className: 'bg-due-soft text-due',
      dot: 'bg-due',
    }
  }
  if (row.stage === 'ship') {
    return {
      label: 'In Transit',
      className: 'bg-upcoming-soft text-upcoming',
      dot: 'bg-upcoming',
    }
  }
  if (row.status === 'Draft' || row.status === 'PO Stage') {
    return {
      label: 'Pending',
      className: 'bg-surface-sunken text-ink-muted',
      dot: 'bg-ink-faint',
    }
  }
  return {
    label: 'In Progress',
    className: 'bg-done-soft text-done',
    dot: 'bg-done',
  }
}

export function ImportsView({
  rows,
  companies,
  archived,
  initialQuery,
  initialAttention,
  initialCompany,
  initialStage,
}: {
  rows: ImportRow[]
  companies: CompanyChip[]
  archived: boolean
  initialQuery?: string
  initialAttention?: string
  initialCompany?: string
  initialStage?: string
}) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [attention, setAttention] = useState<Attention>(
    initialAttention === 'critical' || initialAttention === 'today'
      ? initialAttention
      : 'all',
  )
  const [companyId, setCompanyId] = useState(initialCompany ?? '')
  const [supplier, setSupplier] = useState('')
  const [agent, setAgent] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stage, setStage] = useState<PipelineStage | null>(
    initialStage === 'order' ||
      initialStage === 'make' ||
      initialStage === 'ship' ||
      initialStage === 'arrive'
      ? initialStage
      : null,
  )
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(true)

  const stageCounts = useMemo(() => {
    const counts: Record<PipelineStage, number> = {
      order: 0,
      make: 0,
      ship: 0,
      arrive: 0,
    }
    for (const row of rows) counts[row.stage] += 1
    return counts
  }, [rows])

  const overdue = rows.filter((row) => row.criticalCount > 0).length

  const suppliers = useMemo(() => {
    return [...new Set(rows.map((r) => r.supplier).filter(Boolean))].sort()
  }, [rows])

  const agents = useMemo(() => {
    return [
      ...new Set(rows.map((r) => r.agent).filter((a): a is string => Boolean(a))),
    ].sort()
  }, [rows])

  const statuses = useMemo(() => {
    return [...new Set(rows.map((r) => r.status))].sort()
  }, [rows])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (attention === 'critical' && row.criticalCount === 0) return false
      if (attention === 'today' && row.dueTodayCount === 0) return false
      if (companyId && row.companyId !== companyId) return false
      if (stage && row.stage !== stage) return false
      if (supplier && row.supplier !== supplier) return false
      if (agent && row.agent !== agent) return false
      if (statusFilter && row.status !== statusFilter) return false
      if (!needle) return true
      return [
        row.importNo,
        row.supplier,
        row.companyCode,
        row.poNumber,
        row.piNumber,
        row.title,
        row.status,
        row.agent,
      ].some((value) => value?.toLowerCase().includes(needle))
    })
  }, [rows, query, attention, companyId, stage, supplier, agent, statusFilter])

  const hasFilters =
    attention !== 'all' ||
    companyId !== '' ||
    stage !== null ||
    query.trim() !== '' ||
    supplier !== '' ||
    agent !== '' ||
    statusFilter !== ''

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, filtered.length)

  function clearFilters() {
    setQuery('')
    setAttention('all')
    setCompanyId('')
    setStage(null)
    setSupplier('')
    setAgent('')
    setStatusFilter('')
    setPage(1)
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllOnPage() {
    const ids = pageRows.map((r) => r.id)
    const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOn) ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex rounded-xl border bg-surface-sunken p-1 text-sm font-medium">
          <Link
            href="/imports"
            className={cn(
              'rounded-lg px-3 py-1.5 transition',
              archived
                ? 'text-ink-muted hover:text-ink'
                : 'bg-surface-raised text-ink shadow-sm',
            )}
          >
            Active
          </Link>
          <Link
            href="/imports?archived=1"
            className={cn(
              'rounded-lg px-3 py-1.5 transition',
              archived
                ? 'bg-surface-raised text-ink shadow-sm'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            Archive
          </Link>
        </div>
        <NewImportButton label="New Import" />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={archived ? 'No archived imports' : 'No imports yet'}
          description={
            archived
              ? 'Closed orders you archive will show up here.'
              : 'Create an import to start tracking an order.'
          }
          action={archived ? undefined : <NewImportButton label="New Import" />}
        />
      ) : (
        <>
          {/* Colourful stage summary cards */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            <button
              type="button"
              onClick={() => {
                setStage(null)
                setAttention('all')
                setPage(1)
              }}
              className="flex items-center gap-3 rounded-2xl bg-slate-800 px-4 py-3.5 text-left text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-700"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
                <Package size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <span>
                <span className="block text-xl font-semibold tnum leading-tight">
                  {rows.length}
                </span>
                <span className="block text-xs text-white/70">Imports</span>
              </span>
            </button>

            {STAGE_CARDS.map((card) => {
              const Icon = card.icon
              const count = stageCounts[card.id]
              const selected = stage === card.id
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    setStage(selected ? null : card.id)
                    setAttention('all')
                    setPage(1)
                  }}
                  aria-pressed={selected}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border bg-surface-raised px-4 py-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                    selected && 'ring-2 ring-accent',
                    count === 0 && 'opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                      card.iconWrap,
                      card.iconColor,
                    )}
                  >
                    <Icon size={18} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xl font-semibold tnum leading-tight text-ink">
                      {count}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">{card.label}</span>
                  </span>
                </button>
              )
            })}

            <button
              type="button"
              onClick={() => {
                setAttention(attention === 'critical' ? 'all' : 'critical')
                setStage(null)
                setPage(1)
              }}
              aria-pressed={attention === 'critical'}
              className={cn(
                'flex items-center gap-3 rounded-2xl border bg-surface-raised px-4 py-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md',
                attention === 'critical' && 'ring-2 ring-critical',
                overdue === 0 && 'opacity-60',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-critical-soft text-critical">
                <AlertTriangle size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <span>
                <span className="block text-xl font-semibold tnum leading-tight text-ink">
                  {overdue}
                </span>
                <span className="block text-xs text-ink-muted">Overdue</span>
              </span>
            </button>
          </div>

          <section className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
            <div className="space-y-3 border-b px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
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
                    placeholder="Search by import ID, supplier, PO or PL..."
                    className="w-full rounded-xl border border-border bg-surface-sunken py-2 pr-3 pl-9 text-sm outline-none focus:border-accent focus:bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setFiltersOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm font-medium text-ink-muted transition hover:bg-surface-sunken hover:text-ink"
                >
                  <Filter size={14} aria-hidden />
                  Filters
                </button>
              </div>

              {filtersOpen && (
                <div className="flex flex-wrap items-center gap-2">
                  <FilterSelect
                    label="Supplier"
                    value={supplier}
                    onChange={(v) => {
                      setSupplier(v)
                      setPage(1)
                    }}
                    options={suppliers.map((s) => ({ value: s, label: s }))}
                  />
                  <FilterSelect
                    label="Agent / CHA"
                    value={agent}
                    onChange={(v) => {
                      setAgent(v)
                      setPage(1)
                    }}
                    options={agents.map((a) => ({ value: a, label: a }))}
                  />
                  <FilterSelect
                    label="Status"
                    value={statusFilter}
                    onChange={(v) => {
                      setStatusFilter(v)
                      setPage(1)
                    }}
                    options={statuses.map((s) => ({ value: s, label: s }))}
                  />
                  <FilterSelect
                    label="Type"
                    value={stage ?? ''}
                    onChange={(v) => {
                      setStage(
                        v === 'order' || v === 'make' || v === 'ship' || v === 'arrive'
                          ? v
                          : null,
                      )
                      setPage(1)
                    }}
                    options={STAGE_CARDS.map((s) => ({ value: s.id, label: s.label }))}
                  />
                  {companies.length > 1 && (
                    <FilterSelect
                      label="Company"
                      value={companyId}
                      onChange={(v) => {
                        setCompanyId(v)
                        setPage(1)
                      }}
                      options={companies.map((c) => ({
                        value: c.id,
                        label: c.shortCode,
                      }))}
                    />
                  )}
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="px-2 text-sm font-medium text-accent hover:underline"
                    >
                      Clear all
                    </button>
                  )}
                </div>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="font-medium">Nothing matches</p>
                <p className="mt-1 text-ink-muted">Try another search or clear the filters.</p>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
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
                              pageRows.every((r) => selected.has(r.id))
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
                        <th className="px-3 py-3 font-medium">Amount</th>
                        <th className="w-12 px-3 py-3">
                          <span className="sr-only">Action</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => {
                        const status = attentionStatus(row)
                        const overdueRow = row.criticalCount > 0
                        const dueTodayRow = !overdueRow && row.dueTodayCount > 0
                        const overdueDays = daysOverdue(row.dueDate)
                        return (
                          <tr
                            key={row.id}
                            className={cn(
                              'border-b last:border-b-0',
                              overdueRow
                                ? 'border-l-4 border-l-critical bg-critical-soft/35'
                                : dueTodayRow
                                  ? 'border-l-4 border-l-due bg-due-soft/25'
                                  : 'border-l-4 border-l-transparent hover:bg-surface-sunken/40',
                            )}
                          >
                            <td className="px-4 py-3.5">
                              <input
                                type="checkbox"
                                aria-label={`Select ${row.importNo}`}
                                checked={selected.has(row.id)}
                                onChange={() => toggleRow(row.id)}
                                className="h-3.5 w-3.5 rounded border-border-strong accent-[var(--color-accent)]"
                              />
                            </td>
                            <td className="px-3 py-3.5">
                              <Link
                                href={`/imports/${row.id}`}
                                className="font-semibold text-ink hover:text-accent"
                              >
                                {row.importNo}
                              </Link>
                              <p className="text-xs text-ink-faint">{row.companyCode}</p>
                            </td>
                            <td className="max-w-[200px] px-3 py-3.5">
                              <Link href={`/imports/${row.id}`} className="block min-w-0">
                                <p className="truncate font-medium">
                                  {row.title?.trim() || row.supplier}
                                </p>
                                {row.nextAction && (
                                  <p className="truncate text-xs text-ink-faint">
                                    {row.nextAction}
                                  </p>
                                )}
                              </Link>
                            </td>
                            <td className="px-3 py-3.5">
                              <span className="inline-flex rounded-lg bg-accent-soft/80 px-2 py-1 text-xs font-medium text-accent">
                                {row.supplier}
                              </span>
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
                            <td className="px-3 py-3.5 whitespace-nowrap">
                              <p className="tnum text-ink">{formatDate(row.dueDate)}</p>
                              <p
                                className={cn(
                                  'text-xs font-medium',
                                  overdueRow
                                    ? 'text-critical'
                                    : dueTodayRow
                                      ? 'text-due'
                                      : 'text-ink-faint',
                                )}
                              >
                                {overdueDays !== null && overdueDays > 0
                                  ? `${overdueDays} days overdue`
                                  : dueLabel(row.dueDate)}
                              </p>
                            </td>
                            <td className="px-3 py-3.5 font-semibold whitespace-nowrap tnum">
                              {row.value}
                            </td>
                            <td className="px-3 py-3.5">
                              <Link
                                href={`/imports/${row.id}`}
                                aria-label={`Open ${row.importNo}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-sunken hover:text-ink"
                              >
                                <ArrowRight size={16} aria-hidden />
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
                    <PageBtn
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      label="Previous"
                    >
                      <ChevronLeft size={16} />
                    </PageBtn>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(
                      (n) => (
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
                    {totalPages > 5 && (
                      <span className="px-1 text-ink-faint">…</span>
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
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="appearance-none rounded-xl border border-border bg-surface-raised py-1.5 pr-8 pl-3 text-sm text-ink-muted outline-none focus:border-accent"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-faint"
      />
    </div>
  )
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
