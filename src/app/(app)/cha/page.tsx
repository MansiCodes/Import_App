import { createClient } from '@/lib/supabase/server'
import type { Cha, ChaAgent } from '@/lib/types'
import { ChaList } from './cha-list'

export const dynamic = 'force-dynamic'

export default async function ChaPage() {
  const supabase = await createClient()

  const [chasResult, agentsResult] = await Promise.all([
    supabase.from('chas').select('*').order('name'),
    supabase.from('cha_agents').select('*').order('country').order('name'),
  ])

  return (
    <ChaList
      chas={(chasResult.data ?? []) as Cha[]}
      agents={(agentsResult.data ?? []) as ChaAgent[]}
    />
  )
}
