import Link from 'next/link'
import { Card, CardHeader, CardTitle } from '@/components/ui'
import { createClient } from '@/lib/supabase/server'
import { FREIGHT_MODE_LABELS, type Cha, type FreightQuoteRequestSummary } from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { RequestChip } from './freight-ui'
import { NewRequestForm, type ShipmentOption } from './new-request-form'

export const dynamic = 'force-dynamic'

export default async function FreightQuotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [requestsResult, shipmentsResult, chasResult, importResult] = await Promise.all([
    supabase
      .from('v_freight_quote_requests')
      .select('*')
      .eq('import_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('shipments')
      .select(
        'id, seq, shipment_no, mode, origin_port, destination_port, incoterm, gross_weight_kg, chargeable_weight_kg, cbm, packages',
      )
      .eq('import_id', id)
      .order('seq'),
    supabase.from('chas').select('*').eq('is_active', true).order('name'),
    supabase
      .from('imports')
      .select('origin_country, incoterm, title')
      .eq('id', id)
      .maybeSingle(),
  ])

  const requests = (requestsResult.data ?? []) as FreightQuoteRequestSummary[]

  return (
    <div className="space-y-4">
      <NewRequestForm
        importId={id}
        shipments={(shipmentsResult.data ?? []) as ShipmentOption[]}
        chas={(chasResult.data ?? []) as Cha[]}
        defaults={{
          origin: importResult.data?.origin_country ?? '',
          destination: '',
          incoterm: importResult.data?.incoterm ?? '',
          cargo_description: importResult.data?.title ?? '',
        }}
      />

      {requests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Requests</CardTitle>
            <span className="text-ink-muted">{requests.length}</span>
          </CardHeader>

          <ul className="divide-y">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/imports/${id}/freight-quotes/${request.id}`}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-surface-sunken"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-medium">{request.request_no}</span>
                    <span className="text-ink-muted">
                      {FREIGHT_MODE_LABELS[request.mode] ?? request.mode}
                    </span>
                    <span className="text-ink-muted">
                      {[request.origin, request.destination].filter(Boolean).join(' → ')}
                    </span>
                    <RequestChip status={request.status} />
                  </span>

                  <span className="flex items-center gap-3 whitespace-nowrap text-ink-muted">
                    {request.response_deadline && (
                      <span>by {formatDate(request.response_deadline)}</span>
                    )}
                    <span className="tnum">
                      {request.submitted_count}/{request.recipient_count} in
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
