'use client'

import { useActionState, useState } from 'react'
import { Badge, Button, Card, CardHeader, CardTitle, Field, Input } from '@/components/ui'
import type { SupplierContact } from '@/lib/types'
import { removeContact, saveContact, type ActionResult } from '../actions'

function ContactForm({
  supplierId,
  contact,
  onDone,
}: {
  supplierId: string
  contact?: SupplierContact
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveContact(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="space-y-3 border-t bg-surface-sunken p-4">
      <input type="hidden" name="supplier_id" value={supplierId} />
      {contact && <input type="hidden" name="id" value={contact.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="contact-name" required>
          <Input id="contact-name" name="name" required defaultValue={contact?.name} />
        </Field>

        <Field label="Role" htmlFor="contact-role">
          <Input id="contact-role" name="role" defaultValue={contact?.role ?? ''} />
        </Field>

        <Field label="Email" htmlFor="contact-email">
          <Input id="contact-email" name="email" type="email" defaultValue={contact?.email ?? ''} />
        </Field>

        <Field label="Phone" htmlFor="contact-phone">
          <Input id="contact-phone" name="phone" defaultValue={contact?.phone ?? ''} />
        </Field>

        <Field label="WhatsApp" htmlFor="contact-whatsapp">
          <Input id="contact-whatsapp" name="whatsapp" defaultValue={contact?.whatsapp ?? ''} />
        </Field>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="is_primary"
          defaultChecked={contact?.is_primary ?? false}
          className="size-4"
        />
        Primary contact
      </label>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : contact ? 'Save' : 'Add contact'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function RemoveButton({ contact, supplierId }: { contact: SupplierContact; supplierId: string }) {
  const [, formAction, pending] = useActionState<ActionResult | null, FormData>(removeContact, null)
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={contact.id} />
      <input type="hidden" name="supplier_id" value={supplierId} />
      <span className="text-ink-muted">Remove {contact.name}?</span>
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? '…' : 'Yes'}
      </Button>
      <Button type="button" onClick={() => setConfirming(false)}>
        No
      </Button>
    </form>
  )
}

export function ContactsPanel({
  supplierId,
  contacts,
}: {
  supplierId: string
  contacts: SupplierContact[]
}) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contacts</CardTitle>
        <Button onClick={() => setAdding(true)}>Add contact</Button>
      </CardHeader>

      {adding && <ContactForm supplierId={supplierId} onDone={() => setAdding(false)} />}

      {contacts.length === 0 && !adding ? (
        <p className="px-4 py-3 text-ink-muted">No contacts recorded.</p>
      ) : (
        <ul className="divide-y">
          {contacts.map((contact) => (
            <li key={contact.id}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{contact.name}</span>
                    {contact.is_primary && <Badge tone="accent">Primary</Badge>}
                    {contact.role && (
                      <span className="text-ink-muted">{contact.role}</span>
                    )}
                  </div>
                  <p className="text-ink-muted">
                    {[contact.email, contact.phone, contact.whatsapp].filter(Boolean).join(' · ') ||
                      'No contact details'}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => setEditing(editing === contact.id ? null : contact.id)}
                  >
                    {editing === contact.id ? 'Close' : 'Edit'}
                  </Button>
                  <RemoveButton contact={contact} supplierId={supplierId} />
                </div>
              </div>

              {editing === contact.id && (
                <ContactForm
                  supplierId={supplierId}
                  contact={contact}
                  onDone={() => setEditing(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
