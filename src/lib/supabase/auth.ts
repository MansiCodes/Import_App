import 'server-only'

import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'

/**
 * The sign-in gate.
 *
 * Deliberately separate from `createClient()` in server.ts, because the two do
 * different jobs and use different keys:
 *
 *   auth.ts (here) — reads the SESSION, using the anon key and the request's
 *   cookies. It answers "is someone signed in", nothing more.
 *
 *   server.ts — reads DATA, using the service-role key. It answers "what does
 *   the database say" and is only reachable once this file has said yes.
 *
 * Keeping data access on the service-role key means the gate is the only thing
 * that changed when sign-in was reinstated: no RLS policies were rewritten and
 * no query in the app had to be touched.
 */
export async function createAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Supabase is not configured.')
  }

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Server Components cannot set cookies. Harmless: the proxy refreshes
          // the session on every request, so the cookie is already current.
        }
      },
    },
  })
}

/**
 * The signed-in user, or null.
 *
 * Uses getUser() rather than getSession(): getSession() trusts whatever is in
 * the cookie, while getUser() verifies it with the auth server. For a gate, the
 * unverified answer is worthless.
 */
export const getUser = cache(async function getUser(): Promise<User | null> {
  const supabase = await createAuthClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user
})

/**
 * Defence in depth. The proxy already blocks unauthenticated requests; this
 * makes a page fail closed if it is ever reached another way — a matcher typo,
 * a route added outside the matched paths, a future refactor.
 */
export async function requireUser(): Promise<User> {
  const user = await getUser()
  if (!user) redirect('/login')

  return user
}
