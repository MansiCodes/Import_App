import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, MessageSquare, UserRound } from 'lucide-react'
import { Badge, Fact, PanelSection } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import type { Communication, CommunicationAttachment, CommunicationParse } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { MatchPanel } from './match-panel'
import { StatusControls } from './status-controls'

export const dynamic = 'force-dynamic'

function daysUntil(when: string): number {
  return Math.ceil((new Date(when).getTime() - Date.now()) / 86_400_000)
}

export default async function CommunicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: communication } = await supabase
    .from('communications')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!communication) notFound()
  const message = communication as Communication

  const [membersResult, attachmentsResult, importsResult] = await Promise.all([
    supabase.from('communication_parse_members').select('parse_id').eq('communication_id', id),
    supabase
      .from('communication_attachments')
      .select('*')
      .eq('communication_id', id)
      .order('created_at'),
    supabase
      .from('v_import_summary')
      .select('id, import_no, supplier_name, company_code, status')
      .order('import_no', { ascending: false }),
  ])

  const parseIds = (membersResult.data ?? []).map((row) => row.parse_id)

  const { data: parses } = parseIds.length
    ? await supabase
        .from('communication_parses')
        .select('*')
        .in('id', parseIds)
        .neq('status', 'superseded')
        .order('created_at', { ascending: false })
        .limit(1)
    : { data: [] }

  const parse = (parses?.[0] ?? null) as CommunicationParse | null
  const attachments = (attachmentsResult.data ?? []) as CommunicationAttachment[]
  const imports = importsResult.data ?? []

  const linkedImport = message.import_id ? imports.find((i) => i.id === message.import_id) : null

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to Inbox
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Message</h1>
            <p className="mt-1 text-[14px] text-ink-muted">
              {message.source === 'manual' ? 'Entered by hand' : 'WhatsApp'} · received{' '}
              {formatDate(message.received_at)}
            </p>
          </div>
          <Badge tone={message.source === 'manual' ? 'neutral' : 'accent'}>
            {message.source === 'manual' ? 'Manual' : 'WhatsApp'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <PanelSection
            title="What was said"
            description={
              message.sent_at
                ? `Sent ${formatDate(message.sent_at)}`
                : 'No provider timestamp'
            }
            icon={<MessageSquare size={16} aria-hidden />}
            iconTone="accent"
          >
            {message.body_text ? (
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">
                {message.body_text}
              </p>
            ) : (
              <p className="text-[14px] text-ink-faint">
                No text — this message carried{' '}
                {attachments.length > 0 ? 'only a file' : 'nothing readable'}.
              </p>
            )}
          </PanelSection>

          {attachments.length > 0 && (
            <PanelSection
              title="Attachments"
              description="WhatsApp deletes media ~30 days after send — save to Drive via the import’s Documents tab."
              icon={<FileText size={16} aria-hidden />}
              iconTone="upcoming"
              actions={<Badge tone="neutral">{attachments.length}</Badge>}
            >
              <ul className="space-y-2">
                {attachments.map((attachment) => {
                  const days = attachment.provider_expires_at
                    ? daysUntil(attachment.provider_expires_at)
                    : null

                  return (
                    <li
                      key={attachment.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-surface-sunken/40 px-4 py-3"
                    >
                      <div>
                        <p className="text-[14px] font-semibold text-ink">
                          {attachment.file_name ?? 'Unnamed file'}
                        </p>
                        <p className="text-[12px] text-ink-faint">
                          {attachment.mime_type ?? 'unknown type'}
                        </p>
                      </div>
                      {days !== null && (
                        <Badge tone={days <= 7 ? 'critical' : days <= 14 ? 'due' : 'neutral'}>
                          {days <= 0
                            ? 'Expired at WhatsApp'
                            : `${days} day${days === 1 ? '' : 's'} left`}
                        </Badge>
                      )}
                    </li>
                  )
                })}
              </ul>
            </PanelSection>
          )}

          <MatchPanel
            communicationId={message.id}
            linkedImportId={message.import_id}
            linkedImportNo={linkedImport?.import_no ?? null}
            parse={parse}
            imports={imports}
          />
        </div>

        <div className="space-y-4">
          <PanelSection
            title="Sender"
            icon={<UserRound size={16} aria-hidden />}
            iconTone="neutral"
          >
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Fact label="Role">
                {message.sender_role && message.sender_role !== 'Unknown' ? (
                  <Badge tone="waiting">{message.sender_role}</Badge>
                ) : (
                  <span className="text-ink-muted">Unknown</span>
                )}
              </Fact>
              <Fact label="Name">{message.sender_name ?? '—'}</Fact>
              <Fact label="Number">
                <span className="font-mono">{message.sender_phone ?? '—'}</span>
              </Fact>
              <Fact label="Forwarded by">
                <span className="font-mono">{message.forwarded_by_phone ?? '—'}</span>
              </Fact>
              <Fact label="Recognised by">
                {message.sender_match_method === 'phone_exact'
                  ? 'Exact number'
                  : message.sender_match_method === 'phone_suffix'
                    ? 'Number without country code'
                    : 'Not recognised'}
              </Fact>
            </dl>

            {(!message.sender_role || message.sender_role === 'Unknown') && (
              <p className="mt-4 rounded-xl bg-surface-sunken px-3 py-2 text-[13px] text-ink-muted">
                Only supplier contacts, CHAs and overseas agents have phone numbers on record. A
                bank, customs office or transporter will always read as unknown — that is honest,
                not a failure.
              </p>
            )}
          </PanelSection>

          <StatusControls communicationId={message.id} status={message.status} />
        </div>
      </div>
    </div>
  )
}
