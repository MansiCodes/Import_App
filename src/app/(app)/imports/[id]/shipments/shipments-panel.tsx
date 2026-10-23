'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Ship } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Fact,
  Field,
  FormGrid,
  Input,
  PanelSection,
  Select,
  Textarea,
  type BadgeTone,
} from '@/components/ui'
import { formatDate } from '@/lib/utils'
import {
  SHIPMENT_MODES,
  SHIPMENT_STATUSES,
  type Cha,
  type ChaAgent,
  type Shipment,
  type ShipmentMode,
} from '@/lib/types'
import { deleteShipment, saveShipment, type ActionResult } from './actions'

const STATUS_TONES: Record<string, BadgeTone> = {
  Planned: 'neutral',
  Booked: 'accent',
  'Picked Up': 'accent',
  'In Transit': 'upcoming',
  Arrived: 'due',
  'Customs Cleared': 'due',
  Delivered: 'done',
  Cancelled: 'neutral',
}

const MODE_LABELS: Record<ShipmentMode, string> = {
  air: 'Air',
  sea: 'Sea',
  courier: 'Courier',
  road: 'Road',
}

/** Identifier fields shown per mode — a courier is not asked for a vessel. */
function ModeFields({ mode, shipment }: { mode: ShipmentMode; shipment?: Shipment }) {
  if (mode === 'courier') {
    return (
      <>
        <Field label="Tracking number" htmlFor="tracking_no">
          <Input id="tracking_no" name="tracking_no" defaultValue={shipment?.tracking_no ?? ''} />
        </Field>
        <Field label="Courier" htmlFor="carrier">
          <Input id="carrier" name="carrier" placeholder="DHL" defaultValue={shipment?.carrier ?? ''} />
        </Field>
      </>
    )
  }

  if (mode === 'air') {
    return (
      <>
        <Field label="AWB" htmlFor="awb">
          <Input id="awb" name="awb" defaultValue={shipment?.awb ?? ''} />
        </Field>
        <Field label="House AWB" htmlFor="hawb">
          <Input id="hawb" name="hawb" defaultValue={shipment?.hawb ?? ''} />
        </Field>
        <Field label="Master AWB" htmlFor="mawb">
          <Input id="mawb" name="mawb" defaultValue={shipment?.mawb ?? ''} />
        </Field>
        <Field label="Airline" htmlFor="carrier">
          <Input id="carrier" name="carrier" defaultValue={shipment?.carrier ?? ''} />
        </Field>
        <Field label="Flight" htmlFor="vessel_flight">
          <Input id="vessel_flight" name="vessel_flight" defaultValue={shipment?.vessel_flight ?? ''} />
        </Field>
        <Field label="Chargeable weight (kg)" htmlFor="chargeable_weight_kg">
          <Input
            id="chargeable_weight_kg"
            name="chargeable_weight_kg"
            type="number"
            step="any"
            defaultValue={shipment?.chargeable_weight_kg ?? ''}
          />
        </Field>
      </>
    )
  }

  if (mode === 'sea') {
    return (
      <>
        <Field label="Bill of lading" htmlFor="bl_no">
          <Input id="bl_no" name="bl_no" defaultValue={shipment?.bl_no ?? ''} />
        </Field>
        <Field label="BL date" htmlFor="bl_date">
          <Input id="bl_date" name="bl_date" type="date" defaultValue={shipment?.bl_date ?? ''} />
        </Field>
        <Field label="Shipping line" htmlFor="carrier">
          <Input id="carrier" name="carrier" defaultValue={shipment?.carrier ?? ''} />
        </Field>
        <Field label="Vessel" htmlFor="vessel_flight">
          <Input id="vessel_flight" name="vessel_flight" defaultValue={shipment?.vessel_flight ?? ''} />
        </Field>
        <Field label="Container numbers" htmlFor="container_nos" className="lg:col-span-2">
          <Input id="container_nos" name="container_nos" defaultValue={shipment?.container_nos ?? ''} />
        </Field>
        <Field label="CBM" htmlFor="cbm">
          <Input id="cbm" name="cbm" type="number" step="any" defaultValue={shipment?.cbm ?? ''} />
        </Field>
      </>
    )
  }

  return (
    <>
      <Field label="Transporter" htmlFor="carrier">
        <Input id="carrier" name="carrier" defaultValue={shipment?.carrier ?? ''} />
      </Field>
      <Field label="Vehicle" htmlFor="vessel_flight">
        <Input id="vessel_flight" name="vessel_flight" defaultValue={shipment?.vessel_flight ?? ''} />
      </Field>
    </>
  )
}

