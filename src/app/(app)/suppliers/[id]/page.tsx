import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, CardHeader, CardTitle, PageHeader } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { getSettings } from '@/lib/settings'
import { statusTone } from '@/lib/import-status'
import type { Supplier, SupplierBankAccount, SupplierContact } from '@/lib/types'
import { formatMoney } from '@/lib/utils'
import { SupplierForm } from '../supplier-form'
import { BankPanel } from './bank-panel'
import { ContactsPanel } from './contacts-panel'

export const dynamic = 'force-dynamic'

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [supplierResult, contactsResult, banksResult, importsResult, settings] = await Promise.all([
    supabase.from('suppliers').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('supplier_contacts')
      .select('*')
      .eq('supplier_id', id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('name'),
    supabase
      .from('supplier_bank_accounts')
      .select('*')
      .eq('supplier_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('v_import_summary')
      .select('id, import_no, status, currency, pi_value, title, company_code')
      .eq('supplier_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    getSettings(),
  ])

  if (!supplierResult.data) notFound()

  const supplier = supplierResult.data as Supplier
  const imports = importsResult.data ?? []

  return (
    <>
      <PageHeader
        title={supplier.name}
        description={
          [supplier.legal_name, supplier.city, supplier.country].filter(Boolean).join(' · ') ||
          undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              {!supplier.is_active && <Badge>Inactive</Badge>}
            </CardHeader>
            <SupplierForm
              supplier={supplier}
              currencies={(settings.currencies as string[]) ?? []}
              incoterms={(settings.incoterms as string[]) ?? []}
            />
          </Card>

          <ContactsPanel
            supplierId={supplier.id}
            contacts={(contactsResult.data ?? []) as SupplierContact[]}
          />
        </div>

        <div className="space-y-5">
          <BankPanel
            supplierId={supplier.id}
            accounts={(banksResult.data ?? []) as SupplierBankAccount[]}
            currencies={(settings.currencies as string[]) ?? []}
          />

          <Card>
            <CardHeader>
              <CardTitle>Imports</CardTitle>
              <span className="text-ink-muted">{imports.length}</span>
            </CardHeader>

            {imports.length === 0 ? (
              <p className="px-4 py-3 text-ink-muted">
                No imports from this supplier yet.
              </p>
            ) : (
              <ul className="divide-y">
                {imports.map((imp) => (
                  <li key={imp.id}>
                    <Link
                      href={`/imports/${imp.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-sunken"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium">{imp.import_no}</span>
                        <span className="text-ink-muted">
                          {imp.company_code}
                          {imp.title ? ` · ${imp.title}` : ''}
                        </span>
                        <Badge tone={statusTone(imp.status)}>{imp.status}</Badge>
                      </div>
                      <span className="tnum whitespace-nowrap">
                        {formatMoney(imp.pi_value, imp.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
