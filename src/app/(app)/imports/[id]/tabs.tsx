'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PRIMARY_DOCUMENT_TABS } from '@/lib/types'
import { cn } from '@/lib/utils'

export function ImportTabs({ importId }: { importId: string }) {
  const pathname = usePathname()
  const base = `/imports/${importId}/docs`

  return (
    <div className="overflow-x-auto border-b border-border [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav className="flex min-w-max gap-1 pb-px" aria-label="Documents">
        {PRIMARY_DOCUMENT_TABS.map((tab) => {
          const href = `${base}/${tab.slug}`
          const active = pathname === href
          return (
            <Link
              key={tab.slug}
              href={href}
              title={tab.label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative rounded-t-lg px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition',
                active
                  ? 'text-accent after:absolute after:right-2 after:bottom-0 after:left-2 after:h-0.5 after:rounded-full after:bg-accent'
                  : 'text-ink-muted hover:bg-surface-sunken/60 hover:text-ink',
              )}
            >
              {tab.shortLabel}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
