'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui'
import { parseUnparsed, type ActionResult } from './actions'

/**
 * The retry.
 *
 * Interpretation runs after the webhook has already answered, so it can be cut
 * short by the platform or fail on its own. There is no scheduler in this
 * application to pick that up — the work happens when someone looks, which is
 * this button. Showing the count is what keeps a silent failure visible.
 */
export function ParseButton({ count }: { count: number }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async () => parseUnparsed(),
    null,
  )

  return (
    <form action={formAction} className="flex items-center gap-2">
      {state?.error && <span className="text-sm text-critical">{state.error}</span>}
      <Button type="submit" disabled={pending} className="rounded-xl">
        {pending ? 'Reading…' : `Parse ${count} unread`}
      </Button>
    </form>
  )
}
