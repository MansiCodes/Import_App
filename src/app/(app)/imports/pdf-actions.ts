'use server'

import { headers } from 'next/headers'
import { callerKey, rateLimit } from '@/lib/rate-limit'
import { MAX_FILES, MAX_PDF_BYTES, readDocuments } from '@/lib/pdf-import/extract'
import type { MergedShipment } from '@/lib/pdf-import/merge'
import { requireProfile } from '@/lib/supabase/server'

/**
 * Reading a supplier's documents so nobody has to retype them.
 *
 * This action WRITES NOTHING. It reads the uploaded files, returns what it
 * found, and stops. What happens next is a person looking at the figures in the
 * form and pressing save — which is the same save that already existed, with
 * the same validation and the same audit trail.
 *
 * That split is deliberate. Extraction from a supplier's PDF is a good guess,
 * not a fact, and an import record that quietly rewrote itself because someone
 * uploaded the wrong file would be far worse than a little typing.
 */

export interface PdfImportResult {
  ok: boolean
  error?: string
  shipment?: MergedShipment
  files?: Array<{ fileName: string; kind: string; error: string | null }>
}

export async function readShipmentDocuments(formData: FormData): Promise<PdfImportResult> {
  await requireProfile()

  // PDF parsing is the most expensive thing this app does per request.
  const headerList = await headers()
  const limit = rateLimit(callerKey(headerList, 'pdf-import'), 40, 300)
  if (!limit.allowed) {
    return { ok: false, error: 'Too many documents just now. Try again in a few minutes.' }
  }

  const uploaded = formData.getAll('files').filter((entry): entry is File => entry instanceof File)
  const files = uploaded.filter((file) => file.size > 0)

  if (files.length === 0) return { ok: false, error: 'Choose a PDF to read.' }
  if (files.length > MAX_FILES) {
    return { ok: false, error: `Up to ${MAX_FILES} files at a time.` }
  }

  const wrongType = files.find(
    (file) => file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name),
  )
  if (wrongType) {
    return { ok: false, error: `${wrongType.name} is not a PDF.` }
  }

  const tooBig = files.find((file) => file.size > MAX_PDF_BYTES)
  if (tooBig) {
    return { ok: false, error: `${tooBig.name} is larger than ${MAX_PDF_BYTES / 1024 / 1024} MB.` }
  }

  const result = await readDocuments(files)

  if (!result.shipment) {
    const reason = result.files.find((f) => f.error)?.error
    return { ok: false, error: reason ?? 'Nothing could be read from these files.' }
  }

  return { ok: true, shipment: result.shipment, files: result.files }
}
