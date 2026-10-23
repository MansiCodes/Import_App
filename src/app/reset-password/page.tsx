import Link from 'next/link'
import { AUTH_MESSAGES } from '@/lib/auth/credentials'
import { isResetToken } from '@/lib/auth/reset-token'
import { ResetPasswordForm } from './reset-form'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const safeToken = token && isResetToken(token) ? token : ''

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-8 shadow-sm">
        {safeToken ? (
          <ResetPasswordForm token={safeToken} />
        ) : (
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
        )}
      </div>
    </main>
  )
}
