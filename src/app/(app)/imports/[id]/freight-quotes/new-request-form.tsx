'use client'

import { useActionState, useState } from 'react'
import { Button, Card, CardHeader, CardTitle, Input } from '@/components/ui'
import type { Cha } from '@/lib/types'
import type { MergedShipment } from '@/lib/pdf-import/merge'
import { PdfImportPanel, type FilledField } from '../../pdf-import-panel'
import { Choice } from './freight-ui'
import { createRequestWithRecipients, type ActionResult } from './actions'

export interface ShipmentOption {
  id: string
  seq: number
  shipment_no: string | null
  mode: string
  origin_port: string | null
  destination_port: string | null
  incoterm: string | null
  gross_weight_kg: string | null
  chargeable_weight_kg: string | null
  cbm: string | null
  packages: number | null
}

export interface RequestDefaults {
  origin: string
  destination: string
  incoterm: string
  cargo_description: string
}

/** One labelled input, sized to its content rather than stretched to the grid. */
function Cell({
  label,
  name,
  value,
  onChange,
  type = 'text',
  suffix,
  placeholder,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  type?: string
  suffix?: string
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-ink-muted">{label}</span>
      <span className="flex items-center gap-1.5">
        <Input
          name={name}
          type={type}
          step={type === 'number' ? 'any' : undefined}
          min={type === 'number' ? '0' : undefined}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={type === 'number' ? 'tnum' : undefined}
        />
        {suffix && <span className="shrink-0 text-ink-faint">{suffix}</span>}
      </span>
    </label>
  )
}

/**
 * Create a request and every link in one pass.
 *
 * Mode, the facts the CHA will see, and who is being asked all live on one
 * card, because they are one decision. The previous flow created an empty
 * request and then made the operator navigate to a second screen to add
 * recipients, which split that decision across two pages for no reason.
 */
