'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { extractDriveId } from '@/lib/drive'
import { createClient, getOperator } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

function revalidate(importId: string) {
  revalidatePath(`/imports/${importId}/documents`)
  revalidatePath(`/imports/${importId}`)
  revalidatePath('/documents')
  revalidatePath('/review')
  revalidatePath('/')
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

const addDocumentSchema = z.object({
  import_id: z.string().uuid(),
  title: z.string().trim().min(1, 'Give the document a name').max(200),
  // A single file can be several document types at once — the archive has
  // invoices and packing lists combined in one PDF.
  type_ids: z.array(z.string().uuid()).min(1, 'Choose at least one document type'),
  drive_url: z.string().trim().max(500).nullable(),
  file_name: z.string().trim().max(300).nullable(),
  received_at: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  payment_id: z.union([z.string().uuid(), z.null()]),
  notes: z.string().trim().max(2000).nullable(),
})

export async function addDocument(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = addDocumentSchema.safeParse({
    import_id: formData.get('import_id'),
    title: formData.get('title'),
    type_ids: formData.getAll('type_ids'),
    drive_url: emptyToNull(formData.get('drive_url')),
    file_name: emptyToNull(formData.get('file_name')),
    received_at: emptyToNull(formData.get('received_at')),
    payment_id: emptyToNull(formData.get('payment_id')),
    notes: emptyToNull(formData.get('notes')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  const { data: document, error: documentError } = await supabase
    .from('documents')
    .insert({
      import_id: parsed.data.import_id,
      payment_id: parsed.data.payment_id,
      title: parsed.data.title,
      notes: parsed.data.notes,
    })
    .select('id')
    .single()

  if (documentError) return { ok: false, error: documentError.message }

  const { error: mapError } = await supabase.from('document_type_map').insert(
    parsed.data.type_ids.map((typeId) => ({
      document_id: document.id,
      document_type_id: typeId,
    })),
  )

  if (mapError) return { ok: false, error: mapError.message }

  const { error: versionError } = await supabase.rpc('add_document_version', {
    p_document_id: document.id,
    p_drive_url: parsed.data.drive_url,
    p_drive_file_id: extractDriveId(parsed.data.drive_url),
    p_file_name: parsed.data.file_name,
    p_received_at: parsed.data.received_at,
    p_notes: null,
  })

  if (versionError) return { ok: false, error: versionError.message }

  await logActivity(parsed.data.import_id, `${parsed.data.title} received`, parsed.data.file_name)
  revalidate(parsed.data.import_id)
  return { ok: true }
}

const newVersionSchema = z.object({
  document_id: z.string().uuid(),
  import_id: z.string().uuid(),
  drive_url: z.string().trim().max(500).nullable(),
  file_name: z.string().trim().max(300).nullable(),
  received_at: z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v)),
  notes: z.string().trim().max(1000).nullable(),
  confirm: z.string().nullable(),
})

/**
 * Record a revised version. The previous one is superseded, never replaced —
 * this is how "packing list said 481 packages, then 479" stays answerable.
 */
export async function addVersion(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = newVersionSchema.safeParse({
    document_id: formData.get('document_id'),
    import_id: formData.get('import_id'),
    drive_url: emptyToNull(formData.get('drive_url')),
    file_name: emptyToNull(formData.get('file_name')),
    received_at: emptyToNull(formData.get('received_at')),
    notes: emptyToNull(formData.get('notes')),
    confirm: emptyToNull(formData.get('confirm')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()

  // Replacing a version a human already verified needs explicit consent
  // (spec §43) — the verification does not carry over.
  const { data: current } = await supabase
    .from('document_versions')
    .select('verification_status')
    .eq('document_id', parsed.data.document_id)
    .eq('status', 'current')
    .maybeSingle()

  if (current?.verification_status === 'verified' && parsed.data.confirm !== 'on') {
    return {
      ok: false,
      error: 'The current version is verified. Tick the box to confirm it is being replaced.',
    }
  }

  const { error } = await supabase.rpc('add_document_version', {
    p_document_id: parsed.data.document_id,
    p_drive_url: parsed.data.drive_url,
    p_drive_file_id: extractDriveId(parsed.data.drive_url),
    p_file_name: parsed.data.file_name,
    p_received_at: parsed.data.received_at,
    p_notes: parsed.data.notes,
  })

  if (error) return { ok: false, error: error.message }

  await logActivity(
    parsed.data.import_id,
    'Revised document received',
    parsed.data.file_name ?? parsed.data.notes,
  )
  revalidate(parsed.data.import_id)
  return { ok: true }
}

const verifySchema = z.object({
  version_id: z.string().uuid(),
  import_id: z.string().uuid(),
  decision: z.enum(['verified', 'rejected']),
  remarks: z.string().trim().max(1000).nullable(),
})

export async function verifyDocument(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = verifySchema.safeParse({
    version_id: formData.get('version_id'),
    import_id: formData.get('import_id'),
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
  revalidate(parsed.data.import_id)
  return { ok: true }
}

const requirementSchema = z.object({
  id: z.string().uuid(),
  import_id: z.string().uuid(),
  requirement: z.enum(['required', 'optional', 'not_applicable']),
})

export async function setChecklistRequirement(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = requirementSchema.safeParse({
    id: formData.get('id'),
    import_id: formData.get('import_id'),
    requirement: formData.get('requirement'),
  })

  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('document_checklist')
    .update({ requirement: parsed.data.requirement })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidate(parsed.data.import_id)
  return { ok: true }
}

const applyTemplateSchema = z.object({
  import_id: z.string().uuid(),
  template_id: z.string().uuid(),
})

export async function applyChecklistTemplate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = applyTemplateSchema.safeParse({
    import_id: formData.get('import_id'),
    template_id: formData.get('template_id'),
  })

  if (!parsed.success) return { ok: false, error: 'Choose a checklist first' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('apply_checklist_template', {
    p_import_id: parsed.data.import_id,
    p_template_id: parsed.data.template_id,
  })

  if (error) return { ok: false, error: error.message }

  revalidate(parsed.data.import_id)
  return { ok: true }
}
