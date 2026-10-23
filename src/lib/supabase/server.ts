import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Profile, UserRole } from '@/lib/types'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { getUser } from './auth'

/**
 * Supabase client for Server Components and Server Actions.
 *
 * Sign-in gates ACCESS (src/lib/supabase/auth.ts); this client reads DATA. It
 * uses the SERVICE-ROLE key rather than the signed-in user's token, so the two
 * concerns stay separate and no RLS policy had to be rewritten when logins came
 * back.
 *
 * That is the safer of the two options, not the laxer one. The anon key is
 * public by design — it ships to the browser — so granting it table access
 * would let anyone who reads the page source query and modify the database
 * directly through the REST API, with no UI in the way. Instead RLS stays on,
 * nothing is granted to `anon`, and the service-role key lives only here. The
 * `server-only` import above makes importing this from a Client Component a
 * build error rather than a leaked key.
 *
 * The practical consequence: the app is as open as its URL, and the database is
 * not reachable except through the app.
 */
// Async purely so every existing `await createClient()` call site keeps
// working; there is nothing left to await.
export async function createClient(actorId?: string | null) {
  // `undefined` means "work out who is signed in"; an explicit `null` means
  // "nobody, do not look". getOperator passes null — without that distinction
  // resolving the actor would call this function, which would resolve the
  // actor, for ever.
  const actor = actorId === undefined ? ((await getOperator())?.id ?? null) : actorId

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    )
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Naming the actor lets the audit trigger record WHO did something. The
    // service role has no auth.uid(), so without this the trigger has nothing
    // to go on and records null rather than guessing (migration 015).
    // Set server-side only, alongside a key that never reaches a browser.
    ...(actor ? { global: { headers: { 'x-actor-id': actor } } } : {}),
  })
}

/**
 * The signed-in person's profile.
 *
 * Named `getOperator` because ~40 call sites stamp its id into created_by,
 * verified_by and approved_by, and the name still describes what it is for:
 * the person whose work this is.
 *
 * It used to return "the first active profile" — correct only while exactly one
 * person existed, and silently wrong the moment a second did, attributing one
 * colleague's work to another. It now resolves the actual session.
 *
 * Returns null when nobody is signed in or the account has been deactivated, in
 * which case callers store null rather than inventing an author.
 */
export const getOperator = cache(async function getOperator(): Promise<Profile | null> {
  const user = await getUser()
  if (!user) return null

  const supabase = await createClient(null)

  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  const profile = data as Profile | null

  // A deactivated account is not an author.
  return profile?.is_active ? profile : null
})

/**
 * The signed-in profile, or send them somewhere that explains why not.
 *
 * Deactivation is enforced HERE rather than only at the sign-in gate, because a
 * revoked colleague may still be holding a valid session cookie: the Supabase
 * session outlives the decision to remove their access. Checking the profile on
 * every app render is what makes "revoke" take effect immediately.
 */
export async function requireProfile(): Promise<Profile> {
  const user = await getUser()
  if (!user) redirect('/login')

  const profile = await getOperator()
  if (!profile) redirect('/access-revoked')

  return profile
}

/** Is this profile allowed to manage users and access? */
export function isAdmin(profile: Profile | null): boolean {
  return profile?.role === 'admin' && profile.is_active
}

/**
 * Gate for anything that manages users or access.
 *
 * Called by the server actions themselves, not just the page that renders the
 * form — hiding a button is presentation, and a Server Action is a public HTTP
 * endpoint that anyone signed in can post to directly.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile()
  if (!isAdmin(profile)) redirect('/')

  return profile
}

/**
 * Gate for actions that only some roles may take.
 *
 * Sending a quote request costs money and speaks to an outside company in our
 * name, so it is held to Admin and Import Manager rather than to anyone with a
 * session. Called by the actions themselves, not just the page that draws the
 * button — a Server Action is a public endpoint.
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<Profile> {
  const profile = await requireProfile()
  if (!allowed.includes(profile.role)) redirect('/')

  return profile
}

/** Whether this profile may send quote requests, for drawing the UI. */
export function canSendQuoteRequests(profile: Profile | null): boolean {
  return Boolean(profile?.is_active && ['admin', 'import_manager'].includes(profile.role))
}
