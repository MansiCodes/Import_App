/**
 * The fixtures below are the real text that comes out of the two supplier
 * documents this was built for — Liaoning Rongda's commercial invoice and
 * packing list for ATC/PO/26-27/013 — copied verbatim from the extractor,
 * including the full-width colons, the stray space in "26 -27", and the merged
 * "0.25360" where the packing list's totals column bled into the next row.
 *
 * They are kept exactly as they arrive on purpose. A tidied fixture would test
 * a document nobody will ever upload.
 */

import { describe, expect, it } from 'vitest'
import { parseDocument, parseDocumentDate, tidyReference } from './parse'
import {
  chargeableWeightKg,
  describeCargo,
  mergeDocuments,
  volumetricWeightKg,
} from './merge'

const PACKING_LIST = `RONGDA
Liaoning Rongda Foreign Trade Co., Ltd.
Room 403,No.11-2 KECHECHANG XILI，YINGKOU,PILOT FREE
TRADE ZONE (LIAONING) CHINA
Tel: +8618604079002
PACKING LIST
BILL TO:
ATLANTA TELE CABLES
56/27 , SECTOR 62
NOIDA UTTAR PRADESH GB NAGAR 201301
IEC NO 6116500463 GSTIN 09ACXPJ4171A1ZH
MATERI BY AIR
SHIP TO:
ATLANTA TELE CABLES
56/27 , SECTOR 62
NOIDA UTTAR PRADESH GB NAGAR 201301
Date：Sep.03, 2026
PI NO.:ATC/PO/26 -27/013
Invoice No.:TCATC260903
QTY Specification Production Description DIMENSION
(cm)
PACKAGE
S N.W G.W VOLUME
100 TCFSZ5131 Water Proof Base
(Heat Detector) 53.5*41.5*21.6 1 4.00
66.60 0.25360 NF5260 Current Isolator 53.5*41.5*21.6 3 43.20
120 NF5261 Input Module 53.5*41.5*21.5 1 14.40
580 TOTAL: 5 61.60 66.60 0.25
Total： 5 cartons
Gross Weight Total: 66.60 kgs
Volume Total: 0.25 m3`

const COMMERCIAL_INVOICE = `RONGDA
Liaoning Rongda Foreign Trade Co., Ltd.
Room 403,No.11-2 KECHECHANG XILI，YINGKOU,PILOT FREE
TRADE ZONE (LIAONING) CHINA
Tel: +8618604079002
COMMERCIAL INVOICE
BILL TO:
ATLANTA TELE CABLES
56/27 , SECTOR 62
NOIDA UTTAR PRADESH GB NAGAR 201301
IEC NO 6116500463 GSTIN 09ACXPJ4171A1ZH
MATERI BY AIR
SHIP TO:
ATLANTA TELE CABLES
56/27 , SECTOR 62
NOIDA UTTAR PRADESH GB NAGAR 201301
Date：Sep.03, 2026
PI NO.:ATC/PO/26-27/013
Invoice No.:TCATC260903
No. Specification Production Description QTY Unit price
(USD)
Value
(USD) COMMENT
1 TCFSZ5131 Water Proof Base
(Heat Detector) 100 4.00 /pc 400.00
2 NF5260 Current Isolator 360 3.83 /pc 1,378.80
3 NF5261 Input Module 120 4.00 /pc 480.00
580 Total
amount: US$2,258.80
FOB CHINA BY AIR`

