import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/settings'
import type { ImportSummary } from '@/lib/import-status'
import type { Company } from '@/lib/types'
import { ImportForm, type SupplierOption } from '../../import-form'

export const dynamic = 'force-dynamic'

export default async function EditImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [importResult, companiesResult, suppliersResult, settings] = await Promise.all([
    supabase.from('v_import_summary').select('*').eq('id', id).maybeSingle(),
    supabase.from('companies').select('*').eq('is_active', true).order('name'),
    supabase
      .from('suppliers')
      .select('id, name, country, default_currency')
      .eq('is_active', true)
      .order('name'),
    getSettings(),
  ])

  if (!importResult.data) notFound()

  return (
    <ImportForm
      companies={(companiesResult.data ?? []) as Company[]}
      suppliers={(suppliersResult.data ?? []) as SupplierOption[]}
      currencies={(settings.currencies as string[]) ?? []}
      incoterms={(settings.incoterms as string[]) ?? []}
      existing={importResult.data as ImportSummary}
    />
  )
}
