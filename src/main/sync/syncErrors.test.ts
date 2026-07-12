import { describe, it, expect } from 'vitest'
import { describeSyncError } from './syncErrors'

describe('describeSyncError', () => {
  it('classifies IMAP authentication failures', () => {
    const info = describeSyncError(new Error('Command failed: NO [AUTHENTICATIONFAILED] Invalid credentials'))
    expect(info.category).toBe('auth')
    expect(info.message).toContain('reconnect')
  })

  it('classifies OAuth token revocation (Google invalid_grant)', () => {
    const info = describeSyncError(new Error('invalid_grant: Token has been expired or revoked'))
    expect(info.category).toBe('auth')
  })

  it('classifies Graph 401 responses', () => {
    const info = describeSyncError(new Error('Graph GET 401: InvalidAuthenticationToken'))
    expect(info.category).toBe('auth')
  })

  it('classifies missing-credentials errors from the keychain', () => {
    const info = describeSyncError(new Error('IMAP credentials not found. Please reconnect this account.'))
    expect(info.category).toBe('auth')
  })

  it('classifies DNS and connection failures as network', () => {
    expect(describeSyncError(new Error('getaddrinfo ENOTFOUND imap.gmail.com')).category).toBe('network')
    expect(describeSyncError(new Error('connect ECONNREFUSED 142.250.0.1:993')).category).toBe('network')
    expect(describeSyncError(new Error('connect ETIMEDOUT')).category).toBe('network')
    expect(describeSyncError(new Error('fetch failed')).category).toBe('network')
  })

  it('classifies rate limiting', () => {
    expect(describeSyncError(new Error('Graph GET 429: TooManyRequests')).category).toBe('rate-limit')
    expect(describeSyncError(new Error('User-rate limit exceeded')).category).toBe('rate-limit')
  })

  it('passes through unknown errors with the original message', () => {
    const info = describeSyncError(new Error('Something exotic happened'))
    expect(info.category).toBe('unknown')
    expect(info.message).toBe('Something exotic happened')
  })

  it('handles non-Error values', () => {
    const info = describeSyncError('string error')
    expect(info.message).toBe('string error')
  })
})
