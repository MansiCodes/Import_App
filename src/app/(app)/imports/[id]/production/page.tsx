import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ProductionUpdate } from '@/lib/types'
import { ProductionPanel } from './production-panel'

export const dynamic = 'force-dynamic'

export default async function ProductionTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [importResult, updatesResult, itemsResult] = await Promise.all([
    supabase
      .from('imports')
      .select('id, currency, expected_goods_ready, revised_goods_ready, actual_goods_ready')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('production_updates')
      .select('*')
      .eq('import_id', id)
      .order('reported_on', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('import_items')
      .select('*')
      .eq('import_id', id)
      .order('line_no', { nullsFirst: false }),
  ])

  if (!importResult.data) notFound()

  const imp = importResult.data

  return (
    <ProductionPanel
      importId={imp.id}
      currency={imp.currency}
      expected={imp.expected_goods_ready}
      revised={imp.revised_goods_ready}
      actual={imp.actual_goods_ready}
      updates={(updatesResult.data ?? []) as ProductionUpdate[]}
      items={itemsResult.data ?? []}
    />
  )
}
