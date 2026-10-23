import { createClient } from '@/lib/supabase/server'
import type { ShipmentBoardRow } from '@/lib/types'
import { ShipmentsBoardView } from './shipments-board-view'

export const dynamic = 'force-dynamic'

export default async function ShipmentsPage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('v_shipment_board')
    .select('*')
    .eq('is_archived', false)
    .not('import_status', 'in', '("Closed","Cancelled")')
    .neq('status', 'Cancelled')
    .order('effective_eta', { nullsFirst: false })

  return <ShipmentsBoardView rows={(data ?? []) as ShipmentBoardRow[]} />
}
