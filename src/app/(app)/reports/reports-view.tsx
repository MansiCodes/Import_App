'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ClipboardCheck,
  FileBarChart2,
  Ship,
  Truck,
  Wallet,
} from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui'
import { cn, formatMoney } from '@/lib/utils'

export interface StatusRow {
  company_name: string
  status: string
  currency: string
  import_count: number
  value_total: string
}

export interface PaymentRow {
  company_name: string
  currency: string
  payment_count: number
  planned_total: string
  paid_total: string | null
  outstanding_total: string | null
  overdue_total: string | null
  paid_without_rate: number
}

export interface SupplierRow {
  supplier_name: string
  country: string | null
  import_count: number
  completed_count: number
  avg_lead_time_days: string | null
  quoted_lead_time_days: number | null
  avg_slip_days: string | null
  on_time_count: number
  measurable_count: number
}

export interface ShippingRow {
  mode: string
  cha_name: string | null
  shipment_count: number
  arrived_count: number
  avg_transit_days: string | null
  avg_eta_slip_days: string | null
  on_time_count: number
  revised_count: number
}

export interface CustomsRow {
  company_name: string
  month: string | null
  boe_count: number
  duty_total: string
  assessable_total: string
  queried_count: number
  avg_clearance_days: string | null
}

export interface ComplianceRow {
  company_name: string
  required_count: number
  missing_count: number
  unverified_count: number
  verified_count: number
}

type SectionId =
  | 'status'
  | 'payments'
  | 'suppliers'
  | 'shipping'
  | 'customs'
  | 'compliance'

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[12px] font-medium text-ink-faint',
        right ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  )
}

function Sample({ n, unit = 'orders' }: { n: number; unit?: string }) {
  return (
    <span className="ml-1 text-[11px] text-ink-faint">
      ({n} {unit})
    </span>
  )
}

