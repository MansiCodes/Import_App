'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  Wallet,
} from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import { dueLabel } from '@/lib/import-status'
import { cn, formatDate, formatMoney } from '@/lib/utils'

const PAGE_SIZE = 10
const OPEN_STATUSES = ['Planned', 'Due', 'Approval Required', 'Approved', 'Payment Initiated']
const PAID_STATUSES = ['Paid', 'Supplier Confirmed']

export type PaymentRegisterRow = {
  id: string
  import_id: string
  seq: number
  description: string
  currency: string
  planned_amount: string
  due_date: string | null
  paid_at: string | null
  status: string
  is_advance: boolean
  boe_submitted_to_bank_at: string | null
  import_no: string | null
  supplier_name: string | null
  company_code: string | null
}

type FilterId = 'open' | 'overdue' | 'idpms' | 'paid' | 'all'

function isOverdue(p: PaymentRegisterRow): boolean {
  return (
    p.due_date !== null &&
    OPEN_STATUSES.includes(p.status) &&
    new Date(`${p.due_date}T00:00:00`) < new Date(new Date().toDateString())
  )
}

function isIdpms(p: PaymentRegisterRow): boolean {
  return Boolean(p.is_advance && p.paid_at && !p.boe_submitted_to_bank_at)
}

export function PaymentsRegisterView({
  payments,
  error,
}: {
  payments: PaymentRegisterRow[]
  error?: string | null
}) {
  const [filter, setFilter] = useState<FilterId>('open')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const overdue = useMemo(() => payments.filter(isOverdue), [payments])
  const idpms = useMemo(() => payments.filter(isIdpms), [payments])
  const open = useMemo(
    () => payments.filter((p) => OPEN_STATUSES.includes(p.status)),
    [payments],
  )
  const paid = useMemo(
    () => payments.filter((p) => PAID_STATUSES.includes(p.status)),
    [payments],
  )

  const outstanding = useMemo(() => {
    return open.reduce<Record<string, number>>((acc, p) => {
      acc[p.currency] = (acc[p.currency] ?? 0) + Number(p.planned_amount)
      return acc
    }, {})
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let base = payments
    if (filter === 'open') base = open
    else if (filter === 'overdue') base = overdue
    else if (filter === 'idpms') base = idpms
    else if (filter === 'paid') base = paid

    return base.filter((p) => {
      if (!q) return true
      return [
        p.import_no,
        p.supplier_name,
        p.company_code,
        p.description,
        p.status,
        p.currency,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [payments, filter, query, open, overdue, idpms, paid])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, filtered.length)

  useEffect(() => setPage(1), [filter, query])

  const stats = [
    {
      id: 'open' as const,
      label: 'Open',
      count: open.length,
      icon: Wallet,
      wrap: 'bg-accent-soft text-accent',
    },
    {
      id: 'overdue' as const,
      label: 'Overdue',
      count: overdue.length,
      icon: AlertTriangle,
      wrap: 'bg-critical-soft text-critical',
    },
    {
      id: 'idpms' as const,
      label: 'IDPMS pending',
      count: idpms.length,
      icon: Clock3,
      wrap: 'bg-due-soft text-due',
    },
    {
      id: 'paid' as const,
      label: 'Paid',
      count: paid.length,
      icon: CheckCircle2,
      wrap: 'bg-done-soft text-done',
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Payments</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Every instalment across every import. Nothing is marked paid without a human saying so.
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

      {Object.keys(outstanding).length > 0 && (
        <div className="rounded-2xl border bg-surface-raised p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-done-soft text-done">
              <Banknote size={16} aria-hidden />
            </span>
            <div>
              <p className="text-[12px] font-medium text-ink-faint">Outstanding (open)</p>
              <div className="mt-0.5 flex flex-wrap gap-x-5 gap-y-1">
                {Object.entries(outstanding)
                  .sort((a, b) => b[1] - a[1])
                  .map(([currency, total]) => (
                    <span key={currency} className="text-lg font-bold tnum text-ink">
                      {formatMoney(total, currency)}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {idpms.length > 0 && filter !== 'idpms' && (
        <button
          type="button"
          onClick={() => setFilter('idpms')}
          className="flex w-full items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3 text-left"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-critical" aria-hidden />
          <p className="text-[14px] text-critical">
            <span className="font-semibold">
              {idpms.length} advance{idpms.length === 1 ? '' : 's'}
            </span>{' '}
            await IDPMS closure — Bill of Entry not yet with the bank.
          </p>
        </button>
      )}

      {error && (
        <p className="rounded-xl bg-critical-soft px-4 py-3 text-sm text-critical">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {([...stats, { id: 'all' as const, label: 'Everything', count: payments.length }] ).map(
              (stat) => (
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
              ),
            )}
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
              placeholder="Search import, supplier…"
              className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
        </div>

        {pageRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No payments to show"
              description="Try another filter, or create a schedule on an import’s Payments tab."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b text-left text-[12px] font-medium text-ink-faint">
                  <th className="px-4 py-2.5">Import</th>
                  <th className="px-4 py-2.5">Instalment</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Due</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageRows.map((payment) => {
                  const overdue = isOverdue(payment)
                  const idpmsPending = isIdpms(payment)
                  return (
                    <tr
                      key={payment.id}
                      className={cn(
                        'transition hover:bg-surface-sunken/50',
                        overdue && 'bg-critical-soft/20',
                      )}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/imports/${payment.import_id}/payments`}
                          className="font-mono text-[13px] font-semibold text-accent hover:underline"
                        >
                          {payment.import_no}
                        </Link>
                        <p className="text-[12px] text-ink-muted">
                          {payment.supplier_name ?? payment.company_code ?? '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[14px] font-medium text-ink">{payment.description}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {payment.is_advance && <Badge tone="accent">Advance</Badge>}
                          {idpmsPending && <Badge tone="critical">IDPMS</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-[14px] font-semibold tnum whitespace-nowrap">
                        {formatMoney(payment.planned_amount, payment.currency)}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-3 text-[13px] whitespace-nowrap',
                          overdue ? 'font-medium text-critical' : 'text-ink-muted',
                        )}
                      >
                        {payment.due_date ? (
                          <>
                            <div>{formatDate(payment.due_date)}</div>
                            <div className="text-[12px]">{dueLabel(payment.due_date)}</div>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          tone={
                            PAID_STATUSES.includes(payment.status)
                              ? 'done'
                              : overdue
                                ? 'critical'
                                : 'neutral'
                          }
                        >
                          {payment.status}
                        </Badge>
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
            of <span className="font-medium text-ink tnum">{filtered.length}</span> payments
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
