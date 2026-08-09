import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// Type-only, so it is erased before the hoisted vi.mock factories run.
import type * as QrImageModule from '../../totp/qrImage'

/**
 * This layer is the security boundary of the authenticator subsystem:
 * everything below it holds seeds, and nothing above it may ever see one.
 *
 * Electron, SQLite and the OS credential store are replaced at the module
 * boundary, so the real handlers register themselves against a fake ipcMain and
 * can be invoked directly — the same call the renderer makes, with the answer
 * available for inspection.
 */

interface Envelope<T> {
  data?: T
  error?: { code: string; message: string }
}

type Handler = (event: unknown, payload?: unknown) => Promise<Envelope<unknown>>

interface FakeRow {
  id: string
  accountId: string | null
  issuer: string
  label: string
  algorithm: string
  digits: number
  period: number
  verified: number
  createdAt: number
  updatedAt: number
}

const handlers = new Map<string, Handler>()
const rows: FakeRow[] = []
const credentials = new Map<string, string>()

let protection = { encrypted: true, method: 'Test' }
let sqliteFailure: Error | null = null
let qrFailure: Error | null = null
let qrPayload = ''

/** Just enough of better-sqlite3 for the store: prepare/all/get/run plus a transaction. */
const sqlite = {
  prepare: (sql: string) => {
    if (sqliteFailure) throw sqliteFailure
    return {
      all: (): FakeRow[] => [...rows],
      get: (id: string): FakeRow | undefined => rows.find((r) => r.id === id),
      run: (...args: unknown[]): void => {
        if (sql.startsWith('INSERT')) {
          rows.push({
            id: args[0] as string,
            accountId: (args[1] as string | null) ?? null,
            issuer: args[2] as string,
            label: args[3] as string,
            algorithm: args[4] as string,
            digits: args[5] as number,
            period: args[6] as number,
            verified: 0,
            createdAt: args[7] as number,
            updatedAt: args[8] as number,
          })
        } else if (sql.startsWith('DELETE')) {
          const index = rows.findIndex((r) => r.id === args[0])
          if (index >= 0) rows.splice(index, 1)
        } else if (sql.includes('SET issuer')) {
          const row = rows.find((r) => r.id === args[3])
          if (row) {
            row.issuer = args[0] as string
            row.label = args[1] as string
            row.updatedAt = args[2] as number
          }
        } else if (sql.includes('SET verified')) {
          const row = rows.find((r) => r.id === args[1])
          if (row) {
            row.verified = 1
            row.updatedAt = args[0] as number
          }
        }
      },
    }
  },
  transaction:
    <T>(fn: (arg: T) => void) =>
    (arg: T): void =>
      fn(arg),
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler): void => {
      handlers.set(channel, handler)
    },
  },
  // qrImage imports this at module load; only the decode step is stubbed below.
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
}))

vi.mock('../../db/client', () => ({ getRawSqlite: () => sqlite }))

vi.mock('../../security/keychain', () => ({
  credentialStore: {
    set: (key: string, value: string): void => {
      credentials.set(key, value)
    },
    setMany: (entries: Record<string, string>): void => {
      for (const [key, value] of Object.entries(entries)) credentials.set(key, value)
    },
    get: (key: string): string | null => credentials.get(key) ?? null,
    delete: (key: string): void => {
      credentials.delete(key)
    },
    has: (key: string): boolean => credentials.has(key),
    keys: (): string[] => [...credentials.keys()],
    deleteByPrefix: (prefix: string): number => {
      let removed = 0
      for (const key of [...credentials.keys()]) {
        if (key.startsWith(prefix)) {
          credentials.delete(key)
          removed++
        }
      }
      return removed
    },
  },
  getCredentialProtection: () => protection,
}))

// Only the decode step is replaced — MAX_IMAGE_BYTES stays the real limit, so
// the size guard is tested against the number that actually ships.
vi.mock('../../totp/qrImage', async (importOriginal) => ({
  ...(await importOriginal<typeof QrImageModule>()),
  decodeQrFromImageBytes: (): string => {
    if (qrFailure) throw qrFailure
    return qrPayload
  },
}))

