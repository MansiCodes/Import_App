'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe2,
  Plus,
  Search,
  UserX,
} from 'lucide-react'
import { Badge, Button, EmptyState, Field, Input, Textarea } from '@/components/ui'
import type { Cha, ChaAgent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { deactivateAgent, saveAgent, saveCha, type ActionResult } from './actions'

const PAGE_SIZE = 8
const MODES = ['air', 'sea', 'courier', 'road'] as const

type FilterId = 'all' | 'active' | 'inactive'

function ChaForm({ cha, onDone }: { cha?: Cha; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveCha(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="space-y-3 border-t bg-surface-sunken p-4">
      {cha && <input type="hidden" name="id" value={cha.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Name" htmlFor="cha-name" required>
          <Input id="cha-name" name="name" required defaultValue={cha?.name} />
        </Field>
        <Field label="Company name" htmlFor="cha-company">
          <Input id="cha-company" name="company_name" defaultValue={cha?.company_name ?? ''} />
        </Field>
        <Field label="Contact person" htmlFor="cha-contact">
          <Input id="cha-contact" name="contact_person" defaultValue={cha?.contact_person ?? ''} />
        </Field>
        <Field label="Email" htmlFor="cha-email">
          <Input id="cha-email" name="email" type="email" defaultValue={cha?.email ?? ''} />
        </Field>
        <Field label="Phone" htmlFor="cha-phone">
          <Input id="cha-phone" name="phone" defaultValue={cha?.phone ?? ''} />
        </Field>
      </div>

      <Field label="Notes" htmlFor="cha-notes">
        <Textarea id="cha-notes" name="notes" defaultValue={cha?.notes ?? ''} />
      </Field>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="is_active"
          defaultChecked={cha?.is_active ?? true}
          className="size-4"
        />
        Active
      </label>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : cha ? 'Save' : 'Add CHA'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function AgentForm({
  chaId,
  agent,
  onDone,
}: {
  chaId: string
  agent?: ChaAgent
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveAgent(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form action={formAction} className="space-y-3 rounded-xl border bg-surface-sunken p-3">
      <input type="hidden" name="cha_id" value={chaId} />
      {agent && <input type="hidden" name="id" value={agent.id} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Agent name" htmlFor="agent-name" required>
          <Input id="agent-name" name="name" required defaultValue={agent?.name} />
        </Field>
        <Field label="Country" htmlFor="agent-country">
          <Input id="agent-country" name="country" defaultValue={agent?.country ?? ''} />
        </Field>
        <Field label="City" htmlFor="agent-city">
          <Input id="agent-city" name="city" defaultValue={agent?.city ?? ''} />
        </Field>
        <Field label="Contact person" htmlFor="agent-contact">
          <Input
            id="agent-contact"
            name="contact_person"
            defaultValue={agent?.contact_person ?? ''}
          />
        </Field>
        <Field label="Email" htmlFor="agent-email">
          <Input id="agent-email" name="email" type="email" defaultValue={agent?.email ?? ''} />
        </Field>
        <Field label="Phone" htmlFor="agent-phone">
          <Input id="agent-phone" name="phone" defaultValue={agent?.phone ?? ''} />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Handles</legend>
        <div className="flex flex-wrap gap-3">
          {MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-1.5 text-[13px] capitalize">
              <input
                type="checkbox"
                name="modes"
                value={mode}
                defaultChecked={agent?.modes?.includes(mode)}
                className="size-4"
              />
              {mode}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && (
        <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">{state.error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : agent ? 'Save' : 'Add agent'}
        </Button>
        <Button type="button" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function RemoveAgent({ agent }: { agent: ChaAgent }) {
  const [, formAction, pending] = useActionState<ActionResult | null, FormData>(
    deactivateAgent,
    null,
  )
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Remove
      </Button>
    )
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={agent.id} />
      <span className="text-[13px] text-ink-muted">Remove?</span>
      <Button type="submit" variant="danger" disabled={pending}>
        Yes
      </Button>
      <Button type="button" onClick={() => setConfirming(false)}>
        No
      </Button>
    </form>
  )
}

export function ChaList({ chas, agents }: { chas: Cha[]; agents: ChaAgent[] }) {
  const [addingCha, setAddingCha] = useState(false)
  const [editingCha, setEditingCha] = useState<string | null>(null)
  const [addingAgentFor, setAddingAgentFor] = useState<string | null>(null)
  const [editingAgent, setEditingAgent] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterId>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const activeAgents = useMemo(() => agents.filter((a) => a.is_active), [agents])
  const activeChas = useMemo(() => chas.filter((c) => c.is_active), [chas])
  const inactiveChas = useMemo(() => chas.filter((c) => !c.is_active), [chas])

  const agentsByCha = useMemo(() => {
    const map = new Map<string, ChaAgent[]>()
    for (const agent of activeAgents) {
      const list = map.get(agent.cha_id) ?? []
      list.push(agent)
      map.set(agent.cha_id, list)
    }
    return map
  }, [activeAgents])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base =
      filter === 'active' ? activeChas : filter === 'inactive' ? inactiveChas : chas

    return base.filter((cha) => {
      if (!q) return true
      const chaAgents = agentsByCha.get(cha.id) ?? []
      return [
        cha.name,
        cha.company_name,
        cha.contact_person,
        cha.email,
        cha.phone,
        ...chaAgents.flatMap((a) => [a.name, a.country, a.city, a.email]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [chas, filter, query, activeChas, inactiveChas, agentsByCha])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1
      const ac = (agentsByCha.get(a.id) ?? []).length
      const bc = (agentsByCha.get(b.id) ?? []).length
      if (bc !== ac) return bc - ac
      return a.name.localeCompare(b.name)
    })
  }, [filtered, agentsByCha])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const from = sorted.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1
  const to = Math.min(safePage * PAGE_SIZE, sorted.length)

  useEffect(() => setPage(1), [filter, query])

  const stats = [
    {
      id: 'all' as const,
      label: 'All CHAs',
      count: chas.length,
      icon: Building2,
      wrap: 'bg-accent-soft text-accent',
    },
    {
      id: 'active' as const,
      label: 'Active',
      count: activeChas.length,
      icon: CheckCircle2,
      wrap: 'bg-done-soft text-done',
    },
    {
      id: 'inactive' as const,
      label: 'Inactive',
      count: inactiveChas.length,
      icon: UserX,
      wrap: 'bg-surface-sunken text-ink-muted',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">CHA & Agents</h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            Customs house agents and their overseas counterparts.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAddingCha(true)}>
          <Plus size={16} aria-hidden />
          Add CHA
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          const isActive = filter === stat.id
          return (
            <button
              key={stat.id}
              type="button"
              onClick={() => setFilter(stat.id)}
              className={cn(
                'rounded-2xl border bg-surface-raised p-4 text-left shadow-sm transition',
                isActive
                  ? 'border-accent ring-2 ring-accent/20'
                  : 'hover:border-border-strong hover:bg-surface-sunken/40',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-medium text-ink-faint">{stat.label}</p>
                  <p className="mt-1 text-2xl font-bold tnum">{stat.count}</p>
                </div>
                <span className={cn('flex size-10 items-center justify-center rounded-xl', stat.wrap)}>
                  <Icon size={18} aria-hidden />
                </span>
              </div>
            </button>
          )
        })}

        <div className="rounded-2xl border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-ink-faint">Overseas agents</p>
              <p className="mt-1 text-2xl font-bold tnum">{activeAgents.length}</p>
            </div>
            <span className="flex size-10 items-center justify-center rounded-xl bg-upcoming-soft text-upcoming">
              <Globe2 size={18} aria-hidden />
            </span>
          </div>
        </div>
      </div>

      {addingCha && (
        <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
          <div className="border-b px-4 py-3">
            <p className="text-[14px] font-semibold text-ink">New CHA</p>
            <p className="text-[12px] text-ink-muted">
              Add the clearing house first — overseas agents hang off each CHA.
            </p>
          </div>
          <ChaForm onDone={() => setAddingCha(false)} />
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {stats.map((stat) => (
              <button
                key={stat.id}
                type="button"
                onClick={() => setFilter(stat.id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                  filter === stat.id
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {stat.label}
                <span className="ml-1.5 text-ink-faint tnum">{stat.count}</span>
              </button>
            ))}
          </div>

          <label className="relative block w-full max-w-xs">
            <Search
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search CHA, agent, country…"
              className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>
        </div>

        {pageRows.length === 0 && !addingCha ? (
          <div className="p-6">
            <EmptyState
              title="No clearing agents yet"
              description="Add a CHA first — overseas agents and modes are attached to each one."
            />
          </div>
        ) : pageRows.length === 0 ? null : (
          <ul className="divide-y">
            {pageRows.map((cha) => {
              const chaAgents = agentsByCha.get(cha.id) ?? []
              return (
                <li key={cha.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-ink">{cha.name}</span>
                        {!cha.is_active && <Badge>Inactive</Badge>}
                        {cha.company_name && <Badge tone="neutral">{cha.company_name}</Badge>}
                        <Badge tone="accent">
                          {chaAgents.length} {chaAgents.length === 1 ? 'agent' : 'agents'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-muted">
                        {[cha.contact_person, cha.email, cha.phone].filter(Boolean).join(' · ') ||
                          'No contact details'}
                      </p>
                      {cha.notes && (
                        <p className="mt-1 text-[12px] text-ink-faint">{cha.notes}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button variant="ghost" onClick={() => setAddingAgentFor(cha.id)}>
                        Add agent
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setEditingCha(editingCha === cha.id ? null : cha.id)}
                      >
                        {editingCha === cha.id ? 'Close' : 'Edit'}
                      </Button>
                    </div>
                  </div>

                  {editingCha === cha.id && (
                    <div className="mt-3 overflow-hidden rounded-xl border">
                      <ChaForm cha={cha} onDone={() => setEditingCha(null)} />
                    </div>
                  )}

                  {(chaAgents.length > 0 || addingAgentFor === cha.id) && (
                    <div className="mt-3 space-y-2 border-l-2 border-border pl-3">
                      {addingAgentFor === cha.id && (
                        <AgentForm chaId={cha.id} onDone={() => setAddingAgentFor(null)} />
                      )}

                      {chaAgents.map((agent) => (
                        <div
                          key={agent.id}
                          className="rounded-xl border bg-surface-sunken/40 px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[14px] font-medium text-ink">
                                  {agent.name}
                                </span>
                                {agent.country && (
                                  <Badge tone="accent">
                                    {[agent.city, agent.country].filter(Boolean).join(', ')}
                                  </Badge>
                                )}
                                {agent.modes?.map((mode) => (
                                  <Badge key={mode}>{mode}</Badge>
                                ))}
                              </div>
                              <p className="text-[12px] text-ink-muted">
                                {[agent.contact_person, agent.email, agent.phone]
                                  .filter(Boolean)
                                  .join(' · ') || 'No contact details'}
                              </p>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setEditingAgent(editingAgent === agent.id ? null : agent.id)
                                }
                              >
                                {editingAgent === agent.id ? 'Close' : 'Edit'}
                              </Button>
                              <RemoveAgent agent={agent} />
                            </div>
                          </div>

                          {editingAgent === agent.id && (
                            <div className="mt-2">
                              <AgentForm
                                chaId={cha.id}
                                agent={agent}
                                onDone={() => setEditingAgent(null)}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
          <p className="text-sm text-ink-muted">
            Showing{' '}
            <span className="font-medium text-ink tnum">
              {from}–{to}
            </span>{' '}
            of <span className="font-medium text-ink tnum">{sorted.length}</span> CHAs
          </p>
          <div className="flex items-center gap-1">
            <PageBtn
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              label="Previous"
            >
              <ChevronLeft size={16} />
            </PageBtn>
            {pageNumbers(safePage, totalPages).map((n, i) =>
              n === '…' ? (
                <span key={`e-${i}`} className="px-1 text-ink-faint">
                  …
                </span>
              ) : (
                <PageBtn
                  key={n}
                  active={n === safePage}
                  onClick={() => setPage(n)}
                  label={`Page ${n}`}
                >
                  {n}
                </PageBtn>
              ),
            )}
            <PageBtn
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              label="Next"
            >
              <ChevronRight size={16} />
            </PageBtn>
          </div>
        </div>
      </div>
    </div>
  )
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  if (current <= 3) return [1, 2, 3, 4, '…', total]
  if (current >= total - 2) return [1, '…', total - 3, total - 2, total - 1, total]
  return [1, '…', current - 1, current, current + 1, '…', total]
}

function PageBtn({
  children,
  onClick,
  disabled,
  active,
  label,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition',
        active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {children}
    </button>
  )
}
