import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same seam as totpStore.test.ts: the database and the OS credential store are
// replaced at the module boundary and nothing else is. Staging is only worth
// testing end to end — what it exists to guarantee is a property of the whole
// path from a scanned link through to storage, so the real store runs beneath.
const rows: Record<string, unknown>[] = []
const credentials = new Map<string, string>()

/** One-based INSERT to fail on, so the all-or-nothing claim can be forced. */
let failInsertAt = 0
let insertCount = 0

const fakeSqlite = {
  prepare: (sql: string) => ({
    all: () => (sql.includes('SELECT') ? [...rows] : []),
    get: (id: string) => rows.find((r) => r.id === id),
    run: (...args: unknown[]) => {
      if (sql.startsWith('INSERT')) {
        insertCount++
        if (insertCount === failInsertAt) throw new Error('sqlite: database is locked')
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
  // better-sqlite3 discards every write in the wrapped function when it
  // throws. Without that behaviour here the atomic import would appear to work
  // while actually leaving half an export behind.
  transaction:
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
    (...args: A) => {
      const snapshot = rows.map((row) => ({ ...row }))
      try {
        return fn(...args)
      } catch (err) {
        rows.length = 0
        rows.push(...snapshot)
        throw err
      }
    },
}

vi.mock('../db/client', () => ({
  getRawSqlite: () => fakeSqlite,
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
    deleteByPrefix: (prefix: string) => {
      let removed = 0
      for (const k of [...credentials.keys()]) {
        if (k.startsWith(prefix) && credentials.delete(k)) removed++
      }
      return removed
    },
  },
  getCredentialProtection: () => ({ encrypted: true, method: 'Test' }),
}))

import {
  stageImportText,
  stagedPreview,
  commitStagedImport,
  discardStagedImport,
  discardAllStagedImports,
} from './importStaging'
import { encodeBase32, TotpError } from './totp'

// Real protobuf payloads, built by hand, so staging is fed the same bytes a
// phone produces rather than a convenient stand-in. Helpers duplicated from
// migration.test.ts on purpose — a shared fixture that drifted would quietly
// change what both files think they are testing.
function varint(n: number): Buffer {
  const out: number[] = []
  let v = n
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  out.push(v)
  return Buffer.from(out)
}

function tag(field: number, wireType: number): Buffer {
  return varint((field << 3) | wireType)
}

function lengthDelimited(field: number, payload: Buffer): Buffer {
  return Buffer.concat([tag(field, 2), varint(payload.length), payload])
}

function varintField(field: number, value: number): Buffer {
  return Buffer.concat([tag(field, 0), varint(value)])
}

interface Params {
  secret: Buffer
  name?: string
  issuer?: string
  algorithm?: number
  digits?: number
  type?: number
}

function otpParameters(p: Params): Buffer {
  const parts = [lengthDelimited(1, p.secret)]
  if (p.name !== undefined) parts.push(lengthDelimited(2, Buffer.from(p.name, 'utf8')))
  if (p.issuer !== undefined) parts.push(lengthDelimited(3, Buffer.from(p.issuer, 'utf8')))
  if (p.algorithm !== undefined) parts.push(varintField(4, p.algorithm))
  if (p.digits !== undefined) parts.push(varintField(5, p.digits))
  if (p.type !== undefined) parts.push(varintField(6, p.type))
  return Buffer.concat(parts)
}

interface Batch {
  index?: number
  size?: number
  id?: number
}

function migrationUri(entries: Buffer[], batch: Batch = {}): string {
  const trailer = [varintField(2, 1)] // version
  if (batch.size !== undefined) trailer.push(varintField(3, batch.size))
  if (batch.index !== undefined) trailer.push(varintField(4, batch.index))
  if (batch.id !== undefined) trailer.push(varintField(5, batch.id))
  const payload = Buffer.concat([...entries.map((e) => lengthDelimited(1, e)), ...trailer])
  return `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`
}

// 20 raw bytes each — what a real service issues, and distinct so duplicate
// detection has something to distinguish.
const RAW_A = Buffer.from('12345678901234567890', 'ascii')
const RAW_B = Buffer.from('abcdefghijklmnopqrst', 'ascii')
const RAW_C = Buffer.from('ZYXWVUTSRQPONMLKJIHG', 'ascii')
const RAW_D = Buffer.from('98765432109876543210', 'ascii')

const SECRET_A = encodeBase32(RAW_A)
const SECRET_B = encodeBase32(RAW_B)
const SECRET_C = encodeBase32(RAW_C)
const SECRET_D = encodeBase32(RAW_D)
const ALL_SECRETS = [SECRET_A, SECRET_B, SECRET_C, SECRET_D]

const totpKeys = (): string[] => [...credentials.keys()].filter((k) => k.startsWith('totp:'))

/**
 * Walk everything the import API hands back looking for key material.
 *
 * Deliberately structure-blind: asserting on the fields that exist today would
 * not catch a seed smuggled into a field added tomorrow, and the renderer
 * receives whatever these functions return in full.
 */
function findSecretLeaks(value: unknown, secrets: string[], root = 'result'): string[] {
  const found: string[] = []
  const walk = (node: unknown, at: string): void => {
    if (typeof node === 'string') {
      const upper = node.toUpperCase()
      for (const secret of secrets) {
        if (upper.includes(secret.toUpperCase())) found.push(`${at} contains a seed: ${node}`)
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`))
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        if (key.toLowerCase() === 'secret') found.push(`${at}.${key} is a secret-shaped field`)
        walk(child, `${at}.${key}`)
      }
    }
  }
  walk(value, root)
  return found
}

const exportOf = (...entries: Buffer[]): string => migrationUri(entries)

const readyExport = (): string =>
  exportOf(
    otpParameters({ secret: RAW_A, name: 'one@example.com', issuer: 'VRChat', type: 2 }),
    otpParameters({ secret: RAW_B, name: 'two@example.com', issuer: 'Discord', type: 2 }),
    otpParameters({ secret: RAW_C, name: 'three@example.com', issuer: 'GitHub', type: 2 })
  )

beforeEach(() => {
  rows.length = 0
  credentials.clear()
  failInsertAt = 0
  insertCount = 0
  discardAllStagedImports()
})

describe('import staging security contract', () => {
  it('never returns a seed from staging, preview, or commit', () => {
    // If these constants were wrong the scan would be hunting for strings that
    // never appear and would pass no matter what leaked. GEZD… is the
    // published Base32 of the RFC 6238 ASCII seed.
    expect(SECRET_A).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(new Set(ALL_SECRETS).size).toBe(4)

    // And a scanner that never finds anything would pass this test forever.
    expect(findSecretLeaks({ a: [{ note: `key is ${SECRET_A}` }] }, ALL_SECRETS)).toHaveLength(1)
    expect(findSecretLeaks({ secret: 'redacted' }, ALL_SECRETS)).toHaveLength(1)

    const staged = stageImportText(readyExport())
    expect(findSecretLeaks(staged, ALL_SECRETS, 'stageImportText')).toEqual([])

    const again = stagedPreview(staged.stagingId)
    expect(findSecretLeaks(again, ALL_SECRETS, 'stagedPreview')).toEqual([])

    const committed = commitStagedImport(staged.stagingId, [0, 1, 2])
    expect(findSecretLeaks(committed, ALL_SECRETS, 'commitStagedImport')).toEqual([])

    // The scan is only meaningful if the seeds were really handled: they must
    // have reached the OS credential store and nothing else.
    expect(committed.imported).toBe(3)
    expect([...credentials.values()]).toEqual(
      expect.arrayContaining([SECRET_A, SECRET_B, SECRET_C])
    )
    expect(findSecretLeaks(rows, ALL_SECRETS, 'db rows')).toEqual([])
  })
})

describe('staging an authenticator link', () => {
  it('marks every usable entry ready and counts what it found', () => {
    const view = stageImportText(readyExport())
    expect(view.entries.map((e) => e.status)).toEqual(['ready', 'ready', 'ready'])
    expect(view.counts).toEqual({ ready: 3, duplicate: 0, invalid: 0, unsupported: 0 })
    expect(view.entries.map((e) => e.index)).toEqual([0, 1, 2])
    expect(view.entries.map((e) => e.issuer)).toEqual(['VRChat', 'Discord', 'GitHub'])
    expect(view.entries[0].label).toBe('one@example.com')
    expect(view.entries[0].period).toBe(30)
    expect(view.entries[0].digits).toBe(6)
    expect(view.entries[0].algorithm).toBe('SHA1')
  })

  it('stages a plain otpauth:// link as a single ready entry', () => {
    const view = stageImportText(
      `otpauth://totp/VRChat:me@example.com?secret=${SECRET_A}&issuer=VRChat`
    )
    expect(view.entries).toHaveLength(1)
    expect(view.entries[0].status).toBe('ready')
    expect(view.entries[0].issuer).toBe('VRChat')
    expect(view.entries[0].label).toBe('me@example.com')
    // A lone link is part 1 of 1, so the UI has nothing to wait for.
    expect(view.parts).toEqual({ received: [1], total: 1 })
    expect(findSecretLeaks(view, ALL_SECRETS, 'otpauth preview')).toEqual([])
  })

  it('refuses text that is not an authenticator link', () => {
    expect(() => stageImportText('https://example.com/setup')).toThrow(TotpError)
    expect(() => stageImportText('just some words')).toThrow(/otpauth/)
    expect(() => stageImportText('')).toThrow(TotpError)
  })
})

describe('duplicate detection', () => {
  it('marks the second appearance of a seed inside one export as a duplicate', () => {
    const view = stageImportText(
      exportOf(
        otpParameters({ secret: RAW_A, name: 'first', issuer: 'VRChat', type: 2 }),
        otpParameters({ secret: RAW_A, name: 'second', issuer: 'VRChat', type: 2 })
      )
    )
    expect(view.entries.map((e) => e.status)).toEqual(['ready', 'duplicate'])
    expect(view.entries[1].reason).toContain('more than once')
    expect(view.counts).toEqual({ ready: 1, duplicate: 1, invalid: 0, unsupported: 0 })
  })

  it('marks a seed that is already stored as a duplicate', () => {
    const first = stageImportText(readyExport())
    expect(commitStagedImport(first.stagingId, [0]).imported).toBe(1)

    // Re-scanning the same export is the common case: the user does not know
    // which of these they already added.
    const second = stageImportText(readyExport())
    expect(second.entries[0].status).toBe('duplicate')
    expect(second.entries[0].reason).toBe('Already in Email Hub')
    expect(second.entries.slice(1).map((e) => e.status)).toEqual(['ready', 'ready'])
    expect(second.counts).toEqual({ ready: 2, duplicate: 1, invalid: 0, unsupported: 0 })
  })

  it('re-checks an open import against storage instead of against a snapshot', () => {
    // Two imports open at once: committing one must change what the other says
    // about the same seed, or the user is shown a stale list.
    const first = stageImportText(readyExport())
    const second = stageImportText(readyExport())
    expect(second.entries[0].status).toBe('ready')

    commitStagedImport(first.stagingId, [0])

    const refreshed = stagedPreview(second.stagingId)
    expect(refreshed.entries[0].status).toBe('duplicate')
    expect(refreshed.entries[0].reason).toBe('Already in Email Hub')
  })

  it('reports a selected duplicate as skipped rather than importing it twice', () => {
    const view = stageImportText(
      exportOf(
        otpParameters({ secret: RAW_A, name: 'first', issuer: 'VRChat', type: 2 }),
        otpParameters({ secret: RAW_A, name: 'second', issuer: 'VRChat', type: 2 })
      )
    )
    const result = commitStagedImport(view.stagingId, [0, 1])
    expect(result.imported).toBe(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].index).toBe(1)
    expect(result.skipped[0].reason).toContain('more than once')
    expect(rows).toHaveLength(1)
    expect(totpKeys()).toHaveLength(1)
  })
})

describe('entries that cannot be imported', () => {
  it('separates damaged entries from ones Email Hub does not support', () => {
    const view = stageImportText(
      exportOf(
        otpParameters({ secret: RAW_C, name: 'fine', issuer: 'GitHub', type: 2 }),
        otpParameters({ secret: Buffer.alloc(0), name: 'keyless', type: 2 }),
        otpParameters({ secret: Buffer.from('12345', 'ascii'), name: 'stubby', type: 2 }),
        otpParameters({ secret: RAW_A, name: 'counter-based', type: 1 }),
        otpParameters({ secret: RAW_B, name: 'md5', algorithm: 4, type: 2 })
      )
    )

    expect(view.entries.map((e) => e.status)).toEqual([
      'ready',
      'invalid',
      'invalid',
      'unsupported',
      'unsupported',
    ])
    expect(view.counts).toEqual({ ready: 1, duplicate: 0, invalid: 2, unsupported: 2 })

    expect(view.entries[1].reason).toContain('no key')
    expect(view.entries[2].reason).toContain('too short')
    expect(view.entries[3].reason).toContain('HOTP')
    expect(view.entries[4].reason).toContain('algorithm')

    // A reason is shown to the user and written to the log, so it must not
    // quote what it is complaining about.
    expect(findSecretLeaks(view, ALL_SECRETS, 'problem preview')).toEqual([])
  })

  it('reports a selected unusable entry instead of silently dropping it', () => {
    const view = stageImportText(
      exportOf(otpParameters({ secret: RAW_A, name: 'counter-based', type: 1 }))
    )
    const result = commitStagedImport(view.stagingId, [0])
    expect(result.imported).toBe(0)
    expect(result.skipped[0].reason).toContain('HOTP')
    expect(rows).toHaveLength(0)
    expect(totpKeys()).toEqual([])
  })
})

describe('committing a staged import', () => {
  it('imports exactly the selected entries and leaves the rest out', () => {
    const view = stageImportText(readyExport())
    const result = commitStagedImport(view.stagingId, [0, 2])

    expect(result).toEqual({ imported: 2, skipped: [] })
    expect(rows.map((r) => r.label)).toEqual(['one@example.com', 'three@example.com'])
    expect([...credentials.values()].sort()).toEqual([SECRET_A, SECRET_C].sort())
    // The unselected seed was never written anywhere.
    expect([...credentials.values()]).not.toContain(SECRET_B)

    // Committed means finished: the staged seeds have no further purpose.
    expect(() => stagedPreview(view.stagingId)).toThrow(TotpError)
  })

  it('refuses a commit that selects nothing', () => {
    const view = stageImportText(readyExport())
    expect(() => commitStagedImport(view.stagingId, [])).toThrow(/Nothing was selected/)
    expect(rows).toHaveLength(0)
  })

  it('leaves nothing behind when a row insert fails partway through', () => {
    const view = stageImportText(
      exportOf(
        otpParameters({ secret: RAW_A, name: 'one', issuer: 'VRChat', type: 2 }),
        otpParameters({ secret: RAW_B, name: 'two', issuer: 'Discord', type: 2 }),
        otpParameters({ secret: RAW_C, name: 'three', issuer: 'GitHub', type: 2 }),
        otpParameters({ secret: RAW_D, name: 'four', issuer: 'Steam', type: 2 })
      )
    )
    expect(view.counts.ready).toBe(4)

    failInsertAt = 3
    expect(() => commitStagedImport(view.stagingId, [0, 1, 2, 3])).toThrow()

    // The failure has to land mid-write, otherwise this proves nothing.
    expect(insertCount).toBe(3)

    // Neither half of the split storage may keep a trace: a row without a seed
    // is unusable, and a seed without a row is invisible and unremovable.
    expect(rows).toEqual([])
    expect(totpKeys()).toEqual([])

    // The export QR is usually gone by the time a failure is noticed, so the
    // staged copy has to survive for a retry.
    failInsertAt = 0
    expect(commitStagedImport(view.stagingId, [0, 1, 2, 3]).imported).toBe(4)
    expect(rows).toHaveLength(4)
    expect(totpKeys()).toHaveLength(4)
  })
})

describe('multi-part exports', () => {
  const partOne = (): string =>
    migrationUri(
      [
        otpParameters({ secret: RAW_A, name: 'one', issuer: 'VRChat', type: 2 }),
        otpParameters({ secret: RAW_B, name: 'two', issuer: 'Discord', type: 2 }),
      ],
      { index: 0, size: 2, id: 42 }
    )

  const partTwo = (): string =>
    migrationUri([otpParameters({ secret: RAW_C, name: 'three', issuer: 'GitHub', type: 2 })], {
      index: 1,
      size: 2,
      id: 42,
    })

  it('merges a second QR into the open import rather than replacing it', () => {
    const first = stageImportText(partOne())
    expect(first.parts).toEqual({ received: [1], total: 2 })
    expect(first.entries).toHaveLength(2)

    const merged = stageImportText(partTwo(), first.stagingId)
    expect(merged.stagingId).toBe(first.stagingId)
    expect(merged.parts).toEqual({ received: [1, 2], total: 2 })
    expect(merged.entries.map((e) => e.label)).toEqual(['one', 'two', 'three'])
    expect(merged.counts).toEqual({ ready: 3, duplicate: 0, invalid: 0, unsupported: 0 })
    expect(findSecretLeaks(merged, ALL_SECRETS, 'merged preview')).toEqual([])

    expect(commitStagedImport(merged.stagingId, [0, 1, 2]).imported).toBe(3)
  })

  it('replaces a part when the same QR is scanned twice', () => {
    const first = stageImportText(partOne())
    stageImportText(partTwo(), first.stagingId)

    // Same part number, different contents — a re-scan must not stack.
    const rescanned = stageImportText(
      migrationUri([otpParameters({ secret: RAW_D, name: 'four', issuer: 'Steam', type: 2 })], {
        index: 1,
        size: 2,
        id: 42,
      }),
      first.stagingId
    )
    expect(rescanned.entries.map((e) => e.label)).toEqual(['one', 'two', 'four'])
    expect(rescanned.parts).toEqual({ received: [1, 2], total: 2 })
  })

  it('refuses a QR belonging to a different export', () => {
    const first = stageImportText(partOne())
    const otherExport = migrationUri(
      [otpParameters({ secret: RAW_D, name: 'stranger', issuer: 'Steam', type: 2 })],
      { index: 1, size: 2, id: 99 }
    )

    expect(() => stageImportText(otherExport, first.stagingId)).toThrow(/different export/)
    // And the import already in progress is untouched.
    expect(stagedPreview(first.stagingId).entries.map((e) => e.label)).toEqual(['one', 'two'])
  })
})

describe('staging lifetime', () => {
  it('throws for a staging id it does not know', () => {
    expect(() => stagedPreview('not-a-real-id')).toThrow(TotpError)
    expect(() => commitStagedImport('not-a-real-id', [0])).toThrow(TotpError)
  })

  it('makes a discarded import unusable', () => {
    const view = stageImportText(readyExport())
    discardStagedImport(view.stagingId)

    expect(() => stagedPreview(view.stagingId)).toThrow(TotpError)
    expect(() => commitStagedImport(view.stagingId, [0])).toThrow(TotpError)
    expect(rows).toEqual([])
    expect(totpKeys()).toEqual([])
  })
})
