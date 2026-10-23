import { ForgotPasswordForm } from './forgot-form'

export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-8 shadow-sm">
        <ForgotPasswordForm />
      </div>
    </main>
  )
}
