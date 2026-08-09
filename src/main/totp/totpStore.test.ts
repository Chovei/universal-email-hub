import { describe, it, expect, vi, beforeEach } from 'vitest'

// totpStore reaches for the Electron-backed DB and credential store; both are
// mocked at the module boundary so the security contract can be asserted
// without launching Electron.
const rows: Record<string, unknown>[] = []
const credentials = new Map<string, string>()

vi.mock('../db/client', () => ({
  getRawSqlite: () => ({
    prepare: (sql: string) => ({
      all: () => (sql.includes('SELECT') ? rows : []),
      get: (id: string) => rows.find((r) => r.id === id),
      run: (...args: unknown[]) => {
        if (sql.startsWith('INSERT')) {
          rows.push({
            id: args[0],
            accountId: args[1],
            issuer: args[2],
            label: args[3],
            algorithm: args[4],
            digits: args[5],
            period: args[6],
            verified: 0,
            createdAt: args[7],
            updatedAt: args[8],
          })
        } else if (sql.startsWith('DELETE')) {
          const idx = rows.findIndex((r) => r.id === args[0])
          if (idx >= 0) rows.splice(idx, 1)
        }
      },
    }),
  }),
}))

vi.mock('../security/keychain', () => ({
  credentialStore: {
    set: (k: string, v: string) => credentials.set(k, v),
    get: (k: string) => credentials.get(k) ?? null,
    delete: (k: string) => credentials.delete(k),
    has: (k: string) => credentials.has(k),
  },
  getCredentialProtection: () => ({ encrypted: true, method: 'Test' }),
}))

import { createTotpAccount, listTotpCodes, deleteTotpAccount, verifyTotpAccount } from './totpStore'
import { generateTotp } from './totp'

const SECRET = 'JBSWY3DPEHPK3PXP'

const input = {
  secret: SECRET,
  issuer: 'VRChat',
  label: 'my-account',
  algorithm: 'SHA1' as const,
  digits: 6,
  period: 30,
}

describe('totpStore security contract', () => {
  beforeEach(() => {
    rows.length = 0
    credentials.clear()
  })

  it('never returns the secret from createTotpAccount', () => {
    const meta = createTotpAccount(input)
    expect(JSON.stringify(meta)).not.toContain(SECRET)
    expect(meta).not.toHaveProperty('secret')
  })

  it('never returns the secret in the code listing', () => {
    createTotpAccount(input)
    const listed = listTotpCodes()
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain(SECRET)
    expect(listed[0]).not.toHaveProperty('secret')
  })

  it('stores the secret only in the credential store, never in a DB row', () => {
    createTotpAccount(input)
    // The secret is in the OS-encrypted store...
    expect([...credentials.values()]).toContain(SECRET)
    // ...and nowhere in the database row
    expect(JSON.stringify(rows)).not.toContain(SECRET)
  })

  it('produces a code matching the pure engine', () => {
    createTotpAccount(input)
    const at = 1234567890 * 1000
    const listed = listTotpCodes(at)
    expect(listed[0].code).toBe(generateTotp({ secret: SECRET }, at).code)
  })

  it('verifies a correct code and rejects a wrong one', () => {
    const meta = createTotpAccount(input)
    const at = 1234567890 * 1000
    const code = generateTotp({ secret: SECRET }, at).code
    expect(verifyTotpAccount(meta.id, code, at)).toBe(true)
    expect(verifyTotpAccount(meta.id, '000000', at)).toBe(false)
  })

  it('removes the stored secret when the account is deleted', () => {
    const meta = createTotpAccount(input)
    expect([...credentials.values()]).toContain(SECRET)
    deleteTotpAccount(meta.id)
    expect([...credentials.values()]).not.toContain(SECRET)
    expect(rows).toHaveLength(0)
  })

  it('reports a missing secret without leaking anything', () => {
    createTotpAccount(input)
    credentials.clear() // simulate a credential store that lost its contents
    const listed = listTotpCodes()
    expect(listed[0].code).toBeNull()
    expect(listed[0].error).toBeTruthy()
    expect(JSON.stringify(listed)).not.toContain(SECRET)
  })

  it('rejects a malformed secret before anything is written', () => {
    expect(() => createTotpAccount({ ...input, secret: 'not-base32!' })).toThrow()
    expect(rows).toHaveLength(0)
    expect(credentials.size).toBe(0)
  })
})
