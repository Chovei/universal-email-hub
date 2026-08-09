import {
  encodeBase32,
  MIN_SECRET_BYTES,
  TotpError,
  type TotpAlgorithm,
} from './totp'

/**
 * Decoder for Google Authenticator's "Transfer accounts" export.
 *
 * Exporting produces one or more QR codes whose payload is
 *   otpauth-migration://offline?data=<base64 protobuf>
 * carrying every selected account at once. This matters because Google
 * Authenticator will not show a seed again after setup, so for accounts
 * already enrolled there this export is the only way to read them back
 * without disabling and re-enrolling on each service.
 *
 * The protobuf is decoded by hand rather than adding a dependency — the
 * schema is four scalar fields inside a repeated message, and the wire
 * format needed is two of protobuf's six types.
 *
 * MigrationPayload {
 *   repeated OtpParameters otp_parameters = 1;
 *   int32 version = 2; int32 batch_size = 3;
 *   int32 batch_index = 4; int32 batch_id = 5;
 * }
 * OtpParameters {
 *   bytes secret = 1; string name = 2; string issuer = 3;
 *   Algorithm algorithm = 4; DigitCount digits = 5;
 *   OtpType type = 6; int64 counter = 7;
 * }
 *
 * Nothing here logs, and nothing here returns the payload itself: callers get
 * decoded entries, and the only place those are held is the main process.
 */

const WIRE_VARINT = 0
const WIRE_FIXED64 = 1
const WIRE_LENGTH_DELIMITED = 2
const WIRE_START_GROUP = 3
const WIRE_END_GROUP = 4
const WIRE_FIXED32 = 5

// Enum values as defined by Google Authenticator's schema.
const ALGORITHM_BY_VALUE: Record<number, TotpAlgorithm> = {
  0: 'SHA1', // ALGORITHM_UNSPECIFIED — the app's own default
  1: 'SHA1',
  2: 'SHA256',
  3: 'SHA512',
  // 4 = MD5, deliberately unmapped: not supported and not safe to guess at
}
const DIGITS_BY_VALUE: Record<number, number> = { 0: 6, 1: 6, 2: 8 }
const OTP_TYPE_HOTP = 1

/** The export carries no period field; every entry in one is a 30s account. */
const EXPORT_PERIOD = 30

class Reader {
  private offset = 0
  constructor(private readonly buf: Buffer) {}

  get done(): boolean {
    return this.offset >= this.buf.length
  }

  varint(): number {
    let result = 0
    let shift = 0
    for (;;) {
      if (this.done) throw new TotpError('Export data ended unexpectedly')
      const byte = this.buf[this.offset++]
      // Beyond 2^53 a JS number stops being exact; nothing in this schema
      // legitimately gets near that, and an imprecise batch number simply
      // fails to match a known enum rather than corrupting the stream.
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return result
      shift += 7
      // Ten bytes is protobuf's maximum: a negative int32 is encoded as a
      // full 64-bit varint, so stopping earlier would reject valid data.
      if (shift > 63) throw new TotpError('Export data is malformed')
    }
  }

  bytes(): Buffer {
    const length = this.varint()
    if (!Number.isSafeInteger(length) || this.offset + length > this.buf.length) {
      throw new TotpError('Export data ended unexpectedly')
    }
    const out = this.buf.subarray(this.offset, this.offset + length)
    this.offset += length
    return out
  }

  /** Skip a field whose contents are not needed, without running off the end. */
  skip(wireType: number): void {
    if (wireType === WIRE_VARINT) {
      this.varint()
      return
    }
    if (wireType === WIRE_LENGTH_DELIMITED) {
      this.bytes()
      return
    }
    const fixed = wireType === WIRE_FIXED32 ? 4 : wireType === WIRE_FIXED64 ? 8 : 0
    if (fixed === 0 || wireType === WIRE_START_GROUP || wireType === WIRE_END_GROUP) {
      throw new TotpError('Export data uses an unexpected format')
    }
    if (this.offset + fixed > this.buf.length) {
      throw new TotpError('Export data ended unexpectedly')
    }
    this.offset += fixed
  }
}

