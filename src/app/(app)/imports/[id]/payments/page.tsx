import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSetting } from '@/lib/settings'
import type { ImportPayment, Refund } from '@/lib/types'
import { PaymentsPanel } from './payments-panel'

export const dynamic = 'force-dynamic'

export default async function PaymentsTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [importResult, paymentsResult, refundsResult, idpmsDays] = await Promise.all([
    supabase
      .from('imports')
      .select('id, currency, pi_value, payment_schedule_status')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('import_payments').select('*').eq('import_id', id).order('seq'),
    supabase.from('refunds').select('*').eq('import_id', id).order('created_at'),
    getSetting('idpms_closure_days'),
  ])

  if (!importResult.data) notFound()

  const imp = importResult.data

  return (
    <PaymentsPanel
      importId={imp.id}
      currency={imp.currency}
      piValue={imp.pi_value}
      scheduleStatus={imp.payment_schedule_status}
      payments={(paymentsResult.data ?? []) as ImportPayment[]}
      refunds={(refundsResult.data ?? []) as Refund[]}
      idpmsDays={Number(idpmsDays)}
    />
  )
}
