'use client'

import { useActionState, useRef } from 'react'
import { Button, Card, CardHeader, CardTitle, Field, Input, Textarea } from '@/components/ui'
import { addNote, type ActionResult } from '../../actions'

export function AddNote({ importId }: { importId: string }) {
  const formRef = useRef<HTMLFormElement>(null)

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addNote(prev, formData)
      if (result.ok) formRef.current?.reset()
      return result
    },
    null,
  )

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>Add a note</CardTitle>
      </CardHeader>

      <form ref={formRef} action={formAction} className="space-y-3 p-4">
        <input type="hidden" name="import_id" value={importId} />

        <Field label="What happened" htmlFor="note-title">
          <Input
            id="note-title"
            name="title"
            required
            maxLength={200}
            placeholder="Supplier confirmed production"
          />
        </Field>

        <Field label="Detail" htmlFor="note-detail">
          <Textarea id="note-detail" name="detail" maxLength={5000} />
        </Field>

        {state?.error && <p className="text-critical">{state.error}</p>}

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add to timeline'}
        </Button>
      </form>
    </Card>
  )
}