export interface MigrationEntry {
  /** Base32 seed, or '' when the entry carried none. */
  secret: string
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  /**
   * Set when this entry cannot be imported. Entries are always returned, never
   * dropped: an export that quietly loses an account looks identical to one
   * that never had it, and the user has no way to notice until the code they
   * need is missing.
   */
  problem?: string
  /**
   * 'invalid' — the entry is damaged and nothing can be done with it.
   * 'unsupported' — the entry is intact but describes something Email Hub
   * does not generate. The distinction is what the user is told to do next.
   */
  problemKind?: 'invalid' | 'unsupported'
}

export interface MigrationPayload {
  entries: MigrationEntry[]
  /**
   * Google splits large exports across several QR codes. batchIndex is
   * zero-based; batchSize is how many codes make up the whole export.
   */
  batchIndex: number
  batchSize: number
  batchId: number
}

/**
 * A known field carrying the wrong wire type means the bytes are not the
 * message we think they are. Reading them anyway is the dangerous case: a
 * secret field encoded as a varint decodes into a plausible-looking seed that
 * is simply wrong, and a wrong seed produces codes that never work with no
 * indication why.
 */
function expectWire(actual: number, expected: number): void {
  if (actual !== expected) throw new TotpError('Export data is malformed')
}

function parseOtpParameters(buf: Buffer): MigrationEntry {
  const r = new Reader(buf)
  let secretBytes: Buffer | null = null
  let name = ''
  let issuer = ''
  let algorithm: TotpAlgorithm = 'SHA1'
  let digits = 6
  let isHotp = false
  let problem: string | undefined

  const note = (reason: string): void => {
    if (!problem) problem = reason
  }

  while (!r.done) {
    const key = r.varint()
    const field = key >>> 3
    const wireType = key & 0x07

    switch (field) {
      case 1:
        expectWire(wireType, WIRE_LENGTH_DELIMITED)
        secretBytes = r.bytes()
        break
      case 2:
        expectWire(wireType, WIRE_LENGTH_DELIMITED)
        name = r.bytes().toString('utf8')
        break
      case 3:
        expectWire(wireType, WIRE_LENGTH_DELIMITED)
        issuer = r.bytes().toString('utf8')
        break
      case 4: {
        expectWire(wireType, WIRE_VARINT)
        const mapped = ALGORITHM_BY_VALUE[r.varint()]
        if (mapped) algorithm = mapped
        else note('Uses a hashing algorithm Email Hub does not support')
        break
      }
      case 5: {
        expectWire(wireType, WIRE_VARINT)
        const mapped = DIGITS_BY_VALUE[r.varint()]
        if (mapped) digits = mapped
        else note('Asks for a code length Email Hub does not support')
        break
      }
      case 6:
        expectWire(wireType, WIRE_VARINT)
        isHotp = r.varint() === OTP_TYPE_HOTP
        break
      default:
        r.skip(wireType)
    }
  }

  // The label often arrives as "Issuer:account". Google populates both fields
  // for most services, so the prefix is stripped whenever it is redundant
  // rather than only when the issuer field is missing.
  let label = name
  const colon = name.indexOf(':')
  if (colon !== -1) {
    const prefix = name.slice(0, colon).trim()
    const rest = name.slice(colon + 1).trim()
    if (!issuer) {
      issuer = prefix
      label = rest
    } else if (prefix.toLowerCase() === issuer.trim().toLowerCase()) {
      label = rest
    }
  }

  const entry: MigrationEntry = {
    secret: secretBytes && secretBytes.length > 0 ? encodeBase32(secretBytes) : '',
    issuer: issuer.trim(),
    label: label.trim() || issuer.trim(),
    algorithm,
    digits,
    period: EXPORT_PERIOD,
  }

  // Most fundamental problem first — an entry with no usable key cannot be
  // imported whatever else is wrong with it.
  if (!secretBytes || secretBytes.length === 0) {
    entry.problem = 'This entry has no key in the export'
    entry.problemKind = 'invalid'
  } else if (secretBytes.length < MIN_SECRET_BYTES) {
    entry.problem = 'The key in this entry is too short to be a real one'
    entry.problemKind = 'invalid'
  } else if (isHotp) {
    entry.problem = 'Counter-based (HOTP) account — Email Hub only supports time-based codes'
    entry.problemKind = 'unsupported'
  } else if (problem) {
    entry.problem = problem
    entry.problemKind = 'unsupported'
  }
  return entry
}

