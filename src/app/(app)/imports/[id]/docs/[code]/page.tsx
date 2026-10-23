import { notFound } from 'next/navigation'
import { documentOpenHref } from '@/lib/document-open-url'
import { createClient } from '@/lib/supabase/server'
import { getPrimaryDocumentTab } from '@/lib/types'
import { DocumentTypePanel, type AttachedDocument, type TypeOption } from '../document-type-panel'

export const dynamic = 'force-dynamic'

interface RawDocument {
  id: string
  title: string
  document_type_map: Array<{
    document_types: { code: string; name: string } | null
  }>
  document_versions: Array<{
    id: string
    version_no: number
    status: 'current' | 'superseded' | 'rejected'
    drive_url: string | null
    storage_path: string | null
    file_name: string | null
    received_at: string
    verification_status: 'received' | 'verified' | 'rejected'
    verification_remarks: string | null
    notes: string | null
  }>
}

export default async function DocumentTypeTabPage({
  params,
}: {
  params: Promise<{ id: string; code: string }>
}) {
  const { id, code } = await params
  const tab = getPrimaryDocumentTab(code)
  if (!tab) notFound()

  const supabase = await createClient()
  const typeCodes = [...tab.typeCodes]

  const [typesResult, documentsResult] = await Promise.all([
    supabase
      .from('document_types')
      .select('id, code, name')
      .in('code', typeCodes)
      .eq('is_active', true)
      .order('sort_order'),
    // !inner so we only pull docs tagged with this tab's types — not the whole import.
    supabase
      .from('documents')
      .select(
        'id, title, document_type_map!inner(document_types!inner(code, name)), document_versions(id, version_no, status, drive_url, storage_path, file_name, received_at, verification_status, verification_remarks, notes)',
      )
      .eq('import_id', id)
      .in('document_type_map.document_types.code', typeCodes)
      .order('created_at', { ascending: false }),
  ])

  const typeOptions: TypeOption[] = (typesResult.data ?? []) as TypeOption[]
  if (typeOptions.length === 0) notFound()

  const documents: AttachedDocument[] = ((documentsResult.data ?? []) as unknown as RawDocument[]).map(
    (doc) => {
      const versions = [...doc.document_versions]
        .sort((a, b) => b.version_no - a.version_no)
        .map((version) => ({
          ...version,
          open_url: documentOpenHref(version.id, version.drive_url, version.storage_path),
        }))

      return {
        id: doc.id,
        title: doc.title,
        type_codes: doc.document_type_map
          .map((m) => m.document_types?.code)
          .filter((c): c is string => Boolean(c)),
        type_names: doc.document_type_map
          .map((m) => m.document_types?.name)
          .filter((n): n is string => Boolean(n)),
        versions,
      }
    },
  )

  return (
    <DocumentTypePanel
      importId={id}
      slug={tab.slug}
      label={tab.label}
      typeOptions={typeOptions}
      documents={documents}
    />
  )
}
