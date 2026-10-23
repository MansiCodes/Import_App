'use client'

import { useActionState, useState } from 'react'
import { Badge, Button, Card, CardHeader, CardTitle, Field, Input, Select, Textarea, VerificationBadge } from '@/components/ui'
import type { SupplierBankAccount } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { changeBankAccount, verifyBankAccount, type ActionResult } from '../actions'

function VerifyControls({ account, supplierId }: { account: SupplierBankAccount; supplierId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    verifyBankAccount,
    null,
  )
  const [decision, setDecision] = useState<'verified' | 'rejected'>('verified')

  return (
    <form action={formAction} className="mt-3 border-t pt-3">
      <input type="hidden" name="id" value={account.id} />
      <input type="hidden" name="supplier_id" value={supplierId} />
      <input type="hidden" name="decision" value={decision} />

      <p className="mb-2 text-ink-muted">
        Check these against the supplier&apos;s signed PI or a call to a known contact — not
        against the email that sent them.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Input name="remarks" placeholder="How did you verify? (optional)" className="min-w-56 flex-1" />

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

      {state?.error && <p className="mt-2 text-critical">{state.error}</p>}
    </form>
  )
}

function AccountCard({
  account,
  supplierId,
}: {
  account: SupplierBankAccount
  supplierId: string
}) {
  const rows: Array<[string, string | null]> = [
    ['Beneficiary', account.beneficiary_name],
    ['Bank', account.bank_name],
    ['Account no', account.account_no],
    ['IBAN', account.iban],
    ['SWIFT', account.swift],
    ['Intermediary', account.intermediary_bank],
    ['Currency', account.currency],
  ]

  return (
    <div
      className={`rounded-lg border p-3 ${
        account.is_current
          ? account.verification_status === 'received'
            ? 'border-critical bg-critical-soft'
            : 'border-border-strong'
          : 'border-dashed opacity-70'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {account.is_current ? (
          <Badge tone="accent">Current</Badge>
        ) : (
          <Badge>Superseded</Badge>
        )}
        <VerificationBadge status={account.verification_status} />
        <span className="text-ink-faint">
          Added {formatDate(account.created_at)}
        </span>
      </div>

      <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-mono">{value}</dd>
            </div>
          ))}
      </dl>

      {account.source_note && (
        <p className="mt-2 text-ink-muted">Source: {account.source_note}</p>
      )}
      {account.verification_remarks && (
        <p className="mt-1 text-ink-muted">
          Verification: {account.verification_remarks}
        </p>
      )}

      {account.is_current && account.verification_status === 'received' && (
        <VerifyControls account={account} supplierId={supplierId} />
      )}
    </div>
  )
}

function ChangeForm({
  supplierId,
  currencies,
  hasExisting,
  onDone,
}: {
  supplierId: string
  currencies: string[]
  hasExisting: boolean
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await changeBankAccount(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  const [confirmed, setConfirmed] = useState(false)

  return (
    <form action={formAction} className="space-y-4 border-t bg-surface-sunken p-4">
      <input type="hidden" name="supplier_id" value={supplierId} />

      {hasExisting && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
          <strong>Changing bank details is how import fraud succeeds.</strong> A request to change
          them — however convincing the email — should be confirmed by phone with a contact you
          already know, never a number from the same message. The existing details are kept, and
          these new ones start unverified.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Beneficiary name" htmlFor="beneficiary_name" required>
          <Input id="beneficiary_name" name="beneficiary_name" required />
        </Field>

        <Field label="Bank name" htmlFor="bank_name" required>
          <Input id="bank_name" name="bank_name" required />
        </Field>

        <Field label="Currency" htmlFor="bank_currency">
          <Select id="bank_currency" name="currency">
            <option value="">—</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Account number" htmlFor="account_no" hint="Account number or IBAN required">
          <Input id="account_no" name="account_no" className="font-mono" />
        </Field>

        <Field label="IBAN" htmlFor="iban">
          <Input id="iban" name="iban" className="font-mono" />
        </Field>

        <Field label="SWIFT / BIC" htmlFor="swift">
          <Input id="swift" name="swift" className="font-mono" />
        </Field>

        <Field label="Intermediary bank" htmlFor="intermediary_bank">
          <Input id="intermediary_bank" name="intermediary_bank" />
        </Field>

        <Field label="Intermediary SWIFT" htmlFor="intermediary_swift">
          <Input id="intermediary_swift" name="intermediary_swift" className="font-mono" />
        </Field>
      </div>

      <Field label="Bank address" htmlFor="bank_address">
        <Textarea id="bank_address" name="bank_address" />
      </Field>

      <Field
        label="Where did these come from?"
        htmlFor="source_note"
        hint="e.g. Signed PI dated 12 May, confirmed by phone with Mr Lee"
      >
        <Input id="source_note" name="source_note" />
      </Field>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 size-4"
        />
        <span>
          I have checked these details against a trusted source, not only the message that supplied
          them.
        </span>
      </label>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending || !confirmed}>
          {pending ? 'Saving…' : hasExisting ? 'Replace bank details' : 'Add bank details'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function BankPanel({
  supplierId,
  accounts,
  currencies,
}: {
  supplierId: string
  accounts: SupplierBankAccount[]
  currencies: string[]
}) {
  const [changing, setChanging] = useState(false)

  const current = accounts.filter((a) => a.is_current)
  const history = accounts.filter((a) => !a.is_current)

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Bank details</CardTitle>
          <p className="text-ink-muted">
            Changes never overwrite — the previous details stay on record.
          </p>
        </div>
        <Button onClick={() => setChanging(true)}>
          {current.length > 0 ? 'Change details' : 'Add details'}
        </Button>
      </CardHeader>

      {changing && (
        <ChangeForm
          supplierId={supplierId}
          currencies={currencies}
          hasExisting={current.length > 0}
          onDone={() => setChanging(false)}
        />
      )}

      <div className="space-y-3 p-4">
        {current.length === 0 && !changing && (
          <p className="text-ink-muted">
            No bank details recorded. Add them before scheduling a payment.
          </p>
        )}

        {current.map((account) => (
          <AccountCard key={account.id} account={account} supplierId={supplierId} />
        ))}

        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer text-ink-muted">
              Previous details ({history.length})
            </summary>
            <div className="mt-2 space-y-2">
              {history.map((account) => (
                <AccountCard key={account.id} account={account} supplierId={supplierId} />
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  )
}