describe('the commercial invoice', () => {
  const doc = parseDocument(COMMERCIAL_INVOICE)

  it('knows what it is', () => {
    expect(doc.kind).toBe('commercial_invoice')
  })

  it('reads the header', () => {
    expect(doc.supplierName).toBe('Liaoning Rongda Foreign Trade Co., Ltd.')
    expect(doc.buyerName).toBe('ATLANTA TELE CABLES')
    expect(doc.documentDate).toBe('2026-09-03')
    expect(doc.piNumber).toBe('ATC/PO/26-27/013')
    expect(doc.invoiceNumber).toBe('TCATC260903')
  })

  it('reads the money', () => {
    expect(doc.currency).toBe('USD')
    expect(doc.totalValue).toBe(2258.8)
    expect(doc.totalQuantity).toBe(580)
  })

  it('reads the terms of sale', () => {
    expect(doc.incoterm).toBe('FOB')
    expect(doc.originCountry).toBe('China')
    expect(doc.modeHint).toBe('AIR')
  })

  it('reads every line, including the one that wrapped', () => {
    expect(doc.items).toHaveLength(3)
    expect(doc.items[0]).toMatchObject({
      specification: 'TCFSZ5131',
      description: 'Water Proof Base (Heat Detector)',
      quantity: 100,
      unitPrice: 4,
      amount: 400,
    })
    expect(doc.items[1]).toMatchObject({
      specification: 'NF5260',
      quantity: 360,
      unitPrice: 3.83,
      amount: 1378.8,
    })
    expect(doc.items[2]).toMatchObject({ specification: 'NF5261', quantity: 120, amount: 480 })
  })

  it('adds up to what the document says it adds up to', () => {
    const lines = doc.items.reduce((sum, i) => sum + (i.amount ?? 0), 0)
    expect(Math.round(lines * 100) / 100).toBe(doc.totalValue)
    expect(doc.items.reduce((sum, i) => sum + (i.quantity ?? 0), 0)).toBe(doc.totalQuantity)
    expect(doc.warnings).toEqual([])
  })
})

describe('the packing list', () => {
  const doc = parseDocument(PACKING_LIST)

  it('knows what it is', () => {
    expect(doc.kind).toBe('packing_list')
  })

  it('reads the totals from the sentences that state them', () => {
    expect(doc.grossWeightKg).toBe(66.6)
    expect(doc.netWeightKg).toBe(61.6)
    expect(doc.cbm).toBe(0.25)
    expect(doc.packageCount).toBe(5)
    expect(doc.totalQuantity).toBe(580)
  })

  it('matches the same shipment as the invoice, despite the stray space', () => {
    expect(doc.piNumber).toBe('ATC/PO/26-27/013')
    expect(doc.invoiceNumber).toBe('TCATC260903')
  })

  it('refuses to read a quantity out of a total that bled into the row', () => {
    // "66.60 0.25360 NF5260" — the gross weight and volume landed inside the
    // second row. Reading 25,360 pieces there would be worse than missing it.
    const quantities = doc.items.map((i) => i.quantity)
    expect(quantities).not.toContain(25360)
    expect(quantities).not.toContain(25)
  })

  it('says so when the rows it read do not add up', () => {
    expect(doc.warnings.join(' ')).toMatch(/against a stated total of 580/)
  })

  it('still reads the rows it can, with their boxes', () => {
    expect(doc.items.length).toBeGreaterThanOrEqual(2)
    expect(doc.items[0]).toMatchObject({
      specification: 'TCFSZ5131',
      dimensionsCm: '53.5*41.5*21.6',
      packages: 1,
    })
  })
})

describe('reading the two together', () => {
  const merged = mergeDocuments([
    parseDocument(COMMERCIAL_INVOICE),
    parseDocument(PACKING_LIST),
  ])

  it('takes money from the invoice and weight from the packing list', () => {
    expect(merged.totalValue).toBe(2258.8)
    expect(merged.currency).toBe('USD')
    expect(merged.sources.totalValue).toBe('commercial invoice')

    expect(merged.grossWeightKg).toBe(66.6)
    expect(merged.cbm).toBe(0.25)
    expect(merged.packageCount).toBe(5)
    expect(merged.sources.grossWeightKg).toBe('packing list')
  })

  it('takes the invoice’s clean line items and adds the packing list’s boxes', () => {
    expect(merged.items).toHaveLength(3)
    expect(merged.items.reduce((s, i) => s + (i.quantity ?? 0), 0)).toBe(580)

    const base = merged.items.find((i) => i.specification === 'TCFSZ5131')
    expect(base).toMatchObject({ quantity: 100, amount: 400, dimensionsCm: '53.5*41.5*21.6' })
  })

  it('works out the chargeable weight and shows both figures', () => {
    // 0.25 m³ at 6000 cm³/kg is 41.67 kg, which is lighter than the goods, so
    // the airline charges on the actual 66.60 kg.
    expect(merged.volumetricWeightKg).toBe(41.67)
    expect(merged.chargeableWeightKg).toBe(66.6)
    expect(merged.sources.chargeableWeightKg).toBe('worked out from weight and volume')
  })

  it('describes the cargo', () => {
    expect(merged.cargoDescription).toBe(
      '580 pcs — Water Proof Base (Heat Detector), Current Isolator, Input Module',
    )
  })

  it('carries the mode and terms through', () => {
    expect(merged.mode).toBe('AIR')
    expect(merged.incoterm).toBe('FOB')
    expect(merged.originCountry).toBe('China')
    expect(merged.piNumber).toBe('ATC/PO/26-27/013')
  })

  it('does not complain when the two documents agree', () => {
    expect(merged.warnings.join(' ')).not.toMatch(/disagree/)
  })
})

