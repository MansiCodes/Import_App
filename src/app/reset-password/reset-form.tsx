'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { AUTH_MESSAGES } from '@/lib/auth/credentials'
import { resetPassword } from './actions'
import type { ResetCompleteResult } from '@/lib/auth/reset'

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetCompleteResult | null, FormData>(
    resetPassword,
    null,
  )

  if (!token) {
    return (
      <>
        <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>
        <p className="mt-4 rounded-lg bg-critical-soft px-3 py-2 text-critical">
          {AUTH_MESSAGES.resetExpired}
        </p>
        <p className="mt-4 text-center">
          <Link href="/forgot-password" className="text-accent hover:underline">
            Request a new link
          </Link>
        </p>
      </>
    )
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Reset password</h1>
        <p className="mt-1 text-ink-muted">Choose a new password for your account.</p>
      </div>

      <form action={formAction} className="space-y-4" noValidate>
        <input type="hidden" name="token" value={token} />

        <div>
          <label htmlFor="password" className="mb-1.5 block font-medium">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            className="w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 outline-none focus:border-accent"
          />
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1.5 block font-medium">
            Confirm password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            className="w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 outline-none focus:border-accent"
          />
        </div>

        {state?.error && (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </>
  )
}
