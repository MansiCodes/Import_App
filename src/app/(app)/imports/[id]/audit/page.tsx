import { Badge, Card, CardHeader, CardTitle, EmptyState } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface AuditRow {
  id: string
  user_email: string | null
  table_name: string
  action: 'insert' | 'update' | 'delete'
  changed_fields: Record<string, { old: unknown; new: unknown }> | null
  created_at: string
}

const ACTION_TONES = { insert: 'done', update: 'accent', delete: 'critical' } as const

/** Noise columns — surrogate keys and stamps say nothing about what a person did. */
const HIDDEN_FIELDS = new Set(['id', 'created_at', 'updated_at', 'created_by'])

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '—' : value
  return JSON.stringify(value)
}

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data } = await supabase
    .from('audit_log')
    .select('id, user_email, table_name, action, changed_fields, created_at')
    .eq('import_id', id)
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as AuditRow[]

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No changes recorded yet"
        description="Every change to this import is logged here by the database itself, so nothing can be altered without leaving a trace."
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Audit trail</CardTitle>
          <p className="text-ink-muted">
            Written by a database trigger, not the app — and it cannot be deleted through the
            application.
          </p>
        </div>
      </CardHeader>

      <ul className="divide-y">
        {rows.map((row) => {
          const fields = Object.entries(row.changed_fields ?? {}).filter(
            ([key]) => !HIDDEN_FIELDS.has(key),
          )

          return (
            <li key={row.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={ACTION_TONES[row.action]}>{row.action}</Badge>
                <span className="font-mono text-ink-muted">{row.table_name}</span>
                <span className="text-ink-faint">
                  {new Date(row.created_at).toLocaleString('en-IN')}
                </span>
                <span className="text-ink-faint">
                  {row.user_email ?? 'system'}
                </span>
              </div>

              {fields.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {fields.map(([field, change]) => (
                    <li key={field} className="flex flex-wrap gap-2">
                      <span className="font-mono text-ink-muted">{field}</span>
                      {row.action === 'update' ? (
                        <>
                          <span className="text-ink-faint line-through">
                            {renderValue(change.old)}
                          </span>
                          <span aria-hidden>→</span>
                          <span>{renderValue(change.new)}</span>
                        </>
                      ) : (
                        <span>{renderValue(change.new ?? change.old)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
