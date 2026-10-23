'use client'

import { useActionState, useState } from 'react'
import { Plus } from 'lucide-react'
import { Badge, Button, Field, Input, Select } from '@/components/ui'
import { ROLE_DESCRIPTIONS, ROLE_LABELS, USER_ROLES, type Profile, type UserRole } from '@/lib/types'
import { addUser, changeRole, setUserActive, type ActionResult } from './user-actions'

function Result({ state }: { state: ActionResult | null }) {
  if (!state) return null

  if (state.error) {
    return <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>
  }
  if (state.notice) {
    return <p className="rounded-lg bg-done-soft px-3 py-2 text-sm text-done">{state.notice}</p>
  }
  return null
}

function AddUserForm({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addUser(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  const [role, setRole] = useState<UserRole>('viewer')

  return (
    <form action={formAction} className="space-y-3 border-b bg-surface-sunken/50 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email address" htmlFor="user-email" required>
          <Input id="user-email" name="email" type="email" required placeholder="name@company.com" />
        </Field>

        <Field label="Name" htmlFor="user-name">
          <Input id="user-name" name="full_name" placeholder="Optional" />
        </Field>

        <Field
          label="Temporary password"
          htmlFor="user-password"
          required
          hint="At least 8 characters. Share it with them securely — it is not emailed."
        >
          <Input
            id="user-password"
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
          />
        </Field>

        <Field label="Role" htmlFor="user-role">
          <Select
            id="user-role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-[13px] text-ink-muted">{ROLE_DESCRIPTIONS[role]}</p>

      <Result state={state} />

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add user'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>

      <p className="text-[12px] text-ink-faint">
        They get their own login. They can change the password later from Forgot password.
      </p>
    </form>
  )
}

function RoleSelect({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    changeRole,
    null,
  )

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={user.id} />
      <Select
        name="role"
        defaultValue={user.role}
        disabled={pending || !user.is_active}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="w-auto"
        aria-label={`Role for ${user.email}`}
      >
        {USER_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </Select>
      {isSelf && <span className="text-[12px] text-ink-faint">you</span>}
      {state?.error && <span className="text-[12px] text-critical">{state.error}</span>}
    </form>
  )
}

function AccessButton({ user, isSelf }: { user: Profile; isSelf: boolean }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setUserActive,
    null,
  )
  const [confirming, setConfirming] = useState(false)

  if (user.is_active && isSelf) {
    return <span className="text-[12px] text-ink-faint">—</span>
  }

  if (!user.is_active) {
    return (
      <form action={formAction}>
        <input type="hidden" name="id" value={user.id} />
        <input type="hidden" name="is_active" value="true" />
        <Button type="submit" disabled={pending}>
          {pending ? '…' : 'Restore access'}
        </Button>
        {state?.error && <span className="ml-2 text-[12px] text-critical">{state.error}</span>}
      </form>
    )
  }

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Revoke access
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={user.id} />
      <input type="hidden" name="is_active" value="false" />
      <span className="text-[13px] text-ink-muted">Revoke {user.email}?</span>
      <Button type="submit" variant="danger" disabled={pending}>
        Yes, revoke
      </Button>
      <Button type="button" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      {state?.error && <span className="text-[12px] text-critical">{state.error}</span>}
    </form>
  )
}

export function UsersPanel({ users, currentUserId }: { users: Profile[]; currentUserId: string }) {
  const [adding, setAdding] = useState(false)

  const active = users.filter((u) => u.is_active)
  const revoked = users.filter((u) => !u.is_active)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">Users &amp; Access</p>
          <p className="text-[12px] text-ink-muted">
            {active.length} with access
            {revoked.length > 0 && `, ${revoked.length} revoked`}. Only admins can see this.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden />
          Add user
        </Button>
      </div>

      {adding && <AddUserForm onDone={() => setAdding(false)} />}

      <ul className="divide-y">
        {[...active, ...revoked].map((user) => (
          <li
            key={user.id}
            className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 ${
              user.is_active ? 'hover:bg-surface-sunken/40' : 'bg-surface-sunken/50'
            }`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold text-ink">
                  {user.full_name || user.email}
                </span>
                {!user.is_active && <Badge tone="critical">Access revoked</Badge>}
              </div>
              <p className="text-[13px] text-ink-muted">{user.email}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <RoleSelect user={user} isSelf={user.id === currentUserId} />
              <AccessButton user={user} isSelf={user.id === currentUserId} />
            </div>
          </li>
        ))}
      </ul>

      <p className="border-t px-4 py-3 text-[12px] text-ink-faint">
        Revoking access never deletes anything. Past work stays on record — they simply cannot act
        again.
      </p>
    </div>
  )
}
