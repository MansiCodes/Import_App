'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser client — used for email and password sign-in.
 *
 * It carries the anon key, which is public by design and ships to the browser.
 * That key has no table grants (see migration 012), so it cannot read or write
 * application data even though anyone can read it out of the page source. All
 * data access happens server-side with the service-role key.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local',
    )
  }

  return createBrowserClient(url, anonKey)
}
