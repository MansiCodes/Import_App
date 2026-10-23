import { Card } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import type { InboxRow } from '@/lib/types'
import { InboxView, INBOX_VIEWS, type InboxViewId } from './inbox-view'

export const dynamic = 'force-dynamic'

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const params = await searchParams
  const view = (
    params.view && params.view in INBOX_VIEWS ? params.view : 'review'
  ) as InboxViewId

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_communication_inbox')
    .select('*')
    .order('received_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[inbox] database query failed:', error)
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Inbox</h1>
        <Card className="border-critical bg-critical-soft p-4 text-critical">
          Could not read communications — {error.message}
        </Card>
      </div>
    )
  }

  const all = (data ?? []) as InboxRow[]
  const unparsed = all.filter((row) => row.parse_status === null).length

  return <InboxView rows={all} view={view} unparsedCount={unparsed} />
}
