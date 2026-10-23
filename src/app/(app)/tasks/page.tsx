import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types'
import { TaskList, type TaskRow } from './task-list'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const supabase = await createClient()

  const [tasksResult, peopleResult, importsResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*, imports(import_no)')
      .order('due_date', { nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
    supabase
      .from('imports')
      .select('id, import_no')
      .eq('is_archived', false)
      .not('status', 'in', '("Closed","Cancelled")')
      .order('import_no', { ascending: false }),
  ])

  const tasks = (tasksResult.data ?? []).map((row) => {
    const { imports, ...task } = row as typeof row & { imports: { import_no: string } | null }
    return { ...task, import_no: imports?.import_no ?? null } as TaskRow
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Tasks</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          The smaller things across every import. An import&rsquo;s headline commitment is its Next
          Action — these are everything else.
        </p>
      </div>

      <TaskList
        tasks={tasks}
        people={(peopleResult.data ?? []) as Profile[]}
        imports={importsResult.data ?? []}
      />
    </div>
  )
}
