'use client'

import { ChevronDown, Menu, Search } from 'lucide-react'
import { ROLE_LABELS, type Profile } from '@/lib/types'
import { NotificationBell } from '@/components/nav/notification-bell'
import type { NotificationItem } from '@/lib/notifications'

function initials(name: string | null, email: string): string {
  const source = (name ?? email).trim()
  const parts = source.split(/[\s@._-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function TopBar({
  profile,
  notifications,
  menuOpen = false,
  onMenuToggle,
  onMobileMenu,
}: {
  profile: Profile
  notifications: NotificationItem[]
  menuOpen?: boolean
  onMenuToggle?: () => void
  onMobileMenu?: () => void
}) {
  const name = profile.full_name?.trim() || profile.email.split('@')[0] || 'User'
  const role = ROLE_LABELS[profile.role]

  return (
    <header className="z-20 flex shrink-0 items-center gap-3 border-b bg-surface-raised px-4 py-3 sm:gap-4 sm:px-6">
      {onMobileMenu && (
        <button
          type="button"
          onClick={onMobileMenu}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-sunken hover:text-ink md:hidden"
        >
          <Menu size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      {onMenuToggle && (
        <button
          type="button"
          onClick={onMenuToggle}
          aria-label="Toggle sidebar"
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-surface-sunken hover:text-ink md:flex"
        >
          <Menu size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}

      <div className="relative min-w-0 flex-1">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint"
        />
        <input
          type="search"
          placeholder="Search imports, suppliers, documents..."
          className="w-full max-w-xl rounded-full border border-transparent bg-surface-sunken py-2.5 pr-4 pl-10 text-sm outline-none transition placeholder:text-ink-faint focus:border-accent focus:bg-white"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <NotificationBell items={notifications} />

        <div className="flex items-center gap-2.5 rounded-full py-1 pr-1 pl-1 sm:pr-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {initials(profile.full_name, profile.email)}
          </span>
          <div className="hidden min-w-0 leading-tight sm:block">
            <p className="truncate text-sm font-medium text-ink">{name}</p>
            <p className="truncate text-xs text-ink-faint">{role}</p>
          </div>
          <form action="/auth/signout" method="post" className="hidden sm:block">
            <button
              type="submit"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-full text-ink-faint transition hover:bg-surface-sunken hover:text-ink"
              title="Sign out"
            >
              <ChevronDown size={16} aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
