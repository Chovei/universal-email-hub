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
  secret?: Buffer
  name?: string
  issuer?: string
  algorithm?: number
  digits?: number
  type?: number
}

function otpParameters(p: Params): Buffer {
  const parts: Buffer[] = []
  if (p.secret !== undefined) parts.push(lengthDelimited(1, p.secret))
  if (p.name !== undefined) parts.push(lengthDelimited(2, Buffer.from(p.name, 'utf8')))
  if (p.issuer !== undefined) parts.push(lengthDelimited(3, Buffer.from(p.issuer, 'utf8')))
  if (p.algorithm !== undefined) parts.push(varintField(4, p.algorithm))
  if (p.digits !== undefined) parts.push(varintField(5, p.digits))
  if (p.type !== undefined) parts.push(varintField(6, p.type))
  return Buffer.concat(parts)
}

function payloadOf(entries: Buffer[], extra: Buffer[] = []): Buffer {
  return Buffer.concat([...entries.map((e) => lengthDelimited(1, e)), ...extra])
}

function uriFor(data: string): string {
  return `otpauth-migration://offline?data=${data}`
}

function migrationUri(entries: Buffer[], extra: Buffer[] = []): string {
  return uriFor(encodeURIComponent(payloadOf(entries, extra).toString('base64')))
}

// 20 raw bytes — what a real service issues, and the RFC 6238 SHA-1 seed, so a
// recovered secret can be checked against a published code rather than against
// whatever this decoder happened to produce.
const RAW_SECRET = Buffer.from('12345678901234567890', 'ascii')

// Chosen so the export's standard base64 contains BOTH a literal '+' and a
// literal '/', and both land inside the secret's own bytes. That is what makes
// the two alphabet tests below able to fail.
const PUNCTUATED_SECRET = Buffer.from(Array.from({ length: 20 }, (_, i) => (56 + i * 7) & 0xff))

const TOTP = 2
const HOTP = 1

describe('parseMigrationUri', () => {
  it('decodes a single account', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'me@example.com', issuer: 'VRChat', type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries).toHaveLength(1)
    expect(entries[0].issuer).toBe('VRChat')
    expect(entries[0].label).toBe('me@example.com')
    expect(entries[0].algorithm).toBe('SHA1')
    expect(entries[0].digits).toBe(6)
    // The export carries no period field; every account in one is a 30s account.
    expect(entries[0].period).toBe(30)
    expect(entries[0].problem).toBeUndefined()
    expect(entries[0].problemKind).toBeUndefined()
  })

  it('recovers the exact secret — codes match the original', () => {
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })])
    const { entries } = parseMigrationUri(uri)
    // The decoded base32 must be byte-identical to what went in
    expect(decodeBase32(entries[0].secret)).toEqual(RAW_SECRET)
    // And must produce the RFC 6238 vector for this seed
    expect(generateTotp({ secret: entries[0].secret, digits: 8 }, 59_000).code).toBe('94287082')
  })

  it('decodes several accounts from one export', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'one', issuer: 'VRChat', type: TOTP }),
      otpParameters({ secret: RAW_SECRET, name: 'two', issuer: 'VRChat', type: TOTP }),
      otpParameters({ secret: RAW_SECRET, name: 'three', issuer: 'Discord', type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries.map((e) => e.label)).toEqual(['one', 'two', 'three'])
    expect(entries[2].issuer).toBe('Discord')
  })

  it('maps the algorithm and digit enums', () => {
    const sha256 = parseMigrationUri(
      migrationUri([
        otpParameters({ secret: RAW_SECRET, name: 'a', algorithm: 2, digits: 2, type: TOTP }),
      ])
    ).entries[0]
    expect(sha256.algorithm).toBe('SHA256')
    expect(sha256.digits).toBe(8)

    const sha512 = parseMigrationUri(
      migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', algorithm: 3, type: TOTP })])
    ).entries[0]
    expect(sha512.algorithm).toBe('SHA512')

    // ALGORITHM_UNSPECIFIED / DIGIT_COUNT_UNSPECIFIED are what Google writes
    // for an ordinary account, and mean SHA-1 / 6 rather than "broken".
    const unspecified = parseMigrationUri(
      migrationUri([
        otpParameters({ secret: RAW_SECRET, name: 'a', algorithm: 0, digits: 0, type: TOTP }),
      ])
    ).entries[0]
    expect(unspecified.algorithm).toBe('SHA1')
    expect(unspecified.digits).toBe(6)
    expect(unspecified.problem).toBeUndefined()
  })
})

