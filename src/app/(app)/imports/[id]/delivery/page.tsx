import { createClient } from '@/lib/supabase/server'
import type { DeliveryRecord, Shipment } from '@/lib/types'
import { DeliveryPanel } from './delivery-panel'

export const dynamic = 'force-dynamic'

export default async function DeliveryTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [shipmentsResult, deliveryResult] = await Promise.all([
    supabase.from('shipments').select('*').eq('import_id', id).neq('status', 'Cancelled').order('seq'),
    supabase.from('delivery_records').select('*').eq('import_id', id),
  ])

  return (
    <DeliveryPanel
      importId={id}
      shipments={(shipmentsResult.data ?? []) as Shipment[]}
      records={(deliveryResult.data ?? []) as DeliveryRecord[]}
    />
  )
}
