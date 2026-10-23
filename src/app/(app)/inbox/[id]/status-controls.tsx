'use client'

import { useActionState, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Badge, Button, PanelSection } from '@/components/ui'
import { COMMUNICATION_STATUS_LABELS, type CommunicationStatus } from '@/lib/types'
import { setCommunicationStatus, type ActionResult } from '../actions'

export function StatusControls({
  communicationId,
  status,
}: {
  communicationId: string
  status: CommunicationStatus
}) {
  const [next, setNext] = useState<CommunicationStatus>('actioned')

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setCommunicationStatus,
    null,
  )

  return (
    <PanelSection
      title="Status"
      description="Separate from linking — a message can be actioned without an import."
      icon={<CheckCircle2 size={16} aria-hidden />}
      iconTone="due"
      actions={
        <Badge tone={status === 'actioned' ? 'done' : status === 'ignored' ? 'neutral' : 'due'}>
          {COMMUNICATION_STATUS_LABELS[status]}
        </Badge>
      }
    >
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="communication_id" value={communicationId} />
        <input type="hidden" name="status" value={next} />

        {state?.error && <p className="text-sm text-critical">{state.error}</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            className="rounded-xl"
            disabled={pending || status === 'actioned'}
            onClick={() => setNext('actioned')}
          >
            Mark actioned
          </Button>
          <Button
            type="submit"
            className="rounded-xl"
            disabled={pending || status === 'ignored'}
            onClick={() => setNext('ignored')}
          >
            Ignore
          </Button>
          {status !== 'new' && (
            <Button
              type="submit"
              className="rounded-xl"
              disabled={pending}
              onClick={() => setNext('new')}
            >
              Reopen
            </Button>
          )}
        </div>
      </form>
    </PanelSection>
  )
}
