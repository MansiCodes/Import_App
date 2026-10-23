'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { EXTERNAL_PARTIES, PRIORITIES, TASK_CATEGORIES, TASK_STATUSES } from '@/lib/types'
import { createClient, getOperator } from '@/lib/supabase/server'

export interface ActionResult {
  ok: boolean
  error?: string
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const str = typeof value === 'string' ? value.trim() : ''
  return str === '' ? null : str
}

const nullableDate = z.union([z.string(), z.null()]).transform((v) => (v === '' ? null : v))

function revalidate(importId?: string | null) {
  revalidatePath('/tasks')
  revalidatePath('/')
  if (importId) {
    revalidatePath(`/imports/${importId}/tasks`)
    revalidatePath(`/imports/${importId}`)
  }
}

const taskSchema = z.object({
  id: z.string().uuid().optional(),
  // Nullable: "renew the marine open policy" belongs to the operation, not to
  // any one order, and forcing it under an arbitrary import makes the list lie.
  import_id: z.union([z.string().uuid(), z.null()]),
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().trim().max(4000).nullable(),
  category: z.union([z.enum(TASK_CATEGORIES), z.null()]),
  owner_id: z.union([z.string().uuid(), z.null()]),
  external_party: z.union([z.enum(EXTERNAL_PARTIES), z.null()]),
  due_date: nullableDate,
  priority: z.enum(PRIORITIES),
  status: z.enum(TASK_STATUSES),
})

export async function saveTask(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = taskSchema.safeParse({
    id: formData.get('id') || undefined,
    import_id: emptyToNull(formData.get('import_id')),
    title: formData.get('title'),
    description: emptyToNull(formData.get('description')),
    category: emptyToNull(formData.get('category')),
    owner_id: emptyToNull(formData.get('owner_id')),
    external_party: emptyToNull(formData.get('external_party')),
    due_date: emptyToNull(formData.get('due_date')),
    priority: formData.get('priority') ?? 'normal',
    status: formData.get('status') ?? 'Open',
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const { id, ...values } = parsed.data
  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = id
    ? await supabase.from('tasks').update(values).eq('id', id)
    : await supabase.from('tasks').insert({ ...values, created_by: operator?.id ?? null })

  if (error) return { ok: false, error: error.message }

  revalidate(values.import_id)
  return { ok: true }
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(TASK_STATUSES),
  import_id: z.union([z.string(), z.null()]),
})

/**
 * Move a task's status.
 *
 * The completion stamp is applied by a database trigger rather than here, so
 * "done" always carries a when and a who however the row was updated.
 */
export async function setTaskStatus(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
    import_id: emptyToNull(formData.get('import_id')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ status: parsed.data.status })
    .eq('id', parsed.data.id)

  if (error) return { ok: false, error: error.message }

  revalidate(parsed.data.import_id)
  return { ok: true }
}

export async function deleteTask(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get('id')
  if (typeof id !== 'string') return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }

  revalidate(emptyToNull(formData.get('import_id')))
  return { ok: true }
}

const commentSchema = z.object({
  task_id: z.string().uuid(),
  body: z.string().trim().min(1, 'Write something').max(4000),
  import_id: z.union([z.string(), z.null()]),
})

export async function addTaskComment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = commentSchema.safeParse({
    task_id: formData.get('task_id'),
    body: formData.get('body'),
    import_id: emptyToNull(formData.get('import_id')),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const supabase = await createClient()
  const operator = await getOperator()

  const { error } = await supabase.from('task_comments').insert({
    task_id: parsed.data.task_id,
    body: parsed.data.body,
    created_by: operator?.id ?? null,
  })

  if (error) return { ok: false, error: error.message }

  revalidate(parsed.data.import_id)
  return { ok: true }
}
