import Link from 'next/link'
import { Button, EmptyState, PageHeader } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/settings'
import type { Company } from '@/lib/types'
import { ImportForm, type SupplierOption } from '../import-form'

export const dynamic = 'force-dynamic'

export default async function NewImportPage() {
  const supabase = await createClient()

  const [companiesResult, suppliersResult, settings] = await Promise.all([
    supabase.from('companies').select('*').eq('is_active', true).order('name'),
    supabase
      .from('suppliers')
      .select('id, name, country, default_currency')
      .eq('is_active', true)
      .order('name'),
    getSettings(),
  ])

  const companies = (companiesResult.data ?? []) as Company[]

  if (companies.length === 0) {
    return (
      <>
        <PageHeader title="New import" />
        <EmptyState
          title="Add a company first"
          description="Every import belongs to an importing entity."
          action={
            <Link href="/settings">
              <Button variant="primary">Go to Settings</Button>
            </Link>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="New import"
        description="The import number is allocated automatically and never changes."
        actions={
          <Link href="/imports">
            <Button>Cancel</Button>
          </Link>
        }
      />

      <ImportForm
        companies={companies}
        suppliers={(suppliersResult.data ?? []) as SupplierOption[]}
        currencies={(settings.currencies as string[]) ?? []}
        incoterms={(settings.incoterms as string[]) ?? []}
      />
    </>
  )
}
