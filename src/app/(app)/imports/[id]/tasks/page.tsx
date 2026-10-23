import { createClient } from '@/lib/supabase/server'
import type { Profile } from '@/lib/types'
import { TaskList, type TaskRow } from '../../../tasks/task-list'

export const dynamic = 'force-dynamic'

export default async function ImportTasksTabPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [tasksResult, peopleResult] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('import_id', id)
      .order('due_date', { nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').eq('is_active', true).order('full_name'),
  ])

  return (
    <TaskList
      tasks={(tasksResult.data ?? []) as TaskRow[]}
      people={(peopleResult.data ?? []) as Profile[]}
      scopedImportId={id}
      showImport={false}
    />
  )
}
