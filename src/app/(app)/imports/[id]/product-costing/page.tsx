import Link from 'next/link'
import { Card, EmptyState, PageHeader, Button } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import type {
  CargoLineCosting,
  FreightChargeType,
  LogisticsInvoice,
  LogisticsInvoiceCharge,
  QuoteVsActualRow,
  Shipment,
  ShipmentCargoLine,
  ShipmentCostingSummary,
} from '@/lib/types'
import { ProductCostingPanel } from './product-costing-panel'

export const dynamic = 'force-dynamic'

export default async function ProductCostingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ shipment?: string; view?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const supabase = await createClient()

  const [
    importResult,
    shipmentsResult,
    cargoResult,
    invoicesResult,
    costingResult,
    summaryResult,
    compareResult,
    typesResult,
  ] = await Promise.all([
    supabase.from('imports').select('id, import_no, currency').eq('id', id).maybeSingle(),
    supabase.from('shipments').select('*').eq('import_id', id).order('seq'),
    supabase.from('shipment_cargo_lines').select('*').eq('import_id', id).order('sort_order'),
    supabase
      .from('logistics_invoices')
      .select('*')
      .eq('import_id', id)
      .order('invoice_date', { ascending: false, nullsFirst: false }),
    supabase.from('v_cargo_line_costing').select('*').eq('import_id', id).order('sort_order'),
    supabase.from('v_shipment_costing_summary').select('*').eq('import_id', id),
    supabase.from('v_quote_vs_actual').select('*').eq('import_id', id),
    supabase
      .from('freight_charge_types')
      .select('*')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  const invoiceIds = (invoicesResult.data ?? []).map((r) => r.id)
  const chargesResult =
    invoiceIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from('logistics_invoice_charges')
          .select('*, freight_charge_types(code, name, costing_bucket)')
          .in('invoice_id', invoiceIds)
          .order('sort_order')

  const error =
    importResult.error ??
    shipmentsResult.error ??
    cargoResult.error ??
    invoicesResult.error ??
    chargesResult.error ??
    costingResult.error ??
    summaryResult.error ??
    compareResult.error ??
    typesResult.error

  if (error) {
    console.error('[product-costing]', error)
    return (
      <>
        <PageHeader title="Product Costing" />
        <Card className="border-critical bg-critical-soft p-4 text-critical">
          Could not load product costing — {error.message}
        </Card>
      </>
    )
  }

  if (!importResult.data) {
    return (
      <EmptyState
        title="Import not found"
        action={
          <Link href="/imports">
            <Button>Back to imports</Button>
          </Link>
        }
      />
    )
  }

  const charges: LogisticsInvoiceCharge[] = (chargesResult.data ?? []).map((row) => {
    const raw = row as Record<string, unknown> & {
      freight_charge_types?: {
        code: string
        name: string
        costing_bucket: string | null
      } | null
    }
    const ct = raw.freight_charge_types
    const { freight_charge_types: _omit, ...rest } = raw
    return {
      ...(rest as unknown as LogisticsInvoiceCharge),
      charge_code: ct?.code,
      charge_name: ct?.name,
      costing_bucket: ct?.costing_bucket,
    }
  })

  return (
    <ProductCostingPanel
      importId={id}
      importNo={importResult.data.import_no}
      defaultCurrency={importResult.data.currency}
      initialShipmentId={query.shipment ?? null}
      initialView={(query.view as 'table' | 'shipment' | 'compare' | null) ?? null}
      shipments={(shipmentsResult.data ?? []) as Shipment[]}
      cargo={(cargoResult.data ?? []) as ShipmentCargoLine[]}
      invoices={(invoicesResult.data ?? []) as LogisticsInvoice[]}
      charges={charges}
      costing={(costingResult.data ?? []) as CargoLineCosting[]}
      summaries={(summaryResult.data ?? []) as ShipmentCostingSummary[]}
      compare={(compareResult.data ?? []) as QuoteVsActualRow[]}
      chargeTypes={(typesResult.data ?? []) as FreightChargeType[]}
    />
  )
}
