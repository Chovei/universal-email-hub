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
    // better-sqlite3 rolls the whole statement group back on a throw; the fake
    // restores its snapshot so the atomic import path behaves the same here.
    transaction:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        const snapshot = rows.map((row) => ({ ...row }))
        try {
          return fn(...args)
        } catch (err) {
          rows.length = 0
          rows.push(...snapshot)
          throw err
        }
      },
  }),
}))

vi.mock('../security/keychain', () => ({
  credentialStore: {
    set: (k: string, v: string) => credentials.set(k, v),
    setMany: (entries: Record<string, string>) => {
      for (const [k, v] of Object.entries(entries)) credentials.set(k, v)
    },
    get: (k: string) => credentials.get(k) ?? null,
    delete: (k: string) => credentials.delete(k),
    has: (k: string) => credentials.has(k),
    keys: () => [...credentials.keys()],
  },
  getCredentialProtection: () => ({ encrypted: true, method: 'Test' }),
}))

import {
  createTotpAccount,
  createTotpAccounts,
  listTotpCodes,
  deleteTotpAccount,
  verifyTotpAccount,
  reconcileTotpSecrets,
} from './totpStore'
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

  it('generates codes with the account’s own settings, not the defaults', () => {
    // Deliberately every parameter away from its default: if configFor stopped
    // forwarding one of them, generateTotp would silently fall back to the
    // default and a same-defaults comparison would still pass.
    const custom = { ...input, algorithm: 'SHA256' as const, digits: 8, period: 60 }
    createTotpAccount(custom)
    const at = 1234567890 * 1000

    const listed = listTotpCodes(at)
    expect(listed[0].code).toBe(
      generateTotp({ secret: SECRET, algorithm: 'SHA256', digits: 8, period: 60 }, at).code
    )
    // ...and is genuinely different from what the defaults would have produced
    expect(listed[0].code).not.toBe(generateTotp({ secret: SECRET }, at).code)
    expect(listed[0].code).toHaveLength(8)
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

describe('createTotpAccounts', () => {
  beforeEach(() => {
    rows.length = 0
    credentials.clear()
  })

  it('writes every account of a batch', () => {
    const created = createTotpAccounts([
      input,
      { ...input, label: 'second' },
      { ...input, label: 'third' },
    ])
    expect(created).toHaveLength(3)
    expect(rows).toHaveLength(3)
    expect(credentials.size).toBe(3)
  })

  it('refuses the whole batch when one entry is unusable, writing nothing', () => {
    expect(() =>
      createTotpAccounts([input, { ...input, secret: 'SHORT' }, { ...input, label: 'third' }])
    ).toThrow()
    // The good entries must not be half-committed: validation happens before
    // the first write, so neither store should have been touched at all.
    expect(rows).toHaveLength(0)
    expect(credentials.size).toBe(0)
  })
})

describe('reconcileTotpSecrets', () => {
  beforeEach(() => {
    rows.length = 0
    credentials.clear()
  })

  it('removes a stored secret whose account is gone', () => {
    createTotpAccount(input)
    createTotpAccount({ ...input, label: 'kept' })
    // Simulate a delete whose credential write failed: the row went, the seed
    // stayed. This is the case reconciliation exists for.
    rows.splice(0, 1)

    expect(reconcileTotpSecrets()).toEqual({ removed: 1, retained: 0 })
    expect(credentials.size).toBe(1)
  })

  it('keeps orphaned secrets when no accounts remain at all', () => {
    createTotpAccount(input)
    createTotpAccount({ ...input, label: 'second' })
    // A database replaced wholesale — corruption recovery renames it aside and
    // opens an empty one. The credential store is the ONLY copy of a TOTP
    // seed, so reaping here would destroy every authenticator the user owns
    // from one transient file error.
    rows.length = 0

    expect(reconcileTotpSecrets()).toEqual({ removed: 0, retained: 2 })
    expect(credentials.size).toBe(2)
  })

  it('does nothing when every secret has an account', () => {
    createTotpAccount(input)
    expect(reconcileTotpSecrets()).toEqual({ removed: 0, retained: 0 })
    expect(credentials.size).toBe(1)
  })

  it('leaves credentials belonging to other subsystems alone', () => {
    createTotpAccount(input)
    credentials.set('account:abc:credentials', 'an email password')
    rows.length = 0

    reconcileTotpSecrets()
    expect(credentials.get('account:abc:credentials')).toBe('an email password')
  })
})
