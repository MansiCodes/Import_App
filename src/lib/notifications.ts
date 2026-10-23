import type { Severity } from '@/lib/import-status'

export interface NotificationItem {
  key: string
  importId: string | null
  importNo: string | null
  severity: Severity
  title: string
  dueDate: string | null
  waitingOn: string | null
  href: string
}

/** Stable key for alert rows (view has no id). Safe for server + client. */
export function alertKey(row: {
  import_id: string | null
  source: string
  source_id: string
  severity: string
  title: string
}): string {
  return [row.import_id ?? 'none', row.source, row.source_id, row.severity, row.title].join(':')
}

export function notificationHref(importId: string | null, source: string): string {
  if (!importId) return source === 'task' ? '/tasks' : '/'
  return `/imports/${importId}`
}
