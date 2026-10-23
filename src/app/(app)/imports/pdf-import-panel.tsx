'use client'

import { useRef, useState, useTransition } from 'react'
import { UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { MergedShipment } from '@/lib/pdf-import/merge'
import { readShipmentDocuments } from './pdf-actions'

export interface FilledField {
  label: string
  value: string
  source: string
}

export function PdfImportPanel({
  onApply,
  hint = 'Upload the commercial invoice and the packing list.',
  bare = false,
  compact = false,
}: {
  onApply: (shipment: MergedShipment) => FilledField[]
  hint?: string
  bare?: boolean
  /** Compact dropzone used inside the blue Fill-from-PDF banner. */
  compact?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [filled, setFilled] = useState<FilledField[] | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [readFiles, setReadFiles] = useState<string[]>([])

  function read(files: FileList | null) {
    if (!files || files.length === 0) return

    setError(null)
    setFilled(null)
    setWarnings([])

    const formData = new FormData()
    for (const file of Array.from(files)) formData.append('files', file)

    startTransition(async () => {
      const result = await readShipmentDocuments(formData)

      if (!result.ok || !result.shipment) {
        setError(result.error ?? 'Nothing could be read from those files.')
        return
      }

      setFilled(onApply(result.shipment))
      setWarnings(result.shipment.warnings)
      setReadFiles(
        (result.files ?? [])
          .filter((f) => !f.error)
          .map((f) => `${f.fileName}${f.kind === 'unknown' ? '' : ` — ${KINDS[f.kind] ?? f.kind}`}`),
      )
      if (inputRef.current) inputRef.current.value = ''
    })
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      onChange={(e) => read(e.target.files)}
    />
  )

  if (compact) {
    return (
      <div>
        {fileInput}
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-accent/40 bg-white/70 px-4 py-4 text-center transition hover:border-accent hover:bg-white',
            pending && 'opacity-60',
          )}
        >
          <UploadCloud size={22} className="text-accent" aria-hidden />
          <span className="text-[13px] font-semibold text-accent">
            {pending ? 'Reading…' : 'Choose PDFs'}
          </span>
          {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
        </button>
        {error && <p className="mt-2 text-sm text-critical">{error}</p>}
        {filled && filled.length > 0 && (
          <p className="mt-2 text-[12px] text-done">
            Filled {filled.length} field{filled.length === 1 ? '' : 's'} — review then Save.
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="mt-1">
            {warnings.map((w) => (
              <li key={w} className="text-[12px] text-due">
                • {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!bare && (
          <div>
            <p className="text-[15px] font-semibold">Fill from PDF</p>
            <p className="text-[13px] text-ink-muted">{hint}</p>
          </div>
        )}
        {bare && <p className="text-[13px] text-ink-muted">{hint}</p>}

        <div className="flex items-center gap-2">
          {fileInput}
          <Button
            type="button"
            variant="primary"
            className="rounded-xl"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
          >
            {pending ? 'Reading…' : 'Choose PDFs'}
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-critical">{error}</p>}

      {filled && (
        <div className="mt-4 rounded-xl border bg-surface-sunken/60 px-4 py-3">
          {readFiles.length > 0 && (
            <p className="text-[12px] text-ink-faint">Read {readFiles.join(' · ')}</p>
          )}

          {filled.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">
              Nothing in these documents matched a field on this form.
            </p>
          ) : (
            <>
              <p className="mt-1 text-sm text-ink-muted">
                Filled {filled.length} field{filled.length === 1 ? '' : 's'}. Check them before
                saving — everything is still editable.
              </p>
              <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {filled.map((field) => (
                  <li key={field.label} className="flex justify-between gap-3 text-sm">
                    <span className="text-ink-muted">{field.label}</span>
                    <span className="tnum text-right font-medium">{field.value}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {warnings.length > 0 && (
            <ul className="mt-2 border-t pt-2">
              {warnings.map((warning) => (
                <li key={warning} className="text-sm text-due">
                  • {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )

  if (bare) return <div>{body}</div>

  return (
    <div className="rounded-2xl border border-dashed border-border-strong bg-surface-sunken/50 px-5 py-4">
      {body}
    </div>
  )
}

const KINDS: Record<string, string> = {
  commercial_invoice: 'invoice',
  packing_list: 'packing list',
}