function ReportPanel({
  title,
  hint,
  children,
  empty,
}: {
  title: string
  hint?: string
  children: React.ReactNode
  empty?: boolean
}) {
  if (empty) {
    return (
      <div className="rounded-2xl border bg-surface-raised p-6 shadow-sm">
        <EmptyState title={`No ${title.toLowerCase()} yet`} description={hint} />
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
      <div className="border-b px-4 py-3">
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        {hint && <p className="text-[12px] text-ink-muted">{hint}</p>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}

export function ReportsView({
  statusRows,
  paymentRows,
  supplierRows,
  shippingRows,
  customsRows,
  complianceRows,
}: {
  statusRows: StatusRow[]
  paymentRows: PaymentRow[]
  supplierRows: SupplierRow[]
  shippingRows: ShippingRow[]
  customsRows: CustomsRow[]
  complianceRows: ComplianceRow[]
}) {
  const [section, setSection] = useState<SectionId>('status')

  const importTotal = useMemo(
    () => statusRows.reduce((n, r) => n + Number(r.import_count), 0),
    [statusRows],
  )
  const overdueTotal = useMemo(
    () => paymentRows.reduce((n, r) => n + Number(r.overdue_total ?? 0), 0),
    [paymentRows],
  )
  const missingDocs = useMemo(
    () => complianceRows.reduce((n, r) => n + Number(r.missing_count), 0),
    [complianceRows],
  )
  const shipmentTotal = useMemo(
    () => shippingRows.reduce((n, r) => n + Number(r.shipment_count), 0),
    [shippingRows],
  )
  const unpaidRateNote = useMemo(
    () => paymentRows.reduce((n, r) => n + Number(r.paid_without_rate), 0),
    [paymentRows],
  )

  const nothingYet =
    statusRows.length === 0 &&
    paymentRows.length === 0 &&
    supplierRows.length === 0 &&
    shippingRows.length === 0

  const sections: {
    id: SectionId
    label: string
    count: number
    icon: typeof FileBarChart2
    wrap: string
  }[] = [
    {
      id: 'status',
      label: 'Status',
      count: importTotal,
      icon: FileBarChart2,
      wrap: 'bg-accent-soft text-accent',
    },
    {
      id: 'payments',
      label: 'Payments',
      count: paymentRows.length,
      icon: Wallet,
      wrap: 'bg-due-soft text-due',
    },
    {
      id: 'suppliers',
      label: 'Suppliers',
      count: supplierRows.length,
      icon: Truck,
      wrap: 'bg-upcoming-soft text-upcoming',
    },
    {
      id: 'shipping',
      label: 'Shipping',
      count: shipmentTotal,
      icon: Ship,
      wrap: 'bg-done-soft text-done',
    },
    {
      id: 'customs',
      label: 'Customs',
      count: customsRows.length,
      icon: ClipboardCheck,
      wrap: 'bg-accent-soft text-accent',
    },
    {
      id: 'compliance',
      label: 'Compliance',
      count: missingDocs,
      icon: AlertTriangle,
      wrap: 'bg-critical-soft text-critical',
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Reports</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Computed when the page loads, from the same tables the working screens use — there is no
          separate reporting copy to fall behind.
        </p>
      </div>

      {nothingYet ? (
        <EmptyState
          title="Nothing to report yet"
          description="These fill in as imports, payments and shipments are recorded."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            {sections.map((stat) => {
              const Icon = stat.icon
              const active = section === stat.id
              return (
                <button
                  key={stat.id}
                  type="button"
                  onClick={() => setSection(stat.id)}
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

          {(overdueTotal > 0 || missingDocs > 0) && (
            <div className="flex flex-col gap-2">
              {overdueTotal > 0 && (
                <button
                  type="button"
                  onClick={() => setSection('payments')}
                  className="flex w-full items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3 text-left"
                >
                  <AlertTriangle
                    size={18}
                    className="mt-0.5 shrink-0 text-critical"
                    aria-hidden
                  />
                  <p className="text-[14px] text-critical">
                    Overdue payment exposure across companies — open the Payments section.
                  </p>
                </button>
              )}
              {missingDocs > 0 && (
                <button
                  type="button"
                  onClick={() => setSection('compliance')}
                  className="flex w-full items-start gap-3 rounded-2xl border border-critical/20 bg-critical-soft/60 px-4 py-3 text-left"
                >
                  <AlertTriangle
                    size={18}
                    className="mt-0.5 shrink-0 text-critical"
                    aria-hidden
                  />
                  <p className="text-[14px] text-critical">
                    <span className="font-semibold">
                      {missingDocs} required document{missingDocs === 1 ? '' : 's'}
                    </span>{' '}
                    still missing across companies.
                  </p>
                </button>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
            <div className="flex flex-wrap gap-1 border-b px-4 py-3">
              {sections.map((stat) => (
                <button
                  key={stat.id}
                  type="button"
                  onClick={() => setSection(stat.id)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                    section === stat.id
                      ? 'bg-accent-soft text-accent'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )}
                >
                  {stat.label}
                </button>
              ))}
            </div>

            <div className="space-y-4 p-4">
              {section === 'status' && (
                <ReportPanel
                  title="Where everything stands"
                  empty={statusRows.length === 0}
                  hint="Import counts and value by company and status."
                >
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className="border-b">
                        <Th>Company</Th>
                        <Th>Status</Th>
                        <Th right>Imports</Th>
                        <Th right>Value</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {statusRows.map((row, i) => (
                        <tr key={i} className="hover:bg-surface-sunken/40">
                          <td className="px-4 py-3 text-[14px]">{row.company_name}</td>
                          <td className="px-4 py-3">
                            <Badge tone="neutral">{row.status}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right tnum">{row.import_count}</td>
                          <td className="px-4 py-3 text-right font-medium tnum">
                            {formatMoney(row.value_total, row.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ReportPanel>
              )}

              {section === 'payments' && (
                <ReportPanel
                  title="Payment exposure"
                  empty={paymentRows.length === 0}
                  hint="Committed, paid, outstanding and overdue by company."
                >
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-b">
                        <Th>Company</Th>
                        <Th>Currency</Th>
                        <Th right>Committed</Th>
                        <Th right>Paid</Th>
                        <Th right>Outstanding</Th>
                        <Th right>Overdue</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {paymentRows.map((row, i) => (
                        <tr
                          key={i}
                          className={cn(
                            'hover:bg-surface-sunken/40',
                            Number(row.overdue_total ?? 0) > 0 && 'bg-critical-soft/15',
                          )}
                        >
                          <td className="px-4 py-3 text-[14px]">{row.company_name}</td>
                          <td className="px-4 py-3">
                            <Badge tone="neutral">{row.currency}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {formatMoney(row.planned_total, null)}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {formatMoney(row.paid_total, null)}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tnum">
                            {formatMoney(row.outstanding_total, null)}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {Number(row.overdue_total ?? 0) > 0 ? (
                              <span className="font-medium text-critical">
                                {formatMoney(row.overdue_total, null)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {unpaidRateNote > 0 && (
                    <p className="border-t px-4 py-3 text-[13px] text-ink-muted">
                      {unpaidRateNote} paid instalments have no exchange rate recorded, so they
                      contribute nothing to any INR figure. That is deliberate — no rate is ever
                      assumed.
                    </p>
                  )}
                </ReportPanel>
              )}

              {section === 'suppliers' && (
                <ReportPanel
                  title="Supplier performance"
                  empty={supplierRows.length === 0}
                  hint="Slip measured against the first promise."
                >
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-b">
                        <Th>Supplier</Th>
                        <Th>Country</Th>
                        <Th right>Orders</Th>
                        <Th right>Lead time</Th>
                        <Th right>Quoted</Th>
                        <Th right>Average slip</Th>
                        <Th right>On time</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {supplierRows.map((row, i) => (
                        <tr key={i} className="hover:bg-surface-sunken/40">
                          <td className="px-4 py-3 text-[14px] font-medium">{row.supplier_name}</td>
                          <td className="px-4 py-3 text-ink-muted">{row.country ?? '—'}</td>
                          <td className="px-4 py-3 text-right tnum">{row.import_count}</td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.avg_lead_time_days ? `${row.avg_lead_time_days}d` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.quoted_lead_time_days ? `${row.quoted_lead_time_days}d` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.avg_slip_days === null ? (
                              '—'
                            ) : (
                              <span
                                className={
                                  Number(row.avg_slip_days) > 0 ? 'text-critical' : 'text-done'
                                }
                              >
                                {Number(row.avg_slip_days) > 0 ? '+' : ''}
                                {row.avg_slip_days}d
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.measurable_count > 0 ? (
                              <>
                                {row.on_time_count}/{row.measurable_count}
                              </>
                            ) : (
                              <span className="text-ink-faint">not yet measurable</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ReportPanel>
              )}

              {section === 'shipping' && (
                <ReportPanel
                  title="Shipping performance"
                  empty={shippingRows.length === 0}
                  hint="ETA slip against the original ETA."
                >
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-b">
                        <Th>Mode</Th>
                        <Th>CHA</Th>
                        <Th right>Shipments</Th>
                        <Th right>Transit</Th>
                        <Th right>ETA slip</Th>
                        <Th right>On time</Th>
                        <Th right>ETA moved</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {shippingRows.map((row, i) => (
                        <tr key={i} className="hover:bg-surface-sunken/40">
                          <td className="px-4 py-3 capitalize">
                            <Badge tone="neutral">{row.mode}</Badge>
                          </td>
                          <td className="px-4 py-3 text-[14px]">{row.cha_name ?? '—'}</td>
                          <td className="px-4 py-3 text-right tnum">{row.shipment_count}</td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.avg_transit_days ? `${row.avg_transit_days}d` : '—'}
                            {row.arrived_count > 0 && (
                              <Sample n={row.arrived_count} unit="arrived" />
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.avg_eta_slip_days === null ? (
                              '—'
                            ) : (
                              <span
                                className={
                                  Number(row.avg_eta_slip_days) > 0
                                    ? 'text-critical'
                                    : 'text-done'
                                }
                              >
                                {Number(row.avg_eta_slip_days) > 0 ? '+' : ''}
                                {row.avg_eta_slip_days}d
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.arrived_count > 0
                              ? `${row.on_time_count}/${row.arrived_count}`
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tnum">{row.revised_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ReportPanel>
              )}

              {section === 'customs' && (
                <ReportPanel
                  title="Customs and duty"
                  empty={customsRows.length === 0}
                  hint="Recent Bill of Entry months."
                >
                  <table className="w-full min-w-[720px]">
                    <thead>
                      <tr className="border-b">
                        <Th>Company</Th>
                        <Th>Month</Th>
                        <Th right>Entries</Th>
                        <Th right>Assessable value</Th>
                        <Th right>Duty</Th>
                        <Th right>Queried</Th>
                        <Th right>Clearance</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {customsRows.map((row, i) => (
                        <tr key={i} className="hover:bg-surface-sunken/40">
                          <td className="px-4 py-3 text-[14px]">{row.company_name}</td>
                          <td className="px-4 py-3 text-ink-muted">
                            {row.month
                              ? new Date(row.month).toLocaleDateString('en-IN', {
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tnum">{row.boe_count}</td>
                          <td className="px-4 py-3 text-right tnum">
                            {formatMoney(row.assessable_total, 'INR')}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tnum">
                            {formatMoney(row.duty_total, 'INR')}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.queried_count > 0 ? (
                              <Badge tone="critical">{row.queried_count}</Badge>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.avg_clearance_days ? `${row.avg_clearance_days}d` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ReportPanel>
              )}

              {section === 'compliance' && (
                <ReportPanel
                  title="Document compliance"
                  empty={!complianceRows.some((r) => r.required_count > 0)}
                  hint="Required items only."
                >
                  <table className="w-full min-w-[560px]">
                    <thead>
                      <tr className="border-b">
                        <Th>Company</Th>
                        <Th right>Required</Th>
                        <Th right>Missing</Th>
                        <Th right>Received, unverified</Th>
                        <Th right>Verified</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {complianceRows.map((row, i) => (
                        <tr
                          key={i}
                          className={cn(
                            'hover:bg-surface-sunken/40',
                            row.missing_count > 0 && 'bg-critical-soft/15',
                          )}
                        >
                          <td className="px-4 py-3 text-[14px]">{row.company_name}</td>
                          <td className="px-4 py-3 text-right tnum">{row.required_count}</td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.missing_count > 0 ? (
                              <Badge tone="critical">{row.missing_count}</Badge>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.unverified_count > 0 ? (
                              <Badge tone="due">{row.unverified_count}</Badge>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-right tnum">
                            {row.verified_count > 0 ? (
                              <Badge tone="done">{row.verified_count}</Badge>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ReportPanel>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
