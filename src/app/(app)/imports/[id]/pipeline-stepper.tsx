import { Check } from 'lucide-react'
import { pipelineStage, type PipelineStage } from '@/lib/import-status'
import { cn, formatDate } from '@/lib/utils'

const STEPS: { id: PipelineStage | 'close'; label: string }[] = [
  { id: 'order', label: 'Order' },
  { id: 'make', label: 'Make' },
  { id: 'ship', label: 'Ship' },
  { id: 'arrive', label: 'Arrive' },
  { id: 'close', label: 'Close' },
]

export function detailStageIndex(status: string): number {
  if (['Closed', 'Cancelled'].includes(status)) return 4
  const stage = pipelineStage(status)
  return STEPS.findIndex((s) => s.id === stage)
}

export function PipelineStepper({
  status,
  dates,
}: {
  status: string
  dates: {
    order: string | null
    make: string | null
    ship: string | null
    arrive: string | null
    close: string | null
  }
}) {
  const current = detailStageIndex(status)
  const dateByStep = [dates.order, dates.make, dates.ship, dates.arrive, dates.close]

  return (
    <div className="rounded-2xl border bg-surface-raised px-2 py-5 shadow-sm sm:px-4">
      <ol className="flex items-start">
        {STEPS.map((step, index) => {
          const done = index < current
          const active = index === current
          const pending = index > current
          const date = dateByStep[index]

          return (
            <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <div
                  className={cn(
                    'h-[3px] flex-1 rounded-full',
                    index === 0
                      ? 'bg-transparent'
                      : done || active
                        ? 'bg-accent'
                        : 'bg-border',
                  )}
                  aria-hidden
                />
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    done || active
                      ? 'bg-accent text-white shadow-sm shadow-accent/25'
                      : 'border-2 border-border bg-white text-ink-faint',
                  )}
                >
                  {done ? <Check size={17} strokeWidth={2.75} aria-hidden /> : index + 1}
                </div>
                <div
                  className={cn(
                    'h-[3px] flex-1 rounded-full',
                    index === STEPS.length - 1
                      ? 'bg-transparent'
                      : done
                        ? 'bg-accent'
                        : 'bg-border',
                  )}
                  aria-hidden
                />
              </div>
              <p
                className={cn(
                  'mt-2.5 text-[13px] font-semibold',
                  pending ? 'text-ink-faint' : 'text-ink',
                )}
              >
                {step.label}
              </p>
              {active ? (
                <p className="mt-0.5 text-[11px] font-medium text-accent">Current stage</p>
              ) : pending ? (
                <p className="mt-0.5 text-[11px] text-ink-faint">Pending</p>
              ) : date ? (
                <p className="mt-0.5 text-[11px] text-ink-muted">{formatDate(date)}</p>
              ) : (
                <p className="mt-0.5 text-[11px] text-ink-faint">Done</p>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