describe('label and issuer', () => {
  it('splits an "Issuer:account" label when there is no issuer field', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'VRChat:my-account', type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].issuer).toBe('VRChat')
    expect(entries[0].label).toBe('my-account')
  })

  it('strips a redundant issuer prefix even when the issuer field is present', () => {
    // Google populates both fields for most services, so the prefix survived in
    // the label and every imported account read "VRChat — VRChat:me@…".
    const uri = migrationUri([
      otpParameters({
        secret: RAW_SECRET,
        name: 'VRChat:me@example.com',
        issuer: 'VRChat',
        type: TOTP,
      }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].issuer).toBe('VRChat')
    expect(entries[0].label).toBe('me@example.com')
  })

  it('keeps a prefix that is not the issuer, because it is part of the account name', () => {
    const uri = migrationUri([
      otpParameters({
        secret: RAW_SECRET,
        name: 'work:me@example.com',
        issuer: 'VRChat',
        type: TOTP,
      }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].issuer).toBe('VRChat')
    expect(entries[0].label).toBe('work:me@example.com')
  })

  it('falls back to the issuer when the entry has no account name', () => {
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, issuer: 'VRChat', type: TOTP })])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].label).toBe('VRChat')
  })
})

describe('wire types', () => {
  // A known field carrying the wrong wire type means these are not the bytes we
  // think they are. Reading them anyway is the dangerous outcome, and each
  // payload below is one that used to sail through: the entry comes back
  // complete and plausible, with a value nobody wrote.
  it('rejects a secret encoded as a varint instead of length-delimited', () => {
    // Read as a varint's payload these twenty bytes are a perfectly ordinary
    // 160-bit seed — just not the one in the export. The codes it generates
    // are wrong forever, and nothing says so.
    const decoy = Buffer.alloc(20, 0x5a)
    const params = Buffer.concat([
      tag(1, 0),
      varint(20),
      decoy,
      lengthDelimited(2, Buffer.from('a', 'utf8')),
      varintField(6, TOTP),
    ])
    expect(() => parseMigrationUri(migrationUri([params]))).toThrow(TotpError)
  })

  it('rejects a varint field encoded as length-delimited', () => {
    // The length byte reads back as DIGIT_COUNT_EIGHT and the payload then
    // parses as the type field, so the entry silently claims 8-digit codes.
    const params = Buffer.concat([
      lengthDelimited(1, RAW_SECRET),
      lengthDelimited(2, Buffer.from('a', 'utf8')),
      lengthDelimited(5, Buffer.from([0x30, 0x02])),
    ])
    expect(() => parseMigrationUri(migrationUri([params]))).toThrow(TotpError)
  })

  it('rejects an otp_parameters field that is not length-delimited', () => {
    const entry = otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })
    const payload = Buffer.concat([tag(1, 0), varint(entry.length), entry])
    expect(() => parseMigrationUri(uriFor(encodeURIComponent(payload.toString('base64'))))).toThrow(
      TotpError
    )
  })

  it('rejects a batch field that is not a varint', () => {
    // Misread, this invents batch 2 of 2 — so the app waits for a second QR
    // code that does not exist, or refuses an import that was already complete.
    const entry = otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })
    const uri = migrationUri([entry], [lengthDelimited(3, Buffer.from([0x20, 0x01]))])
    expect(() => parseMigrationUri(uri)).toThrow(TotpError)
  })

  it('skips a complete fixed64 field but refuses a truncated one', () => {
    const entry = otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })
    const fixed64Tag = tag(9, 1)

    const complete = migrationUri([entry], [fixed64Tag, Buffer.alloc(8)])
    expect(parseMigrationUri(complete).entries).toHaveLength(1)

    // Fewer than eight bytes left: advancing the cursor anyway would walk past
    // the buffer and read whatever the next field happens to be.
    const short = migrationUri([entry], [fixed64Tag, Buffer.alloc(3)])
    expect(() => parseMigrationUri(short)).toThrow(TotpError)
  })

  it('rejects group wire types, which this schema never uses', () => {
    const entry = otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })
    expect(() => parseMigrationUri(migrationUri([entry], [tag(9, 3)]))).toThrow(TotpError)
  })
})

