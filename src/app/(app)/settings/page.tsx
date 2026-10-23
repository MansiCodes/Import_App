import { createClient, isAdmin, requireProfile } from '@/lib/supabase/server'
import type { AppSetting, Company, EmailTemplate, PoSequence, Profile } from '@/lib/types'
import { SettingsView } from './settings-view'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const profile = await requireProfile()
  const admin = isAdmin(profile)
  const supabase = await createClient()

  const [companiesResult, settingsResult, sequencesResult, templatesResult] = await Promise.all([
    supabase.from('companies').select('*').order('name'),
    supabase.from('app_settings').select('*').order('key'),
    supabase.from('po_sequences').select('*'),
    supabase.from('email_templates').select('*').order('sort_order').order('name'),
  ])

  const companies = (companiesResult.data ?? []) as Company[]
  const settings = (settingsResult.data ?? []) as AppSetting[]
  const sequences = (sequencesResult.data ?? []) as PoSequence[]
  const templates = (templatesResult.data ?? []) as EmailTemplate[]

  // Only fetched for admins — a non-admin never receives the list of who has
  // access, rather than receiving it and having it hidden by CSS.
  const users = admin
    ? (((
        await supabase
          .from('profiles')
          .select('id, email, full_name, role, is_active')
          .order('is_active', { ascending: false })
          .order('email')
      ).data ?? []) as Profile[])
    : []

  return (
    <SettingsView
      admin={admin}
      users={users}
      currentUserId={profile.id}
      companies={companies}
      sequences={sequences}
      settings={settings}
      templates={templates}
    />
  )
}
