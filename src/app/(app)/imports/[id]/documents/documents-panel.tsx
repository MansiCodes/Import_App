'use client'

import { useActionState, useState } from 'react'
import { ClipboardCheck, Files } from 'lucide-react'
import {
  Badge,
  Button,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
  VerificationBadge,
} from '@/components/ui'
import {
  GATE_LABELS,
  type ChecklistGate,
  type ChecklistRow,
  type DocumentType,
} from '@/lib/types'
import { formatDate } from '@/lib/utils'
import {
  addDocument,
  addVersion,
  applyChecklistTemplate,
  setChecklistRequirement,
  verifyDocument,
  type ActionResult,
} from './actions'

export interface DocumentRow {
  id: string
  title: string
  notes: string | null
  type_names: string[]
  versions: Array<{
    id: string
    version_no: number
    status: 'current' | 'superseded' | 'rejected'
    drive_url: string | null
    file_name: string | null
    received_at: string
    verification_status: 'received' | 'verified' | 'rejected'
    verification_remarks: string | null
    notes: string | null
  }>
}

function VerifyForm({ versionId, importId }: { versionId: string; importId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    verifyDocument,
    null,
  )
  const [decision, setDecision] = useState<'verified' | 'rejected'>('verified')

  return (
    <form
      action={formAction}
      className="mt-3 space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
    >
      <input type="hidden" name="version_id" value={versionId} />
      <input type="hidden" name="import_id" value={importId} />
      <input type="hidden" name="decision" value={decision} />

      <FormGrid>
        <Field label="Remarks" htmlFor={`verify-remarks-${versionId}`} className="sm:col-span-2 lg:col-span-2">
          <Input
            id={`verify-remarks-${versionId}`}
            name="remarks"
            placeholder="Remarks (optional)"
          />
        </Field>
      </FormGrid>

      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          onClick={() => setDecision('verified')}
        >
          Mark verified
        </Button>
        <Button type="submit" disabled={pending} onClick={() => setDecision('rejected')}>
          Reject
        </Button>
      </div>

      {state?.error && <p className="text-critical">{state.error}</p>}
    </form>
  )
}

