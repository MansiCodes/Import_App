import Link from 'next/link'

const REASONS: Record<string, string> = {
  incomplete:
    'That link did not carry a sign-in token. If it was copied by hand, some of it was probably lost — open the link from the email directly.',
  expired: 'That link has expired. Magic links are short-lived — request a fresh one.',
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams

  const message =
    (reason && REASONS[reason]) ??
    reason ??
    'The link has expired or was already used. Each link works once.'

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Sign-in link didn&apos;t work</h1>
        <p className="mt-2 text-ink-muted">{message}</p>
        <Link
          href="/login"
          className="mt-6 inline-block rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  )
}
