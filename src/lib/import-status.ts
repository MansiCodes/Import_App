import type { BadgeTone } from '@/components/ui'

/**
 * Import lifecycle vocabulary (spec §7).
 *
 * These are the stages an import PASSES THROUGH, not a state machine. Any
 * transition is allowed and logged — a courier import jumps straight from Draft
 * to Arrived, and forcing it through Production would make the app lie.
 */
export const IMPORT_STATUSES = [
  'Draft',
  'PO Stage',
  'Payment Pending',
  'In Production',
  'Goods Ready',
  'Freight Arrangement',
  'Pickup Scheduled',
  'In Transit',
  'Arrived',
  'Customs Clearance',
  'Cleared',
  'Out for Delivery',
  'Delivered',
  'Financial Closure',
  'Closed',
  'On Hold',
  'Cancelled',
] as const

export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/** Statuses that no longer need daily attention. */
export const TERMINAL_STATUSES: readonly ImportStatus[] = ['Closed', 'Cancelled']

export function isActive(status: string): boolean {
  return !TERMINAL_STATUSES.includes(status as ImportStatus)
}

/** Coarse pipeline bucket for the dashboard — not a status machine. */
export type PipelineStage = 'order' | 'make' | 'ship' | 'arrive'

export function pipelineStage(status: string): PipelineStage {
  if (['Draft', 'PO Stage', 'Payment Pending'].includes(status)) return 'order'
  if (['In Production', 'Goods Ready'].includes(status)) return 'make'
  if (['Freight Arrangement', 'Pickup Scheduled', 'In Transit'].includes(status)) {
    return 'ship'
  }
  return 'arrive'
}

const STATUS_TONES: Record<ImportStatus, BadgeTone> = {
  Draft: 'neutral',
  'PO Stage': 'neutral',
  'Payment Pending': 'due',
  'In Production': 'accent',
  'Goods Ready': 'accent',
  'Freight Arrangement': 'upcoming',
  'Pickup Scheduled': 'upcoming',
  'In Transit': 'upcoming',
  Arrived: 'upcoming',
  'Customs Clearance': 'due',
  Cleared: 'accent',
  'Out for Delivery': 'accent',
  Delivered: 'done',
  'Financial Closure': 'accent',
  Closed: 'done',
  'On Hold': 'waiting',
  Cancelled: 'neutral',
}

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status as ImportStatus] ?? 'neutral'
}

/** Who an action is waiting on — drives the "Waiting On Others" bucket. */
export const WAITING_ON_OPTIONS = [
  'Internal',
  'Supplier',
  'CHA',
  'Overseas Agent',
  'Bank',
  'Customs',
  'Transporter',
  'Insurance',
  'Other',
] as const

export type WaitingOn = (typeof WAITING_ON_OPTIONS)[number]

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const
export type Priority = (typeof PRIORITIES)[number]

/** Alert severities produced by v_alerts, in the order the Action Centre shows them. */
export const SEVERITIES = ['critical', 'due_today', 'upcoming'] as const
export type Severity = (typeof SEVERITIES)[number]

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  due_today: 'Due today',
  upcoming: 'Upcoming',
}

export const SEVERITY_TONES: Record<Severity, BadgeTone> = {
  critical: 'critical',
  due_today: 'due',
  upcoming: 'upcoming',
}

export interface Alert {
  import_id: string
  source: string
  source_id: string
  severity: Severity
  title: string
  due_date: string | null
  waiting_on: string
  priority: string
}

export interface ImportSummary {
  id: string
  import_no: string
  company_id: string
  supplier_id: string | null
  status: ImportStatus
  title: string | null
  po_number: string | null
  po_date: string | null
  pi_number: string | null
  pi_date: string | null
  currency: string
  pi_value: string | null
  po_value: string | null
  incoterm: string | null
  payment_terms_text: string | null
  origin_country: string | null
  expected_goods_ready: string | null
  revised_goods_ready: string | null
  actual_goods_ready: string | null
  next_action_title: string | null
  next_action_due: string | null
  next_action_priority: Priority
  waiting_on: WaitingOn | null
  last_contact_at: string | null
  last_response_at: string | null
  next_followup_at: string | null
  drive_folder_url: string | null
  notes: string | null
  closed_at: string | null
  is_archived: boolean
  created_at: string
  updated_at: string
  company_name: string
  company_code: string
  supplier_name: string | null
  supplier_country: string | null
  cha_name: string | null
  critical_count: number
  due_today_count: number
  earliest_due: string | null
}

/**
 * How far past due, in whole days. Negative means still ahead.
 * Compared date-only so a time component cannot make "today" read as overdue.
 */
export function daysOverdue(dueDate: string | null, today = new Date()): number | null {
  if (!dueDate) return null

  const due = new Date(`${dueDate}T00:00:00`)
  const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  return Math.round((ref.getTime() - due.getTime()) / 86_400_000)
}

/** Human phrasing for a due date, e.g. "4 days overdue" / "Due today". */
export function dueLabel(dueDate: string | null, today = new Date()): string {
  const overdue = daysOverdue(dueDate, today)
  if (overdue === null) return 'No date'
  if (overdue === 0) return 'Due today'
  if (overdue === 1) return '1 day overdue'
  if (overdue > 1) return `${overdue} days overdue`
  if (overdue === -1) return 'Due tomorrow'
  return `Due in ${Math.abs(overdue)} days`
}
