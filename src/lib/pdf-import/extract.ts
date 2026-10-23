import 'server-only'

import { extractText, getDocumentProxy } from 'unpdf'
import { parseDocument, type ExtractedDocument } from './parse'
import { mergeDocuments, type MergedShipment } from './merge'

/**
 * Turning an uploaded PDF into text.
 *
 * Server-side on purpose. The parsing is not secret, but a PDF is an attack
 * surface — it is a scripting format with a long history of parser bugs — and
 * the browser is not where an unknown supplier's file should be opened. It also
 * keeps a megabyte of PDF machinery out of the client bundle.
 *
 * unpdf is pdf.js packaged for serverless, which is what this deploys onto.
 */

/** Comfortably larger than a real invoice, small enough to stay in memory. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024
export const MAX_FILES = 4

export interface ReadResult {
  fileName: string
  document: ExtractedDocument | null
  error: string | null
}

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

/**
 * Read one file, and say plainly when it cannot be read.
 *
 * A scanned document is the case worth naming: it is a perfectly good PDF that
 * happens to contain a photograph of a table rather than a table, so extraction
 * succeeds and returns nothing. Reporting "no text" instead of an empty form
 * tells the operator to type it in rather than wonder what went wrong.
 */
export async function readDocument(file: File): Promise<ReadResult> {
  const fileName = file.name

  if (file.size > MAX_PDF_BYTES) {
    return {
      fileName,
      document: null,
      error: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.`,
    }
  }

  try {
    const text = await pdfToText(new Uint8Array(await file.arrayBuffer()))

    if (text.replace(/\s/g, '').length < 40) {
      return {
        fileName,
        document: null,
        error:
          'No text could be read from this PDF. If it is a scan or a photograph, the figures will have to be typed in.',
      }
    }

    return { fileName, document: parseDocument(text), error: null }
  } catch (error) {
    return {
      fileName,
      document: null,
      error:
        error instanceof Error && /password|encrypt/i.test(error.message)
          ? 'This PDF is password protected.'
          : 'This file could not be read as a PDF.',
    }
  }
}

export interface ReadFilesResult {
  shipment: MergedShipment | null
  files: Array<{ fileName: string; kind: string; error: string | null }>
}

/** Read everything that was uploaded and merge it into one set of figures. */
export async function readDocuments(files: File[]): Promise<ReadFilesResult> {
  const results = await Promise.all(files.slice(0, MAX_FILES).map(readDocument))
  const documents = results
    .map((r) => r.document)
    .filter((d): d is ExtractedDocument => d !== null)

  return {
    shipment: documents.length > 0 ? mergeDocuments(documents) : null,
    files: results.map((r) => ({
      fileName: r.fileName,
      kind: r.document?.kind ?? 'unknown',
      error: r.error,
    })),
  }
}
