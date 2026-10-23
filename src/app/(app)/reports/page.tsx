import { createClient } from '@/lib/supabase/server'
import {
  ReportsView,
  type ComplianceRow,
  type CustomsRow,
  type PaymentRow,
  type ShippingRow,
  type StatusRow,
  type SupplierRow,
} from './reports-view'

export const dynamic = 'force-dynamic'

export default async function ReportsPage() {
  const supabase = await createClient()

  const [status, payments, suppliers, shipping, customs, compliance] = await Promise.all([
    supabase.from('v_report_status_summary').select('*').order('company_name').order('status'),
    supabase.from('v_report_payment_summary').select('*').order('company_name').order('currency'),
    supabase
      .from('v_report_supplier_performance')
      .select('*')
      .gt('import_count', 0)
      .order('import_count', { ascending: false }),
    supabase.from('v_report_shipping_performance').select('*').order('mode'),
    supabase
      .from('v_report_customs_summary')
      .select('*')
      .order('month', { ascending: false, nullsFirst: false })
      .limit(24),
    supabase.from('v_report_document_compliance').select('*').order('company_name'),
  ])

  return (
    <ReportsView
      statusRows={(status.data ?? []) as StatusRow[]}
      paymentRows={(payments.data ?? []) as PaymentRow[]}
      supplierRows={(suppliers.data ?? []) as SupplierRow[]}
      shippingRows={(shipping.data ?? []) as ShippingRow[]}
      customsRows={(customs.data ?? []) as CustomsRow[]}
      complianceRows={(compliance.data ?? []) as ComplianceRow[]}
    />
  )
}
