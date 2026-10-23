import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ImportCost, LandedCost, LandedCostByCurrency, Shipment } from '@/lib/types'
import { CostsPanel } from './costs-panel'

export const dynamic = 'force-dynamic'

export default async function CostsTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [importResult, costsResult, shipmentsResult, rollupResult, currencyResult] =
    await Promise.all([
      supabase
        .from('imports')
        .select('id, currency, status, closed_at, closure_notes')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('v_import_cost_lines')
        .select('*')
        .eq('import_id', id)
        .order('cost_type')
        .order('created_at'),
      supabase.from('shipments').select('*').eq('import_id', id).order('seq'),
      supabase.from('v_landed_cost').select('*').eq('import_id', id).maybeSingle(),
      supabase.from('v_landed_cost_by_currency').select('*').eq('import_id', id).order('currency'),
    ])

  if (!importResult.data) notFound()

  const imp = importResult.data

  return (
    <CostsPanel
      importId={imp.id}
      currency={imp.currency}
      status={imp.status}
      closedAt={imp.closed_at}
      closureNotes={imp.closure_notes}
      costs={(costsResult.data ?? []) as ImportCost[]}
      shipments={(shipmentsResult.data ?? []) as Shipment[]}
      rollup={(rollupResult.data ?? null) as LandedCost | null}
      byCurrency={(currencyResult.data ?? []) as LandedCostByCurrency[]}
    />
  )
}