function NewVersionForm({
  documentId,
  importId,
  currentIsVerified,
  onDone,
}: {
  documentId: string
  importId: string
  currentIsVerified: boolean
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addVersion(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )
  const [confirmed, setConfirmed] = useState(false)

  return (
    <form
      action={formAction}
      className="mt-3 space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
    >
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Drive link" htmlFor={`ver-url-${documentId}`}>
          <Input id={`ver-url-${documentId}`} name="drive_url" type="url" />
        </Field>
        <Field label="File name" htmlFor={`ver-file-${documentId}`}>
          <Input id={`ver-file-${documentId}`} name="file_name" />
        </Field>
        <Field label="Received on" htmlFor={`ver-date-${documentId}`}>
          <Input id={`ver-date-${documentId}`} name="received_at" type="date" />
        </Field>
        <Field
          label="What changed?"
          htmlFor={`ver-notes-${documentId}`}
          className="sm:col-span-2 lg:col-span-3"
        >
          <Input
            id={`ver-notes-${documentId}`}
            name="notes"
            placeholder="Packages revised from 481 to 479"
          />
        </Field>
      </FormGrid>

      {currentIsVerified && (
        <label className="flex items-start gap-2 text-critical">
          <input
            type="checkbox"
            name="confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>
            The current version is already verified. Adding a revision supersedes it and the new
            one starts unverified.
          </span>
        </label>
      )}

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={pending || (currentIsVerified && !confirmed)}
        >
          {pending ? 'Saving…' : 'Add revision'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function AddDocumentForm({
  importId,
  types,
  onDone,
}: {
  importId: string
  types: DocumentType[]
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addDocument(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  const [selected, setSelected] = useState<string[]>([])

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const byCategory = types.reduce<Record<string, DocumentType[]>>((acc, type) => {
    ;(acc[type.category] ??= []).push(type)
    return acc
  }, {})

  return (
    <form
      action={formAction}
      className="mb-4 space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
    >
      <input type="hidden" name="import_id" value={importId} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="type_ids" value={id} />
      ))}

      <FormGrid>
        <Field label="Name" htmlFor="doc-title" required className="sm:col-span-2 lg:col-span-2">
          <Input id="doc-title" name="title" required placeholder="Commercial Invoice 910011055" />
        </Field>
        <Field label="Drive link" htmlFor="doc-url" hint="Paste the link — the file stays in Drive">
          <Input id="doc-url" name="drive_url" type="url" />
        </Field>
        <Field label="File name" htmlFor="doc-file">
          <Input id="doc-file" name="file_name" />
        </Field>
        <Field label="Received on" htmlFor="doc-date">
          <Input id="doc-date" name="received_at" type="date" />
        </Field>
      </FormGrid>

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-semibold text-ink">
          Document type <span className="text-critical">*</span>
        </legend>
        <p className="mb-2 text-[13px] text-ink-muted">
          Tick more than one if a single file covers several — a combined invoice and packing list
          satisfies both checklist items.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(byCategory).map(([category, categoryTypes]) => (
            <div key={category}>
              <p className="mb-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
                {category}
              </p>
              <ul className="space-y-0.5">
                {categoryTypes.map((type) => (
                  <li key={type.id}>
                    <label className="flex items-start gap-1.5 text-[14px]">
                      <input
                        type="checkbox"
                        checked={selected.includes(type.id)}
                        onChange={() => toggle(type.id)}
                        className="mt-0.5 size-4"
                      />
                      <span>{type.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </fieldset>

      <FormGrid>
        <Field label="Notes" htmlFor="doc-notes" className="sm:col-span-2 lg:col-span-3">
          <Textarea id="doc-notes" name="notes" />
        </Field>
      </FormGrid>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || selected.length === 0}>
          {pending ? 'Saving…' : 'Add document'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function RequirementSelect({ row, importId }: { row: ChecklistRow; importId: string }) {
  const [, formAction] = useActionState<ActionResult | null, FormData>(
    setChecklistRequirement,
    null,
  )

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="import_id" value={importId} />
      <Select
        name="requirement"
        defaultValue={row.requirement}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-auto"
      >
        <option value="required">Required</option>
        <option value="optional">Optional</option>
        <option value="not_applicable">Not applicable</option>
      </Select>
    </form>
  )
}

function ApplyTemplate({
  importId,
  templates,
}: {
  importId: string
  templates: Array<{ id: string; name: string; mode: string }>
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    applyChecklistTemplate,
    null,
  )

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="import_id" value={importId} />

      <Field label="Checklist" htmlFor="template" hint="Pick the one matching how this ships">
        <Select id="template" name="template_id" className="w-auto">
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Applying…' : 'Apply checklist'}
      </Button>

      {state?.error && <span className="text-critical">{state.error}</span>}
    </form>
  )
}

export function DocumentsPanel({
  importId,
  documents,
  checklist,
  types,
  templates,
}: {
  importId: string
  documents: DocumentRow[]
  checklist: ChecklistRow[]
  types: DocumentType[]
  templates: Array<{ id: string; name: string; mode: string }>
}) {
  const [adding, setAdding] = useState(false)
  const [versioning, setVersioning] = useState<string | null>(null)

  const gates = checklist.reduce<Record<string, ChecklistRow[]>>((acc, row) => {
    ;(acc[row.gate] ??= []).push(row)
    return acc
  }, {})

  const missingRequired = checklist.filter(
    (row) => row.requirement === 'required' && row.state === 'pending',
  )

  return (
    <div className="space-y-4">
      <PanelSection
        title="Checklist"
        description="What this import needs — mark N/A if not required."
        icon={<ClipboardCheck size={15} aria-hidden />}
        iconTone="due"
        actions={
          missingRequired.length > 0 ? (
            <Badge tone="critical">{missingRequired.length} still missing</Badge>
          ) : undefined
        }
      >
        {checklist.length === 0 ? (
          <ApplyTemplate importId={importId} templates={templates} />
        ) : (
          <div className="space-y-4">
            {(Object.keys(GATE_LABELS) as ChecklistGate[]).map((gate) => {
              const rows = gates[gate]
              if (!rows?.length) return null

              return (
                <div key={gate}>
                  <p className="mb-2 text-[12px] font-medium tracking-wide text-ink-faint uppercase">
                    {GATE_LABELS[gate]}
                  </p>

                  <ul className="space-y-2">
                    {rows.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-sunken/30 px-3.5 py-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={
                              row.requirement === 'not_applicable'
                                ? 'text-ink-faint line-through'
                                : 'text-[14px] font-medium text-ink'
                            }
                          >
                            {row.type_name}
                          </span>
                          <VerificationBadge
                            status={row.requirement === 'not_applicable' ? 'not_applicable' : row.state}
                          />
                          {row.drive_url && (
                            <a
                              href={row.drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              open ↗
                            </a>
                          )}
                          {row.version_no !== null && row.version_no > 1 && (
                            <Badge tone="due">v{row.version_no}</Badge>
                          )}
                        </div>

                        <RequirementSelect row={row} importId={importId} />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </PanelSection>

      <PanelSection
        title="Documents"
        description="Drive holds files; here you track versions and verification."
        icon={<Files size={15} aria-hidden />}
        iconTone="accent"
        actions={
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add document
          </Button>
        }
      >
        {adding && (
          <AddDocumentForm importId={importId} types={types} onDone={() => setAdding(false)} />
        )}

        {documents.length === 0 && !adding ? (
          <p className="text-[14px] text-ink-muted">No documents recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {documents.map((doc) => {
              const current = doc.versions.find((v) => v.status === 'current')
              const superseded = doc.versions.filter((v) => v.status !== 'current')

              return (
                <li
                  key={doc.id}
                  className="rounded-xl border border-border bg-surface-sunken/30 px-4 py-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold text-ink">{doc.title}</span>
                        {doc.type_names.map((name) => (
                          <Badge key={name} tone="accent">
                            {name}
                          </Badge>
                        ))}
                        {current && <VerificationBadge status={current.verification_status} />}
                      </div>

                      {current && (
                        <p className="mt-1 text-[13px] text-ink-muted">
                          v{current.version_no} · received {formatDate(current.received_at)}
                          {current.file_name ? ` · ${current.file_name}` : ''}
                          {current.verification_remarks
                            ? ` · ${current.verification_remarks}`
                            : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      {current?.drive_url && (
                        <a
                          href={current.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 text-accent hover:underline"
                        >
                          Open ↗
                        </a>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => setVersioning(versioning === doc.id ? null : doc.id)}
                      >
                        {versioning === doc.id ? 'Close' : 'Add revision'}
                      </Button>
                    </div>
                  </div>

                  {current?.verification_status === 'received' && (
                    <VerifyForm versionId={current.id} importId={importId} />
                  )}

                  {versioning === doc.id && (
                    <NewVersionForm
                      documentId={doc.id}
                      importId={importId}
                      currentIsVerified={current?.verification_status === 'verified'}
                      onDone={() => setVersioning(null)}
                    />
                  )}

                  {superseded.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[13px] text-ink-muted">
                        Earlier versions ({superseded.length})
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {superseded.map((version) => (
                          <li
                            key={version.id}
                            className="rounded-xl border border-border bg-surface-sunken/30 px-3 py-2 text-[13px] text-ink-faint"
                          >
                            v{version.version_no} · {formatDate(version.received_at)}
                            {version.file_name ? ` · ${version.file_name}` : ''}
                            {version.notes ? ` · ${version.notes}` : ''}
                            <Badge className="ml-2">Superseded</Badge>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PanelSection>
    </div>
  )
}
