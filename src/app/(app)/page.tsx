import Link from 'next/link'
import { Button, Card, EmptyState, PageHeader } from '@/components/ui'
import { createClient, requireProfile } from '@/lib/supabase/server'
import {
  isActive,
  pipelineStage,
  type ImportSummary,
  type PipelineStage,
  type Severity,
} from '@/lib/import-status'
import { DashboardView, type DashboardRow } from './dashboard-view'

export const dynamic = 'force-dynamic'

function importSeverity(imp: ImportSummary): Severity | 'in_progress' {
  if (imp.critical_count > 0) return 'critical'
  if (imp.due_today_count > 0) return 'due_today'
  if (imp.earliest_due) return 'upcoming'
  return 'in_progress'
}

export default async function DashboardPage() {
  const [profile, supabase] = await Promise.all([requireProfile(), createClient()])

  const [companiesResult, importsResult] = await Promise.all([
    supabase.from('companies').select('id').eq('is_active', true),
    supabase
      .from('v_import_summary')
      .select(
        [
          'id',
          'import_no',
          'status',
          'title',
          'currency',
          'pi_value',
          'next_action_title',
          'next_action_due',
          'waiting_on',
          'is_archived',
          'supplier_name',
          'cha_name',
          'critical_count',
          'due_today_count',
          'earliest_due',
        ].join(', '),
      )
      .eq('is_archived', false),
  ])

  // A failed query must never render as "you have no data" — that is how a
  // broken connection gets mistaken for an empty database.
  const queryError = companiesResult.error ?? importsResult.error

  if (queryError) {
    console.error('[dashboard] database query failed:', queryError)
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card className="border-critical bg-critical-soft p-4">
          <p className="font-medium text-critical">Could not read from the database.</p>
          <p className="mt-1 text-critical">{queryError.message}</p>
          <p className="mt-2 text-ink-muted">
            This is a connection or permissions problem, not an empty database. Check
            SUPABASE_SERVICE_ROLE_KEY in .env.local, then restart the dev server.
          </p>
        </Card>
      </>
    )
  }

  if ((companiesResult.data?.length ?? 0) === 0) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <EmptyState
          title="No importing entities yet"
          description="Add your companies in Settings first — every import belongs to one."
          action={
            <Link href="/settings">
              <Button variant="primary">Go to Settings</Button>
            </Link>
          }
        />
      </>
    )
  }

  const imports = (importsResult.data ?? []) as unknown as ImportSummary[]
  const active = imports.filter((i) => isActive(i.status))

  const stageCounts = active.reduce<Record<PipelineStage, number>>(
    (acc, imp) => {
      const id = pipelineStage(imp.status)
      acc[id] += 1
      return acc
    },
    { order: 0, make: 0, ship: 0, arrive: 0 },
  )

  const stages = (['order', 'make', 'ship', 'arrive'] as const).map((id) => ({
    id,
    count: stageCounts[id],
  }))

  const values = Object.entries(
    active.reduce<Record<string, number>>((acc, imp) => {
      const value = Number(imp.pi_value ?? 0)
      if (value > 0) acc[imp.currency] = (acc[imp.currency] ?? 0) + value
      return acc
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .map(([currency, total]) => ({ currency, total }))

  const severityRank: Record<Severity | 'in_progress', number> = {
    critical: 0,
    due_today: 1,
    upcoming: 2,
    in_progress: 3,
  }

  const rows: DashboardRow[] = active
    .map((imp) => ({
      key: imp.id,
      href: `/imports/${imp.id}`,
      importNo: imp.import_no,
      title: imp.title?.trim() || imp.supplier_name || imp.import_no,
      subtitle: imp.next_action_title,
      supplier: imp.supplier_name,
      agent: imp.cha_name ?? (imp.waiting_on && imp.waiting_on !== 'Internal' ? imp.waiting_on : null),
      severity: importSeverity(imp),
      dueDate: imp.earliest_due ?? imp.next_action_due,
    }))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  const userName =
    profile.full_name?.trim() || profile.email.split('@')[0] || 'there'

  return (
    <DashboardView
      userName={userName}
      activeCount={active.length}
      stages={stages}
      values={values}
      rows={rows}
    />
  )
}
