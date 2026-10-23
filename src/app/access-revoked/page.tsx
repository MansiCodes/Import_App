/**
 * Where a signed-in person lands once their access has been revoked.
 *
 * A Supabase session outlives the decision to remove someone, so a revoked
 * colleague can still be holding a valid cookie. Rather than bounce them to the
 * login page — where they would sign in successfully and bounce straight back —
 * say plainly what has happened.
 */
export default function AccessRevokedPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-sunken px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface-raised p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">No access to this app</h1>
        <p className="mt-2 text-ink-muted">
          Your sign-in worked, but this account does not currently have access to the Import
          Control Tower. An administrator can restore it under Settings.
        </p>

        <form action="/auth/signout" method="post" className="mt-6">
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  )
}