import { IPC } from '@shared/constants/ipc-channels'
import { registerTotpHandlers } from './totp'
import { discardAllStagedImports } from '../../totp/importStaging'
import { encodeBase32 } from '../../totp/totp'
import { MAX_IMAGE_BYTES } from '../../totp/qrImage'
import type { ImportCommitResult, ImportPreview } from '../../totp/importStaging'
import type { TotpAccountMeta, TotpCodeView } from '../../totp/totpStore'

// ── Fixtures ───────────────────────────────────────────────────────────────

// Real protobuf payloads, built by hand, so the import channels are exercised
// against the wire format Google Authenticator actually emits.
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

function migrationData(entries: Buffer[]): string {
  return Buffer.concat(entries.map((e) => lengthDelimited(1, e))).toString('base64')
}

function migrationUri(entries: Buffer[]): string {
  return `otpauth-migration://offline?data=${encodeURIComponent(migrationData(entries))}`
}

const SECRET = 'JBSWY3DPEHPK3PXP'
/** RFC 6238's seed "12345678901234567890" — its published vectors are the yardstick. */
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii')
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
const SEED_B = Buffer.from('abcdefghijklmnopqrst', 'ascii')
const SEED_C = Buffer.from('ABCDEFGHIJKLMNOPQRST', 'ascii')
const SHORT_SEED = Buffer.from('1234', 'ascii')

/** digits enum 2 = 8 digits, type enum 2 = time-based. */
const EXPORT_ENTRIES = [
  otpParameters({ secret: RFC_SEED, name: 'rfc@example.com', issuer: 'RFC', digits: 2, type: 2 }),
  otpParameters({ secret: SEED_B, name: 'b@example.com', issuer: 'Discord', type: 2 }),
  otpParameters({ secret: SEED_C, name: 'c@example.com', issuer: 'GitHub', type: 2 }),
]
const MIGRATION_URI = migrationUri(EXPORT_ENTRIES)
const OTPAUTH_URI = `otpauth://totp/Discord:someone@example.com?secret=${encodeBase32(SEED_B)}&issuer=Discord`
const PNG_BYTES = new Uint8Array([137, 80, 78, 71])

const ADD_PAYLOAD = { secret: SECRET, issuer: 'VRChat', label: 'me@example.com' }

/** Anything whose appearance in a response would mean a seed escaped. */
const NEEDLES = [
  SECRET,
  RFC_SECRET,
  encodeBase32(SEED_B),
  encodeBase32(SEED_C),
  migrationData(EXPORT_ENTRIES),
]

registerTotpHandlers()

async function invoke<T = unknown>(channel: string, payload?: unknown): Promise<Envelope<T>> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`No handler registered for ${channel}`)
  return (await handler({}, payload)) as Envelope<T>
}

/**
 * Walk a response looking for either shape a leak could take: a field actually
 * named `secret`, or a string carrying one of the seeds in play.
 */
