'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { requestPasswordReset } from './actions'
import type { ResetRequestResult } from '@/lib/auth/reset'

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<ResetRequestResult | null, FormData>(
    requestPasswordReset,
    null,
  )

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Forgot password</h1>
        <p className="mt-1 text-ink-muted">
          Enter your email and we will send a reset link if an account exists.
        </p>
      </div>

      {state?.ok ? (
        <p className="rounded-lg bg-done-soft px-3 py-2 text-done">{state.message}</p>
      ) : (
        <form action={formAction} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1.5 block font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
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
            {pending ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="mt-4 text-center">
        <Link href="/login" className="text-accent hover:underline">
          Back to login
        </Link>
      </p>
    </>
  )
}