export function NewRequestForm({
  importId,
  shipments,
  chas,
  defaults,
}: {
  importId: string
  shipments: ShipmentOption[]
  chas: Cha[]
  defaults: RequestDefaults
}) {
  const [open, setOpen] = useState(false)

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await createRequestWithRecipients(prev, formData)
      if (result.ok) setOpen(false)
      return result
    },
    null,
  )

  const [mode, setMode] = useState<'AIR' | 'SEA_LCL'>('AIR')
  const [shipmentId, setShipmentId] = useState('')
  const [selectedChas, setSelectedChas] = useState<string[]>([])
  const [extras, setExtras] = useState<string[]>([])
  const [facts, setFacts] = useState({
    origin: defaults.origin,
    destination: defaults.destination,
    incoterm: defaults.incoterm,
    cargo_description: defaults.cargo_description,
    gross_weight_kg: '',
    chargeable_weight_kg: '',
    cbm: '',
    package_count: '',
    pallet_count: '',
  })

  const isAir = mode === 'AIR'

  /** Adopt a lot's figures, but never overwrite something already typed. */
  function pickShipment(id: string) {
    setShipmentId(id)
    const shipment = shipments.find((s) => s.id === id)
    if (!shipment) return

    setFacts((prev) => ({
      ...prev,
      origin: shipment.origin_port ?? prev.origin,
      destination: shipment.destination_port ?? prev.destination,
      incoterm: shipment.incoterm ?? prev.incoterm,
      gross_weight_kg: shipment.gross_weight_kg ?? prev.gross_weight_kg,
      chargeable_weight_kg: shipment.chargeable_weight_kg ?? prev.chargeable_weight_kg,
      cbm: shipment.cbm ?? prev.cbm,
      package_count: shipment.packages ? String(shipment.packages) : prev.package_count,
    }))
  }

  /**
   * Take the figures out of the supplier's own paperwork.
   *
   * The packing list states the gross weight, the carton count and the volume;
   * the invoice states the incoterm, the origin and what is in the boxes. That
   * is most of this section, and typing it again is where the wrong chargeable
   * weight comes from.
   *
   * Nothing already typed is overwritten, and the mode is only switched when
   * the documents say so and nobody has touched it.
   */
  function applyDocuments(shipment: MergedShipment): FilledField[] {
    const filled: FilledField[] = []
    const source = (field: string) => shipment.sources[field] ?? 'document'

    const next = { ...facts }
    const set = (key: keyof typeof facts, value: string | null, label: string, field: string) => {
      if (value === null || value === '' || next[key]) return
      next[key] = value
      filled.push({ label, value, source: source(field) })
    }

    // Destination is deliberately not filled: "SHIP TO" on these documents is
    // our own office, not the airport or port the CHA needs to quote to.
    set('origin', shipment.originCountry, 'Origin', 'originCountry')
    set('incoterm', shipment.incoterm, 'Incoterm', 'incoterm')
    set('cargo_description', shipment.cargoDescription, 'Cargo', 'totalQuantity')
    set(
      'gross_weight_kg',
      shipment.grossWeightKg === null ? null : String(shipment.grossWeightKg),
      'Gross weight',
      'grossWeightKg',
    )
    set('cbm', shipment.cbm === null ? null : String(shipment.cbm), 'CBM', 'cbm')
    set(
      'package_count',
      shipment.packageCount === null ? null : String(shipment.packageCount),
      'Packages',
      'packageCount',
    )

    if (shipment.mode && selectedChas.length === 0 && !facts.gross_weight_kg) {
      setMode(shipment.mode)
      filled.push({ label: 'Mode', value: shipment.mode === 'AIR' ? 'Air' : 'Sea LCL', source: source('mode') })
    }

    // Air is charged on the greater of actual and volumetric weight. Filled in
    // because it is arithmetic, not a judgement — and shown alongside the two
    // figures it came from so it can be checked.
    const chargeable = shipment.chargeableWeightKg
    if ((shipment.mode ?? mode) === 'AIR' && chargeable !== null && !next.chargeable_weight_kg) {
      next.chargeable_weight_kg = String(chargeable)
      filled.push({
        label: 'Chargeable weight',
        value: `${chargeable} kg`,
        source:
          shipment.volumetricWeightKg !== null
            ? `greater of ${shipment.grossWeightKg ?? '—'} kg actual and ${shipment.volumetricWeightKg} kg volumetric`
            : 'gross weight',
      })
    }

    setFacts(next)
    return filled
  }

  const recipientCount = selectedChas.length + extras.filter((n) => n.trim()).length

  if (!open) {
    return (
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Freight quotations</CardTitle>
            <p className="text-ink-muted">
              Ask several CHAs for a quote, then compare what comes back side by side.
            </p>
          </div>
          <Button variant="primary" onClick={() => setOpen(true)}>
            New quote request
          </Button>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New freight quote request</CardTitle>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
      </CardHeader>

      <form action={formAction} className="space-y-6 p-4">
        <input type="hidden" name="import_id" value={importId} />
        <input type="hidden" name="mode" value={mode} />
        <input type="hidden" name="shipment_id" value={shipmentId} />
        {selectedChas.map((id) => (
          <input key={id} type="hidden" name="cha_ids" value={id} />
        ))}
        {extras
          .filter((name) => name.trim())
          .map((name, index) => (
            <input key={index} type="hidden" name="extra_names" value={name.trim()} />
          ))}

        <section>
          <h3 className="mb-2 font-medium">1 · Mode</h3>
          <div className="flex flex-wrap gap-2">
            <Choice selected={isAir} onClick={() => setMode('AIR')} className="min-w-32">
              Air
            </Choice>
            <Choice selected={!isAir} onClick={() => setMode('SEA_LCL')} className="min-w-32">
              Sea LCL
            </Choice>
          </div>
        </section>

        <section>
          <h3 className="mb-1 font-medium">2 · What the CHA will see</h3>
          <p className="mb-3 text-ink-muted">
            Filled in from this import. Correct anything that is wrong before the links exist.
          </p>

          <div className="mb-3">
            <PdfImportPanel
              onApply={applyDocuments}
              hint="The packing list gives the weight, cartons and volume; the invoice gives the terms and the cargo."
            />
          </div>

          {shipments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <Choice selected={shipmentId === ''} onClick={() => setShipmentId('')}>
                No shipment yet
              </Choice>
              {shipments.map((shipment) => (
                <Choice
                  key={shipment.id}
                  selected={shipmentId === shipment.id}
                  onClick={() => pickShipment(shipment.id)}
                >
                  Lot {shipment.seq}
                  {shipment.shipment_no ? ` · ${shipment.shipment_no}` : ''}
                </Choice>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Cell
              label="Origin"
              name="origin"
              value={facts.origin}
              onChange={(v) => setFacts({ ...facts, origin: v })}
            />
            <Cell
              label="Destination"
              name="destination"
              value={facts.destination}
              onChange={(v) => setFacts({ ...facts, destination: v })}
            />
            <Cell
              label="Incoterm"
              name="incoterm"
              value={facts.incoterm}
              onChange={(v) => setFacts({ ...facts, incoterm: v })}
              placeholder="EXW"
            />
            <Cell
              label="Gross weight"
              name="gross_weight_kg"
              type="number"
              suffix="kg"
              value={facts.gross_weight_kg}
              onChange={(v) => setFacts({ ...facts, gross_weight_kg: v })}
            />

            {/* Only the field this mode is actually priced on. */}
            {isAir ? (
              <Cell
                label="Chargeable weight"
                name="chargeable_weight_kg"
                type="number"
                suffix="kg"
                value={facts.chargeable_weight_kg}
                onChange={(v) => setFacts({ ...facts, chargeable_weight_kg: v })}
              />
            ) : (
              <Cell
                label="CBM"
                name="cbm"
                type="number"
                value={facts.cbm}
                onChange={(v) => setFacts({ ...facts, cbm: v })}
              />
            )}

            {/*
              The mode decides which figure is SHOWN, not which is kept. A
              packing list gives both the weight and the volume, and the one
              this mode is not priced on is still worth recording — it is what
              a volumetric weight is worked out from, and it is needed the day
              the shipment moves by sea instead.
            */}
            <input
              type="hidden"
              name={isAir ? 'cbm' : 'chargeable_weight_kg'}
              value={isAir ? facts.cbm : facts.chargeable_weight_kg}
            />

            <Cell
              label="Packages"
              name="package_count"
              type="number"
              value={facts.package_count}
              onChange={(v) => setFacts({ ...facts, package_count: v })}
            />
            <Cell
              label="Pallets"
              name="pallet_count"
              type="number"
              value={facts.pallet_count}
              onChange={(v) => setFacts({ ...facts, pallet_count: v })}
            />
            <Cell
              label="Cargo"
              name="cargo_description"
              value={facts.cargo_description}
              onChange={(v) => setFacts({ ...facts, cargo_description: v })}
            />
          </div>
        </section>

        <section>
          <h3 className="mb-1 font-medium">3 · Request quotes from</h3>
          <p className="mb-3 text-ink-muted">
            One private link per company. You paste each into their WhatsApp group.
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {chas.map((cha) => {
              const selected = selectedChas.includes(cha.id)
              return (
                <label
                  key={cha.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition ${
                    selected
                      ? 'border-accent bg-accent-soft'
                      : 'border-border-strong hover:bg-surface-sunken'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() =>
                      setSelectedChas((prev) =>
                        prev.includes(cha.id)
                          ? prev.filter((id) => id !== cha.id)
                          : [...prev, cha.id],
                      )
                    }
                    className="size-4"
                  />
                  <span className={selected ? 'font-medium' : ''}>{cha.name}</span>
                </label>
              )
            })}
          </div>

          {extras.map((name, index) => (
            <div key={index} className="mt-2 flex items-center gap-2">
              <Input
                value={name}
                placeholder="Company name"
                onChange={(e) =>
                  setExtras((prev) => prev.map((n, i) => (i === index ? e.target.value : n)))
                }
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => setExtras((prev) => prev.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            onClick={() => setExtras((prev) => [...prev, ''])}
          >
            + Add another company
          </Button>
        </section>

        <section>
          <h3 className="mb-3 font-medium">4 · Optional</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-ink-muted">Reply by</span>
              <Input name="response_deadline" type="date" />
            </label>
            <label className="block">
              <span className="mb-1 block text-ink-muted">Note for the CHA</span>
              <Input name="request_notes" placeholder="Anything they should know" />
            </label>
          </div>
        </section>

        {state?.error && (
          <p className="rounded-lg bg-critical-soft px-3 py-2 text-critical">{state.error}</p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button type="submit" variant="primary" disabled={pending || recipientCount === 0}>
            {pending
              ? 'Creating…'
              : recipientCount === 0
                ? 'Create request & generate links'
                : `Create request & generate ${recipientCount} link${recipientCount === 1 ? '' : 's'}`}
          </Button>
          {recipientCount === 0 && (
            <span className="text-ink-muted">Choose at least one company above.</span>
          )}
        </div>
      </form>
    </Card>
  )
}
