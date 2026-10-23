'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UserX,
} from 'lucide-react'
import { Badge, Button, EmptyState } from '@/components/ui'
import type { Supplier } from '@/lib/types'
import { cn } from '@/lib/utils'
import { SupplierForm } from './supplier-form'

const PAGE_SIZE = 10

export interface SupplierRow extends Supplier {
  import_count: number
  unverified_bank: boolean
}

type FilterId = 'all' | 'active' | 'unverified' | 'inactive'

export function SuppliersList({
  suppliers,
  currencies,
  incoterms,
}: {
  suppliers: SupplierRow[]
  currencies: string[]
  incoterms: string[]
}) {
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const active = useMemo(() => suppliers.filter((s) => s.is_active), [suppliers])
  const inactive = useMemo(() => suppliers.filter((s) => !s.is_active), [suppliers])
  const unverified = useMemo(
    () => suppliers.filter((s) => s.unverified_bank),
    [suppliers],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base =
      filter === 'active'
        ? active
        : filter === 'inactive'
          ? inactive
          : filter === 'unverified'
            ? unverified
            : suppliers

    return base.filter((s) => {
      if (!q) return true
      return [
        s.name,
        s.legal_name,
        s.country,
        s.city,
        s.default_currency,
        s.payment_terms_text,
        s.default_incoterm,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [suppliers, filter, query, active, inactive, unverified])

  // Unverified bank first, then active with most imports.
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.unverified_bank !== b.unverified_bank) return a.unverified_bank ? -1 : 1
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      if (b.import_count !== a.import_count) return b.import_count - a.import_count
      return a.name.localeCompare(b.name)
    })
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, sorted.length)

  useEffect(() => setPage(1), [filter, query])

  const stats = [
    {
      id: 'all' as const,
      label: 'All',
      count: suppliers.length,
      icon: Building2,
      wrap: 'bg-accent-soft text-accent',
    },
    {
      id: 'active' as const,
      label: 'Active',
      count: active.length,
      icon: CheckCircle2,
      wrap: 'bg-done-soft text-done',
    },
    {
      id: 'unverified' as const,
      label: 'Bank unverified',
      count: unverified.length,
      icon: AlertTriangle,
      wrap: 'bg-critical-soft text-critical',
    },
    {
      id: 'inactive' as const,
      label: 'Inactive',
      count: inactive.length,
      icon: UserX,
      wrap: 'bg-surface-sunken text-ink-muted',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Suppliers</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            Contacts, usual terms, and bank details — with every change to bank details kept on
            record.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden />
          Add supplier
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          const isActive = filter === stat.id
          return (
            <button
              key={stat.id}
              type="button"
              onClick={() => setFilter(stat.id)}
              className={cn(
                'rounded-2xl border bg-surface-raised p-4 text-left shadow-sm transition',
                isActive
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

      {unverified.length > 0 && filter !== 'unverified' && (
        <button
          type="button"
          onClick={() => setFilter('unverified')}
          className="flex w-full items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3 text-left"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
          <p className="text-[14px] text-critical">
            <span className="font-semibold">
              {unverified.length} supplier{unverified.length === 1 ? '' : 's'}
            </span>{' '}
            {unverified.length === 1 ? 'has' : 'have'} bank details waiting to be verified.
          </p>
        </button>
      )}

      {adding && (
        <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
          <div className="border-b px-4 py-3">
            <p className="text-[14px] font-semibold text-ink">New supplier</p>
            <p className="text-[12px] text-ink-muted">
              Usual terms and currency — bank accounts are added on the supplier page.
            </p>
          </div>
          <SupplierForm
            currencies={currencies}
            incoterms={incoterms}
            onDone={() => setAdding(false)}
          />
        </div>
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
              placeholder="Search name, country, terms…"
              className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
        </div>

        {pageRows.length === 0 && !adding ? (
          <div className="p-6">
            <EmptyState
              title="No suppliers to show"
              description="Add the first supplier above — an import can be created without one, but the supplier carries usual terms and bank details."
            />
          </div>
        ) : pageRows.length === 0 ? null : (
          <ul className="divide-y">
            {pageRows.map((supplier) => (
              <li key={supplier.id}>
                <Link
                  href={`/suppliers/${supplier.id}`}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 transition hover:bg-surface-sunken/50',
                    supplier.unverified_bank && 'bg-critical-soft/15',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-ink">{supplier.name}</span>
                      {!supplier.is_active && <Badge>Inactive</Badge>}
                      {supplier.unverified_bank && (
                        <Badge tone="critical">Bank unverified</Badge>
                      )}
                      {supplier.default_currency && (
                        <Badge tone="neutral">{supplier.default_currency}</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-muted">
                      {[
                        [supplier.city, supplier.country].filter(Boolean).join(', '),
                        supplier.payment_terms_text,
                        supplier.lead_time_days
                          ? `${supplier.lead_time_days} day lead time`
                          : null,
                        supplier.default_incoterm,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No details recorded yet'}
                    </p>
                  </div>

                  <span className="text-[13px] text-ink-muted tnum whitespace-nowrap">
                    {supplier.import_count}{' '}
                    {supplier.import_count === 1 ? 'import' : 'imports'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-sm text-ink-muted">
            Showing{' '}
            <span className="font-medium text-ink tnum">
              {from}–{to}
            </span>{' '}
            of <span className="font-medium text-ink tnum">{sorted.length}</span> suppliers
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
