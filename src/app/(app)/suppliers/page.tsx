import { createClient } from '@/lib/supabase/server'
import { getSettingsKeys } from '@/lib/settings'
import type { Supplier } from '@/lib/types'
import { SuppliersList, type SupplierRow } from './suppliers-list'

export const dynamic = 'force-dynamic'

export default async function SuppliersPage() {
  const supabase = await createClient()

  const [suppliersResult, importsResult, banksResult, settings] = await Promise.all([
    supabase
      .from('suppliers')
      .select(
        'id, name, legal_name, country, city, default_currency, default_incoterm, payment_terms_text, lead_time_days, website, notes, is_active',
      )
      .order('name'),
    supabase
      .from('imports')
      .select('supplier_id')
      .eq('is_archived', false)
      .not('supplier_id', 'is', null),
    supabase
      .from('supplier_bank_accounts')
      .select('supplier_id')
      .eq('is_current', true)
      .eq('verification_status', 'received'),
    getSettingsKeys(['currencies', 'incoterms'] as const),
  ])

  const importCounts = (importsResult.data ?? []).reduce<Record<string, number>>((acc, row) => {
    if (row.supplier_id) acc[row.supplier_id] = (acc[row.supplier_id] ?? 0) + 1
    return acc
  }, {})

  const unverified = new Set((banksResult.data ?? []).map((b) => b.supplier_id))

  const suppliers: SupplierRow[] = ((suppliersResult.data ?? []) as Supplier[]).map((s) => ({
    ...s,
    import_count: importCounts[s.id] ?? 0,
    unverified_bank: unverified.has(s.id),
  }))

  return (
    <SuppliersList
      suppliers={suppliers}
      currencies={(settings.currencies as string[]) ?? []}
      incoterms={(settings.incoterms as string[]) ?? []}
    />
  )
}
