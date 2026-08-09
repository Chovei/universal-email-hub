import { encodeBase32, type TotpAlgorithm, TotpError, type ProvisioningData } from './totp'

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
 */

const WIRE_VARINT = 0
const WIRE_LENGTH_DELIMITED = 2

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
const OTP_TYPE_TOTP = 2

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
      // legitimately gets near that.
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return result
      shift += 7
      if (shift > 56) throw new TotpError('Export data is malformed')
    }
  }

  bytes(): Buffer {
    const length = this.varint()
    if (this.offset + length > this.buf.length) {
      throw new TotpError('Export data ended unexpectedly')
    }
    const out = this.buf.subarray(this.offset, this.offset + length)
    this.offset += length
    return out
  }

  /** Skip a field whose contents are not needed. */
  skip(wireType: number): void {
    if (wireType === WIRE_VARINT) this.varint()
    else if (wireType === WIRE_LENGTH_DELIMITED) this.bytes()
    else if (wireType === 5) this.offset += 4
    else if (wireType === 1) this.offset += 8
    else throw new TotpError('Export data uses an unexpected format')
  }
}

export interface MigrationEntry extends ProvisioningData {
  /** Entries Email Hub cannot use are reported rather than silently dropped. */
  unsupportedReason?: string
}

function parseOtpParameters(buf: Buffer): MigrationEntry | null {
  const r = new Reader(buf)
  let secretBytes: Buffer | null = null
  let name = ''
  let issuer = ''
  let algorithm: TotpAlgorithm = 'SHA1'
  let digits = 6
  let type = OTP_TYPE_TOTP
  let algorithmSupported = true

  while (!r.done) {
    const key = r.varint()
    const field = key >>> 3
    const wireType = key & 0x07

    switch (field) {
      case 1:
        secretBytes = r.bytes()
        break
      case 2:
        name = r.bytes().toString('utf8')
        break
      case 3:
        issuer = r.bytes().toString('utf8')
        break
      case 4: {
        const value = r.varint()
        const mapped = ALGORITHM_BY_VALUE[value]
        if (mapped) algorithm = mapped
        else algorithmSupported = false
        break
      }
      case 5:
        digits = DIGITS_BY_VALUE[r.varint()] ?? 6
        break
      case 6:
        type = r.varint()
        break
      default:
        r.skip(wireType)
    }
  }

  if (!secretBytes || secretBytes.length === 0) return null

  // The label often arrives as "Issuer:account"; prefer the explicit field.
  let label = name
  if (!issuer && name.includes(':')) {
    issuer = name.slice(0, name.indexOf(':')).trim()
    label = name.slice(name.indexOf(':') + 1).trim()
  }

  const entry: MigrationEntry = {
    secret: encodeBase32(secretBytes),
    issuer: issuer.trim(),
    label: label.trim() || issuer.trim(),
    algorithm,
    digits,
    period: 30, // the export carries no period; TOTP entries are always 30s here
  }

  if (type === OTP_TYPE_HOTP) {
    entry.unsupportedReason = 'Counter-based (HOTP) account — Email Hub only supports time-based codes'
  } else if (!algorithmSupported) {
    entry.unsupportedReason = 'Uses an algorithm Email Hub does not support'
  }
  return entry
}

/**
 * Decode an otpauth-migration:// export into its accounts.
 *
 * Google Authenticator splits large exports across several QR codes, so a
 * user with many accounts will have several of these URIs; each is decoded
 * independently and the results combined by the caller.
 */
export function parseMigrationUri(uri: string): MigrationEntry[] {
  let parsed: URL
  try {
    parsed = new URL(uri.trim())
  } catch {
    throw new TotpError('That does not look like a Google Authenticator export link')
  }
  if (parsed.protocol !== 'otpauth-migration:') {
    throw new TotpError('Link must start with otpauth-migration://')
  }

  const data = parsed.searchParams.get('data')
  if (!data) throw new TotpError('Export link is missing its data')

  let payload: Buffer
  try {
    // The value is base64 that has already been URL-decoded by URL parsing.
    payload = Buffer.from(data, 'base64')
  } catch {
    throw new TotpError('Export data could not be decoded')
  }
  if (payload.length === 0) throw new TotpError('Export data is empty')

  const r = new Reader(payload)
  const entries: MigrationEntry[] = []

  while (!r.done) {
    const key = r.varint()
    const field = key >>> 3
    const wireType = key & 0x07
    if (field === 1 && wireType === WIRE_LENGTH_DELIMITED) {
      const entry = parseOtpParameters(r.bytes())
      if (entry) entries.push(entry)
    } else {
      r.skip(wireType)
    }
  }

  if (entries.length === 0) {
    throw new TotpError('No accounts were found in that export')
  }
  return entries
}
