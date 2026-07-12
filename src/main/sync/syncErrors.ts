// Classify raw provider/network errors into messages a user can act on.
// The raw error is kept for logs; this is what the UI shows.

const AUTH_PATTERNS = [
  'authenticationfailed',
  'invalid credentials',
  'invalid_grant',
  'invalid_client',
  'login failed',
  'auth failed',
  'unauthorized',
  '401',
  'credentials not found',
  'reconnect this account',
  'token has been expired or revoked',
]

const NETWORK_PATTERNS = [
  'enotfound',
  'econnrefused',
  'econnreset',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'socket hang up',
  'network error',
  'fetch failed',
  'getaddrinfo',
]

const RATE_LIMIT_PATTERNS = ['429', 'too many requests', 'rate limit', 'quota exceeded', 'user-rate limit']

export interface SyncErrorInfo {
  /** User-facing, actionable message. */
  message: string
  /** Category for programmatic handling (e.g. reconnect UI, backoff). */
  category: 'auth' | 'network' | 'rate-limit' | 'unknown'
}

export function describeSyncError(err: unknown): SyncErrorInfo {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()

  if (AUTH_PATTERNS.some((p) => lower.includes(p))) {
    return {
      message: 'Authentication failed. Please reconnect this account in Settings.',
      category: 'auth',
    }
  }
  if (NETWORK_PATTERNS.some((p) => lower.includes(p))) {
    return {
      message: 'Cannot reach the mail server. Check your internet connection — sync will retry automatically.',
      category: 'network',
    }
  }
  if (RATE_LIMIT_PATTERNS.some((p) => lower.includes(p))) {
    return {
      message: 'The mail provider is rate-limiting requests. Sync will retry on the next cycle.',
      category: 'rate-limit',
    }
  }
  return { message: raw, category: 'unknown' }
}
