'use client'

import { useActionState, useId, useState } from 'react'
import { Check, ExternalLink, FileText, Replace, Upload, X } from 'lucide-react'
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  VerificationBadge,
} from '@/components/ui'
import { cn, formatDate } from '@/lib/utils'
import {
  attachDocumentType,
  verifyDocumentType,
  type ActionResult,
} from './actions'

export interface TypeOption {
  id: string
  code: string
  name: string
}

export interface AttachedDocument {
  id: string
  title: string
  type_codes: string[]
  type_names: string[]
  versions: Array<{
    id: string
    version_no: number
    status: 'current' | 'superseded' | 'rejected'
    drive_url: string | null
    storage_path: string | null
    open_url: string | null
    file_name: string | null
    received_at: string
    verification_status: 'received' | 'verified' | 'rejected'
    verification_remarks: string | null
    notes: string | null
  }>
}

function VerifyBar({
  versionId,
  importId,
  slug,
}: {
  versionId: string
  importId: string
  slug: string
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    verifyDocumentType,
    null,
  )
  const [showRemarks, setShowRemarks] = useState(false)
  const remarksId = useId()

  return (
    <form action={formAction} className="mt-3 space-y-2 border-t border-border pt-3">
      <input type="hidden" name="version_id" value={versionId} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="slug" value={slug} />

      {showRemarks && (
        <Input
          id={remarksId}
          name="remarks"
          placeholder="Remarks (optional)"
          className="text-[13px]"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          name="decision"
          value="verified"
          variant="primary"
          disabled={pending}
          className="rounded-xl"
        >
          <Check size={14} aria-hidden />
          {pending ? 'Saving…' : 'Verify'}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="rejected"
          disabled={pending}
          className="rounded-xl"
        >
          <X size={14} aria-hidden />
          Reject
        </Button>
        <button
          type="button"
          onClick={() => setShowRemarks((v) => !v)}
          className="text-[12px] text-ink-muted hover:text-ink"
        >
          {showRemarks ? 'Hide remarks' : 'Add remarks'}
        </button>
      </div>

      {state?.error && <p className="text-[13px] text-critical">{state.error}</p>}
    </form>
  )
}

function AttachForm({
  importId,
  slug,
  label,
  typeOptions,
  currentIsVerified,
  onDone,
  showCancel,
}: {
  importId: string
  slug: string
  label: string
  typeOptions: TypeOption[]
  currentIsVerified: boolean
  onDone: () => void
  showCancel: boolean
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await attachDocumentType(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )
  const [confirmed, setConfirmed] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [showLink, setShowLink] = useState(false)
  const defaultCode = typeOptions[0]?.code ?? ''
  const fileId = useId()
  const linkId = useId()

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="slug" value={slug} />

      {typeOptions.length > 1 ? (
        <Field label="Type" htmlFor="type_code" required>
          <Select id="type_code" name="type_code" defaultValue={defaultCode} required>
            {typeOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="type_code" value={defaultCode} />
      )}

      <label
        htmlFor={fileId}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border-strong bg-surface-sunken/40 px-4 py-10 text-center transition hover:border-accent hover:bg-accent-soft/30',
          fileName && 'border-accent bg-accent-soft/20',
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-xl bg-surface-raised text-accent shadow-sm">
          <Upload size={18} aria-hidden />
        </span>
        <span className="text-[14px] font-semibold text-ink">
          {fileName ?? `Upload ${label}`}
        </span>
        <span className="text-[12px] text-ink-faint">PDF, JPG or PNG · max 20 MB</span>
        <input
          id={fileId}
          name="file"
          type="file"
          accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
          className="sr-only"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
      </label>

      {showLink ? (
        <Field label="Drive link" htmlFor={linkId} hint="Use this if the file is already in Drive">
          <Input
            id={linkId}
            name="drive_url"
            type="url"
            placeholder="https://drive.google.com/…"
          />
        </Field>
      ) : (
        <button
          type="button"
          onClick={() => setShowLink(true)}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          Or paste a Drive link
        </button>
      )}

      {currentIsVerified && (
        <label className="flex items-start gap-2 rounded-xl bg-critical-soft/60 px-3 py-2.5 text-[13px] text-critical">
          <input
            type="checkbox"
            name="confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>Replace the verified file? The new one will need verification again.</span>
        </label>
      )}

      {state?.error && (
        <p className="rounded-xl bg-critical-soft px-3 py-2 text-[13px] text-critical">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || (currentIsVerified && !confirmed)}
          className="rounded-xl px-4 py-2"
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {showCancel && (
          <Button type="button" onClick={onDone} disabled={pending} className="rounded-xl">
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

export function DocumentTypePanel({
  importId,
  slug,
  label,
  typeOptions,
  documents,
}: {
  importId: string
  slug: string
  label: string
  typeOptions: TypeOption[]
  documents: AttachedDocument[]
}) {
  const currentDoc = documents[0] ?? null
  const current = currentDoc?.versions.find((v) => v.status === 'current') ?? null
  const older =
    currentDoc?.versions.filter((v) => v.status !== 'current') ??
    ([] as NonNullable<typeof currentDoc>['versions'])
  const [replacing, setReplacing] = useState(false)
  const empty = !current

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-ink">{label}</h2>
          <p className="mt-0.5 text-[13px] text-ink-muted">
            {empty ? 'No file yet — upload one to continue.' : 'Current file for this import.'}
          </p>
        </div>
        {current && <VerificationBadge status={current.verification_status} />}
      </div>

      {empty || replacing ? (
        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm sm:p-6">
          <AttachForm
            importId={importId}
            slug={slug}
            label={label}
            typeOptions={typeOptions}
            currentIsVerified={current?.verification_status === 'verified'}
            onDone={() => setReplacing(false)}
            showCancel={!empty}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-surface-raised p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <FileText size={20} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">
                {current.file_name ?? currentDoc?.title ?? label}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Received {formatDate(current.received_at)}
                {current.version_no > 1 ? ` · v${current.version_no}` : ''}
              </p>
              {currentDoc && currentDoc.type_names.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {currentDoc.type_names.map((name) => (
                    <Badge key={name} tone="accent">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {current.open_url && (
              <a
                href={current.open_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-raised px-3.5 py-2 text-[13px] font-medium text-ink transition hover:bg-surface-sunken"
              >
                <ExternalLink size={14} aria-hidden />
                Open
              </a>
            )}
            <Button
              type="button"
              onClick={() => setReplacing(true)}
              className="rounded-xl"
            >
              <Replace size={14} aria-hidden />
              Replace
            </Button>
          </div>

          {current.verification_status === 'received' && (
            <VerifyBar versionId={current.id} importId={importId} slug={slug} />
          )}

          {current.verification_remarks && (
            <p className="mt-3 text-[13px] text-ink-muted">{current.verification_remarks}</p>
          )}

          {older.length > 0 && (
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-[13px] font-medium text-ink-muted hover:text-ink">
                Earlier versions ({older.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {older.map((version) => (
                  <li
                    key={version.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-ink-faint"
                  >
                    <span>
                      v{version.version_no} · {formatDate(version.received_at)}
                      {version.file_name ? ` · ${version.file_name}` : ''}
                    </span>
                    {version.open_url && (
                      <a
                        href={version.open_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        Open
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