describe('base64 payload', () => {
  it('decodes a payload whose base64 contains a literal +', () => {
    // Real QR codes carry the data parameter unescaped. Reading it through
    // URLSearchParams applies form-decoding rules, under which '+' means a
    // space — and Buffer's base64 decoder skips spaces instead of failing, so
    // every byte after the '+' shifted by six bits and the secret came out
    // wrong with no error anywhere.
    const payload = payloadOf([
      otpParameters({
        secret: PUNCTUATED_SECRET,
        name: 'a@example.com',
        issuer: 'VRChat',
        type: TOTP,
      }),
    ])
    const data = payload.toString('base64')
    expect(data).toContain('+') // guards the point of this test

    const { entries } = parseMigrationUri(uriFor(data))
    expect(decodeBase32(entries[0].secret)).toEqual(PUNCTUATED_SECRET)
    expect(entries[0].label).toBe('a@example.com')
  })

  it('decodes the base64url alphabet', () => {
    const payload = payloadOf([
      otpParameters({
        secret: PUNCTUATED_SECRET,
        name: 'a@example.com',
        issuer: 'VRChat',
        type: TOTP,
      }),
    ])
    const standard = payload.toString('base64')
    expect(standard).toContain('+')
    expect(standard).toContain('/')

    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const { entries } = parseMigrationUri(uriFor(urlSafe))
    expect(decodeBase32(entries[0].secret)).toEqual(PUNCTUATED_SECRET)
  })

  it('rejects characters outside either base64 alphabet', () => {
    // Buffer.from(…, 'base64') discards what it does not recognise, so a
    // damaged scan used to decode to something and import without complaint
    // rather than being reported as damaged.
    const data = payloadOf([otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })]).toString(
      'base64'
    )
    const corrupted = `${data.slice(0, 10)}**${data.slice(10)}`
    expect(() => parseMigrationUri(uriFor(encodeURIComponent(corrupted)))).toThrow(TotpError)

    // Mixing the two alphabets is not something any encoder produces.
    expect(() => parseMigrationUri(uriFor('Ci8KFDg-Rk1UW2Jp+HdhYyT'))).toThrow(TotpError)
  })

  it('rejects a base64 length that cannot exist', () => {
    // Base64 encodes three bytes as four characters, so a final block of one
    // character means characters were lost in transit.
    expect(() => parseMigrationUri(uriFor('AAAAA'))).toThrow(TotpError)
  })
})

