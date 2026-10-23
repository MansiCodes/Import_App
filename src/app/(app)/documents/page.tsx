import { createClient } from '@/lib/supabase/server'
import type { ChecklistRow } from '@/lib/types'
import { DocumentsRegisterView, type DocumentRegisterRow } from './documents-register-view'

export const dynamic = 'force-dynamic'

export default async function DocumentsRegisterPage() {
  const supabase = await createClient()

  const [checklistResult, importsResult] = await Promise.all([
    supabase
      .from('v_document_checklist')
      .select(
        'id, import_id, document_type_id, type_code, type_name, category, gate, requirement, notes, sort_order, document_id, version_id, version_no, drive_url, file_name, received_at, verification_status, state',
      )
      .neq('requirement', 'not_applicable'),
    supabase
      .from('v_import_summary')
      .select('id, import_no, supplier_name, company_code, status')
      .eq('is_archived', false),
  ])

  const imports = new Map((importsResult.data ?? []).map((i) => [i.id, i]))

  // Only rows belonging to a live import — archived ones are noise here.
  const rows: DocumentRegisterRow[] = ((checklistResult.data ?? []) as ChecklistRow[])
    .filter((row) => imports.has(row.import_id))
    .map((row) => {
      const imp = imports.get(row.import_id)
      return {
        ...row,
        import_no: imp?.import_no,
        supplier_name: imp?.supplier_name,
        company_code: imp?.company_code,
      }
    })

  return <DocumentsRegisterView rows={rows} />
}
