'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { extractDriveId } from '@/lib/drive'
import { createClient, getOperator } from '@/lib/supabase/server'
import { getPrimaryDocumentTab } from '@/lib/types'

export interface ActionResult {
  ok: boolean
  error?: string
}

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_BYTES = 20 * 1024 * 1024
const BUCKET = 'import-documents'

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

function revalidate(importId: string, slug?: string) {
  if (slug) revalidatePath(`/imports/${importId}/docs/${slug}`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/documents')
}

async function logActivity(importId: string, title: string, detail?: string | null) {
  const supabase = await createClient()
  const operator = await getOperator()

  await supabase.from('activity_log').insert({
    import_id: importId,
    event_type: 'document',
    title,
    detail: detail ?? null,
    created_by: operator?.id ?? null,
  })
}

function extensionForMime(mime: string): string {
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/png') return 'png'
  return 'jpg'
}

async function uploadAttachment(
  importId: string,
  typeCode: string,
  file: File,
): Promise<{ storagePath: string; fileName: string } | { error: string }> {
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: 'Only PDF, JPG, and PNG files are allowed' }
  }
  if (file.size <= 0) return { error: 'Choose a file to attach' }
  if (file.size > MAX_BYTES) return { error: 'File must be 20 MB or smaller' }

  const ext = extensionForMime(file.type)
  const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 180) || `attachment.${ext}`
  const storagePath = `${importId}/${typeCode}/${randomUUID()}.${ext}`

  const supabase = await createClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: file.type,
    upsert: false,
  })

  if (error) return { error: error.message }
  return { storagePath, fileName: safeName }
}

const attachSchema = z.object({
  import_id: z.string().uuid(),
  slug: z.string().min(1),
  type_code: z.string().min(1),
  drive_url: z.string().trim().max(500).nullable(),
  received_at: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  notes: z.string().trim().max(2000).nullable(),
  confirm: z.string().nullable(),
})

/**
 * Attach a PDF/JPG/PNG (and/or Drive link) for one primary document type.
 * Creates a new document if none exists for that type on this import, otherwise
 * adds a new version (with confirm when the current version is verified).
 */
export async function attachDocumentType(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = attachSchema.safeParse({
    import_id: formData.get('import_id'),
    slug: formData.get('slug'),
    type_code: formData.get('type_code'),
    drive_url: emptyToNull(formData.get('drive_url')),
    received_at: emptyToNull(formData.get('received_at')),
    notes: emptyToNull(formData.get('notes')),
    confirm: emptyToNull(formData.get('confirm')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const tab = getPrimaryDocumentTab(parsed.data.slug)
  if (!tab || !(tab.typeCodes as readonly string[]).includes(parsed.data.type_code)) {
    return { ok: false, error: 'Unknown document tab' }
  }

  const fileEntry = formData.get('file')
  const file = fileEntry instanceof File && fileEntry.size > 0 ? fileEntry : null

  if (!file && !parsed.data.drive_url) {
    return { ok: false, error: 'Attach a PDF/JPG/PNG or paste a Drive link' }
  }

  let storagePath: string | null = null
  let fileName: string | null = null

  if (file) {
    const uploaded = await uploadAttachment(parsed.data.import_id, parsed.data.type_code, file)
    if ('error' in uploaded) return { ok: false, error: uploaded.error }
    storagePath = uploaded.storagePath
    fileName = uploaded.fileName
  }

  const supabase = await createClient()

  const { data: typeRow, error: typeError } = await supabase
    .from('document_types')
    .select('id, name')
    .eq('code', parsed.data.type_code)
    .eq('is_active', true)
    .maybeSingle()

  if (typeError || !typeRow) {
    return { ok: false, error: typeError?.message ?? 'Document type not found' }
  }

  // Prefer an existing document already tagged with this type for this import.
  const { data: existingDocs } = await supabase
    .from('documents')
    .select('id, document_type_map!inner(document_type_id)')
    .eq('import_id', parsed.data.import_id)
    .eq('document_type_map.document_type_id', typeRow.id)
    .limit(1)

  let documentId = existingDocs?.[0]?.id ?? null

  if (documentId) {
    const { data: current } = await supabase
      .from('document_versions')
      .select('verification_status')
      .eq('document_id', documentId)
      .eq('status', 'current')
      .maybeSingle()

    if (current?.verification_status === 'verified' && parsed.data.confirm !== 'on') {
      return {
        ok: false,
        error: 'The current version is verified. Tick the box to confirm it is being replaced.',
      }
    }
  } else {
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        import_id: parsed.data.import_id,
        title: typeRow.name,
        notes: parsed.data.notes,
      })
      .select('id')
      .single()

    if (documentError) return { ok: false, error: documentError.message }
    documentId = document.id

    const { error: mapError } = await supabase.from('document_type_map').insert({
      document_id: documentId,
      document_type_id: typeRow.id,
    })
    if (mapError) return { ok: false, error: mapError.message }
  }

  const { error: versionError } = await supabase.rpc('add_document_version', {
    p_document_id: documentId,
    p_drive_url: parsed.data.drive_url,
    p_drive_file_id: extractDriveId(parsed.data.drive_url),
    p_file_name: fileName,
    p_received_at: parsed.data.received_at,
    p_notes: parsed.data.notes,
    p_storage_path: storagePath,
  })

  if (versionError) return { ok: false, error: versionError.message }

  await logActivity(
    parsed.data.import_id,
    `${typeRow.name} received`,
    fileName ?? parsed.data.drive_url,
  )
  revalidate(parsed.data.import_id, parsed.data.slug)
  return { ok: true }
}

const verifySchema = z.object({
  version_id: z.string().uuid(),
  import_id: z.string().uuid(),
  slug: z.string().min(1),
  decision: z.enum(['verified', 'rejected']),
  remarks: z.string().trim().max(1000).nullable(),
})

export async function verifyDocumentType(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = verifySchema.safeParse({
    version_id: formData.get('version_id'),
    import_id: formData.get('import_id'),
    slug: formData.get('slug'),
    decision: formData.get('decision'),
    remarks: emptyToNull(formData.get('remarks')),
  })

  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase
    .from('document_versions')
    .update({
      verification_status: parsed.data.decision,
      verified_by: operator?.id ?? null,
      verified_at: new Date().toISOString(),
      verification_remarks: parsed.data.remarks,
    })
    .eq('id', parsed.data.version_id)

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    parsed.data.decision === 'verified' ? 'Document verified' : 'Document rejected',
    parsed.data.remarks,
  )
  revalidate(parsed.data.import_id, parsed.data.slug)
  return { ok: true }
}
