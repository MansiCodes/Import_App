'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useRef } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button, Field, FormGrid, Input, PanelSection, Textarea } from '@/components/ui'
import { ingestManualMessage, type ActionResult } from '../actions'

export function ManualEntry() {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await ingestManualMessage(prev, formData)
      if (result.ok) {
        formRef.current?.reset()
        router.push('/inbox')
      }
      return result
    },
    null,
  )

  return (
    <form ref={formRef} action={formAction} className="mx-auto max-w-3xl space-y-4 pb-20">
      <PanelSection
        title="Message details"
        description="Paste it as written — matching reads PO, AWB, container, BOE references."
        icon={<MessageSquarePlus size={16} aria-hidden />}
        iconTone="accent"
      >
        <div className="space-y-4">
          <Field
            label="The message"
            htmlFor="manual-body"
            required
            hint="Paste it as it was written."
          >
            <Textarea id="manual-body" name="body_text" rows={7} required maxLength={10000} />
          </Field>

          <FormGrid>
            <Field label="Who said it" htmlFor="manual-sender">
              <Input id="manual-sender" name="sender_name" maxLength={200} placeholder="Mr Zhang" />
            </Field>

            <Field
              label="Their number"
              htmlFor="manual-phone"
              hint="Used to recognise the party. Optional."
            >
              <Input
                id="manual-phone"
                name="sender_phone"
                maxLength={50}
                placeholder="+86 138…"
              />
            </Field>

            <Field
              label="When"
              htmlFor="manual-sent"
              hint="Leave blank for now. Relative dates are read against this."
            >
              <Input id="manual-sent" name="sent_at" type="datetime-local" />
            </Field>
          </FormGrid>
        </div>
      </PanelSection>

      {state?.error && (
        <p className="rounded-xl bg-critical-soft px-4 py-3 text-sm text-critical">{state.error}</p>
      )}

      <div className="sticky bottom-3 z-20 flex justify-end rounded-2xl border border-border bg-surface-raised/95 px-4 py-3 shadow-lg backdrop-blur-md">
        <Button type="submit" variant="primary" disabled={pending} className="rounded-xl px-5">
          {pending ? 'Filing…' : 'Add to Inbox'}
        </Button>
      </div>
    </form>
  )
}
