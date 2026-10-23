import { NextResponse, type NextRequest } from 'next/server'
import { createAuthClient } from '@/lib/supabase/auth'

/** POST-only: a GET sign-out can be triggered by any image tag on any page. */
export async function POST(request: NextRequest) {
  const supabase = await createAuthClient()
  await supabase.auth.signOut()

  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
