import { describe, expect, it } from 'vitest'
import { extractDriveId, isDriveUrl } from './drive'

describe('extractDriveId', () => {
  it('reads the id from a file link', () => {
    expect(
      extractDriveId('https://drive.google.com/file/d/1h35GJCApxcoB1GQcJD33q-wVJFo8ZNbA/view?usp=sharing'),
    ).toBe('1h35GJCApxcoB1GQcJD33q-wVJFo8ZNbA')
  })

  it('reads the id from a folder link', () => {
    // The real Notofire imports root.
    expect(
      extractDriveId('https://drive.google.com/drive/folders/11tk0tISihrS5DlZSevh6SOTdbJMQKZX5'),
    ).toBe('11tk0tISihrS5DlZSevh6SOTdbJMQKZX5')
  })

  it('reads the id from Docs and Sheets links', () => {
    expect(extractDriveId('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit')).toBe(
      '1AbCdEfGhIjKlMnOp',
    )
    expect(extractDriveId('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0')).toBe(
      '1AbCdEfGhIjKlMnOp',
    )
  })

  it('reads the id from an open?id= link', () => {
    expect(extractDriveId('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe(
      '1AbCdEfGhIjKlMnOp',
    )
  })

  it('returns null rather than guessing', () => {
    expect(extractDriveId(null)).toBeNull()
    expect(extractDriveId('')).toBeNull()
    expect(extractDriveId('https://example.com/some/file.pdf')).toBeNull()
    // Too short to be a Drive id — must not match.
    expect(extractDriveId('https://drive.google.com/file/d/short/view')).toBeNull()
  })
})

describe('isDriveUrl', () => {
  it('recognises Drive and Docs hosts only', () => {
    expect(isDriveUrl('https://drive.google.com/drive/folders/abc')).toBe(true)
    expect(isDriveUrl('https://docs.google.com/document/d/abc/edit')).toBe(true)
    expect(isDriveUrl('https://dropbox.com/s/abc')).toBe(false)
    expect(isDriveUrl(null)).toBe(false)
  })
})
