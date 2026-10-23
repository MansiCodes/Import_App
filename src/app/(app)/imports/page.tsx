import Link from 'next/link'
import { Button, Card, EmptyState, PageHeader } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { formatMoney } from '@/lib/utils'
import { pipelineStage, type ImportSummary } from '@/lib/import-status'
import type { Company } from '@/lib/types'
import { ImportsView, type ImportRow } from './imports-view'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  company?: string
  attention?: string
  archived?: string
  stage?: string
}

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const archived = params.archived === '1'

  const [companiesResult, importsResult] = await Promise.all([
    supabase.from('companies').select('id, name, short_code').eq('is_active', true).order('name'),
    supabase
      .from('v_import_summary')
      .select(
        [
          'id',
          'import_no',
          'company_id',
          'company_code',
          'status',
          'title',
          'po_number',
          'pi_number',
          'currency',
          'pi_value',
          'next_action_title',
          'next_action_due',
          'waiting_on',
          'is_archived',
          'created_at',
          'supplier_name',
          'cha_name',
          'critical_count',
          'due_today_count',
          'earliest_due',
        ].join(', '),
      )
      .eq('is_archived', archived)
      .order('earliest_due', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false }),
  ])

  const queryError = companiesResult.error ?? importsResult.error

  if (queryError) {
    console.error('[imports] database query failed:', queryError)
    return (
      <>
        <PageHeader title="Imports" />
        <Card className="border-critical bg-critical-soft p-4">
          <p className="font-medium text-critical">Could not read from the database.</p>
          <p className="mt-1 text-critical">{queryError.message}</p>
        </Card>
      </>
    )
  }

  if ((companiesResult.data?.length ?? 0) === 0) {
    return (
      <>
        <PageHeader title="Imports" />
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
  const companies = (companiesResult.data ?? []) as Pick<Company, 'id' | 'name' | 'short_code'>[]

  return (
    <ImportsView
      archived={archived}
      initialQuery={params.q}
      initialAttention={params.attention}
      initialCompany={params.company}
      initialStage={params.stage}
      companies={companies.map((company) => ({
        id: company.id,
        name: company.name,
        shortCode: company.short_code,
      }))}
      rows={imports.map((imp) => toRow(imp))}
    />
  )
}

function toRow(imp: ImportSummary): ImportRow {
  return {
    id: imp.id,
    importNo: imp.import_no,
    companyId: imp.company_id,
    companyCode: imp.company_code,
    supplier: imp.supplier_name ?? 'No supplier',
    agent:
      imp.cha_name ??
      (imp.waiting_on && imp.waiting_on !== 'Internal' ? imp.waiting_on : null),
    poNumber: imp.po_number,
    piNumber: imp.pi_number,
    title: imp.title,
    status: imp.status,
    value: formatMoney(imp.pi_value, imp.currency),
    nextAction: imp.next_action_title,
    dueDate: imp.earliest_due ?? imp.next_action_due,
    waitingOn: imp.waiting_on && imp.waiting_on !== 'Internal' ? imp.waiting_on : null,
    criticalCount: imp.critical_count,
    dueTodayCount: imp.due_today_count,
    stage: pipelineStage(imp.status),
  }
}
