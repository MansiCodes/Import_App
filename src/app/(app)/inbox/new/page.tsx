import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ManualEntry } from './manual-entry'

export const dynamic = 'force-dynamic'

export default function NewCommunicationPage() {
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
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">Add a message</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Paste something a supplier, CHA or agent told you. It is matched and filed the same way
          a forwarded message is.
        </p>
      </div>

      <ManualEntry />
    </div>
  )
}
