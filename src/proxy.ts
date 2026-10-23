import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Request guard — configuration first, then sign-in.
 *
 * Both checks live here rather than in a layout because Next still evaluates
 * the page component underneath a layout guard, so a layout cannot stop a page
 * from running its queries.
 *
 * This runs for Server Action POSTs too: an action posts to the route it lives
 * on, so an unauthenticated action request is redirected exactly like a page
 * view. That matters — otherwise the UI would be gated while the mutations
 * behind it stayed open.
 */

/** Reachable without a session. Everything else requires one. */
const PUBLIC_PATHS = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/auth/confirm',
  '/auth/error',
  '/auth/signout',
  '/api/whatsapp',
  // The freight quote portal. A CHA has no account and never will — the token
  // in the URL is the authorisation, checked server-side on every action. The
  // page reads exactly one recipient's row and nothing else, so being public
  // does not make anything public.
  '/q',
]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/**
 * Machine callers that must never be redirected.
 *
 * A webhook is not a browser: it cannot follow a redirect to a sign-in or setup
 * page, and a provider reads any non-2xx as delivery failure. Meta retries, then
 * eventually disables the subscription — so a misconfigured deployment would
 * quietly stop receiving messages altogether. These reach their route handler
 * whatever the app's state, and the handler answers honestly.
 *
 * Kept as exact matches, not prefixes: nothing may be nested under a path that
 * skips both the configuration check and the session gate.
 */
const UNREDIRECTABLE_PATHS = ['/api/whatsapp']

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const { pathname } = request.nextUrl

  if (UNREDIRECTABLE_PATHS.includes(pathname)) {
    return NextResponse.next()
  }

  // Without credentials there is no database and no auth server, so there is
  // nothing to sign in to. Explain the setup instead of failing obscurely.
  if (!url || !anonKey || !serviceKey) {
    return pathname === '/setup'
      ? NextResponse.next()
      : NextResponse.redirect(new URL('/setup', request.url))
  }

  if (pathname === '/setup') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // The response is rebuilt inside setAll because refreshed auth cookies have
  // to be written onto the response that is actually returned.
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // getUser(), not getSession(): getSession() trusts the cookie as presented,
  // which is no basis for a gate. This also refreshes an expiring session.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublic(pathname)) {
    const signIn = new URL('/login', request.url)
    // Come back to where they were headed once signed in.
    if (pathname !== '/') signIn.searchParams.set('next', pathname + request.nextUrl.search)

    return NextResponse.redirect(signIn)
  }

  // Signed in already — the login page has nothing to offer.
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets — those never need the
     * check and matching them would slow every page load.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
