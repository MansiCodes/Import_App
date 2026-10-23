'use client'

import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Modal({
  open,
  onClose,
  title,
  description,
  icon,
  headerAlign = 'left',
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  icon?: React.ReactNode
  headerAlign?: 'left' | 'center'
  children: React.ReactNode
  footer?: React.ReactNode
  size?: 'md' | 'lg' | 'xl'
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()

    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] transition"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-surface-raised shadow-2xl outline-none sm:rounded-2xl',
          size === 'xl' && 'sm:max-w-3xl',
          size === 'lg' && 'sm:max-w-2xl',
          size === 'md' && 'sm:max-w-xl',
        )}
      >
        <div className="relative shrink-0 border-b px-5 py-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-sunken hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>

          <div
            className={cn(
              'pr-8',
              headerAlign === 'center' && 'flex flex-col items-center text-center',
            )}
          >
            {icon && (
              <div
                className={cn(
                  'mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent',
                  headerAlign === 'left' && 'mb-2',
                )}
              >
                {icon}
              </div>
            )}
            <h2 id={titleId} className="text-xl font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t bg-surface-raised px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  )
}
