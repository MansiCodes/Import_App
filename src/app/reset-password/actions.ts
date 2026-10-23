'use server'

import { redirect } from 'next/navigation'
import { completePasswordReset } from '@/lib/auth/reset'
import type { ResetCompleteResult } from '@/lib/auth/reset'

export async function resetPassword(
  _prev: ResetCompleteResult | null,
  formData: FormData,
): Promise<ResetCompleteResult> {
  const token = formData.get('token')
  const password = formData.get('password')
  const confirm = formData.get('confirm')

  const result = await completePasswordReset(
    typeof token === 'string' ? token : '',
    typeof password === 'string' ? password : '',
    typeof confirm === 'string' ? confirm : '',
  )

  if (result.ok) redirect('/login?reset=success')
  return result
}
