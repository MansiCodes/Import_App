'use client'

import { useState } from 'react'
import {
  Building2,
  FileText,
  Settings2,
  Users,
} from 'lucide-react'
import type { AppSetting, Company, EmailTemplate, PoSequence, Profile } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CompaniesPanel } from './companies-panel'
import { ConfigPanel } from './config-panel'
import { TemplatesPanel } from './templates-panel'
import { UsersPanel } from './users-panel'

type SectionId = 'users' | 'companies' | 'config' | 'templates'

export function SettingsView({
  admin,
  users,
  currentUserId,
  companies,
  sequences,
  settings,
  templates,
}: {
  admin: boolean
  users: Profile[]
  currentUserId: string
  companies: Company[]
  sequences: PoSequence[]
  settings: AppSetting[]
  templates: EmailTemplate[]
}) {
  const [section, setSection] = useState<SectionId>(admin ? 'users' : 'companies')

  const sections = [
    ...(admin
      ? [
          {
            id: 'users' as const,
            label: 'Users',
            count: users.filter((u) => u.is_active).length,
            icon: Users,
            wrap: 'bg-accent-soft text-accent',
            hint: 'Who can sign in',
          },
        ]
      : []),
    {
      id: 'companies' as const,
      label: 'Companies',
      count: companies.length,
      icon: Building2,
      wrap: 'bg-done-soft text-done',
      hint: 'Importing entities',
    },
    {
      id: 'config' as const,
      label: 'Config',
      count: settings.length,
      icon: Settings2,
      wrap: 'bg-due-soft text-due',
      hint: 'Thresholds & lists',
    },
    {
      id: 'templates' as const,
      label: 'Templates',
      count: templates.length,
      icon: FileText,
      wrap: 'bg-upcoming-soft text-upcoming',
      hint: 'Email drafts',
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Settings</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Companies, identifiers, email templates and the thresholds the alert engine uses.
        </p>
      </div>

      <div
        className={cn(
          'grid gap-3',
          sections.length === 4
            ? 'sm:grid-cols-2 xl:grid-cols-4'
            : 'sm:grid-cols-3',
        )}
      >
        {sections.map((stat) => {
          const Icon = stat.icon
          const active = section === stat.id
          return (
            <button
              key={stat.id}
              type="button"
              onClick={() => setSection(stat.id)}
              className={cn(
                'rounded-2xl border bg-surface-raised p-4 text-left shadow-sm transition',
                active
                  ? 'border-accent ring-2 ring-accent/20'
                  : 'hover:border-border-strong hover:bg-surface-sunken/40',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-medium text-ink-faint">{stat.label}</p>
                  <p className="mt-1 text-2xl font-bold tnum">{stat.count}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">{stat.hint}</p>
                </div>
                <span className={cn('flex size-10 items-center justify-center rounded-xl', stat.wrap)}>
                  <Icon size={18} aria-hidden />
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
        <div className="flex flex-wrap gap-1 border-b px-4 py-3">
          {sections.map((stat) => (
            <button
              key={stat.id}
              type="button"
              onClick={() => setSection(stat.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                section === stat.id
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              {stat.label}
              <span className="ml-1.5 text-ink-faint tnum">{stat.count}</span>
            </button>
          ))}
        </div>

        <div>
          {section === 'users' && admin && (
            <UsersPanel users={users} currentUserId={currentUserId} />
          )}
          {section === 'companies' && (
            <CompaniesPanel companies={companies} sequences={sequences} />
          )}
          {section === 'config' && <ConfigPanel settings={settings} />}
          {section === 'templates' && <TemplatesPanel templates={templates} />}
        </div>
      </div>
    </div>
  )
}
