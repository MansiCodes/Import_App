import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>
}) {
  const { reset } = await searchParams

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-8 shadow-sm">
        <LoginForm resetSuccess={reset === 'success'} />
      </div>
    </main>
  )
}
