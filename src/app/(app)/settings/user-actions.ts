'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { emailSchema, passwordSchema, redactSecret } from '@/lib/auth/credentials'
import { findAuthUserByEmail } from '@/lib/auth/accounts'
import { createClient, requireAdmin } from '@/lib/supabase/server'
import { USER_ROLES } from '@/lib/types'

export interface ActionResult {
  ok: boolean
  error?: string
  notice?: string
}

/**
 * User and access management.
 *
 * Every action here calls requireAdmin() FIRST. A Server Action is a public
 * HTTP endpoint — anyone with a session can post to it — so hiding the panel
 * from non-admins is presentation, not protection.
 *
 * The service-role key stays on the server: these run only here, and nothing in
 * this file is ever imported by a client component.
 */

/** Named actor on the client, so the audit trigger records who did this. */
async function adminClient() {
  const admin = await requireAdmin()
  return { admin, supabase: await createClient(admin.id) }
}

const addSchema = z.object({
  email: emailSchema,
  full_name: z.string().trim().max(200).nullable(),
  role: z.enum(USER_ROLES),
  password: passwordSchema,
})

/**
 * Give someone their own account.
 *
 * Creates a distinct Supabase auth user per address — access is never granted
 * by sharing an existing login. The password is hashed by Supabase Auth and is
 * never stored or returned by this action. Re-adding a revoked person sets a
 * new password and restores the same profile, so their history stays put.
 */
export async function addUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { supabase } = await adminClient()

  const passwordRaw = formData.get('password')
  const password = typeof passwordRaw === 'string' ? passwordRaw : ''

  const parsed = addSchema.safeParse({
    email: formData.get('email'),
    full_name: (formData.get('full_name') as string)?.trim() || null,
    role: formData.get('role'),
    password,
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { email, full_name, role } = parsed.data

  let found
  try {
    found = await findAuthUserByEmail(supabase, email)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save that user.'
    return { ok: false, error: redactSecret(message, password) }
  }

  let userId = found?.id

  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: full_name ? { full_name } : undefined,
      app_metadata: { password_login: true },
    })
    if (error) return { ok: false, error: redactSecret(error.message, password) }
    userId = data.user.id
  } else {
    const { data: current, error: readError } = await supabase.auth.admin.getUserById(userId)
    if (readError || !current.user) {
      return { ok: false, error: redactSecret(readError?.message ?? 'Could not save that user.', password) }
    }

    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      app_metadata: { ...(current.user.app_metadata ?? {}), password_login: true },
    })
    if (error) return { ok: false, error: redactSecret(error.message, password) }
  }

  // The profile is what grants access; the auth user only proves the address.
  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      email,
      full_name: full_name ?? email.split('@')[0],
      role,
      is_active: true,
    },
    { onConflict: 'id' },
  )

  if (profileError) return { ok: false, error: redactSecret(profileError.message, password) }

  revalidatePath('/settings')

  return { ok: true, notice: `${email} can sign in with the password you set.` }
}

const roleSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(USER_ROLES),
})

export async function changeRole(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { admin, supabase } = await adminClient()

  const parsed = roleSchema.safeParse({ id: formData.get('id'), role: formData.get('role') })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  // Demoting yourself while you are the last admin locks everyone out of this
  // screen, and only a database console could undo it.
  if (parsed.data.id === admin.id && parsed.data.role !== 'admin') {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true)

    if ((count ?? 0) <= 1) {
      return { ok: false, error: 'You are the only admin. Make someone else an admin first.' }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: parsed.data.role })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings')
  return { ok: true }
}

const activeSchema = z.object({
  id: z.string().uuid(),
  is_active: z.enum(['true', 'false']),
})

/**
 * Revoke or restore access.
 *
 * Deactivates the PROFILE and never deletes anything. The auth user, the
 * profile row, and every audit and activity record referencing it stay exactly
 * where they are — `created_by` and `verified_by` on past work still resolve to
 * a real person. Revoking removes the ability to act, not the record of having
 * acted.
 */
export async function setUserActive(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { admin, supabase } = await adminClient()

  const parsed = activeSchema.safeParse({
    id: formData.get('id'),
    is_active: formData.get('is_active'),
  })
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const isActive = parsed.data.is_active === 'true'

  if (!isActive && parsed.data.id === admin.id) {
    return { ok: false, error: 'You cannot revoke your own access.' }
  }

  if (!isActive) {
    const { count } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true)

    const { data: target } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', parsed.data.id)
      .maybeSingle()

    if (target?.role === 'admin' && (count ?? 0) <= 1) {
      return { ok: false, error: 'That is the last active admin. Promote someone else first.' }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/settings')
  return { ok: true, notice: isActive ? 'Access restored.' : 'Access revoked.' }
}