describe('two documents from different shipments', () => {
  it('says so instead of merging them', () => {
    const other = PACKING_LIST.replace('ATC/PO/26 -27/013', 'ATC/PO/26-27/099')
    const merged = mergeDocuments([parseDocument(COMMERCIAL_INVOICE), parseDocument(other)])

    expect(merged.warnings.join(' ')).toMatch(/disagree about the PI number/)
  })
})

describe('a packing list on its own', () => {
  const merged = mergeDocuments([parseDocument(PACKING_LIST)])

  it('still gives the freight figures', () => {
    expect(merged.grossWeightKg).toBe(66.6)
    expect(merged.cbm).toBe(0.25)
    expect(merged.packageCount).toBe(5)
    expect(merged.chargeableWeightKg).toBe(66.6)
  })

  it('has no money to report, and does not invent any', () => {
    expect(merged.totalValue).toBeNull()
  })
})

describe('chargeable weight', () => {
  it('is the greater of actual and volumetric, for air', () => {
    expect(chargeableWeightKg('AIR', 66.6, 0.25)).toBe(66.6)
    // A light, bulky consignment: 2 m³ is 333.33 kg volumetric.
    expect(chargeableWeightKg('AIR', 80, 2)).toBe(333.33)
  })

  it('is not a weight at all for sea, which is priced by the cubic metre', () => {
    expect(chargeableWeightKg('SEA_LCL', 66.6, 0.25)).toBeNull()
    expect(chargeableWeightKg(null, 66.6, 0.25)).toBeNull()
  })

  it('works with only one of the two figures', () => {
    expect(chargeableWeightKg('AIR', 66.6, null)).toBe(66.6)
    expect(chargeableWeightKg('AIR', null, 0.25)).toBe(41.67)
    expect(chargeableWeightKg('AIR', null, null)).toBeNull()
  })

  it('uses the 6000 divisor, not the courier one', () => {
    expect(volumetricWeightKg(1)).toBe(166.67)
    expect(volumetricWeightKg(0)).toBeNull()
    expect(volumetricWeightKg(null)).toBeNull()
  })
})

describe('reference numbers', () => {
  it('closes the gaps the layout opened', () => {
    expect(tidyReference('ATC/PO/26 -27/013')).toBe('ATC/PO/26-27/013')
    expect(tidyReference('  TCATC260903 ')).toBe('TCATC260903')
    expect(tidyReference('ATC / PO / 26-27 / 013')).toBe('ATC/PO/26-27/013')
  })
})

describe('dates', () => {
  it('reads the ones that can only mean one thing', () => {
    expect(parseDocumentDate('Sep.03, 2026')).toBe('2026-09-03')
    expect(parseDocumentDate('September 3, 2026')).toBe('2026-09-03')
    expect(parseDocumentDate('3 Sep 2026')).toBe('2026-09-03')
    expect(parseDocumentDate('2026-09-03')).toBe('2026-09-03')
  })

  it('refuses the ones that could mean two', () => {
    // September third or March ninth, depending on who typed it.
    expect(parseDocumentDate('03/09/2026')).toBeNull()
  })
})

describe('describeCargo', () => {
  it('says nothing when there is nothing to describe', () => {
    expect(describeCargo([], 580)).toBeNull()
  })
})
