import { createClient } from '@/lib/supabase/server'
import { PaymentsRegisterView, type PaymentRegisterRow } from './payments-register-view'

export const dynamic = 'force-dynamic'

export default async function PaymentsRegisterPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('import_payments')
    .select(
      'id, import_id, seq, description, currency, planned_amount, due_date, paid_at, status, is_advance, boe_submitted_to_bank_at, imports!inner(import_no, status, is_archived, suppliers(name), companies(short_code))',
    )
    .eq('imports.is_archived', false)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(500)

  const payments: PaymentRegisterRow[] = ((data ?? []) as unknown as Array<{
    id: string
    import_id: string
    seq: number
    description: string
    currency: string
    planned_amount: string
    due_date: string | null
    paid_at: string | null
    status: string
    is_advance: boolean
    boe_submitted_to_bank_at: string | null
    imports: {
      import_no: string
      suppliers: { name: string } | null
      companies: { short_code: string } | null
    } | null
  }>).map((row) => ({
    id: row.id,
    import_id: row.import_id,
    seq: row.seq,
    description: row.description,
    currency: row.currency,
    planned_amount: row.planned_amount,
    due_date: row.due_date,
    paid_at: row.paid_at,
    status: row.status,
    is_advance: row.is_advance,
    boe_submitted_to_bank_at: row.boe_submitted_to_bank_at,
    import_no: row.imports?.import_no ?? null,
    supplier_name: row.imports?.suppliers?.name ?? null,
    company_code: row.imports?.companies?.short_code ?? null,
  }))

  return <PaymentsRegisterView payments={payments} error={error?.message} />
}
