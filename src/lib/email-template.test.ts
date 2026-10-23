import { describe, expect, it } from 'vitest'
import {
  emptyPlaceholders,
  extractPlaceholders,
  gmailComposeUrl,
  missingPlaceholders,
  renderTemplate,
} from './email-template'

describe('renderTemplate', () => {
  it('substitutes a known placeholder', () => {
    expect(renderTemplate('Dear {{name}},', { name: 'Mr Chen' })).toBe('Dear Mr Chen,')
  })

  it('substitutes every occurrence, not just the first', () => {
    expect(renderTemplate('{{po}} — chasing {{po}}', { po: 'ATC_PO_006' })).toBe(
      'ATC_PO_006 — chasing ATC_PO_006',
    )
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderTemplate('{{ name }}', { name: 'Ada' })).toBe('Ada')
  })

  it('leaves an unknown placeholder visible so a broken template is obvious', () => {
    expect(renderTemplate('Dear {{whatsit}},', { name: 'Ada' })).toBe('Dear {{whatsit}},')
  })

  it('renders a supplied-but-null value as empty rather than leaving the tag', () => {
    expect(renderTemplate('PI {{pi_number}}.', { pi_number: null })).toBe('PI .')
  })

  it('does not treat a value containing braces as a further placeholder', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'nested' })).toBe('{{b}}')
  })

  it('leaves text with no placeholders untouched', () => {
    expect(renderTemplate('Nothing to do here.', {})).toBe('Nothing to do here.')
  })
})

describe('extractPlaceholders', () => {
  it('lists each distinct placeholder once, in first-appearance order', () => {
    expect(extractPlaceholders('{{b}} {{a}} {{b}}')).toEqual(['b', 'a'])
  })

  it('returns nothing for a template with no placeholders', () => {
    expect(extractPlaceholders('plain text')).toEqual([])
  })
})

describe('missingPlaceholders', () => {
  it('names what the template needs and the caller did not supply', () => {
    expect(missingPlaceholders('{{a}} {{b}}', { a: 'x' })).toEqual(['b'])
  })

  it('counts a null value as supplied — that was a deliberate choice', () => {
    expect(missingPlaceholders('{{a}}', { a: null })).toEqual([])
  })
})

describe('emptyPlaceholders', () => {
  it('flags a placeholder that resolved to nothing, so a hole is visible before sending', () => {
    expect(emptyPlaceholders('{{a}} {{b}}', { a: '', b: 'set' })).toEqual(['a'])
  })

  it('does not flag one that was never supplied — that is a different problem', () => {
    expect(emptyPlaceholders('{{a}}', {})).toEqual([])
  })
})

describe('gmailComposeUrl', () => {
  it('builds a compose URL, never a send', () => {
    const url = gmailComposeUrl({ to: 'x@y.com', subject: 'Hi', body: 'Body' })

    expect(url.startsWith('https://mail.google.com/mail/?')).toBe(true)
    expect(url).toContain('view=cm')
    expect(url).toContain('to=x%40y.com')
  })

  it('encodes newlines and ampersands so the body survives the round trip', () => {
    const url = gmailComposeUrl({ subject: 'A & B', body: 'line one\nline two' })

    expect(url).toContain('su=A+%26+B')
    expect(url).toContain('line+one%0Aline+two')
  })

  it('omits recipients that were not given', () => {
    const url = gmailComposeUrl({ subject: 's', body: 'b' })

    expect(url).not.toContain('to=')
    expect(url).not.toContain('cc=')
  })
})
