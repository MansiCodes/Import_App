import { AppShell } from '@/components/nav/app-shell'
import { SetupRequired, isSupabaseConfigured } from '@/components/setup-required'
import { createClient, requireProfile } from '@/lib/supabase/server'
import type { Severity } from '@/lib/import-status'
import {
  alertKey,
  notificationHref,
  type NotificationItem,
} from '@/lib/notifications'

/**
 * Read at request time. The pages query live data and the alert engine is
 * evaluated on every load, so nothing here can be prerendered at build time.
 */
export const dynamic = 'force-dynamic'

interface AlertRow {
  import_id: string | null
  source: string
  source_id: string
  severity: Severity
  title: string
  due_date: string | null
  waiting_on: string | null
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // A fresh clone has no Supabase project yet — explain the next step instead
  // of throwing a connection error.
  if (!isSupabaseConfigured()) return <SetupRequired />

  // Profile gate + shell data in parallel.
  const [profile, supabase] = await Promise.all([requireProfile(), createClient()])

  const [inboxResult, alertsResult] = await Promise.all([
    supabase
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'in_review']),
    supabase
      .from('v_alerts')
      .select('import_id, source, source_id, severity, title, due_date, waiting_on')
      .limit(40),
  ])

  const alertRows = (alertsResult.data ?? []) as AlertRow[]
  const importIds = [
    ...new Set(alertRows.map((row) => row.import_id).filter((id): id is string => Boolean(id))),
  ]

  const importNos = new Map<string, string>()
  if (importIds.length > 0) {
    const { data: imports } = await supabase
      .from('imports')
      .select('id, import_no')
      .in('id', importIds)
    for (const row of imports ?? []) {
      importNos.set(row.id, row.import_no)
    }
  }

  const notifications: NotificationItem[] = alertRows.map((row) => ({
    key: alertKey(row),
    importId: row.import_id,
    importNo: row.import_id ? (importNos.get(row.import_id) ?? null) : null,
    severity: row.severity,
    title: row.title,
    dueDate: row.due_date,
    waitingOn: row.waiting_on,
    href: notificationHref(row.import_id, row.source),
  }))

  return (
    <AppShell
      profile={profile}
      inboxCount={inboxResult.count ?? 0}
      notifications={notifications}
    >
      {children}
    </AppShell>
  )
}
