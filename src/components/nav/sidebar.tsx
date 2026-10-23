'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  Package,
  Settings,
  Ship,
  Truck,
  Users,
  Wallet,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/imports', label: 'Imports', icon: Package },
  { href: '/inbox', label: 'Inbox', icon: MessageSquare, badgeKey: 'inbox' as const },
  { href: '/tasks', label: 'Tasks', icon: ListTodo },
  { href: '/review', label: 'Review', icon: ClipboardCheck },
  { href: '/payments', label: 'Payments', icon: Wallet },
  { href: '/shipments', label: 'Shipments', icon: Ship },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/suppliers', label: 'Suppliers', icon: Building2 },
  { href: '/cha', label: 'CHA & Agents', icon: Truck },
  { href: '/reports', label: 'Reports', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const

export function Sidebar({
  inboxCount = 0,
  collapsed = false,
  mobileOpen = false,
  onToggle,
  onCloseMobile,
}: {
  inboxCount?: number
  collapsed?: boolean
  mobileOpen?: boolean
  onToggle?: () => void
  onCloseMobile?: () => void
}) {
  const pathname = usePathname()

  useEffect(() => {
    onCloseMobile?.()
    // Close after navigation. The callback is stable from AppShell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  useEffect(() => {
    if (!mobileOpen) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseMobile?.()
    }

    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen, onCloseMobile])

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-ink/40 md:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-dvh w-[240px] shrink-0 flex-col border-r bg-surface-raised transition-transform duration-200 ease-out md:static md:z-auto md:transition-[width]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          collapsed ? 'md:w-[72px]' : 'md:w-[240px]',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-3 pt-5 pb-4',
            collapsed ? 'md:justify-center md:px-2' : 'px-5',
          )}
        >
          <BrandMark />
          <div className={cn('min-w-0 leading-tight', collapsed && 'md:hidden')}>
            <p className="truncate text-[15px] font-semibold tracking-tight text-ink">
              Import Control Tower
            </p>
            <p className="text-xs text-ink-faint">Notofire</p>
          </div>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pb-2">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
            const badge =
              'badgeKey' in rest && rest.badgeKey === 'inbox' && inboxCount > 0
                ? inboxCount
                : null

            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center rounded-lg py-2 transition',
                  collapsed ? 'gap-2.5 px-3 md:justify-center md:px-2' : 'gap-2.5 px-3',
                  active
                    ? 'bg-accent-soft font-medium text-accent before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                <Icon size={17} strokeWidth={1.75} aria-hidden className="shrink-0" />
                <span className={cn('min-w-0 flex-1 truncate', collapsed && 'md:hidden')}>
                  {label}
                </span>
                {badge !== null && (
                  <span
                    className={cn(
                      'flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white',
                      collapsed && 'md:absolute md:top-1 md:right-1 md:h-2 md:min-w-2 md:p-0 md:ring-2 md:ring-white',
                    )}
                  >
                    <span className={cn(collapsed && 'md:hidden')}>{badge > 99 ? '99+' : badge}</span>
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {onToggle && (
          <div className={cn('hidden shrink-0 border-t p-2 md:block', collapsed && 'md:flex md:justify-center')}>
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand' : 'Collapse'}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-muted transition hover:bg-surface-sunken hover:text-ink',
                collapsed ? 'justify-center px-2' : 'w-full',
              )}
            >
              {collapsed ? (
                <ChevronRight size={16} aria-hidden />
              ) : (
                <>
                  <ChevronLeft size={16} aria-hidden />
                  <span>Collapse</span>
                </>
              )}
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

function BrandMark() {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-white shadow-sm"
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path
          d="M12 2.5 19.5 7v10L12 21.5 4.5 17V7L12 2.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M12 7.2c1.8 1.6 2.7 3 2.7 4.4a2.7 2.7 0 1 1-5.4 0c0-1.4.9-2.8 2.7-4.4Z"
          fill="currentColor"
        />
      </svg>
    </div>
  )
}
