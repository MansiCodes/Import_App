import 'server-only'

import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Auth users are paged. A single listUsers() call only returns the first page,
 * which would miss someone and then create a duplicate.
 */
export async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  const target = email.trim().toLowerCase()

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)

    const found = data.users.find((user) => user.email?.toLowerCase() === target)
    if (found) return found
    if (data.users.length < 200) return null
  }

  return null
}
