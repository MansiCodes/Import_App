'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Headphones,
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
  onToggle,
}: {
  inboxCount?: number
  collapsed?: boolean
  onToggle?: () => void
}) {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile: horizontal strip — page body still scrolls separately */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b bg-surface-raised px-2 py-2 md:hidden">
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
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap transition',
                active
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              <Icon size={15} strokeWidth={1.75} aria-hidden />
              {label}
              {badge !== null && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      <aside
        className={cn(
          'hidden h-dvh shrink-0 flex-col border-r bg-surface-raised transition-[width] duration-200 ease-out md:flex',
          collapsed ? 'w-[72px]' : 'w-[240px]',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-3 pt-5 pb-4',
            collapsed ? 'justify-center px-2' : 'px-5',
          )}
        >
          <BrandMark />
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[15px] font-semibold tracking-tight text-ink">
                Import Control Tower
              </p>
              <p className="text-xs text-ink-faint">Notofire</p>
            </div>
          )}
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
                  collapsed ? 'justify-center px-2' : 'gap-2.5 px-3',
                  active
                    ? 'bg-accent-soft font-medium text-accent before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                <Icon size={17} strokeWidth={1.75} aria-hidden className="shrink-0" />
                {!collapsed && (
                  <>
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {badge !== null && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </>
                )}
                {collapsed && badge !== null && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-accent ring-2 ring-white" />
                )}
              </Link>
            )
          })}
        </nav>

        {!collapsed && (
          <div className="shrink-0 p-3">
            <div className="rounded-2xl bg-accent-soft px-4 py-4">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-accent shadow-sm">
                <Headphones size={18} strokeWidth={1.75} aria-hidden />
              </div>
              <p className="font-semibold text-ink">Need help?</p>
              <p className="mt-0.5 text-xs text-ink-muted">Talk to support anytime.</p>
              <a
                href="mailto:support@notofire.com"
                className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-accent shadow-sm transition hover:bg-surface-raised"
              >
                Get Support
              </a>
            </div>
          </div>
        )}

        {onToggle && (
          <div className={cn('shrink-0 border-t p-2', collapsed && 'flex justify-center')}>
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
