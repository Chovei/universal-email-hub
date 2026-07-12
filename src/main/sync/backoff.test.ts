import { describe, it, expect } from 'vitest'
import { computeBackoffMs } from './backoff'

describe('computeBackoffMs', () => {
  it('returns base interval when there are no failures', () => {
    expect(computeBackoffMs(60_000, 0)).toBe(60_000)
  })

  it('doubles per consecutive failure with ±10% jitter', () => {
    for (const [failures, expected] of [
      [1, 120_000],
      [2, 240_000],
      [3, 480_000],
    ] as const) {
      const ms = computeBackoffMs(60_000, failures)
      expect(ms).toBeGreaterThanOrEqual(expected * 0.9)
      expect(ms).toBeLessThanOrEqual(expected * 1.1)
    }
  })

  it('caps at maxMs', () => {
    expect(computeBackoffMs(60_000, 20, 900_000)).toBeLessThanOrEqual(900_000 * 1.1)
  })

  it('caps at 15 minutes by default', () => {
    expect(computeBackoffMs(60_000, 20)).toBeLessThanOrEqual(900_000 * 1.1)
  })

  it('never returns negative or zero delay', () => {
    expect(computeBackoffMs(1000, 1)).toBeGreaterThan(0)
  })
})
