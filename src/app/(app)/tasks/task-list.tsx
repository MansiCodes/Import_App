'use client'

import { useActionState, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Plus,
  Search,
} from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
  type BadgeTone,
} from '@/components/ui'
import { cn, formatDate } from '@/lib/utils'
import { dueLabel } from '@/lib/import-status'
import {
  EXTERNAL_PARTIES,
  PRIORITIES,
  TASK_CATEGORIES,
  TASK_STATUSES,
  type Profile,
  type Task,
} from '@/lib/types'
import { addTaskComment, deleteTask, saveTask, setTaskStatus, type ActionResult } from './actions'

export interface TaskRow extends Task {
  import_no?: string | null
}

const PRIORITY_TONES: Record<string, BadgeTone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'due',
  critical: 'critical',
}

const STATUS_TONES: Record<string, BadgeTone> = {
  Open: 'accent',
  'In Progress': 'upcoming',
  Blocked: 'critical',
  Done: 'done',
  Cancelled: 'neutral',
}

function TaskForm({
  task,
  importId,
  imports,
  people,
  onDone,
}: {
  task?: TaskRow
  importId?: string
  imports?: { id: string; import_no: string }[]
  people: Profile[]
  onDone: () => void
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveTask(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border bg-surface-sunken/30 p-4"
    >
      {task && <input type="hidden" name="id" value={task.id} />}
      {importId && <input type="hidden" name="import_id" value={importId} />}

      <Field label="What needs doing" htmlFor="title" required>
        <Input id="title" name="title" required maxLength={200} defaultValue={task?.title ?? ''} />
      </Field>

      <Field label="Detail" htmlFor="description">
        <Textarea id="description" name="description" defaultValue={task?.description ?? ''} />
      </Field>

      <FormGrid className="lg:grid-cols-4">
        {!importId && imports && (
          <Field label="Import" htmlFor="import_id" hint="Optional">
            <Select id="import_id" name="import_id" defaultValue={task?.import_id ?? ''}>
              <option value="">Not tied to an import</option>
              {imports.map((imp) => (
                <option key={imp.id} value={imp.id}>
                  {imp.import_no}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={task?.category ?? ''}>
            <option value="">—</option>
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Owner" htmlFor="owner_id">
          <Select id="owner_id" name="owner_id" defaultValue={task?.owner_id ?? ''}>
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Waiting on" htmlFor="external_party" hint="Outside party, if any">
          <Select
            id="external_party"
            name="external_party"
            defaultValue={task?.external_party ?? ''}
          >
            <option value="">—</option>
            {EXTERNAL_PARTIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>

      <FormGrid>
        <Field label="Due date" htmlFor="due_date">
          <Input id="due_date" name="due_date" type="date" defaultValue={task?.due_date ?? ''} />
        </Field>
        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={task?.priority ?? 'normal'}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={task?.status ?? 'Open'}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
      </FormGrid>

      {state?.error && <p className="text-sm text-critical">{state.error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending} className="rounded-xl">
          {pending ? 'Saving…' : task ? 'Save task' : 'Add task'}
        </Button>
        <Button type="button" onClick={onDone} className="rounded-xl">
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Comments({ taskId, importId }: { taskId: string; importId: string | null }) {
  const formRef = useRef<HTMLFormElement>(null)
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await addTaskComment(prev, formData)
      if (result.ok) formRef.current?.reset()
      return result
    },
    null,
  )

  return (
    <form ref={formRef} action={formAction} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="task_id" value={taskId} />
      <input type="hidden" name="import_id" value={importId ?? ''} />
      <Input name="body" placeholder="Add a comment" maxLength={4000} className="min-w-[200px] flex-1" />
      <Button type="submit" disabled={pending} className="rounded-xl">
        {pending ? '…' : 'Post'}
      </Button>
      {state?.error && <p className="w-full text-sm text-critical">{state.error}</p>}
    </form>
  )
}

function TaskItem({
  task,
  people,
  imports,
  scopedImportId,
  showImport,
}: {
  task: TaskRow
  people: Profile[]
  imports?: { id: string; import_no: string }[]
  scopedImportId?: string
  showImport: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const [, statusAction, statusPending] = useActionState<ActionResult | null, FormData>(
    setTaskStatus,
    null,
  )
  const [, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(deleteTask, null)

  const done = task.status === 'Done' || task.status === 'Cancelled'
  const owner = people.find((p) => p.id === task.owner_id)
  const overdue =
    !done &&
    task.due_date &&
    new Date(task.due_date) < new Date(new Date().toDateString())

  if (editing) {
    return (
      <li className="px-4 py-4">
        <TaskForm
          task={task}
          importId={scopedImportId}
          imports={imports}
          people={people}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li
      className={cn(
        'px-4 py-3.5 transition hover:bg-surface-sunken/40',
        overdue && 'bg-critical-soft/25',
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <form action={statusAction} className="pt-0.5">
          <input type="hidden" name="id" value={task.id} />
          <input type="hidden" name="import_id" value={task.import_id ?? ''} />
          <input type="hidden" name="status" value={done ? 'Open' : 'Done'} />
          <button
            type="submit"
            disabled={statusPending}
            aria-label={done ? 'Reopen task' : 'Mark done'}
            className={cn(
              'flex size-7 items-center justify-center rounded-lg border text-sm transition',
              done
                ? 'border-done bg-done-soft text-done'
                : 'border-border-strong text-ink-muted hover:border-accent hover:bg-accent-soft hover:text-accent',
            )}
          >
            {done ? '↩' : '✓'}
          </button>
        </form>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'text-[15px] font-semibold',
                done ? 'text-ink-faint line-through' : 'text-ink',
              )}
            >
              {task.title}
            </span>
            {showImport && task.import_no && (
              <Link
                href={`/imports/${task.import_id}/tasks`}
                className="font-mono text-[12px] font-medium text-accent hover:underline"
              >
                {task.import_no}
              </Link>
            )}
            {task.category && <Badge tone="neutral">{task.category}</Badge>}
            {task.priority !== 'normal' && (
              <Badge tone={PRIORITY_TONES[task.priority]}>{task.priority}</Badge>
            )}
            <Badge tone={STATUS_TONES[task.status] ?? 'neutral'}>{task.status}</Badge>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {task.due_date && !done && (
              <span className={overdue ? 'font-medium text-critical' : 'text-ink-muted'}>
                {dueLabel(task.due_date)} · {formatDate(task.due_date)}
              </span>
            )}
            {task.external_party && (
              <span className="text-ink-muted">Waiting on {task.external_party}</span>
            )}
            {owner && (
              <span className="text-ink-faint">{owner.full_name || owner.email}</span>
            )}
          </div>

          {expanded && (
            <div className="mt-3 rounded-xl border bg-surface-sunken/30 p-3">
              {task.description && (
                <p className="mb-2 text-[14px] whitespace-pre-wrap text-ink-muted">
                  {task.description}
                </p>
              )}
              <Comments taskId={task.id} importId={task.import_id} />
              <form action={deleteAction} className="mt-3">
                <input type="hidden" name="id" value={task.id} />
                <input type="hidden" name="import_id" value={task.import_id ?? ''} />
                <Button
                  type="submit"
                  variant="ghost"
                  disabled={deleting}
                  className="rounded-xl text-critical"
                >
                  Delete task
                </Button>
              </form>
            </div>
          )}
        </div>

        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Less' : 'More'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        </div>
      </div>
    </li>
  )
}

export function TaskList({
  tasks,
  people,
  imports,
  scopedImportId,
  showImport = true,
}: {
  tasks: TaskRow[]
  people: Profile[]
  imports?: { id: string; import_no: string }[]
  scopedImportId?: string
  showImport?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'overdue' | 'open' | 'done'>('all')

  const open = tasks.filter((t) => t.status !== 'Done' && t.status !== 'Cancelled')
  const closed = tasks.filter((t) => t.status === 'Done' || t.status === 'Cancelled')

  const today = new Date(new Date().toDateString())
  const overdue = open.filter((t) => t.due_date && new Date(t.due_date) < today)
  const rest = open.filter((t) => !overdue.includes(t))

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (t: TaskRow) => {
      if (!q) return true
      return [t.title, t.description, t.import_no, t.category, t.external_party]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    }

    if (tab === 'overdue') return overdue.filter(match)
    if (tab === 'open') return rest.filter(match)
    if (tab === 'done') return closed.filter(match)
    return []
  }, [tab, query, overdue, rest, closed])

  const listForAll = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (t: TaskRow) => {
      if (!q) return true
      return [t.title, t.description, t.import_no, t.category, t.external_party]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    }
    return {
      overdue: overdue.filter(match),
      open: rest.filter(match),
      closed: closed.filter(match),
    }
  }, [query, overdue, rest, closed])

  const stats = [
    {
      id: 'open' as const,
      label: 'Open',
      count: open.length,
      icon: CircleDot,
      wrap: 'bg-accent-soft text-accent',
    },
    {
      id: 'overdue' as const,
      label: 'Overdue',
      count: overdue.length,
      icon: AlertTriangle,
      wrap: 'bg-critical-soft text-critical',
    },
    {
      id: 'done' as const,
      label: 'Closed',
      count: closed.length,
      icon: CheckCircle2,
      wrap: 'bg-done-soft text-done',
    },
  ]

  return (
    <div className="space-y-5">
      {!scopedImportId && (
        <div className="grid gap-3 sm:grid-cols-3">
          {stats.map((stat) => {
            const Icon = stat.icon
            const active = tab === stat.id
            return (
              <button
                key={stat.id}
                type="button"
                onClick={() => setTab(stat.id)}
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
                  </div>
                  <span
                    className={cn(
                      'flex size-10 items-center justify-center rounded-xl',
                      stat.wrap,
                    )}
                  >
                    <Icon size={18} aria-hidden />
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border bg-surface-raised shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                ['all', 'All open'],
                ['overdue', 'Overdue'],
                ['open', 'Upcoming'],
                ['done', 'Closed'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                  tab === id
                    ? 'bg-accent-soft text-accent'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block w-full min-w-[200px] max-w-xs">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tasks…"
                className="w-full rounded-xl border border-border bg-surface-sunken/50 py-2 pr-3 pl-9 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </label>
            {!adding && (
              <Button
                type="button"
                variant="primary"
                className="rounded-xl"
                onClick={() => setAdding(true)}
              >
                <Plus size={16} aria-hidden />
                Add task
              </Button>
            )}
          </div>
        </div>

        {adding && (
          <div className="border-b px-4 py-4">
            <p className="mb-3 text-[14px] font-semibold text-ink">New task</p>
            <TaskForm
              importId={scopedImportId}
              imports={imports}
              people={people}
              onDone={() => setAdding(false)}
            />
          </div>
        )}

        {open.length === 0 && !adding && tab !== 'done' ? (
          <div className="p-6">
            <EmptyState
              title="Nothing outstanding"
              description="Tasks are the smaller things that should not displace an import's Next Action."
              action={
                <Button
                  type="button"
                  variant="primary"
                  className="rounded-xl"
                  onClick={() => setAdding(true)}
                >
                  Add the first task
                </Button>
              }
            />
          </div>
        ) : tab === 'all' ? (
          <div>
            {listForAll.overdue.length > 0 && (
              <div>
                <div className="flex items-center gap-2 border-b bg-critical-soft/40 px-4 py-2">
                  <AlertTriangle size={14} className="text-critical" aria-hidden />
                  <p className="text-[13px] font-semibold text-critical">Overdue</p>
                  <Badge tone="critical">{listForAll.overdue.length}</Badge>
                </div>
                <ul className="divide-y">
                  {listForAll.overdue.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      people={people}
                      imports={imports}
                      scopedImportId={scopedImportId}
                      showImport={showImport}
                    />
                  ))}
                </ul>
              </div>
            )}
            {listForAll.open.length > 0 && (
              <div>
                {listForAll.overdue.length > 0 && (
                  <div className="border-b bg-surface-sunken/50 px-4 py-2">
                    <p className="text-[13px] font-semibold text-ink-muted">Upcoming</p>
                  </div>
                )}
                <ul className="divide-y">
                  {listForAll.open.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      people={people}
                      imports={imports}
                      scopedImportId={scopedImportId}
                      showImport={showImport}
                    />
                  ))}
                </ul>
              </div>
            )}
            {listForAll.overdue.length === 0 && listForAll.open.length === 0 && (
              <div className="p-6">
                <EmptyState title="No open tasks match" description="Try another search or filter." />
              </div>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing here" description="Try another search or filter." />
          </div>
        ) : (
          <ul className="divide-y">
            {filtered.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                people={people}
                imports={imports}
                scopedImportId={scopedImportId}
                showImport={showImport}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
