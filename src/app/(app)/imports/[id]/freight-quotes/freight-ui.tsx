import { Badge } from '@/components/ui'
import type { BadgeTone } from '@/components/ui'

/**
 * Shared vocabulary for the freight quote screens.
 *
 * The database statuses are unchanged — these are labels over them. `Sent`
 * reads two ways on purpose. When the app delivered the message itself it says
 * "Sent", because it knows that. When the operator copied the link and pasted
 * it by hand it says "Link copied", because that is all the app can know —
 * claiming delivery on the strength of a clipboard write would be a guess.
 */
const RECIPIENT_LABELS: Record<string, string> = {
  Pending: 'Not sent',
  Sent: 'Link copied',
  Viewed: 'Viewed',
  Submitted: 'Submitted',
  Revised: 'Revised',
  Declined: 'Declined',
  Revoked: 'Revoked',
}

const RECIPIENT_TONES: Record<string, BadgeTone> = {
  Pending: 'neutral',
  Sent: 'accent',
  Viewed: 'due',
  Submitted: 'done',
  Revised: 'done',
  Declined: 'neutral',
  Revoked: 'critical',
}

export function RecipientChip({
  status,
  /** True only when the app itself delivered the message to the provider. */
  autoSent = false,
}: {
  status: string
  autoSent?: boolean
}) {
  const label =
    status === 'Sent' && autoSent ? 'Sent' : (RECIPIENT_LABELS[status] ?? status)

  return <Badge tone={RECIPIENT_TONES[status] ?? 'neutral'}>{label}</Badge>
}

export function recipientLabel(status: string): string {
  return RECIPIENT_LABELS[status] ?? status
}

const REQUEST_TONES: Record<string, BadgeTone> = {
  Draft: 'neutral',
  Open: 'due',
  'Partially Submitted': 'accent',
  Complete: 'done',
  Closed: 'neutral',
  Cancelled: 'neutral',
}

export function RequestChip({ status }: { status: string }) {
  return <Badge tone={REQUEST_TONES[status] ?? 'neutral'}>{status}</Badge>
}

/**
 * A selectable option that reads as a decision rather than a form field.
 *
 * Used for mode and for choosing recipients: with two or three choices a set of
 * visible options is faster and clearer than a dropdown that hides them.
 */
export function Choice({
  selected,
  onClick,
  children,
  className = '',
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? 'border-accent bg-accent-soft font-medium text-accent'
          : 'border-border-strong hover:border-accent hover:bg-surface-sunken'
      } ${className}`}
    >
      {children}
    </button>
  )
}
