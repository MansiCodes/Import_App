'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileWarning,
  Search,
} from 'lucide-react'
import { Badge, EmptyState, VerificationBadge } from '@/components/ui'
import { GATE_LABELS, type ChecklistGate, type ChecklistRow } from '@/lib/types'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 10

export type DocumentRegisterRow = ChecklistRow & {
  import_no?: string
  supplier_name?: string | null
  company_code?: string | null
}

type FilterId = 'missing' | 'unverified' | 'received' | 'all'

function matchesFilter(row: DocumentRegisterRow, filter: FilterId): boolean {
  if (filter === 'missing') return row.requirement === 'required' && row.state === 'pending'
  if (filter === 'unverified') return row.state === 'received'
  if (filter === 'received') return row.state === 'received' || row.state === 'verified'
  return true
}

export function DocumentsRegisterView({ rows }: { rows: DocumentRegisterRow[] }) {
  const [filter, setFilter] = useState<FilterId>('missing')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const missing = useMemo(
    () => rows.filter((r) => matchesFilter(r, 'missing')),
    [rows],
  )
  const unverified = useMemo(
    () => rows.filter((r) => matchesFilter(r, 'unverified')),
    [rows],
  )
  const received = useMemo(
    () => rows.filter((r) => matchesFilter(r, 'received')),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base =
      filter === 'missing'
        ? missing
        : filter === 'unverified'
          ? unverified
          : filter === 'received'
            ? received
            : rows

    return base.filter((row) => {
      if (!q) return true
      return [
        row.import_no,
        row.supplier_name,
        row.company_code,
        row.type_name,
        row.type_code,
        GATE_LABELS[row.gate as ChecklistGate],
        row.state,
        row.file_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [rows, filter, query, missing, unverified, received])

  // Missing first, then unverified, then the rest — actionable at the top.
  const sorted = useMemo(() => {
    const rank = (r: DocumentRegisterRow) => {
      if (r.requirement === 'required' && r.state === 'pending') return 0
      if (r.state === 'received') return 1
      if (r.state === 'rejected') return 2
      if (r.state === 'verified') return 3
      return 4
    }
    return [...filtered].sort((a, b) => {
      const d = rank(a) - rank(b)
      if (d !== 0) return d
      return (a.import_no ?? '').localeCompare(b.import_no ?? '')
    })
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, sorted.length)
  const importCount = useMemo(
    () => new Set(sorted.map((r) => r.import_id)).size,
    [sorted],
  )

  useEffect(() => setPage(1), [filter, query])

  const stats = [
    {
      id: 'missing' as const,
      label: 'Missing required',
      count: missing.length,
      icon: FileWarning,
      wrap: 'bg-critical-soft text-critical',
    },
    {
      id: 'unverified' as const,
      label: 'Not verified',
      count: unverified.length,
      icon: ClipboardList,
      wrap: 'bg-due-soft text-due',
    },
    {
      id: 'received' as const,
      label: 'On record',
      count: received.length,
      icon: CheckCircle2,
      wrap: 'bg-done-soft text-done',
    },
    {
      id: 'all' as const,
      label: 'Everything',
      count: rows.length,
      icon: ClipboardList,
      wrap: 'bg-accent-soft text-accent',
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Documents</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Across every active import — what is missing, and what has arrived but not been checked.
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

      {missing.length > 0 && filter !== 'missing' && (
        <button
          type="button"
          onClick={() => setFilter('missing')}
          className="flex w-full items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3 text-left"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
          <p className="text-[14px] text-critical">
            <span className="font-semibold">
              {missing.length} required document{missing.length === 1 ? '' : 's'}
            </span>{' '}
            still not received across active imports.
          </p>
        </button>
      )}

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
              placeholder="Search import, type, gate…"
              className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
        </div>

        {pageRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={
                filter === 'missing'
                  ? 'Nothing required is missing'
                  : filter === 'unverified'
                    ? 'Nothing is waiting to be verified'
                    : 'No documents to show'
              }
              description="Checklists are applied on an import’s Documents tab."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b text-left text-[12px] font-medium text-ink-faint">
                  <th className="px-4 py-2.5">Import</th>
                  <th className="px-4 py-2.5">Document</th>
                  <th className="px-4 py-2.5">Gate</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((row) => {
                  const isMissing = row.requirement === 'required' && row.state === 'pending'
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'transition hover:bg-surface-sunken/50',
                        isMissing && 'bg-critical-soft/20',
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/imports/${row.import_id}/documents`}
                          className="font-mono text-[13px] font-semibold text-accent hover:underline"
                        >
                          {row.import_no}
                        </Link>
                        <p className="text-[12px] text-ink-muted">
                          {row.supplier_name ?? row.company_code ?? '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[14px] font-medium text-ink">{row.type_name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {row.requirement === 'required' && (
                            <Badge tone={isMissing ? 'critical' : 'neutral'}>Required</Badge>
                          )}
                          {row.drive_url && (
                            <a
                              href={row.drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[12px] text-accent hover:underline"
                            >
                              open ↗
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-muted whitespace-nowrap">
                        {GATE_LABELS[row.gate as ChecklistGate] ?? row.gate}
                      </td>
                      <td className="px-4 py-3">
                        <VerificationBadge status={row.state} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-sm text-ink-muted">
            Showing{' '}
            <span className="font-medium text-ink tnum">
              {from}–{to}
            </span>{' '}
            of <span className="font-medium text-ink tnum">{sorted.length}</span> items
            {importCount > 0 && (
              <>
                {' '}
                across <span className="font-medium text-ink tnum">{importCount}</span>{' '}
                {importCount === 1 ? 'import' : 'imports'}
              </>
            )}
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
