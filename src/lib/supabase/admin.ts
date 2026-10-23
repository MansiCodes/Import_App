import 'server-only'

import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client — bypasses RLS entirely.
 *
 * Reserved for administrative work that has no user session: seeding, backfills
 * and maintenance scripts. Application request paths must use
 * `@/lib/supabase/server` so queries run as the signed-in user with RLS applied.
 *
 * The `server-only` import above makes importing this from a Client Component a
 * build error rather than a leaked key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error(
      'Admin Supabase client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
