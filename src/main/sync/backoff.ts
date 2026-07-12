const DEFAULT_MAX_MS = 15 * 60 * 1000

/**
 * Exponential backoff with ±10% jitter. failures=0 returns baseMs unchanged
 * so the healthy path keeps the user's configured interval. Jitter prevents
 * many accounts that failed together (e.g. network drop) from retrying in
 * lockstep.
 */
export function computeBackoffMs(baseMs: number, failures: number, maxMs = DEFAULT_MAX_MS): number {
  if (failures <= 0) return baseMs
  const raw = Math.min(baseMs * Math.pow(2, failures), maxMs)
  const jitter = raw * 0.1 * (Math.random() * 2 - 1)
  return Math.max(1, Math.round(raw + jitter))
}
