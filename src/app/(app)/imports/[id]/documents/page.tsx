import { createClient } from '@/lib/supabase/server'
import type { ChecklistRow, DocumentType } from '@/lib/types'
import { DocumentsPanel, type DocumentRow } from './documents-panel'

export const dynamic = 'force-dynamic'

interface RawDocument {
  id: string
  title: string
  notes: string | null
  document_type_map: Array<{ document_types: { name: string } | null }>
  document_versions: DocumentRow['versions']
}

export default async function DocumentsTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [documentsResult, checklistResult, typesResult, templatesResult] = await Promise.all([
    supabase
      .from('documents')
      .select(
        'id, title, notes, document_type_map(document_types(name)), document_versions(id, version_no, status, drive_url, file_name, received_at, verification_status, verification_remarks, notes)',
      )
      .eq('import_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('v_document_checklist')
      .select('*')
      .eq('import_id', id)
      .order('sort_order'),
    supabase
      .from('document_types')
      .select('*')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('checklist_templates').select('id, name, mode').order('name'),
  ])

  const documents: DocumentRow[] = ((documentsResult.data ?? []) as unknown as RawDocument[]).map(
    (doc) => ({
      id: doc.id,
      title: doc.title,
      notes: doc.notes,
      type_names: doc.document_type_map
        .map((m) => m.document_types?.name)
        .filter((name): name is string => Boolean(name)),
      // Newest first so the current version reads at the top.
      versions: [...doc.document_versions].sort((a, b) => b.version_no - a.version_no),
    }),
  )

  return (
    <DocumentsPanel
      importId={id}
      documents={documents}
      checklist={(checklistResult.data ?? []) as ChecklistRow[]}
      types={(typesResult.data ?? []) as DocumentType[]}
      templates={templatesResult.data ?? []}
    />
  )
}