function leaks(value: unknown, path: string): string[] {
  const found: string[] = []

  const walk = (node: unknown, at: string): void => {
    if (typeof node === 'string') {
      for (const needle of NEEDLES) {
        if (node.includes(needle)) found.push(`${at} carries a seed`)
      }
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`))
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        if (key.toLowerCase() === 'secret') found.push(`${at}.${key} is a secret field`)
        walk(item, `${at}.${key}`)
      }
    }
  }

  walk(value, path)
  return found
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('authenticator IPC', () => {
  beforeEach(() => {
    rows.length = 0
    credentials.clear()
    discardAllStagedImports()
    protection = { encrypted: true, method: 'Test' }
    sqliteFailure = null
    qrFailure = null
    qrPayload = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers exactly the channels the renderer is allowed to call', () => {
    // Pinned deliberately: a getSecret-shaped channel added later fails here
    // before it can ever answer the renderer.
    expect([...handlers.keys()].sort()).toEqual(
      [
        IPC.TOTP_ADD,
        IPC.TOTP_DELETE,
        IPC.TOTP_IMPORT_COMMIT,
        IPC.TOTP_IMPORT_DISCARD,
        IPC.TOTP_IMPORT_SCAN,
        IPC.TOTP_LIST,
        IPC.TOTP_RENAME,
        IPC.TOTP_VERIFY,
      ].sort()
    )
  })

  it('never hands a seed back on any registered channel', async () => {
    // The sweep below is only worth anything if the detector fires, so plant a
    // leak of each shape first: a field named `secret`, and a seed in a value.
    expect(leaks({ data: { code: '123456', secret: SECRET } }, 'planted')).toHaveLength(2)
    expect(leaks({ data: [{ reason: `bad key ${RFC_SECRET}` }] }, 'planted')).toHaveLength(1)

    const added = await invoke<TotpAccountMeta>(IPC.TOTP_ADD, ADD_PAYLOAD)
    const id = added.data?.id ?? ''
    const staged = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'text', text: MIGRATION_URI },
    })
    const stagingId = staged.data?.stagingId ?? ''

    const payloads: Record<string, unknown> = {
      [IPC.TOTP_LIST]: undefined,
      [IPC.TOTP_ADD]: { ...ADD_PAYLOAD, label: 'second@example.com' },
      [IPC.TOTP_IMPORT_SCAN]: { source: { kind: 'text', text: OTPAUTH_URI } },
      [IPC.TOTP_IMPORT_COMMIT]: { stagingId, indices: [0, 1, 2] },
      [IPC.TOTP_IMPORT_DISCARD]: { stagingId },
      [IPC.TOTP_VERIFY]: { id, code: '000000' },
      [IPC.TOTP_RENAME]: { id, issuer: 'VRChat', label: 'renamed' },
      [IPC.TOTP_DELETE]: { id },
    }

    for (const [channel, handler] of handlers) {
      // A channel added later must be given a payload here rather than skipped.
      expect(Object.keys(payloads), `${channel} has no valid payload in this test`).toContain(
        channel
      )
      const response = await handler({}, payloads[channel])
      expect(response.error, `${channel} rejected a valid payload`).toBeUndefined()
      expect(leaks(response, channel)).toEqual([])
    }
  })

  it('answers a malformed payload with an error envelope instead of throwing', async () => {
    const garbage = [undefined, null, true, 42, 'nope', [], {}]

    const malformed: Record<string, unknown[]> = {
      [IPC.TOTP_ADD]: [
        ...garbage,
        { label: 'x' },
        { secret: SECRET },
        { secret: 42, label: 'x' },
        { secret: '', label: 'x' },
        { secret: 'A'.repeat(513), label: 'x' },
        { secret: SECRET, label: '' },
        { secret: SECRET, label: 'x'.repeat(201) },
        { secret: SECRET, label: 'x', issuer: 'i'.repeat(201) },
        { secret: SECRET, label: 'x', algorithm: 'MD5' },
        { secret: SECRET, label: 'x', digits: -6 },
        { secret: SECRET, label: 'x', digits: 6.5 },
        { secret: SECRET, label: 'x', period: -30 },
        { secret: SECRET, label: 'x', period: 3000 },
        { secret: SECRET, label: 'x', accountId: 7 },
      ],
      [IPC.TOTP_VERIFY]: [
        ...garbage,
        { id: 'x' },
        { code: '123456' },
        { id: '', code: '123456' },
        { id: 'x'.repeat(201), code: '123456' },
        { id: 'x', code: '12' },
        { id: 'x', code: '1'.repeat(17) },
        { id: 'x', code: 123456 },
      ],
      [IPC.TOTP_RENAME]: [
        ...garbage,
        { id: 'x', issuer: 'a' },
        { id: 'x', label: 'b' },
        { id: 'x', issuer: 'a', label: '' },
        { id: 'x', issuer: null, label: 'b' },
        { id: 'x', issuer: 'a'.repeat(201), label: 'b' },
        { id: '', issuer: 'a', label: 'b' },
      ],
      [IPC.TOTP_DELETE]: [...garbage, { id: '' }, { id: 42 }, { id: 'x'.repeat(201) }],
      [IPC.TOTP_IMPORT_SCAN]: [
        ...garbage,
        { source: OTPAUTH_URI },
        { source: { kind: 'text' } },
        { source: { kind: 'text', text: '' } },
        { source: { kind: 'text', text: 'x'.repeat(16385) } },
        { source: { kind: 'video', text: OTPAUTH_URI } },
        { source: { kind: 'image' } },
        { source: { kind: 'image', bytes: [137, 80, 78, 71] } },
        { source: { kind: 'image', bytes: 'PNG' } },
        { source: { kind: 'text', text: OTPAUTH_URI }, stagingId: '' },
        { source: { kind: 'text', text: OTPAUTH_URI }, stagingId: 'x'.repeat(101) },
      ],
      [IPC.TOTP_IMPORT_COMMIT]: [
        ...garbage,
        { stagingId: 'x' },
        { indices: [0] },
        { stagingId: '', indices: [0] },
        { stagingId: 'x'.repeat(101), indices: [0] },
        { stagingId: 'x', indices: 'all' },
        { stagingId: 'x', indices: [-1] },
        { stagingId: 'x', indices: [1.5] },
        { stagingId: 'x', indices: [10001] },
        { stagingId: 'x', indices: new Array<number>(1001).fill(0) },
      ],
    }

    // TOTP_LIST takes no payload and TOTP_IMPORT_DISCARD is best-effort
    // cleanup; both are covered by their own tests below.
    const noPayload = new Set<string>([IPC.TOTP_LIST, IPC.TOTP_IMPORT_DISCARD])

    for (const channel of handlers.keys()) {
      if (noPayload.has(channel)) continue
      const cases = malformed[channel]
      expect(cases, `${channel} has no malformed payloads in this test`).toBeDefined()
      for (const payload of cases) {
        const response = await invoke(channel, payload)
        expect(response.error?.message, `${channel} accepted ${JSON.stringify(payload)}`).toEqual(
          expect.any(String)
        )
        expect(response.data).toBeUndefined()
      }
    }
  })

  it('ignores whatever payload is sent to the read-only listing channel', async () => {
    await invoke(IPC.TOTP_ADD, ADD_PAYLOAD)
    const listed = await invoke<TotpCodeView[]>(IPC.TOTP_LIST, { give: 'me the secret' })
    expect(listed.data).toHaveLength(1)
    expect(leaks(listed, 'list')).toEqual([])
  })

  it('replaces an internal failure with a message that carries nothing from it', async () => {
    const marker = 'LEAK-MARKER-9f3a'

    sqliteFailure = new Error(`SQLITE_CANTOPEN ${marker}`)
    const listed = await invoke(IPC.TOTP_LIST)
    expect(listed.error?.message).toBe('Could not read authenticators')
    expect(JSON.stringify(listed)).not.toContain(marker)

    const added = await invoke(IPC.TOTP_ADD, ADD_PAYLOAD)
    expect(added.error?.message).toBe('Could not add authenticator')
    expect(JSON.stringify(added)).not.toContain(marker)
    // The secret written ahead of the row is rolled back, not orphaned.
    expect(credentials.size).toBe(0)

    sqliteFailure = null
    qrFailure = new Error(`decoder blew up in ${marker}`)
    const scanned = await invoke(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'image', bytes: PNG_BYTES },
    })
    expect(scanned.error?.message).toBe('That could not be read as an authenticator export')
    expect(JSON.stringify(scanned)).not.toContain(marker)
  })

  it('explains why nothing will save when the OS cannot encrypt', async () => {
    protection = { encrypted: false, method: 'None — OS encryption unavailable' }

    const response = await invoke(IPC.TOTP_ADD, ADD_PAYLOAD)
    // A TotpError, so this one is allowed through: it is the only message that
    // tells the user why adding an authenticator will never work here.
    expect(response.error?.message).not.toBe('Could not add authenticator')
    expect(response.error?.message).toContain('cannot encrypt')
    expect(response.error?.message).toContain('Settings')
    expect(credentials.size).toBe(0)
    expect(rows).toHaveLength(0)
  })

  it('returns metadata only when an authenticator is added', async () => {
    const response = await invoke<TotpAccountMeta>(IPC.TOTP_ADD, {
      secret: 'jbsw y3dp ehpk 3pxp',
      issuer: '  VRChat  ',
      label: '  me@example.com  ',
    })
    expect(response.data?.issuer).toBe('VRChat')
    expect(response.data?.label).toBe('me@example.com')
    expect(response.data?.verified).toBe(false)
    expect(leaks(response, 'add')).toEqual([])
    // The pasted form is normalised on the way into the credential store only.
    expect([...credentials.values()]).toEqual([SECRET])
  })

  it('refuses a malformed setup key without echoing the character it objected to', async () => {
    const response = await invoke(IPC.TOTP_ADD, { secret: 'JBSWY3DPEHPK3PX!', label: 'x' })
    expect(response.error?.code).toBe('TOTP_ADD_FAILED')
    expect(response.error?.message).toContain('position 16')
    expect(response.error?.message).not.toContain('!')
    expect(credentials.size).toBe(0)
    expect(rows).toHaveLength(0)
  })

  it('turns a pasted link into a preview carrying metadata only', async () => {
    const response = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'text', text: OTPAUTH_URI },
    })
    expect(response.data?.entries).toEqual([
      {
        index: 0,
        issuer: 'Discord',
        label: 'someone@example.com',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        status: 'ready',
        reason: undefined,
      },
    ])
    expect(leaks(response, 'importScan')).toEqual([])
  })

  it('decodes a dropped QR image through the same staging path', async () => {
    qrPayload = MIGRATION_URI
    const response = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'image', bytes: PNG_BYTES },
    })
    expect(response.data?.entries.map((e) => e.label)).toEqual([
      'rfc@example.com',
      'b@example.com',
      'c@example.com',
    ])
    expect(response.data?.counts).toEqual({ ready: 3, duplicate: 0, invalid: 0, unsupported: 0 })
    expect(response.data?.parts).toEqual({ received: [1], total: 1 })
    // The renderer supplied an image it cannot read; it must not get the
    // payload back in readable form.
    expect(leaks(response, 'importScan')).toEqual([])
  })

  it('refuses an image larger than the decoder is willing to accept', async () => {
    // The payload itself is a perfectly good export, so only the size guard can
    // be what rejects this.
    qrPayload = MIGRATION_URI
    const response = await invoke(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'image', bytes: new Uint8Array(MAX_IMAGE_BYTES + 1) },
    })
    expect(response.error?.code).toBe('TOTP_IMPORT_SCAN_FAILED')
    expect(response.data).toBeUndefined()
    // The size guard lives in the handler rather than in the schema: a schema
    // failure is a ZodError, and safeMessage would replace its wording with
    // the generic text, so the user would be told the file was unreadable
    // rather than too big.
    expect(response.error?.message).toBe(
      'That image is too large — a screenshot of the QR code is plenty'
    )
  })

  it('imports the chosen indices, with the seeds the export actually carried', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(59_000) // RFC 6238's first test vector

    const staged = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'text', text: MIGRATION_URI },
    })
    const committed = await invoke<ImportCommitResult>(IPC.TOTP_IMPORT_COMMIT, {
      stagingId: staged.data?.stagingId,
      indices: [0, 2],
    })
    expect(committed.data).toEqual({ imported: 2, skipped: [] })

    const listed = await invoke<TotpCodeView[]>(IPC.TOTP_LIST)
    expect((listed.data ?? []).map((a) => a.label).sort()).toEqual([
      'c@example.com',
      'rfc@example.com',
    ])
    // Proof the right seed landed: the 8-digit SHA-1 code for T=59 published in
    // RFC 6238 for the seed encoded into that export.
    const rfc = listed.data?.find((a) => a.label === 'rfc@example.com')
    expect(rfc?.digits).toBe(8)
    expect(rfc?.code).toBe('94287082')
    expect(leaks(listed, 'list')).toEqual([])
  })

  it('reports the entries a user picked that cannot be imported', async () => {
    const uri = migrationUri([
      otpParameters({ secret: SHORT_SEED, name: 'stub@example.com', type: 2 }),
      otpParameters({ secret: RFC_SEED, name: 'counter@example.com', type: 1 }),
    ])
    const staged = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'text', text: uri },
    })
    expect(staged.data?.counts).toEqual({ ready: 0, duplicate: 0, invalid: 1, unsupported: 1 })

    const committed = await invoke<ImportCommitResult>(IPC.TOTP_IMPORT_COMMIT, {
      stagingId: staged.data?.stagingId,
      indices: [0, 1],
    })
    expect(committed.data?.imported).toBe(0)
    expect(committed.data?.skipped.map((s) => s.index)).toEqual([0, 1])
    expect(rows).toHaveLength(0)
    expect(leaks(committed, 'importCommit')).toEqual([])
  })

  it('marks an entry already stored as a duplicate rather than importing it twice', async () => {
    await invoke(IPC.TOTP_ADD, {
      secret: encodeBase32(SEED_C),
      issuer: 'GitHub',
      label: 'c@example.com',
    })
    const staged = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'text', text: MIGRATION_URI },
    })
    const duplicate = staged.data?.entries.find((e) => e.label === 'c@example.com')
    expect(duplicate?.status).toBe('duplicate')
    expect(duplicate?.reason).toBe('Already in Email Hub')
    expect(staged.data?.counts.duplicate).toBe(1)
  })

  it('discards an import without complaint, including one it never heard of', async () => {
    const staged = await invoke<ImportPreview>(IPC.TOTP_IMPORT_SCAN, {
      source: { kind: 'text', text: OTPAUTH_URI },
    })
    const stagingId = staged.data?.stagingId

    await expect(invoke(IPC.TOTP_IMPORT_DISCARD, { stagingId })).resolves.toEqual({ data: null })
    await expect(invoke(IPC.TOTP_IMPORT_DISCARD, { stagingId })).resolves.toEqual({ data: null })
    await expect(
      invoke(IPC.TOTP_IMPORT_DISCARD, { stagingId: 'never-existed' })
    ).resolves.toEqual({ data: null })
    await expect(invoke(IPC.TOTP_IMPORT_DISCARD, 'not even an object')).resolves.toEqual({
      data: null,
    })

    // Discarded means gone: the same id can no longer be committed.
    const committed = await invoke(IPC.TOTP_IMPORT_COMMIT, { stagingId, indices: [0] })
    expect(committed.error?.code).toBe('TOTP_IMPORT_COMMIT_FAILED')
    expect(rows).toHaveLength(0)
  })

  it('verifies the RFC 6238 vector and remembers the account was verified', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(59_000)

    const added = await invoke<TotpAccountMeta>(IPC.TOTP_ADD, {
      secret: RFC_SECRET,
      issuer: 'RFC',
      label: '6238',
      digits: 8,
    })
    const id = added.data?.id

    const wrong = await invoke<{ verified: boolean }>(IPC.TOTP_VERIFY, { id, code: '00000000' })
    expect(wrong.data).toEqual({ verified: false })

    const right = await invoke<{ verified: boolean }>(IPC.TOTP_VERIFY, { id, code: '94287082' })
    expect(right.data).toEqual({ verified: true })

    const listed = await invoke<TotpCodeView[]>(IPC.TOTP_LIST)
    expect(listed.data?.[0].verified).toBe(true)
    expect(listed.data?.[0].code).toBe('94287082')
    expect(listed.data?.[0].remainingSeconds).toBe(1)
  })

  it('reports an unknown account as unverified rather than failing', async () => {
    const response = await invoke<{ verified: boolean }>(IPC.TOTP_VERIFY, {
      id: 'no-such-account',
      code: '123456',
    })
    expect(response.data).toEqual({ verified: false })
    expect(response.error).toBeUndefined()
  })

  it('renames an authenticator and removes the stored secret when it is deleted', async () => {
    const added = await invoke<TotpAccountMeta>(IPC.TOTP_ADD, ADD_PAYLOAD)
    const id = added.data?.id

    await expect(
      invoke(IPC.TOTP_RENAME, { id, issuer: '  Discord  ', label: '  new-name  ' })
    ).resolves.toEqual({ data: null })

    const renamed = await invoke<TotpCodeView[]>(IPC.TOTP_LIST)
    expect(renamed.data?.[0].issuer).toBe('Discord')
    expect(renamed.data?.[0].label).toBe('new-name')

    await expect(invoke(IPC.TOTP_DELETE, { id })).resolves.toEqual({ data: null })
    expect(credentials.size).toBe(0)
    expect((await invoke<TotpCodeView[]>(IPC.TOTP_LIST)).data).toEqual([])
  })

  it('surfaces a missing stored secret without saying anything about it', async () => {
    await invoke(IPC.TOTP_ADD, ADD_PAYLOAD)
    credentials.clear() // a credential store that lost its contents

    const listed = await invoke<TotpCodeView[]>(IPC.TOTP_LIST)
    expect(listed.data?.[0].code).toBeNull()
    expect(listed.data?.[0].error).toContain('Stored secret is missing')
    expect(leaks(listed, 'list')).toEqual([])
  })
})
