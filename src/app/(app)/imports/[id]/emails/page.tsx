import { notFound } from 'next/navigation'
import { createClient, getOperator } from '@/lib/supabase/server'
import type { Placeholders } from '@/lib/email-template'
import type { EmailDraft, EmailTemplate } from '@/lib/types'
import { formatDate, formatMoney } from '@/lib/utils'
import { EmailsPanel } from './emails-panel'

export const dynamic = 'force-dynamic'

export default async function EmailsTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [summaryResult, templatesResult, draftsResult, operator] = await Promise.all([
    supabase.from('v_import_summary').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('email_templates')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
    supabase
      .from('email_drafts')
      .select('*')
      .eq('import_id', id)
      .order('prepared_at', { ascending: false }),
    // Signs the email. With no sign-in this is the operator, not "whoever is
    // looking" — the same identity everything else is attributed to.
    getOperator(),
  ])

  if (!summaryResult.data) notFound()

  const imp = summaryResult.data

  const contactResult = imp.supplier_id
    ? await supabase
        .from('supplier_contacts')
        .select('name, email')
        .eq('supplier_id', imp.supplier_id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null }

  /**
   * Every value a seeded template can ask for. Supplying a key with an empty
   * string is deliberate: the renderer distinguishes "we have nothing for this"
   * (blank, and reported) from "this template is asking for something that does
   * not exist" (left visible as a broken tag).
   */
  const values: Placeholders = {
    import_no: imp.import_no,
    po_number: imp.po_number ?? '',
    pi_number: imp.pi_number ?? '',
    currency: imp.currency,
    pi_value: imp.pi_value ? formatMoney(imp.pi_value, null) : '',
    company_name: imp.company_name,
    supplier_name: imp.supplier_name ?? '',
    supplier_contact: contactResult.data?.name ?? 'Sir or Madam',
    cha_name: imp.cha_name ?? '',
    expected_goods_ready: imp.revised_goods_ready
      ? formatDate(imp.revised_goods_ready)
      : imp.expected_goods_ready
        ? formatDate(imp.expected_goods_ready)
        : '',
    next_eta: imp.next_eta ? formatDate(imp.next_eta) : '',
    sender_name: operator?.full_name ?? operator?.email ?? '',
  }

  return (
    <EmailsPanel
      importId={id}
      templates={(templatesResult.data ?? []) as EmailTemplate[]}
      drafts={(draftsResult.data ?? []) as EmailDraft[]}
      values={values}
      defaultTo={contactResult.data?.email ?? null}
    />
  )
}
