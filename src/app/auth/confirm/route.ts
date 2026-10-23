import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createAuthClient } from '@/lib/supabase/auth'

/**
 * Magic-link landing route. Handles BOTH shapes a Supabase sign-in link can
 * arrive in, because which one you get depends on the project's plan.
 *
 *   ?code=…        PKCE. The default email template sends the user through
 *                  /auth/v1/verify, which redirects here appending `code` as a
 *                  QUERY parameter — readable by the server. This is what the
 *                  free tier gives you, and it is why the browser client must
 *                  be `@supabase/ssr`'s createBrowserClient (PKCE by default)
 *                  rather than plain supabase-js (implicit by default, which
 *                  returns the session in a URL FRAGMENT the server can never
 *                  see — the cause of the earlier "link was incomplete" dead
 *                  end).
 *
 *   ?token_hash=…  Used when a custom email template is installed, which
 *                  Supabase only permits with custom SMTP. `npm run
 *                  auth:configure` installs that template when it is allowed.
 *
 * Supporting both means changing plan or adding SMTP does not break sign-in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  // Only internal redirects — an absolute URL here would turn sign-in into an
  // open redirect that hands the session to someone else's site.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'

  const supabase = await createAuthClient()

  let error: { message: string } | null = null

  if (code) {
    ;({ error } = await supabase.auth.exchangeCodeForSession(code))
  } else if (tokenHash && type) {
    ;({ error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash }))
  } else {
    return NextResponse.redirect(`${origin}/auth/error?reason=incomplete`)
  }

  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(`${origin}${safeNext}`)
}
