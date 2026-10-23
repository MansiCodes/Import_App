/**
 * The credentials must not be reachable from the browser.
 *
 * This is checked by reading the source rather than by reasoning about it,
 * because the failure mode is silent: a `process.env.WHATSAPP_ACCESS_TOKEN`
 * added to a Client Component compiles, renders, ships the token in the
 * JavaScript bundle, and looks completely fine.
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../..', import.meta.url))

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)))
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full)
  }

  return out
}

describe('WhatsApp credentials', () => {
  it('are never read from a Client Component', async () => {
    const offenders: string[] = []

    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, 'utf8')
      if (!/^['"]use client['"]/m.test(source)) continue
      if (/process\.env\.WHATSAPP|WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_PHONE_NUMBER_ID/.test(source)) {
        offenders.push(path.relative(SRC, file))
      }
    }

    expect(offenders).toEqual([])
  })

  it('are only read by modules a client bundle cannot import', async () => {
    const unguarded: string[] = []

    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, 'utf8')
      if (!/process\.env\.WHATSAPP/.test(source)) continue

      // Either the module refuses to be bundled for the browser, or it is a
      // route handler / server action, which is never bundled in the first place.
      const guarded =
        /^import ['"]server-only['"]/m.test(source) || /^['"]use server['"]/m.test(source)
      if (!guarded) unguarded.push(path.relative(SRC, file))
    }

    // Route handlers under app/api are server-only by construction.
    expect(unguarded.filter((f) => !f.includes(`api${path.sep}`))).toEqual([])
  })

  it('are absent from the page that renders the send buttons', async () => {
    const panel = await readFile(
      path.join(SRC, 'app', '(app)', 'imports', '[id]', 'freight-quotes', '[requestId]', 'recipients-panel.tsx'),
      'utf8',
    )

    expect(panel).toMatch(/^'use client'/)
    expect(panel).not.toMatch(/process\.env/)
    // The panel is handed a masked number and never resolves one itself.
    expect(panel).not.toMatch(/whatsapp_phone|resolveDestination/)
    expect(panel).toMatch(/destinationMasked/)
    expect(panel).toMatch(/waDigits/)
  })
})
