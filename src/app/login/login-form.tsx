'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  AUTH_MESSAGES,
  emailSchema,
  loginFailureMessage,
  passwordSchema,
  safeNextPath,
} from '@/lib/auth/credentials'

export function LoginForm({ resetSuccess }: { resetSuccess: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')

    const parsedEmail = emailSchema.safeParse(email)
    const parsedPassword = passwordSchema.safeParse(password)
    if (!parsedEmail.success || !parsedPassword.success) {
      setStatus('error')
      setMessage(AUTH_MESSAGES.invalidLogin)
      return
    }

    setStatus('submitting')

    try {
      const supabase = createClient()
      const next = safeNextPath(new URLSearchParams(window.location.search).get('next'))
      const { error } = await supabase.auth.signInWithPassword({
        email: parsedEmail.data,
        password: parsedPassword.data,
      })

      if (error) {
        setStatus('error')
        setMessage(loginFailureMessage(error))
        return
      }

      window.location.assign(next)
    } catch {
      setStatus('error')
      setMessage(AUTH_MESSAGES.loginUnavailable)
    }
  }

  return (
    <>
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Import Control Tower</h1>
        <p className="mt-1 text-ink-muted">Log in to continue.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 outline-none focus:border-accent"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-border-strong bg-surface-raised px-3 py-2 outline-none focus:border-accent"
          />
        </div>

        {resetSuccess && status !== 'error' && (
          <p className="rounded-lg bg-done-soft px-3 py-2 text-done">{AUTH_MESSAGES.resetSuccess}</p>
        )}

        {status === 'error' && (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">{message}</p>
        )}

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="w-full rounded-lg bg-accent px-3 py-2 font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
        >
          {status === 'submitting' ? 'Logging in…' : 'Login'}
        </button>
      </form>

      <p className="mt-4 text-center">
        <Link href="/forgot-password" className="text-accent hover:underline">
          Forgot password?
        </Link>
      </p>
    </>
  )
}
