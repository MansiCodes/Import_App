import { Card } from '@/components/ui'

/**
 * Shown when Supabase credentials are absent.
 *
 * The Supabase project has to be created in the owner's own account, so a fresh
 * clone genuinely cannot connect until that happens. Explaining the next step
 * beats an unhandled exception.
 */
export function SetupRequired() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Finish setting up</h1>
      <p className="mt-2 text-ink-muted">
        The app is built and ready, but it has no database to talk to yet.
      </p>

      <Card className="mt-6 p-6">
        <p className="mb-4 font-medium">One token, and the rest is scripted.</p>

        <ol className="list-decimal space-y-4 pl-5">
          <li>
            Generate an access token at{' '}
            <a
              href="https://supabase.com/dashboard/account/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              supabase.com/dashboard/account/tokens
            </a>
            .
          </li>
          <li>
            Copy <span className="font-mono">.env.local.example</span> to{' '}
            <span className="font-mono">.env.local</span> and add the token as{' '}
            <span className="font-mono">SUPABASE_ACCESS_TOKEN</span>.
          </li>
          <li>
            Run{' '}
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono">
              npm run db:setup
            </span>
            . That creates the project, retrieves the keys, writes them here, and applies the
            schema.
          </li>
          <li>
            Set <span className="font-mono">INITIAL_ADMIN_EMAIL</span> and{' '}
            <span className="font-mono">INITIAL_ADMIN_PASSWORD</span>, run{' '}
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono">npm run auth:seed</span>
            , restart the dev server, and log in with that email and password.
          </li>
        </ol>

        <p className="mt-6 text-ink-faint">
          Prefer to do it by hand? Create the project yourself, fill in the four Supabase values in{' '}
          <span className="font-mono">.env.local</span>, and run{' '}
          <span className="font-mono">npm run db:apply</span>. Use the direct database host (
          <span className="font-mono">db.&lt;ref&gt;.supabase.co:5432</span>), not the pooler.
        </p>
      </Card>
    </main>
  )
}

/** True when both public Supabase variables are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
