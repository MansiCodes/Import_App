import 'server-only'

/**
 * A small in-memory rate limiter for the public quote portal.
 *
 * Be clear about what this is and is not. On serverless the counter lives in
 * one instance's memory, so a determined attacker spread across instances gets
 * more attempts than the number suggests, and a cold start forgets everything.
 * It is a brake on hammering, not a security boundary.
 *
 * The actual security boundary is the token: 32 random bytes is not guessable
 * at any rate, so the job here is only to stop one caller burning the database
 * — and to do it without adding a paid dependency such as Redis, which would
 * break the zero-cost constraint for no real gain at this volume.
 *
 * Anything that must be counted exactly — how many quotes a recipient has
 * actually submitted — is counted in Postgres instead.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/** Stop the map growing without bound on a long-lived instance. */
function sweep(now: number) {
  if (buckets.size < 500) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const existing = buckets.get(key)

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }
  }

  existing.count += 1

  if (existing.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    }
  }

  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 }
}

/** Best-effort caller identity behind Vercel's proxy. */
export function callerKey(headers: Headers, suffix = ''): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || headers.get('x-real-ip') || 'unknown'
  return suffix ? `${ip}:${suffix}` : ip
}
