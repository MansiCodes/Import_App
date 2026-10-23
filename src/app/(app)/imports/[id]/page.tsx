import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  CalendarDays,
  ClipboardList,
  DollarSign,
  FileText,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { daysOverdue, type ImportSummary } from '@/lib/import-status'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { StatusChanger } from './status-changer'

export const dynamic = 'force-dynamic'

const FLAG: Record<string, string> = {
  China: '🇨🇳',
  CN: '🇨🇳',
  India: '🇮🇳',
  IN: '🇮🇳',
  'Hong Kong': '🇭🇰',
  HK: '🇭🇰',
  Taiwan: '🇹🇼',
  TW: '🇹🇼',
  Vietnam: '🇻🇳',
  VN: '🇻🇳',
  Germany: '🇩🇪',
  DE: '🇩🇪',
  'United States': '🇺🇸',
  US: '🇺🇸',
  USA: '🇺🇸',
  Japan: '🇯🇵',
  JP: '🇯🇵',
  'South Korea': '🇰🇷',
  KR: '🇰🇷',
  Italy: '🇮🇹',
  IT: '🇮🇹',
  UAE: '🇦🇪',
  'United Arab Emirates': '🇦🇪',
}

function flagFor(country: string | null | undefined) {
  if (!country) return null
  return FLAG[country] ?? FLAG[country.toUpperCase()] ?? null
}

export default async function ImportOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data }, { data: totals }, { data: shipment }] = await Promise.all([
    supabase.from('v_import_summary').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('v_payment_totals')
      .select('paid_actual_total, outstanding_total, planned_total')
      .eq('import_id', id)
      .maybeSingle(),
    supabase
      .from('shipments')
      .select('etd, eta, revised_eta, actual_arrival')
      .eq('import_id', id)
      .order('seq', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (!data) notFound()

  const imp = data as ImportSummary
  const origin = imp.origin_country ?? imp.supplier_country
  const flag = flagFor(origin)

  const invoiceValue = Number(imp.pi_value ?? 0)
  const paid = Number(totals?.paid_actual_total ?? 0)
  const pending =
    totals?.outstanding_total != null
      ? Number(totals.outstanding_total)
      : Math.max(invoiceValue - paid, 0)

  const dueDate = imp.next_action_due
  const overdue = daysOverdue(dueDate)
  const expectedArrival =
    shipment?.actual_arrival ?? shipment?.revised_eta ?? shipment?.eta ?? null

  const basicFields: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: 'Import ID', value: imp.import_no, mono: true },
    { label: 'Supplier', value: imp.supplier_name ?? '—' },
    { label: 'Company', value: imp.company_name },
    {
      label: 'Origin',
      value: origin ? (
        <span className="inline-flex items-center gap-1.5">
          {flag && <span className="text-base leading-none">{flag}</span>}
          {origin}
        </span>
      ) : (
        '—'
      ),
    },
    { label: 'Agent / CHA', value: imp.cha_name ?? '—' },
    { label: 'Type', value: 'General Cargo' },
    { label: 'Created On', value: formatDate(imp.created_at) },
    { label: 'Last Updated', value: formatDate(imp.updated_at) },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left column */}
      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-2xl border bg-surface-raised p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FileText size={15} aria-hidden />
            </span>
            <h2 className="text-[15px] font-semibold text-ink">Basic Information</h2>
          </div>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {basicFields.map((field) => (
              <div key={field.label}>
                <p className="text-[12px] font-medium text-ink-faint">{field.label}</p>
                <p
                  className={cn(
                    'mt-1 text-[14px] font-medium text-ink',
                    field.mono && 'font-mono',
                  )}
                >
                  {field.value}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border bg-surface-raised p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#EEF2FF] text-[#4F46E5]">
              <ClipboardList size={15} aria-hidden />
            </span>
            <h2 className="text-[15px] font-semibold text-ink">Description</h2>
          </div>
          <p className="text-[14px] leading-relaxed text-ink-muted">
            {imp.title || imp.next_action_title || 'No description yet.'}
          </p>
        </section>

        <section className="rounded-2xl border bg-surface-raised p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-surface-sunken text-ink-muted">
              <ClipboardList size={15} aria-hidden />
            </span>
            <h2 className="text-[15px] font-semibold text-ink">Notes</h2>
          </div>
          {imp.notes ? (
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-muted">
              {imp.notes}
            </p>
          ) : (
            <p className="text-[14px] text-ink-faint">
              No notes yet.{' '}
              <Link href={`/imports/${id}/edit`} className="text-accent hover:underline">
                Add notes
              </Link>
            </p>
          )}
        </section>
      </div>

      {/* Right column — matches screenshot order */}
      <div className="space-y-4">
        <StatusChanger
          importId={imp.id}
          status={imp.status}
          priority={imp.next_action_priority}
        />

        <section className="rounded-2xl border bg-surface-raised p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-done-soft text-done">
              <DollarSign size={15} aria-hidden />
            </span>
            <h2 className="text-[15px] font-semibold text-ink">Financial Summary</h2>
          </div>
          <dl className="space-y-3.5">
            <div className="flex items-center justify-between gap-3 text-[14px]">
              <dt className="text-ink-muted">Invoice Value</dt>
              <dd className="font-semibold tnum">
                {formatMoney(imp.pi_value, imp.currency)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 text-[14px]">
              <dt className="text-ink-muted">Paid</dt>
              <dd className="font-semibold tnum">{formatMoney(paid, imp.currency)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-t pt-3.5 text-[14px]">
              <dt className="font-medium text-critical">Pending</dt>
              <dd className="font-bold tnum text-critical">
                {formatMoney(pending, imp.currency)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border bg-surface-raised p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <CalendarDays size={15} aria-hidden />
              </span>
              <h2 className="text-[15px] font-semibold text-ink">Key Dates</h2>
            </div>
            <Link
              href={`/imports/${id}/edit`}
              className="text-[13px] font-medium text-accent hover:underline"
            >
              Edit
            </Link>
          </div>
          <dl className="space-y-3.5 text-[14px]">
            <DateRow label="Order Date" value={formatDate(imp.po_date ?? imp.created_at)} />
            <DateRow label="Shipment Date" value={formatDate(shipment?.etd)} />
            <DateRow label="Expected Arrival" value={formatDate(expectedArrival)} />
            <DateRow label="Due Date" value={formatDate(dueDate)} />
            <div className="flex items-center justify-between gap-3 border-t pt-3.5">
              <dt className="text-ink-muted">Days Overdue</dt>
              <dd>
                {(overdue ?? 0) > 0 ? (
                  <span className="font-semibold text-critical">{overdue} days</span>
                ) : (
                  <span className="font-medium text-ink-muted">—</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  )
}

function DateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  )
}
