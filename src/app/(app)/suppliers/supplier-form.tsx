'use client'

import { useActionState } from 'react'
import { Button, Field, Input, Select, Textarea } from '@/components/ui'
import type { Supplier } from '@/lib/types'
import { saveSupplier, type ActionResult } from './actions'

export function SupplierForm({
  supplier,
  currencies,
  incoterms,
  onDone,
}: {
  supplier?: Supplier
  currencies: string[]
  incoterms: string[]
  onDone?: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveSupplier(prev, formData)
      if (result.ok) onDone?.()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="space-y-4 border-t bg-surface-sunken p-4">
      {supplier && <input type="hidden" name="id" value={supplier.id} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name" htmlFor="name" required>
          <Input id="name" name="name" required defaultValue={supplier?.name} maxLength={200} />
        </Field>

        <Field label="Legal name" htmlFor="legal_name">
          <Input id="legal_name" name="legal_name" defaultValue={supplier?.legal_name ?? ''} />
        </Field>

        <Field label="Country" htmlFor="country">
          <Input id="country" name="country" defaultValue={supplier?.country ?? ''} />
        </Field>

        <Field label="City" htmlFor="city">
          <Input id="city" name="city" defaultValue={supplier?.city ?? ''} />
        </Field>

        <Field label="Usual currency" htmlFor="default_currency">
          <Select
            id="default_currency"
            name="default_currency"
            defaultValue={supplier?.default_currency ?? ''}
          >
            <option value="">—</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Usual Incoterm" htmlFor="default_incoterm">
          <Select
            id="default_incoterm"
            name="default_incoterm"
            defaultValue={supplier?.default_incoterm ?? ''}
          >
            <option value="">—</option>
            {incoterms.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Usual lead time (days)"
          htmlFor="lead_time_days"
          hint="Typical production time — a starting point, not a promise"
        >
          <Input
            id="lead_time_days"
            name="lead_time_days"
            type="number"
            min="0"
            className="tnum"
            defaultValue={supplier?.lead_time_days ?? ''}
          />
        </Field>

        <Field label="Website" htmlFor="website">
          <Input id="website" name="website" defaultValue={supplier?.website ?? ''} />
        </Field>
      </div>

      <Field
        label="Usual payment terms"
        htmlFor="payment_terms_text"
        hint="Free text — terms differ per supplier and per order, so nothing is assumed"
      >
        <Input
          id="payment_terms_text"
          name="payment_terms_text"
          defaultValue={supplier?.payment_terms_text ?? ''}
          placeholder="30% advance, 70% before dispatch"
        />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" defaultValue={supplier?.notes ?? ''} />
      </Field>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={supplier?.is_active ?? true}
          className="size-4"
        />
        Active
      </label>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : supplier ? 'Save changes' : 'Add supplier'}
        </Button>
        {onDone && (
          <Button type="button" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
