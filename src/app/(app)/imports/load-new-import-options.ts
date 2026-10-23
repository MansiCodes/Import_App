'use server'

import { getSettings } from '@/lib/settings'
import { createClient } from '@/lib/supabase/server'
import type { Company } from '@/lib/types'
import type { SupplierOption } from './import-form'

export type NewImportOptions = {
  companies: Pick<Company, 'id' | 'name' | 'short_code'>[]
  suppliers: SupplierOption[]
  currencies: string[]
  incoterms: string[]
}

export async function loadNewImportOptions(): Promise<NewImportOptions> {
  const supabase = await createClient()

  const [companiesResult, suppliersResult, settings] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, short_code')
      .eq('is_active', true)
      .order('name'),
    supabase
      .from('suppliers')
      .select('id, name, country, default_currency')
      .eq('is_active', true)
      .order('name'),
    getSettings(),
  ])

  return {
    companies: (companiesResult.data ?? []) as Pick<Company, 'id' | 'name' | 'short_code'>[],
    suppliers: (suppliersResult.data ?? []) as SupplierOption[],
    currencies: (settings.currencies as string[]) ?? [],
    incoterms: (settings.incoterms as string[]) ?? [],
  }
}
