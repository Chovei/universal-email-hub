import { describe, it, expect } from 'vitest'
import { humanizeWizardError } from './wizardErrors'

describe('humanizeWizardError', () => {
  it('maps Gmail auth failures to App Password guidance', () => {
    const r = humanizeWizardError('gmail', '[AUTHENTICATIONFAILED] Invalid credentials (Failure)')
    expect(r.title).toContain('Gmail')
    expect(r.hint).toContain('App Password')
  })

  it('maps Yahoo auth failures to Yahoo App Password guidance', () => {
    const r = humanizeWizardError('yahoo', 'LOGIN failed')
    expect(r.hint.toLowerCase()).toContain('app password')
  })

  it('maps iCloud auth failures to app-specific password guidance', () => {
    const r = humanizeWizardError('icloud', 'AUTHENTICATIONFAILED')
    expect(r.hint.toLowerCase()).toContain('app')
  })

  it('maps generic IMAP auth failures to credential guidance', () => {
    const r = humanizeWizardError('imap', 'Invalid credentials')
    expect(r.title).toContain('rejected')
    expect(r.hint).toContain('IMAP')
  })

  it('maps DNS/connection errors to server-unreachable guidance', () => {
    for (const raw of ['getaddrinfo ENOTFOUND imap.example.com', 'connect ECONNREFUSED', 'ETIMEDOUT']) {
      const r = humanizeWizardError('imap', raw)
      expect(r.title).toContain("Can't reach")
    }
  })

  it('maps TLS certificate errors', () => {
    const r = humanizeWizardError('imap', 'unable to verify the first certificate')
    expect(r.title).toContain('Secure connection')
  })

  it('falls back to the raw message', () => {
    const r = humanizeWizardError('imap', 'Something very unusual')
    expect(r.title).toBe('Connection failed')
    expect(r.hint).toContain('Something very unusual')
  })
})
