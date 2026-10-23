'use client'

import { useActionState, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Package,
  Plus,
  Scale,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Select,
  Textarea,
} from '@/components/ui'
import {
  ALLOCATION_BASES,
  ALLOCATION_BASIS_LABELS,
  costPerCbm,
  costPerKg,
  formatDiffPct,
  invoiceChargeGap,
  isLargeDeviation,
  type AllocationBasis,
} from '@/lib/product-costing'
import type {
  CargoLineCosting,
  FreightChargeType,
  LogisticsInvoice,
  LogisticsInvoiceCharge,
  QuoteVsActualRow,
  Shipment,
  ShipmentCargoLine,
  ShipmentCostingSummary,
} from '@/lib/types'
import { cn, formatMoney } from '@/lib/utils'
import {
  deleteCargoLine,
  deleteInvoiceCharge,
  deleteLogisticsInvoice,
  saveCargoLine,
  saveInvoiceCharge,
  saveLogisticsInvoice,
  syncInvoiceRollup,
  type ActionResult,
} from './actions'

type View = 'table' | 'shipment' | 'compare' | 'setup'

export function ProductCostingPanel({
  importId,
  importNo,
  defaultCurrency,
  initialShipmentId,
  initialView,
  shipments,
  cargo,
  invoices,
  charges,
  costing,
  summaries,
  compare,
  chargeTypes,
}: {
  importId: string
  importNo: string
  defaultCurrency: string
  initialShipmentId: string | null
  initialView: View | null
  shipments: Shipment[]
  cargo: ShipmentCargoLine[]
  invoices: LogisticsInvoice[]
  charges: LogisticsInvoiceCharge[]
  costing: CargoLineCosting[]
  summaries: ShipmentCostingSummary[]
  compare: QuoteVsActualRow[]
  chargeTypes: FreightChargeType[]
}) {
  const [view, setView] = useState<View>(
    initialView && ['table', 'shipment', 'compare', 'setup'].includes(initialView)
      ? initialView
      : 'table',
  )
  const [shipmentId, setShipmentId] = useState(
    initialShipmentId ?? shipments[0]?.id ?? '',
  )

  const shipmentCargo = useMemo(
    () => cargo.filter((c) => c.shipment_id === shipmentId),
    [cargo, shipmentId],
  )
  const shipmentInvoices = useMemo(
    () => invoices.filter((i) => i.shipment_id === shipmentId),
    [invoices, shipmentId],
  )
  const shipmentCosting = useMemo(
    () => costing.filter((c) => c.shipment_id === shipmentId),
    [costing, shipmentId],
  )
  const summary = summaries.find((s) => s.shipment_id === shipmentId)
  const shipmentCompare = useMemo(
    () =>
      compare.filter(
        (r) => !shipmentId || r.shipment_id === shipmentId || r.shipment_id === null,
      ),
    [compare, shipmentId],
  )

  const shipment = shipments.find((s) => s.id === shipmentId)
  const invoiceIds = new Set(shipmentInvoices.map((i) => i.id))
  const shipmentCharges = charges.filter((c) => invoiceIds.has(c.invoice_id))

  if (shipments.length === 0) {
    return (
      <EmptyState
        title="Add a shipment first"
        description="Product-wise costing maps cargo and logistics invoices to a shipment / BL."
        action={
          <Link href={`/imports/${importId}/shipments`}>
            <Button variant="primary">Go to Shipments</Button>
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Product Costing</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {importNo} — invoice charge lines allocated to products (not new expenses)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={shipmentId}
            onChange={(e) => setShipmentId(e.target.value)}
            className="min-w-48"
          >
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                Lot {s.seq}
                {s.bl_no ? ` · BL ${s.bl_no}` : ''}
                {s.awb ? ` · AWB ${s.awb}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-0">
        {(
          [
            ['table', 'Product-wise'],
            ['shipment', 'Packing List / BL'],
            ['compare', 'Quoted vs Actual'],
            ['setup', 'Cargo & Invoices'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cn(
              'relative px-3 pb-2.5 text-sm font-medium transition',
              view === id
                ? 'text-accent after:absolute after:right-0 after:bottom-0 after:left-0 after:h-0.5 after:bg-accent'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {summary && Math.abs(Number(summary.invoice_charge_gap)) > 0.01 && (
        <WarningBanner>
          Unallocated / invoice gap: charges differ from invoice totals by{' '}
          <span className="font-semibold tnum">
            {formatMoney(summary.invoice_charge_gap, defaultCurrency)}
          </span>
          . Fix charge lines so they reconcile with the source invoice.
        </WarningBanner>
      )}
      {summary && Math.abs(Number(summary.unallocated_amount)) > 0.01 && (
        <WarningBanner>
          Unallocated amount:{' '}
          <span className="font-semibold tnum">
            {formatMoney(summary.unallocated_amount, defaultCurrency)}
          </span>{' '}
          — product allocations do not yet equal charge totals.
        </WarningBanner>
      )}

      {view === 'table' && (
        <ProductTable rows={shipmentCosting} currency={defaultCurrency} />
      )}
      {view === 'shipment' && (
        <ShipmentBlView
          shipment={shipment}
          summary={summary}
          cargo={shipmentCargo}
          invoices={shipmentInvoices}
          charges={shipmentCharges}
          costing={shipmentCosting}
          currency={defaultCurrency}
        />
      )}
      {view === 'compare' && (
        <CompareView
          rows={shipmentCompare}
          summary={summary}
          currency={defaultCurrency}
        />
      )}
      {view === 'setup' && (
        <SetupView
          importId={importId}
          shipmentId={shipmentId}
          currency={defaultCurrency}
          cargo={shipmentCargo}
          invoices={shipmentInvoices}
          charges={charges}
          chargeTypes={chargeTypes}
        />
      )}
    </div>
  )
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-due/30 bg-due-soft px-3 py-2.5 text-sm text-due">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

function ProductTable({
  rows,
  currency,
}: {
  rows: CargoLineCosting[]
  currency: string
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No product allocations yet"
        description="Add cargo lines and logistics invoice charges under Cargo & Invoices."
      />
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead>
            <tr className="border-b bg-surface-sunken/60 text-xs font-medium tracking-wide text-ink-faint uppercase">
              <th className="px-3 py-2.5">Product</th>
              <th className="px-3 py-2.5">Qty</th>
              <th className="px-3 py-2.5">Weight</th>
              <th className="px-3 py-2.5">Product value</th>
              <th className="px-3 py-2.5">Freight</th>
              <th className="px-3 py-2.5">BL/AWB</th>
              <th className="px-3 py-2.5">CHA</th>
              <th className="px-3 py-2.5">Local</th>
              <th className="px-3 py-2.5">Other</th>
              <th className="px-3 py-2.5">Total logistics</th>
              <th className="px-3 py-2.5">Cost/unit</th>
              <th className="px-3 py-2.5">Landed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.cargo_line_id} className="border-b last:border-b-0">
                <td className="px-3 py-2.5">
                  <p className="font-medium">{row.description}</p>
                  {(row.sku || row.product_code) && (
                    <p className="text-xs text-ink-faint">
                      {[row.sku, row.product_code].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2.5 tnum">
                  {row.quantity ?? '—'}
                  {row.unit ? ` ${row.unit}` : ''}
                </td>
                <td className="px-3 py-2.5 tnum">
                  {row.gross_weight_kg != null ? `${row.gross_weight_kg} kg` : '—'}
                </td>
                <td className="px-3 py-2.5 tnum">
                  {formatMoney(row.line_value, row.product_currency ?? currency)}
                </td>
                <td className="px-3 py-2.5 tnum">{formatMoney(row.freight_alloc, currency)}</td>
                <td className="px-3 py-2.5 tnum">{formatMoney(row.bl_awb_alloc, currency)}</td>
                <td className="px-3 py-2.5 tnum">{formatMoney(row.cha_alloc, currency)}</td>
                <td className="px-3 py-2.5 tnum">{formatMoney(row.local_alloc, currency)}</td>
                <td className="px-3 py-2.5 tnum">
                  {formatMoney(
                    Number(row.other_alloc) + Number(row.tax_alloc),
                    currency,
                  )}
                </td>
                <td className="px-3 py-2.5 font-medium tnum">
                  {formatMoney(row.total_logistics, currency)}
                </td>
                <td className="px-3 py-2.5 tnum">
                  {row.logistics_per_unit != null
                    ? formatMoney(row.logistics_per_unit, currency)
                    : '—'}
                </td>
                <td className="px-3 py-2.5 font-semibold tnum">
                  {formatMoney(row.landed_cost, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ShipmentBlView({
  shipment,
  summary,
  cargo,
  invoices,
  charges,
  costing,
  currency,
}: {
  shipment?: Shipment
  summary?: ShipmentCostingSummary
  cargo: ShipmentCargoLine[]
  invoices: LogisticsInvoice[]
  charges: LogisticsInvoiceCharge[]
  costing: CargoLineCosting[]
  currency: string
}) {
  const totalLogistics = costing.reduce((s, r) => s + Number(r.total_logistics), 0)
  const weight = Number(summary?.cargo_gross_weight_kg ?? shipment?.gross_weight_kg ?? 0) || null
  const cbm = Number(summary?.shipment_cbm ?? shipment?.cbm ?? 0) || null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Products" value={String(summary?.product_count ?? cargo.length)} icon={Package} />
        <StatCard
          label="Cargo weight"
          value={weight != null ? `${weight} kg` : '—'}
          icon={Scale}
        />
        <StatCard
          label="Total logistics"
          value={formatMoney(totalLogistics, currency)}
        />
        <StatCard
          label="Cost / kg"
          value={
            costPerKg(totalLogistics, weight) != null
              ? formatMoney(costPerKg(totalLogistics, weight), currency)
              : '—'
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Lot {shipment?.seq}
            {shipment?.bl_no ? ` · BL ${shipment.bl_no}` : ''}
            {shipment?.awb ? ` · AWB ${shipment.awb}` : ''}
          </CardTitle>
          <span className="text-ink-muted">
            CBM cost:{' '}
            {costPerCbm(totalLogistics, cbm) != null
              ? formatMoney(costPerCbm(totalLogistics, cbm), currency)
              : '—'}
          </span>
        </CardHeader>
        <div className="space-y-3 p-4">
          {invoices.length === 0 ? (
            <p className="text-ink-muted">No logistics invoices on this shipment yet.</p>
          ) : (
            invoices.map((inv) => {
              const invCharges = charges.filter((c) => c.invoice_id === inv.id)
              const gap = invoiceChargeGap(
                Number(inv.grand_total),
                invCharges.map((c) => Number(c.amount)),
              )
              return (
                <div key={inv.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {inv.vendor ?? 'Vendor'} · {inv.invoice_no ?? 'No invoice #'}
                      </p>
                      <p className="text-xs text-ink-faint">
                        Source total {formatMoney(inv.grand_total, inv.currency)}
                      </p>
                    </div>
                    {Math.abs(gap) > 0.01 && (
                      <Badge tone="due">Gap {formatMoney(gap, inv.currency)}</Badge>
                    )}
                  </div>
                  <ul className="mt-2 divide-y">
                    {invCharges.map((ch) => (
                      <li
                        key={ch.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"
                      >
                        <span>
                          {ch.charge_name ?? ch.description ?? 'Charge'}
                          {ch.is_tax && (
                            <Badge tone="waiting" className="ml-2">
                              Tax
                            </Badge>
                          )}
                          <span className="ml-2 text-xs text-ink-faint">
                            {ALLOCATION_BASIS_LABELS[ch.allocation_basis as AllocationBasis] ??
                              ch.allocation_basis}
                          </span>
                        </span>
                        <span className="font-medium tnum">
                          {formatMoney(ch.amount, ch.currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })
          )}
        </div>
      </Card>

      <ProductTable rows={costing} currency={currency} />
    </div>
  )
}

function CompareView({
  rows,
  summary,
  currency,
}: {
  rows: QuoteVsActualRow[]
  summary?: ShipmentCostingSummary
  currency: string
}) {
  const quoted = rows.reduce((s, r) => s + Number(r.quoted_amount), 0)
  const actual = rows.reduce((s, r) => s + Number(r.actual_amount), 0)
  const weight = Number(summary?.cargo_gross_weight_kg ?? 0) || null
  const cbm = Number(summary?.shipment_cbm ?? 0) || null

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing to compare yet"
        description="Select a freight quote and capture actual logistics invoice charges for this shipment."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Quoted total" value={formatMoney(quoted, currency)} />
        <StatCard label="Actual total" value={formatMoney(actual, currency)} />
        <StatCard
          label="Diff"
          value={formatMoney(actual - quoted, currency)}
          tone={Math.abs(actual - quoted) > quoted * 0.1 ? 'critical' : undefined}
        />
        <StatCard
          label="Actual ₹/kg"
          value={
            costPerKg(actual, weight) != null
              ? formatMoney(costPerKg(actual, weight), currency)
              : '—'
          }
        />
      </div>
      {cbm != null && cbm > 0 && (
        <p className="text-sm text-ink-muted">
          Actual cost/CBM: {formatMoney(costPerCbm(actual, cbm), currency)} · Quoted
          cost/CBM: {formatMoney(costPerCbm(quoted, cbm), currency)}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken/60 text-xs font-medium tracking-wide text-ink-faint uppercase">
                <th className="px-3 py-2.5">Charge</th>
                <th className="px-3 py-2.5">Quoted</th>
                <th className="px-3 py-2.5">Actual</th>
                <th className="px-3 py-2.5">Diff</th>
                <th className="px-3 py-2.5">Diff %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct = row.diff_pct === null ? null : Number(row.diff_pct)
                const hot = isLargeDeviation(pct)
                return (
                  <tr
                    key={`${row.charge_code}-${row.shipment_id}`}
                    className={cn('border-b last:border-b-0', hot && 'bg-critical-soft/40')}
                  >
                    <td className="px-3 py-2.5 font-medium">{row.charge_name}</td>
                    <td className="px-3 py-2.5 tnum">
                      {formatMoney(row.quoted_amount, row.quote_currency ?? currency)}
                    </td>
                    <td className="px-3 py-2.5 tnum">
                      {formatMoney(row.actual_amount, row.actual_currency ?? currency)}
                    </td>
                    <td className={cn('px-3 py-2.5 tnum', hot && 'font-semibold text-critical')}>
                      {formatMoney(row.diff_amount, currency)}
                    </td>
                    <td className={cn('px-3 py-2.5 tnum', hot && 'font-semibold text-critical')}>
                      {formatDiffPct(pct)}
                      {hot && (
                        <Badge tone="critical" className="ml-2">
                          High
                        </Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function SetupView({
  importId,
  shipmentId,
  currency,
  cargo,
  invoices,
  charges,
  chargeTypes,
}: {
  importId: string
  shipmentId: string
  currency: string
  cargo: ShipmentCargoLine[]
  invoices: LogisticsInvoice[]
  charges: LogisticsInvoiceCharge[]
  chargeTypes: FreightChargeType[]
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CargoEditor importId={importId} shipmentId={shipmentId} currency={currency} cargo={cargo} />
      <InvoiceEditor
        importId={importId}
        shipmentId={shipmentId}
        currency={currency}
        invoices={invoices}
        charges={charges}
        chargeTypes={chargeTypes}
      />
    </div>
  )
}

function CargoEditor({
  importId,
  shipmentId,
  currency,
  cargo,
}: {
  importId: string
  shipmentId: string
  currency: string
  cargo: ShipmentCargoLine[]
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveCargoLine,
    null,
  )
  const [delState, delAction, delPending] = useActionState<ActionResult | null, FormData>(
    deleteCargoLine,
    null,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cargo / products</CardTitle>
        <span className="text-ink-muted">{cargo.length} lines</span>
      </CardHeader>
      <div className="space-y-3 p-4">
        <ul className="divide-y rounded-xl border">
          {cargo.length === 0 && (
            <li className="px-3 py-4 text-sm text-ink-muted">No products on this shipment.</li>
          )}
          {cargo.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-2 px-3 py-2.5 text-sm">
              <div>
                <p className="font-medium">{line.description}</p>
                <p className="text-xs text-ink-faint">
                  Qty {line.quantity ?? '—'} · {line.gross_weight_kg ?? '—'} kg ·{' '}
                  {formatMoney(line.line_value, line.currency ?? currency)}
                </p>
              </div>
              <form action={delAction}>
                <input type="hidden" name="id" value={line.id} />
                <input type="hidden" name="import_id" value={importId} />
                <button
                  type="submit"
                  disabled={delPending}
                  className="rounded-lg p-1.5 text-ink-faint hover:bg-critical-soft hover:text-critical"
                  aria-label="Delete cargo line"
                >
                  <Trash2 size={14} />
                </button>
              </form>
            </li>
          ))}
        </ul>

        <form action={action} className="space-y-3 rounded-xl bg-surface-sunken/50 p-3">
          <input type="hidden" name="import_id" value={importId} />
          <input type="hidden" name="shipment_id" value={shipmentId} />
          <p className="text-sm font-medium">Add product</p>
          <Field label="Description" htmlFor="c_desc" required>
            <Input id="c_desc" name="description" required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="SKU" htmlFor="c_sku">
              <Input id="c_sku" name="sku" />
            </Field>
            <Field label="Qty" htmlFor="c_qty">
              <Input id="c_qty" name="quantity" type="number" step="any" />
            </Field>
            <Field label="Gross kg" htmlFor="c_gw">
              <Input id="c_gw" name="gross_weight_kg" type="number" step="any" />
            </Field>
            <Field label="Net kg" htmlFor="c_nw">
              <Input id="c_nw" name="net_weight_kg" type="number" step="any" />
            </Field>
            <Field label="CBM" htmlFor="c_cbm">
              <Input id="c_cbm" name="cbm" type="number" step="any" />
            </Field>
            <Field label="Packages" htmlFor="c_pkg">
              <Input id="c_pkg" name="packages" type="number" step="any" />
            </Field>
            <Field label="Line value" htmlFor="c_val">
              <Input id="c_val" name="line_value" type="number" step="0.01" />
            </Field>
            <Field label="Currency" htmlFor="c_cur">
              <Input id="c_cur" name="currency" defaultValue={currency} />
            </Field>
          </div>
          <Field label="Packing list ref" htmlFor="c_pl">
            <Input id="c_pl" name="packing_list_ref" placeholder="PL number" />
          </Field>
          {(state?.error || delState?.error) && (
            <p className="text-sm text-critical">{state?.error ?? delState?.error}</p>
          )}
          {state?.warning && <p className="text-sm text-due">{state.warning}</p>}
          <Button type="submit" variant="primary" disabled={pending}>
            <Plus size={14} aria-hidden />
            {pending ? 'Saving…' : 'Add cargo line'}
          </Button>
        </form>
      </div>
    </Card>
  )
}

function InvoiceEditor({
  importId,
  shipmentId,
  currency,
  invoices,
  charges,
  chargeTypes,
}: {
  importId: string
  shipmentId: string
  currency: string
  invoices: LogisticsInvoice[]
  charges: LogisticsInvoiceCharge[]
  chargeTypes: FreightChargeType[]
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveLogisticsInvoice,
    null,
  )
  const [chargeState, chargeAction, chargePending] = useActionState<
    ActionResult | null,
    FormData
  >(saveInvoiceCharge, null)
  const [delState, delAction] = useActionState<ActionResult | null, FormData>(
    deleteLogisticsInvoice,
    null,
  )
  const [delChState, delChAction] = useActionState<ActionResult | null, FormData>(
    deleteInvoiceCharge,
    null,
  )
  const [syncState, syncAction, syncPending] = useActionState<ActionResult | null, FormData>(
    syncInvoiceRollup,
    null,
  )
  const [activeInvoiceId, setActiveInvoiceId] = useState(invoices[0]?.id ?? '')

  const activeCharges = charges.filter((c) => c.invoice_id === activeInvoiceId)
  const activeInvoice = invoices.find((i) => i.id === activeInvoiceId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logistics invoices</CardTitle>
        <span className="text-ink-muted">Charge breakup</span>
      </CardHeader>
      <div className="space-y-3 p-4">
        {invoices.length > 0 && (
          <Select
            value={activeInvoiceId}
            onChange={(e) => setActiveInvoiceId(e.target.value)}
          >
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoice_no ?? 'Invoice'} · {formatMoney(inv.grand_total, inv.currency)}
              </option>
            ))}
          </Select>
        )}

        {activeInvoice && (
          <div className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">
                  {activeInvoice.vendor} · {activeInvoice.invoice_no}
                </p>
                <p className="text-xs text-ink-faint">
                  Source total {formatMoney(activeInvoice.grand_total, activeInvoice.currency)}
                  {activeInvoice.import_cost_id && (
                    <Badge tone="done" className="ml-2">
                      Synced to Costs
                    </Badge>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                {!activeInvoice.import_cost_id && (
                  <form action={syncAction}>
                    <input type="hidden" name="invoice_id" value={activeInvoice.id} />
                    <Button type="submit" disabled={syncPending}>
                      Sync to Costs
                    </Button>
                  </form>
                )}
                <form action={delAction}>
                  <input type="hidden" name="id" value={activeInvoice.id} />
                  <input type="hidden" name="import_id" value={importId} />
                  <Button type="submit" variant="danger">
                    Delete
                  </Button>
                </form>
              </div>
            </div>

            <ul className="mt-2 divide-y">
              {activeCharges.map((ch) => (
                <li key={ch.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span>
                    {ch.charge_name}
                    <span className="ml-2 text-xs text-ink-faint">{ch.allocation_basis}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum">{formatMoney(ch.amount, ch.currency)}</span>
                    <form action={delChAction}>
                      <input type="hidden" name="id" value={ch.id} />
                      <input type="hidden" name="import_id" value={importId} />
                      <button type="submit" className="text-ink-faint hover:text-critical">
                        <Trash2 size={14} />
                      </button>
                    </form>
                  </span>
                </li>
              ))}
            </ul>

            <form action={chargeAction} className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
              <input type="hidden" name="import_id" value={importId} />
              <input type="hidden" name="invoice_id" value={activeInvoice.id} />
              <input type="hidden" name="currency" value={activeInvoice.currency} />
              <Field label="Charge type" htmlFor="ch_type" className="sm:col-span-2">
                <Select id="ch_type" name="charge_type_id" required>
                  {chargeTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount" htmlFor="ch_amt">
                <Input id="ch_amt" name="amount" type="number" step="0.01" required />
              </Field>
              <Field label="Allocation" htmlFor="ch_basis">
                <Select id="ch_basis" name="allocation_basis" defaultValue="gross_weight">
                  {ALLOCATION_BASES.map((b) => (
                    <option key={b} value={b}>
                      {ALLOCATION_BASIS_LABELS[b]}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="is_tax" />
                Tax / GST line
              </label>
              {chargeState?.error && (
                <p className="text-sm text-critical sm:col-span-2">{chargeState.error}</p>
              )}
              {chargeState?.warning && (
                <p className="text-sm text-due sm:col-span-2">{chargeState.warning}</p>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={chargePending}
                className="sm:col-span-2"
              >
                {chargePending ? 'Adding…' : 'Add charge line'}
              </Button>
            </form>
          </div>
        )}

        <form action={action} className="space-y-3 rounded-xl bg-surface-sunken/50 p-3">
          <input type="hidden" name="import_id" value={importId} />
          <input type="hidden" name="shipment_id" value={shipmentId} />
          <p className="text-sm font-medium">New logistics invoice</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Vendor" htmlFor="inv_vendor">
              <Input id="inv_vendor" name="vendor" placeholder="TRAQO" />
            </Field>
            <Field label="Invoice #" htmlFor="inv_no">
              <Input id="inv_no" name="invoice_no" />
            </Field>
            <Field label="Date" htmlFor="inv_date">
              <Input id="inv_date" name="invoice_date" type="date" />
            </Field>
            <Field label="Currency" htmlFor="inv_cur">
              <Input id="inv_cur" name="currency" defaultValue={currency} required />
            </Field>
            <Field label="Grand total" htmlFor="inv_total" required className="col-span-2">
              <Input
                id="inv_total"
                name="grand_total"
                type="number"
                step="0.01"
                required
                placeholder="124517.00"
              />
            </Field>
          </div>
          <Field label="Notes" htmlFor="inv_notes">
            <Textarea id="inv_notes" name="notes" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="sync_to_costs" defaultChecked />
            Sync one rollup line to Costs tab
          </label>
          {(state?.error || delState?.error || delChState?.error || syncState?.error) && (
            <p className="text-sm text-critical">
              {state?.error ?? delState?.error ?? delChState?.error ?? syncState?.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            <Plus size={14} aria-hidden />
            {pending ? 'Saving…' : 'Create invoice'}
          </Button>
        </form>
      </div>
    </Card>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon?: typeof Package
  tone?: 'critical'
}) {
  return (
    <div className="rounded-2xl border bg-surface-raised p-4 shadow-sm">
      <div className="flex items-center gap-2 text-ink-muted">
        {Icon && <Icon size={16} aria-hidden />}
        <p className="text-sm">{label}</p>
      </div>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tracking-tight tnum',
          tone === 'critical' && 'text-critical',
        )}
      >
        {value}
      </p>
    </div>
  )
}
