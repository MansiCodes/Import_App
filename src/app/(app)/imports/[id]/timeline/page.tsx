import { Card, CardHeader, CardTitle, EmptyState } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { AddNote } from './add-note'

export const dynamic = 'force-dynamic'

interface ActivityRow {
  id: string
  event_type: string
  title: string
  detail: string | null
  occurred_at: string
  created_by: string | null
}

/** Timeline entries read better grouped by day than as a flat list of stamps. */
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export default async function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('activity_log')
    .select('id, event_type, title, detail, occurred_at, created_by')
    .eq('import_id', id)
    .order('occurred_at', { ascending: false })

  const events = (data ?? []) as ActivityRow[]

  const days = events.reduce<Record<string, ActivityRow[]>>((acc, event) => {
    const key = dayLabel(event.occurred_at)
    ;(acc[key] ??= []).push(event)
    return acc
  }, {})

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {events.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="The timeline fills in automatically as the import progresses. You can add your own notes too."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
              <span className="text-ink-muted">{events.length} entries</span>
            </CardHeader>

            <div className="divide-y">
              {Object.entries(days).map(([day, dayEvents]) => (
                <div key={day} className="px-4 py-3">
                  <p className="mb-2 font-medium">{day}</p>
                  <ul className="space-y-2">
                    {dayEvents.map((event) => (
                      <li key={event.id} className="flex gap-3">
                        <span className="w-12 shrink-0 text-ink-faint tnum">
                          {timeLabel(event.occurred_at)}
                        </span>
                        <div className="min-w-0">
                          <p>{event.title}</p>
                          {event.detail && (
                            <p className="text-ink-muted">{event.detail}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <AddNote importId={id} />
    </div>
  )
}
