import { createClient } from '@/lib/supabase/server'
import type { VerificationItem } from '@/lib/types'
import { ReviewView, type ReviewImport } from './review-view'

export const dynamic = 'force-dynamic'

export default async function ReviewPage() {
  const supabase = await createClient()

  const [queueResult, importsResult] = await Promise.all([
    supabase.from('v_verification_queue').select('*').order('since'),
    supabase.from('v_import_summary').select('id, import_no, supplier_name, company_code, status'),
  ])

  const items = (queueResult.data ?? []) as VerificationItem[]
  const imports = (importsResult.data ?? []) as ReviewImport[]

  return <ReviewView items={items} imports={imports} />
}
