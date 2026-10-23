import { createClient } from '@/lib/supabase/server'
import type { Cha, ChaAgent, Shipment } from '@/lib/types'
import { ShipmentsPanel } from './shipments-panel'

export const dynamic = 'force-dynamic'

export default async function ShipmentsTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [shipmentsResult, chasResult, agentsResult] = await Promise.all([
    supabase.from('shipments').select('*').eq('import_id', id).order('seq'),
    supabase.from('chas').select('*').eq('is_active', true).order('name'),
    supabase.from('cha_agents').select('*').eq('is_active', true).order('name'),
  ])

  return (
    <ShipmentsPanel
      importId={id}
      shipments={(shipmentsResult.data ?? []) as Shipment[]}
      chas={(chasResult.data ?? []) as Cha[]}
      agents={(agentsResult.data ?? []) as ChaAgent[]}
    />
  )
}
