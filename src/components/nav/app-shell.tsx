'use client'

import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from '@/components/nav/sidebar'
import { TopBar } from '@/components/nav/top-bar'
import type { NotificationItem } from '@/lib/notifications'
import type { Profile } from '@/lib/types'

const STORAGE_KEY = 'ict-sidebar-collapsed'

export function AppShell({
  profile,
  inboxCount,
  notifications,
  children,
}: {
  profile: Profile
  inboxCount: number
  notifications: NotificationItem[]
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // ignore storage errors
    }
    setReady(true)
  }, [])

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <Sidebar
        inboxCount={inboxCount}
        collapsed={ready ? collapsed : false}
        mobileOpen={mobileOpen}
        onToggle={toggleCollapsed}
        onCloseMobile={closeMobile}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          profile={profile}
          notifications={notifications}
          menuOpen={mobileOpen}
          onMenuToggle={toggleCollapsed}
          onMobileMenu={() => setMobileOpen((open) => !open)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
