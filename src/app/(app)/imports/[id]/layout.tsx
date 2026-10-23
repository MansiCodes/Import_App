import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import {
  daysOverdue,
  statusTone,
  type Alert,
  type ImportSummary,
} from '@/lib/import-status'
import { formatMoney } from '@/lib/utils'
import { ImportMoreMenu, UpdateStatusButton } from './update-status-button'
import { NextActionBanner } from './next-action-banner'
import { PipelineStepper } from './pipeline-stepper'
import { ImportTabs } from './tabs'

export const dynamic = 'force-dynamic'

export default async function ImportLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data }, { data: alertRows }, { data: shipment }] = await Promise.all([
    supabase
      .from('v_import_summary')
      .select(
        [
          'id',
          'import_no',
          'status',
          'title',
          'po_date',
          'currency',
          'pi_value',
          'expected_goods_ready',
          'revised_goods_ready',
          'actual_goods_ready',
          'next_action_title',
          'next_action_due',
          'next_action_priority',
          'waiting_on',
          'drive_folder_url',
          'closed_at',
          'is_archived',
          'created_at',
          'company_name',
          'supplier_name',
          'cha_name',
        ].join(', '),
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('v_alerts')
      .select('import_id, severity, title')
      .eq('import_id', id)
      .eq('severity', 'critical'),
    supabase
      .from('shipments')
      .select('etd, eta, revised_eta, actual_arrival')
      .eq('import_id', id)
      .order('seq', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (!data) notFound()

  const imp = data as unknown as ImportSummary
  const alerts = (alertRows ?? []) as Alert[]
  const critical = alerts.filter((a) => a.severity === 'critical')
  const overdueDays = daysOverdue(imp.next_action_due)
  const overdue = (overdueDays ?? 0) > 0 || critical.length > 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <Link
          href="/imports"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to imports
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] leading-tight font-bold tracking-tight text-ink">
                {imp.import_no}
              </h1>
              <Badge
                tone={statusTone(imp.status)}
                className="rounded-md px-2.5 py-1 text-[13px] font-medium"
              >
                {imp.status}
              </Badge>
              {imp.is_archived && <Badge>Archived</Badge>}
            </div>
            <p className="mt-1.5 text-[14px] text-ink-muted">
              {imp.supplier_name ?? 'No supplier'}
              <span className="text-ink-faint"> · {imp.company_name}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ImportMoreMenu importId={imp.id} driveUrl={imp.drive_folder_url} />
            <UpdateStatusButton importId={imp.id} status={imp.status} />
            {imp.pi_value != null && (
              <p className="text-[22px] font-bold tracking-tight tnum text-ink">
                {formatMoney(imp.pi_value, imp.currency)}
              </p>
            )}
          </div>
        </div>
      </div>

      <PipelineStepper
        status={imp.status}
        dates={{
          order: imp.po_date ?? imp.created_at,
          make: imp.actual_goods_ready ?? imp.revised_goods_ready ?? imp.expected_goods_ready,
          ship: shipment?.etd ?? null,
          arrive: shipment?.actual_arrival ?? shipment?.revised_eta ?? shipment?.eta ?? null,
          close: imp.closed_at,
        }}
      />

      <NextActionBanner
        importId={imp.id}
        title={imp.next_action_title}
        dueDate={imp.next_action_due}
        waitingOn={imp.waiting_on}
        priority={imp.next_action_priority}
        overdue={overdue}
        detail={
          critical.find((a) => a.title !== imp.next_action_title)?.title ?? null
        }
      />

      <ImportTabs importId={id} />

      <div>{children}</div>
    </div>
  )
}
