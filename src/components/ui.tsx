import { cn } from '@/lib/utils'

/**
 * Shared UI primitives.
 *
 * Deliberately hand-rolled and small — spec §49 warns against pulling in
 * libraries without reason, and this app needs perhaps a dozen elements.
 */

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-surface-raised shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 px-5 py-4',
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 className={cn('text-[15px] font-semibold text-ink', className)} {...props} />
}

/** Overview-style section used inside import tabs. */
export function PanelSection({
  title,
  description,
  icon,
  iconTone = 'accent',
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  iconTone?: 'accent' | 'done' | 'due' | 'upcoming' | 'critical' | 'neutral'
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
  bodyClassName?: string
}) {
  const tones: Record<string, string> = {
    accent: 'bg-accent-soft text-accent',
    done: 'bg-done-soft text-done',
    due: 'bg-due-soft text-due',
    upcoming: 'bg-upcoming-soft text-upcoming',
    critical: 'bg-critical-soft text-critical',
    neutral: 'bg-surface-sunken text-ink-muted',
  }

  return (
    <section
      className={cn(
        'rounded-2xl border border-border bg-surface-raised shadow-sm',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl',
                tones[iconTone],
              )}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0 pt-0.5">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {description && (
              <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children != null && (
        <div className={cn('px-5 pt-5 pb-5 sm:px-6', bodyClassName)}>{children}</div>
      )}
    </section>
  )
}

export function Fact({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-[12px] font-medium text-ink-faint">{label}</dt>
      <dd className="mt-1 text-[14px] font-medium text-ink">{children}</dd>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary:
    'bg-accent text-white hover:bg-accent-hover disabled:opacity-50',
  secondary:
    'border border-border-strong bg-surface-raised hover:bg-surface-sunken disabled:opacity-50',
  ghost: 'hover:bg-surface-sunken disabled:opacity-50',
  danger: 'bg-critical text-white hover:brightness-95 disabled:opacity-50',
} as const

export function Button({
  className,
  variant = 'secondary',
  ...props
}: React.ComponentProps<'button'> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}

const BADGE_TONES = {
  neutral: 'bg-surface-sunken text-ink-muted',
  critical: 'bg-critical-soft text-critical',
  due: 'bg-due-soft text-due',
  upcoming: 'bg-upcoming-soft text-upcoming',
  waiting: 'bg-waiting-soft text-waiting',
  done: 'bg-done-soft text-done',
  accent: 'bg-accent-soft text-accent',
} as const

export type BadgeTone = keyof typeof BADGE_TONES

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: React.ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  required,
  className,
  children,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-semibold text-ink">
        {label}
        {required && <span className="ml-0.5 text-critical">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-[12px] leading-snug text-ink-faint">{hint}</p>}
      {error && <p className="mt-1.5 text-[12px] text-critical">{error}</p>}
    </div>
  )
}

/** Standard 3-column form grid used across import tabs. */
export function FormGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </div>
  )
}

const INPUT_CLASS =
  'w-full rounded-lg border border-border bg-surface-raised px-3.5 py-2.5 text-[14px] text-ink shadow-none outline-none transition placeholder:text-ink-faint hover:border-border-strong focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-faint'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(INPUT_CLASS, className)} {...props} />
}

export function Select({ className, style, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        INPUT_CLASS,
        'cursor-pointer appearance-none bg-[length:16px] bg-[position:right_12px_center] bg-no-repeat pr-10',
        className,
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
        ...style,
      }}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea className={cn(INPUT_CLASS, 'min-h-[88px] resize-y', className)} {...props} />
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface-sunken/40 px-6 py-12 text-center">
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-md text-[13px] text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * The distinction the whole app is built around (spec §50): something that has
 * ARRIVED is not something that has been CHECKED. Rendered identically
 * everywhere so the difference is never ambiguous.
 */
export function VerificationBadge({
  status,
}: {
  status: 'pending' | 'received' | 'verified' | 'rejected' | 'not_applicable' | null
}) {
  switch (status) {
    case 'verified':
      return <Badge tone="done">✓ Verified</Badge>
    case 'received':
      return <Badge tone="due">Received, not verified</Badge>
    case 'rejected':
      return <Badge tone="critical">Rejected</Badge>
    case 'not_applicable':
      return <Badge>Not applicable</Badge>
    default:
      return <Badge tone="neutral">Not received</Badge>
  }
}

/**
 * Marks a value the system computed rather than a human confirmed (spec §50).
 * The wording is deliberately unambiguous — "Calculated" must never be mistaken
 * for "Approved".
 */
export function CalculatedNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-due-soft px-3 py-2 text-due">
      <span aria-hidden>⚠</span>
      <span>{children ?? 'Calculated — please verify before acting on these figures.'}</span>
    </p>
  )
}
