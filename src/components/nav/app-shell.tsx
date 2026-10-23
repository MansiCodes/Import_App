'use client'

import { useEffect, useState } from 'react'
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
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === '1')
    } catch {
      // ignore storage errors
    }
    setReady(true)
  }, [])

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
    <div className="flex h-dvh flex-col overflow-hidden bg-surface md:flex-row">
      <Sidebar
        inboxCount={inboxCount}
        collapsed={ready ? collapsed : false}
        onToggle={toggleCollapsed}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          profile={profile}
          notifications={notifications}
          onMenuToggle={toggleCollapsed}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
