import { describe, it, expect } from 'vitest'
import { parseMigrationUri } from './migration'
import { generateTotp, decodeBase32, TotpError } from './totp'

// Build real protobuf payloads by hand so the decoder is tested against the
// actual wire format rather than against itself.
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

function migrationUri(entries: Buffer[], extra: Buffer[] = []): string {
  const payload = Buffer.concat([
    ...entries.map((e) => lengthDelimited(1, e)),
    ...extra,
  ])
  return `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`
}

// 20 raw bytes — what a real service issues, and long enough to pass the
// minimum-length guard once base32-encoded.
const RAW_SECRET = Buffer.from('12345678901234567890', 'ascii')

describe('parseMigrationUri', () => {
  it('decodes a single account', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'me@example.com', issuer: 'VRChat', type: 2 }),
    ])
    const entries = parseMigrationUri(uri)
    expect(entries).toHaveLength(1)
    expect(entries[0].issuer).toBe('VRChat')
    expect(entries[0].label).toBe('me@example.com')
    expect(entries[0].algorithm).toBe('SHA1')
    expect(entries[0].digits).toBe(6)
    expect(entries[0].unsupportedReason).toBeUndefined()
  })

  it('recovers the exact secret — codes match the original', () => {
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', type: 2 })])
    const [entry] = parseMigrationUri(uri)
    // The decoded base32 must be byte-identical to what went in
    expect(decodeBase32(entry.secret)).toEqual(RAW_SECRET)
    // And must produce the RFC 6238 vector for this seed
    expect(generateTotp({ secret: entry.secret, digits: 8 }, 59_000).code).toBe('94287082')
  })

  it('decodes several accounts from one export', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'one', issuer: 'VRChat', type: 2 }),
      otpParameters({ secret: RAW_SECRET, name: 'two', issuer: 'VRChat', type: 2 }),
      otpParameters({ secret: RAW_SECRET, name: 'three', issuer: 'Discord', type: 2 }),
    ])
    const entries = parseMigrationUri(uri)
    expect(entries.map((e) => e.label)).toEqual(['one', 'two', 'three'])
    expect(entries[2].issuer).toBe('Discord')
  })

  it('splits an "Issuer:account" label when there is no issuer field', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'VRChat:my-account', type: 2 }),
    ])
    const [entry] = parseMigrationUri(uri)
    expect(entry.issuer).toBe('VRChat')
    expect(entry.label).toBe('my-account')
  })

  it('maps the algorithm and digit enums', () => {
    const sha256 = parseMigrationUri(
      migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', algorithm: 2, digits: 2, type: 2 })])
    )[0]
    expect(sha256.algorithm).toBe('SHA256')
    expect(sha256.digits).toBe(8)

    const sha512 = parseMigrationUri(
      migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', algorithm: 3, type: 2 })])
    )[0]
    expect(sha512.algorithm).toBe('SHA512')
  })

  it('flags entries it cannot use instead of dropping them silently', () => {
    const hotp = parseMigrationUri(
      migrationUri([otpParameters({ secret: RAW_SECRET, name: 'counter', type: 1 })])
    )[0]
    expect(hotp.unsupportedReason).toContain('HOTP')

    const md5 = parseMigrationUri(
      migrationUri([otpParameters({ secret: RAW_SECRET, name: 'weird', algorithm: 4, type: 2 })])
    )[0]
    expect(md5.unsupportedReason).toBeTruthy()
  })

  it('ignores the batch fields Google adds', () => {
    // version=2, batch_size=3, batch_index=4, batch_id=5 sit alongside entries
    const extra = [varintField(2, 1), varintField(3, 1), varintField(4, 0), varintField(5, 12345)]
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', type: 2 })], extra)
    expect(parseMigrationUri(uri)).toHaveLength(1)
  })

  it('rejects malformed input', () => {
    expect(() => parseMigrationUri('not a uri')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth-migration://offline')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth-migration://offline?data=')).toThrow(TotpError)
  })

  it('reports an export containing no accounts', () => {
    const empty = `otpauth-migration://offline?data=${encodeURIComponent(
      Buffer.concat([varintField(2, 1)]).toString('base64')
    )}`
    expect(() => parseMigrationUri(empty)).toThrow(/No accounts/)
  })

  it('does not run past the end of truncated data', () => {
    const good = otpParameters({ secret: RAW_SECRET, name: 'a', type: 2 })
    const full = Buffer.concat([tag(1, 2), varint(good.length), good])
    const truncated = full.subarray(0, full.length - 6)
    const uri = `otpauth-migration://offline?data=${encodeURIComponent(truncated.toString('base64'))}`
    expect(() => parseMigrationUri(uri)).toThrow(TotpError)
  })
})