describe('entries that cannot be imported', () => {
  // Entries are reported, never dropped: an export that quietly loses an
  // account looks identical to one that never had it, and the user finds out
  // when the code they need is missing.
  it('reports an entry whose secret is empty rather than dropping it', () => {
    const uri = migrationUri([
      otpParameters({ secret: Buffer.alloc(0), name: 'ghost', issuer: 'VRChat', type: TOTP }),
      otpParameters({ secret: RAW_SECRET, name: 'real', issuer: 'VRChat', type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries).toHaveLength(2)
    expect(entries[0].label).toBe('ghost')
    expect(entries[0].secret).toBe('')
    expect(entries[0].problemKind).toBe('invalid')
    expect(entries[0].problem).toBeTruthy()
    expect(entries[1].problemKind).toBeUndefined()
  })

  it('reports a secret shorter than the RFC minimum at parse time', () => {
    // Caught here rather than at import, so the review list shows the problem
    // beside the account instead of failing after the user has committed.
    const uri = migrationUri([
      otpParameters({ secret: Buffer.alloc(9, 0x41), name: 'stub', type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries).toHaveLength(1)
    expect(entries[0].problemKind).toBe('invalid')
  })

  it('reports a digit count it does not recognise instead of defaulting to 6', () => {
    // Guessing 6 here hands the user an account that produces confident,
    // permanently wrong codes.
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'odd', digits: 3, type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].problemKind).toBe('unsupported')
    expect(entries[0].problem).toBeTruthy()
  })

  it('reports MD5 as unsupported rather than treating it as SHA-1', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'weird', algorithm: 4, type: TOTP }),
    ])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].problemKind).toBe('unsupported')
    expect(entries[0].problem).toBeTruthy()
  })

  it('reports a counter-based entry as unsupported', () => {
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, name: 'counter', type: HOTP })])
    const { entries } = parseMigrationUri(uri)
    expect(entries[0].problemKind).toBe('unsupported')
    expect(entries[0].problem).toContain('HOTP')
  })
})

describe('batch fields', () => {
  it('returns the batch numbers so a multi-QR export can be assembled', () => {
    // version=2, batch_size=3, batch_index=4, batch_id=5
    const extra = [varintField(2, 1), varintField(3, 3), varintField(4, 1), varintField(5, 12345)]
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })], extra)
    const payload = parseMigrationUri(uri)
    expect(payload.entries).toHaveLength(1)
    expect(payload.batchSize).toBe(3)
    expect(payload.batchIndex).toBe(1)
    expect(payload.batchId).toBe(12345)
  })

  it('treats a single-QR export as part 1 of 1', () => {
    const uri = migrationUri([otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })])
    const payload = parseMigrationUri(uri)
    expect(payload.batchIndex).toBe(0)
    expect(payload.batchSize).toBe(1)
  })

  it('survives a canonical ten-byte varint in a batch field', () => {
    // A negative int32 is sign-extended and written as a full 64-bit varint.
    // Stopping short of ten bytes rejected the whole export over a batch
    // number nothing depends on.
    const negativeInt32 = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])
    const uri = migrationUri(
      [otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })],
      [Buffer.concat([tag(4, 0), negativeInt32])]
    )
    const payload = parseMigrationUri(uri)
    expect(payload.entries).toHaveLength(1)
    // Unrepresentable as a batch number, so it falls back rather than throwing.
    expect(payload.batchIndex).toBe(0)
  })
})

describe('malformed exports', () => {
  it('rejects input that is not an export link', () => {
    expect(() => parseMigrationUri('not a uri')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth-migration://offline')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth-migration://offline?data=')).toThrow(TotpError)
    expect(() => parseMigrationUri('otpauth-migration://offline?other=x')).toThrow(TotpError)
  })

  it('reports an export containing no accounts', () => {
    const uri = uriFor(encodeURIComponent(varintField(2, 1).toString('base64')))
    expect(() => parseMigrationUri(uri)).toThrow(/No accounts/)
  })

  it('does not run past the end of truncated data', () => {
    const good = otpParameters({ secret: RAW_SECRET, name: 'a', type: TOTP })
    const full = Buffer.concat([tag(1, 2), varint(good.length), good])
    const truncated = full.subarray(0, full.length - 6)
    expect(() =>
      parseMigrationUri(uriFor(encodeURIComponent(truncated.toString('base64'))))
    ).toThrow(TotpError)
  })

  it('does not run past the end of a truncated entry', () => {
    // The outer length says the entry is complete, so the damage only shows up
    // while reading the fields inside it.
    const inner = Buffer.concat([tag(1, 2), varint(20), RAW_SECRET.subarray(0, 8)])
    expect(() => parseMigrationUri(migrationUri([inner]))).toThrow(TotpError)
  })
})
