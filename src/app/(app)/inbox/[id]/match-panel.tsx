'use client'

import { useActionState, useState } from 'react'
import { Link2 } from 'lucide-react'
import { Badge, Button, Field, FormGrid, PanelSection, Select } from '@/components/ui'
import type { CommunicationParse } from '@/lib/types'
import {
  linkCommunication,
  reparseCommunication,
  unlinkCommunication,
  type ActionResult,
} from '../actions'

interface ImportOption {
  id: string
  import_no: string
  supplier_name: string | null
  company_code: string | null
  status: string
}

const SIGNAL_LABELS: Record<string, string> = {
  import_no: 'Import number',
  po_number: 'PO number',
  pi_number: 'PI number',
  awb: 'Air waybill',
  bl_no: 'Bill of lading',
  container: 'Container',
  boe_no: 'Bill of entry',
  tracking_no: 'Tracking number',
  sender_supplier: 'Sender’s supplier',
}

export function MatchPanel({
  communicationId,
  linkedImportId,
  linkedImportNo,
  parse,
  imports,
}: {
  communicationId: string
  linkedImportId: string | null
  linkedImportNo: string | null
  parse: CommunicationParse | null
  imports: ImportOption[]
}) {
  const suggestedId = parse?.matched_import_id ?? null
  const [choice, setChoice] = useState(linkedImportId ?? suggestedId ?? '')

  const [linkState, linkAction, linking] = useActionState<ActionResult | null, FormData>(
    linkCommunication,
    null,
  )
  const [unlinkState, unlinkAction, unlinking] = useActionState<ActionResult | null, FormData>(
    unlinkCommunication,
    null,
  )
  const [reparseState, reparseAction, reparsing] = useActionState<ActionResult | null, FormData>(
    reparseCommunication,
    null,
  )

  const signals = parse?.match_signals?.signals ?? []
  const alternatives = parse?.match_signals?.alternatives ?? []
  const confidence = parse?.match_confidence
    ? Math.round(Number(parse.match_confidence) * 100)
    : null

  const badge = linkedImportId ? (
    <Badge tone="done">Linked</Badge>
  ) : parse?.match_status === 'ambiguous' ? (
    <Badge tone="due">Several possible</Badge>
  ) : suggestedId ? (
    <Badge tone="upcoming">Suggested{confidence ? ` — ${confidence}%` : ''}</Badge>
  ) : (
    <Badge tone="waiting">Match required</Badge>
  )

  return (
    <PanelSection
      title="Import match"
      description="Suggestions are proposals until you confirm them."
      icon={<Link2 size={16} aria-hidden />}
      iconTone="done"
      actions={badge}
    >
      {linkedImportId ? (
        <div className="space-y-3">
          <p className="text-[14px] text-ink-muted">
            Linked to{' '}
            <span className="font-mono font-semibold text-ink">{linkedImportNo}</span>. It
            appears on that import’s timeline.
          </p>

          <form action={unlinkAction}>
            <input type="hidden" name="communication_id" value={communicationId} />
            {unlinkState?.error && (
              <p className="mb-2 text-sm text-critical">{unlinkState.error}</p>
            )}
            <Button type="submit" disabled={unlinking} className="rounded-xl">
              {unlinking ? 'Unlinking…' : 'Unlink'}
            </Button>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          {parse?.status === 'failed' && (
            <p className="rounded-xl bg-critical-soft px-3 py-2 text-sm text-critical">
              Could not read this message — {parse.failure_reason ?? 'no reason recorded'}. Link
              it by hand, or try again.
            </p>
          )}

          {!parse && (
            <p className="rounded-xl bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
              This message has not been read yet. Link it by hand, or press Read again.
            </p>
          )}

          {signals.length > 0 && (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-ink-faint">Matched on</p>
              <ul className="flex flex-wrap gap-2">
                {signals.map((signal) => (
                  <li key={`${signal.kind}-${signal.value}`}>
                    <Badge tone="accent">
                      {SIGNAL_LABELS[signal.kind] ?? signal.kind}: {signal.value}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alternatives.length > 1 && (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold text-ink-faint">Also considered</p>
              <ul className="space-y-1">
                {alternatives.map((alternative) => (
                  <li key={alternative.importId} className="flex items-center gap-2 text-sm">
                    <span className="font-mono font-medium">{alternative.importNo}</span>
                    <span className="text-ink-muted">
                      {Math.round(alternative.confidence * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form
            action={linkAction}
            className="space-y-3 rounded-xl border bg-surface-sunken/30 p-4"
          >
            <input type="hidden" name="communication_id" value={communicationId} />

            <FormGrid className="lg:grid-cols-1">
              <Field label="Link to import" htmlFor="match-import">
                <Select
                  id="match-import"
                  name="import_id"
                  value={choice}
                  onChange={(event) => setChoice(event.currentTarget.value)}
                >
                  <option value="">Choose an import…</option>
                  {imports.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.import_no} · {option.supplier_name ?? option.company_code} ·{' '}
                      {option.status}
                    </option>
                  ))}
                </Select>
              </Field>
            </FormGrid>

            {linkState?.error && <p className="text-sm text-critical">{linkState.error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={linking || !choice}
                className="rounded-xl"
              >
                {linking ? 'Linking…' : 'Link to this import'}
              </Button>
            </div>
          </form>

          <form action={reparseAction}>
            <input type="hidden" name="communication_id" value={communicationId} />
            {reparseState?.error && (
              <p className="mb-2 text-sm text-critical">{reparseState.error}</p>
            )}
            <Button type="submit" disabled={reparsing} className="rounded-xl">
              {reparsing ? 'Reading…' : 'Read again'}
            </Button>
          </form>
        </div>
      )}
    </PanelSection>
  )
}
