import { createClient } from '@/lib/supabase/server'
import type { CustomsRecord, Shipment } from '@/lib/types'
import { CustomsPanel } from './customs-panel'

export const dynamic = 'force-dynamic'

export default async function CustomsTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [shipmentsResult, customsResult] = await Promise.all([
    supabase.from('shipments').select('*').eq('import_id', id).neq('status', 'Cancelled').order('seq'),
    supabase.from('customs_records').select('*').eq('import_id', id),
  ])

  return (
    <CustomsPanel
      importId={id}
      shipments={(shipmentsResult.data ?? []) as Shipment[]}
      records={(customsResult.data ?? []) as CustomsRecord[]}
    />
  )
}
