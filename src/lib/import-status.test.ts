import { describe, expect, it } from 'vitest'
import {
  daysOverdue,
  dueLabel,
  isActive,
  pipelineStage,
  statusTone,
  IMPORT_STATUSES,
} from './import-status'

// Fixed reference date so these never drift with the real clock.
const TODAY = new Date(2026, 7, 14) // 14 Aug 2026

describe('daysOverdue', () => {
  it('returns 0 on the due date itself', () => {
    expect(daysOverdue('2026-08-14', TODAY)).toBe(0)
  })

  it('counts whole days past due', () => {
    expect(daysOverdue('2026-08-10', TODAY)).toBe(4)
  })

  it('returns negative for a future date', () => {
    expect(daysOverdue('2026-08-20', TODAY)).toBe(-6)
  })

  it('returns null when there is no date', () => {
    expect(daysOverdue(null, TODAY)).toBeNull()
  })

  it('is unaffected by a time component on the reference date', () => {
    const lateInDay = new Date(2026, 7, 14, 23, 59, 59)
    expect(daysOverdue('2026-08-14', lateInDay)).toBe(0)
  })

  it('counts correctly across a month boundary', () => {
    expect(daysOverdue('2026-07-31', TODAY)).toBe(14)
  })
})

describe('dueLabel', () => {
  it('phrases the boundary cases without pluralisation errors', () => {
    expect(dueLabel('2026-08-14', TODAY)).toBe('Due today')
    expect(dueLabel('2026-08-13', TODAY)).toBe('1 day overdue')
    expect(dueLabel('2026-08-11', TODAY)).toBe('3 days overdue')
    expect(dueLabel('2026-08-15', TODAY)).toBe('Due tomorrow')
    expect(dueLabel('2026-08-21', TODAY)).toBe('Due in 7 days')
    expect(dueLabel(null, TODAY)).toBe('No date')
  })
})

describe('status vocabulary', () => {
  it('treats only Closed and Cancelled as inactive', () => {
    const inactive = IMPORT_STATUSES.filter((s) => !isActive(s))
    expect(inactive).toEqual(['Closed', 'Cancelled'])
  })

  it('assigns a tone to every status, so none renders unstyled', () => {
    for (const status of IMPORT_STATUSES) {
      expect(statusTone(status)).toBeTruthy()
    }
  })

  it('falls back to neutral for an unrecognised status', () => {
    expect(statusTone('Something Else')).toBe('neutral')
  })
})

describe('pipelineStage', () => {
  it('buckets statuses into the four dashboard stages', () => {
    expect(pipelineStage('PO Stage')).toBe('order')
    expect(pipelineStage('In Production')).toBe('make')
    expect(pipelineStage('In Transit')).toBe('ship')
    expect(pipelineStage('Customs Clearance')).toBe('arrive')
  })

  it('covers every status so the dashboard never drops an import', () => {
    for (const status of IMPORT_STATUSES) {
      expect(['order', 'make', 'ship', 'arrive']).toContain(pipelineStage(status))
    }
  })
})