function ShipmentForm({
  importId,
  shipment,
  chas,
  agents,
  onDone,
}: {
  importId: string
  shipment?: Shipment
  chas: Cha[]
  agents: ChaAgent[]
  onDone: () => void
}) {
  const [mode, setMode] = useState<ShipmentMode>(shipment?.mode ?? 'sea')
  const [chaId, setChaId] = useState(shipment?.cha_id ?? '')

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await saveShipment(prev, formData)
      if (result.ok) onDone()
      return result
    },
    null,
  )

  const relevantAgents = agents.filter((a) => a.cha_id === chaId)

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-border bg-surface-sunken/30 p-4"
    >
      {shipment && <input type="hidden" name="id" value={shipment.id} />}
      <input type="hidden" name="import_id" value={importId} />

      <FormGrid>
        <Field label="Mode" htmlFor="mode" required>
          <Select
            id="mode"
            name="mode"
            required
            value={mode}
            onChange={(e) => setMode(e.target.value as ShipmentMode)}
          >
            {SHIPMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="status" required>
          <Select id="status" name="status" required defaultValue={shipment?.status ?? 'Planned'}>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="shipment_no" hint="Booking or job number">
          <Input id="shipment_no" name="shipment_no" defaultValue={shipment?.shipment_no ?? ''} />
        </Field>
        <Field label="Incoterm" htmlFor="incoterm">
          <Input id="incoterm" name="incoterm" placeholder="FOB" defaultValue={shipment?.incoterm ?? ''} />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          hint="What is in this lot"
          className="sm:col-span-2 lg:col-span-2"
        >
          <Input id="description" name="description" defaultValue={shipment?.description ?? ''} />
        </Field>

        <Field label="Origin country" htmlFor="origin_country">
          <Input id="origin_country" name="origin_country" defaultValue={shipment?.origin_country ?? ''} />
        </Field>
        <Field label="Origin port" htmlFor="origin_port">
          <Input id="origin_port" name="origin_port" defaultValue={shipment?.origin_port ?? ''} />
        </Field>
        <Field label="Destination port" htmlFor="destination_port">
          <Input
            id="destination_port"
            name="destination_port"
            defaultValue={shipment?.destination_port ?? ''}
          />
        </Field>
        <Field label="Freight terms" htmlFor="freight_terms">
          <Input
            id="freight_terms"
            name="freight_terms"
            placeholder="Prepaid"
            defaultValue={shipment?.freight_terms ?? ''}
          />
        </Field>

        <Field label="Pickup" htmlFor="pickup_date">
          <Input id="pickup_date" name="pickup_date" type="date" defaultValue={shipment?.pickup_date ?? ''} />
        </Field>
        <Field label="ETD" htmlFor="etd">
          <Input id="etd" name="etd" type="date" defaultValue={shipment?.etd ?? ''} />
        </Field>
        <Field label="ETA" htmlFor="eta">
          <Input id="eta" name="eta" type="date" defaultValue={shipment?.eta ?? ''} />
        </Field>
        <Field label="Revised ETA" htmlFor="revised_eta" hint="Keeps the original">
          <Input id="revised_eta" name="revised_eta" type="date" defaultValue={shipment?.revised_eta ?? ''} />
        </Field>
        <Field label="Actual arrival" htmlFor="actual_arrival">
          <Input
            id="actual_arrival"
            name="actual_arrival"
            type="date"
            defaultValue={shipment?.actual_arrival ?? ''}
          />
        </Field>

        <ModeFields mode={mode} shipment={shipment} />

        <Field label="Packages" htmlFor="packages">
          <Input id="packages" name="packages" type="number" defaultValue={shipment?.packages ?? ''} />
        </Field>
        <Field label="Package type" htmlFor="package_type">
          <Input
            id="package_type"
            name="package_type"
            placeholder="cartons"
            defaultValue={shipment?.package_type ?? ''}
          />
        </Field>
        <Field label="Gross weight (kg)" htmlFor="gross_weight_kg">
          <Input
            id="gross_weight_kg"
            name="gross_weight_kg"
            type="number"
            step="any"
            defaultValue={shipment?.gross_weight_kg ?? ''}
          />
        </Field>
        <Field label="Net weight (kg)" htmlFor="net_weight_kg">
          <Input
            id="net_weight_kg"
            name="net_weight_kg"
            type="number"
            step="any"
            defaultValue={shipment?.net_weight_kg ?? ''}
          />
        </Field>
        {mode === 'sea' && (
          <Field label="Containers" htmlFor="container_count">
            <Input
              id="container_count"
              name="container_count"
              type="number"
              defaultValue={shipment?.container_count ?? ''}
            />
          </Field>
        )}

        <Field label="CHA" htmlFor="cha_id">
          <Select id="cha_id" name="cha_id" value={chaId} onChange={(e) => setChaId(e.target.value)}>
            <option value="">—</option>
            {chas.map((cha) => (
              <option key={cha.id} value={cha.id}>
                {cha.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Overseas agent"
          htmlFor="cha_agent_id"
          hint={chaId ? undefined : 'Pick a CHA first'}
        >
          <Select
            id="cha_agent_id"
            name="cha_agent_id"
            defaultValue={shipment?.cha_agent_id ?? ''}
            disabled={!chaId}
          >
            <option value="">—</option>
            {relevantAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
                {agent.country ? ` — ${agent.country}` : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Notes" htmlFor="notes" className="sm:col-span-2 lg:col-span-3">
          <Textarea id="notes" name="notes" defaultValue={shipment?.notes ?? ''} maxLength={2000} />
        </Field>
      </FormGrid>

      {state?.error && <p className="text-critical">{state.error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Saving…' : shipment ? 'Save shipment' : 'Add shipment'}
        </Button>
        <Button type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function ShipmentCard({
  shipment,
  importId,
  chas,
  agents,
}: {
  shipment: Shipment
  importId: string
  chas: Cha[]
  agents: ChaAgent[]
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const [deleteState, deleteAction, deleting] = useActionState<ActionResult | null, FormData>(
    deleteShipment,
    null,
  )

  const effectiveEta = shipment.revised_eta ?? shipment.eta
  const overdue =
    !shipment.actual_arrival &&
    effectiveEta !== null &&
    new Date(effectiveEta) < new Date(new Date().toDateString())

  const identifier =
    shipment.awb ?? shipment.bl_no ?? shipment.tracking_no ?? shipment.shipment_no ?? null

  return (
    <PanelSection
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>
            Lot {shipment.seq}
            {shipment.shipment_no && (
              <span className="font-normal text-ink-muted"> — {shipment.shipment_no}</span>
            )}
          </span>
          <Badge tone="accent">{MODE_LABELS[shipment.mode]}</Badge>
          <Badge tone={STATUS_TONES[shipment.status] ?? 'neutral'}>{shipment.status}</Badge>
          {overdue && <Badge tone="critical">Overdue</Badge>}
        </span>
      }
      icon={<Ship size={15} aria-hidden />}
      iconTone="accent"
      actions={
        !editing ? (
          <>
            <Link href={`/imports/${importId}/product-costing?shipment=${shipment.id}&view=shipment`}>
              <Button type="button">Cost this shipment</Button>
            </Link>
            <Button type="button" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </>
        ) : undefined
      }
    >
      {editing ? (
        <ShipmentForm
          importId={importId}
          shipment={shipment}
          chas={chas}
          agents={agents}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div>
          {shipment.description && (
            <p className="mb-4 text-[14px] text-ink-muted">{shipment.description}</p>
          )}

          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Route">
              {shipment.origin_port ?? shipment.origin_country ?? '—'} →{' '}
              {shipment.destination_port ?? '—'}
            </Fact>
            <Fact label="Identifier">
              <span className="font-mono">{identifier ?? '—'}</span>
            </Fact>
            <Fact label="ETD">{formatDate(shipment.etd)}</Fact>
            <Fact label={shipment.actual_arrival ? 'Arrived' : 'ETA'}>
              <span className={overdue ? 'text-critical' : undefined}>
                {formatDate(shipment.actual_arrival ?? effectiveEta)}
                {shipment.revised_eta && shipment.eta && shipment.revised_eta !== shipment.eta && (
                  <span className="ml-2 text-xs font-normal text-ink-faint">
                    was {formatDate(shipment.eta)}
                  </span>
                )}
              </span>
            </Fact>
            <Fact label="Carrier">
              {shipment.carrier ?? '—'}
              {shipment.vessel_flight && ` · ${shipment.vessel_flight}`}
            </Fact>
            <Fact label="Packages">
              {shipment.packages ?? '—'} {shipment.package_type ?? ''}
              {shipment.gross_weight_kg && ` · ${Number(shipment.gross_weight_kg)} kg`}
            </Fact>
            <Fact label="Incoterm">{shipment.incoterm ?? '—'}</Fact>
            <Fact label="Pickup">{formatDate(shipment.pickup_date)}</Fact>
          </dl>

          {shipment.notes && (
            <p className="mt-4 whitespace-pre-wrap text-[14px] text-ink-muted">{shipment.notes}</p>
          )}

          <div className="mt-5 border-t pt-4">
            {confirming ? (
              <form action={deleteAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={shipment.id} />
                <input type="hidden" name="import_id" value={importId} />
                <Field label="Type DELETE to remove this lot" htmlFor={`confirm-${shipment.id}`}>
                  <Input id={`confirm-${shipment.id}`} name="confirm" placeholder="DELETE" />
                </Field>
                <Button type="submit" variant="danger" disabled={deleting}>
                  {deleting ? 'Removing…' : 'Remove'}
                </Button>
                <Button type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>
                Remove this lot
              </Button>
            )}
            {deleteState?.error && <p className="mt-2 text-critical">{deleteState.error}</p>}
          </div>
        </div>
      )}
    </PanelSection>
  )
}

export function ShipmentsPanel({
  importId,
  shipments,
  chas,
  agents,
}: {
  importId: string
  shipments: Shipment[]
  chas: Cha[]
  agents: ChaAgent[]
}) {
  const [adding, setAdding] = useState(false)

  const countLabel =
    shipments.length === 0
      ? 'No lots yet.'
      : `${shipments.length} ${shipments.length === 1 ? 'lot' : 'lots'} against this order.`

  return (
    <div className="space-y-4">
      <PanelSection
        title="Shipments"
        description={countLabel}
        icon={<Ship size={15} aria-hidden />}
        iconTone="accent"
        className={adding ? undefined : 'pb-5'}
        actions={
          !adding ? (
            <Button type="button" variant="primary" onClick={() => setAdding(true)}>
              Add a lot
            </Button>
          ) : undefined
        }
      >
        {adding ? (
          <ShipmentForm
            importId={importId}
            chas={chas}
            agents={agents}
            onDone={() => setAdding(false)}
          />
        ) : null}
      </PanelSection>

      {shipments.length === 0 && !adding ? (
        <EmptyState
          title="Nothing shipped yet"
          description="One order can dispatch in several lots. Each carries its own dates, documents, customs entry and delivery."
          action={
            <Button type="button" variant="primary" onClick={() => setAdding(true)}>
              Add the first lot
            </Button>
          }
        />
      ) : (
        shipments.map((shipment) => (
          <ShipmentCard
            key={shipment.id}
            shipment={shipment}
            importId={importId}
            chas={chas}
            agents={agents}
          />
        ))
      )}
    </div>
  )
}