/**
 * Pull the data parameter out by hand.
 *
 * URLSearchParams applies application/x-www-form-urlencoded rules, under which
 * a literal '+' means a space. Standard-alphabet base64 uses '+' as a data
 * character, and Buffer's base64 decoder skips a space rather than failing —
 * so going through searchParams shifts every following byte by six bits and
 * yields wrong secrets with no error anywhere.
 */
function extractDataParam(uri: string): string {
  const withoutFragment = uri.split('#')[0]
  const q = withoutFragment.indexOf('?')
  if (q === -1) throw new TotpError('Export link is missing its data')

  for (const part of withoutFragment.slice(q + 1).split('&')) {
    const eq = part.indexOf('=')
    if ((eq === -1 ? part : part.slice(0, eq)) !== 'data') continue
    const raw = eq === -1 ? '' : part.slice(eq + 1)
    try {
      return decodeURIComponent(raw)
    } catch {
      throw new TotpError('Export link data could not be read')
    }
  }
  throw new TotpError('Export link is missing its data')
}

/**
 * Buffer's base64 decoder silently discards anything outside the alphabet, so
 * garbage decodes to garbage instead of failing. The payload is checked before
 * it is handed over.
 */
function decodeBase64Strict(data: string): Buffer {
  const compact = data.replace(/\s/g, '')
  if (compact.length === 0) throw new TotpError('Export data is empty')

  const body = compact.replace(/=+$/, '')
  // Both alphabets appear in the wild; mixing them does not.
  const standard = /^[A-Za-z0-9+/]*$/.test(body)
  const urlSafe = /^[A-Za-z0-9\-_]*$/.test(body)
  if (!standard && !urlSafe) {
    throw new TotpError('That export data is not valid — try exporting from your phone again')
  }
  if (body.length % 4 === 1) {
    throw new TotpError('That export data is incomplete — try exporting from your phone again')
  }

  const normalized = urlSafe && !standard ? body.replace(/-/g, '+').replace(/_/g, '/') : body
  const decoded = Buffer.from(normalized, 'base64')
  if (decoded.length !== Math.floor((body.length * 3) / 4)) {
    throw new TotpError('That export data could not be decoded')
  }
  return decoded
}

/**
 * Decode an otpauth-migration:// export into its accounts.
 *
 * Google Authenticator splits large exports across several QR codes, so a user
 * with many accounts will have several of these URIs; each is decoded
 * independently and the caller combines them using the batch fields.
 */
export function parseMigrationUri(uri: string): MigrationPayload {
  let parsed: URL
  try {
    parsed = new URL(uri.trim())
  } catch {
    throw new TotpError('That does not look like a Google Authenticator export link')
  }
  if (parsed.protocol !== 'otpauth-migration:') {
    throw new TotpError('Link must start with otpauth-migration://')
  }

  const payload = decodeBase64Strict(extractDataParam(uri.trim()))

  const r = new Reader(payload)
  const entries: MigrationEntry[] = []
  let batchIndex = 0
  let batchSize = 1
  let batchId = 0

  while (!r.done) {
    const key = r.varint()
    const field = key >>> 3
    const wireType = key & 0x07

    switch (field) {
      case 1:
        expectWire(wireType, WIRE_LENGTH_DELIMITED)
        entries.push(parseOtpParameters(r.bytes()))
        break
      case 3:
        expectWire(wireType, WIRE_VARINT)
        batchSize = r.varint()
        break
      case 4:
        expectWire(wireType, WIRE_VARINT)
        batchIndex = r.varint()
        break
      case 5:
        expectWire(wireType, WIRE_VARINT)
        batchId = r.varint()
        break
      default:
        r.skip(wireType)
    }
  }

  if (entries.length === 0) {
    throw new TotpError('No accounts were found in that export')
  }

  return {
    entries,
    // A single-QR export omits these; treat it as part 1 of 1.
    batchIndex: Number.isSafeInteger(batchIndex) ? batchIndex : 0,
    batchSize: Number.isSafeInteger(batchSize) && batchSize > 0 ? batchSize : 1,
    batchId: Number.isSafeInteger(batchId) ? batchId : 0,
  }
}
