import { createHmac } from 'crypto'

/**
 * RFC 6238 TOTP / RFC 4226 HOTP.
 *
 * Deliberately dependency-free and free of any Electron, database, React or
 * provider knowledge: it is pure arithmetic over a secret and a timestamp, so
 * it can be exercised directly against the RFC test vectors. Nothing in here
 * knows what VRChat is — an issuer is just a label.
 */

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

export const DEFAULT_ALGORITHM: TotpAlgorithm = 'SHA1'
export const DEFAULT_DIGITS = 6
export const DEFAULT_PERIOD = 30

const ALGORITHMS: Record<TotpAlgorithm, string> = {
  SHA1: 'sha1',
  SHA256: 'sha256',
  SHA512: 'sha512',
}

/** Authenticators universally use 6 or 8; anything else is a typo, not a choice. */
const ALLOWED_DIGITS = [6, 7, 8]
const MIN_PERIOD = 15
const MAX_PERIOD = 300

export class TotpError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TotpError'
  }
}

// ── Base32 (RFC 4648) ──────────────────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * Normalise a user-supplied secret: authenticator setup keys are commonly
 * shown in lowercase and in space-separated groups of four, and people paste
 * them exactly as displayed.
 */
export function normalizeSecret(raw: string): string {
  return raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase()
}

export function decodeBase32(raw: string): Buffer {
  const input = normalizeSecret(raw)
  if (input.length === 0) throw new TotpError('Secret is empty')

  let bits = 0
  let value = 0
  const out: number[] = []

  for (const char of input) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx === -1) {
      // 0, 1, 8 and 9 are absent from the alphabet precisely because they are
      // easy to confuse with O, I and B when transcribed by hand.
      throw new TotpError(`Secret contains a character that is not valid Base32: "${char}"`)
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }

  if (out.length === 0) throw new TotpError('Secret is too short to be valid')
  return Buffer.from(out)
}

/** Base32-encode raw bytes. Used for tests and for displaying generated secrets. */
export function encodeBase32(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(value >>> bits) & 31]
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

// ── HOTP / TOTP ────────────────────────────────────────────────────────────

export function validateDigits(digits: number): void {
  if (!ALLOWED_DIGITS.includes(digits)) {
    throw new TotpError(`Unsupported digit count: ${digits} (expected 6, 7 or 8)`)
  }
}

export function validatePeriod(period: number): void {
  if (!Number.isInteger(period) || period < MIN_PERIOD || period > MAX_PERIOD) {
    throw new TotpError(`Unsupported period: ${period} seconds`)
  }
}

export function validateAlgorithm(algorithm: string): TotpAlgorithm {
  const upper = algorithm.toUpperCase()
  if (upper in ALGORITHMS) return upper as TotpAlgorithm
  throw new TotpError(`Unsupported algorithm: ${algorithm}`)
}

/**
 * RFC 4226 HOTP over raw secret bytes. Exposed separately from TOTP so the
 * published HOTP vectors can be checked without going through a clock.
 */
export function hotp(
  secretBytes: Buffer,
  counter: number,
  algorithm: TotpAlgorithm = DEFAULT_ALGORITHM,
  digits: number = DEFAULT_DIGITS
): string {
  validateDigits(digits)

  // 8-byte big-endian counter. BigInt keeps this exact past 2^32, which a
  // 32-bit write would silently wrap.
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))

  const digest = createHmac(ALGORITHMS[algorithm], secretBytes).update(counterBuf).digest()

  // Dynamic truncation (RFC 4226 §5.3): low nibble of the last byte selects a
  // 4-byte window; the top bit is masked off to keep the value positive.
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)

  return String(binary % 10 ** digits).padStart(digits, '0')
}

export interface TotpConfig {
  /** Base32 secret as shown by the service. Spaces and case are tolerated. */
  secret: string
  algorithm?: TotpAlgorithm
  digits?: number
  period?: number
}

export interface TotpResult {
  code: string
  /** Whole seconds until this code stops being valid. */
  remainingSeconds: number
  period: number
}

/**
 * Current code for a secret. `atMs` is injectable so tests are deterministic
 * and never depend on the wall clock.
 */
export function generateTotp(config: TotpConfig, atMs: number = Date.now()): TotpResult {
  const algorithm = validateAlgorithm(config.algorithm ?? DEFAULT_ALGORITHM)
  const digits = config.digits ?? DEFAULT_DIGITS
  const period = config.period ?? DEFAULT_PERIOD
  validateDigits(digits)
  validatePeriod(period)

  const secretBytes = decodeBase32(config.secret)
  const seconds = Math.floor(atMs / 1000)
  const counter = Math.floor(seconds / period)

  return {
    code: hotp(secretBytes, counter, algorithm, digits),
    // At the exact instant a step begins the code is valid for the full
    // period, so this is period..1 rather than period-1..0.
    remainingSeconds: period - (seconds % period),
    period,
  }
}

/**
 * Whether `candidate` matches the code for `atMs`, allowing ±`window` steps
 * to absorb modest clock skew between this machine and the service.
 */
export function verifyTotp(
  config: TotpConfig,
  candidate: string,
  atMs: number = Date.now(),
  window = 1
): boolean {
  const cleaned = candidate.replace(/\s/g, '')
  const period = config.period ?? DEFAULT_PERIOD
  for (let step = -window; step <= window; step++) {
    const at = atMs + step * period * 1000
    try {
      if (generateTotp(config, at).code === cleaned) return true
    } catch {
      return false
    }
  }
  return false
}

// ── otpauth:// provisioning URIs ───────────────────────────────────────────

export interface ProvisioningData {
  secret: string
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
}

/**
 * Parse an otpauth://totp/ URI (the payload behind a setup QR code).
 * Rejects anything malformed rather than guessing — a silently wrong
 * parameter yields codes that never work and no clue why.
 */
export function parseOtpauthUri(uri: string): ProvisioningData {
  let parsed: URL
  try {
    parsed = new URL(uri.trim())
  } catch {
    throw new TotpError('That does not look like a valid otpauth:// link')
  }

  if (parsed.protocol !== 'otpauth:') {
    throw new TotpError('Link must start with otpauth://')
  }
  // URL puts the type in the host for otpauth://totp/Label
  const type = parsed.host.toLowerCase()
  if (type === 'hotp') {
    throw new TotpError('Counter-based (HOTP) links are not supported — only time-based codes')
  }
  if (type !== 'totp') {
    throw new TotpError(`Unsupported link type: ${type || '(none)'}`)
  }

  const secret = parsed.searchParams.get('secret')
  if (!secret) throw new TotpError('Link is missing its secret')
  decodeBase32(secret) // throws with a specific message if malformed

  // Label is "Issuer:account" or just "account"; the issuer query parameter
  // takes precedence when both are present.
  const rawLabel = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  const [labelIssuer, labelAccount] = rawLabel.includes(':')
    ? [rawLabel.slice(0, rawLabel.indexOf(':')), rawLabel.slice(rawLabel.indexOf(':') + 1)]
    : ['', rawLabel]

  const issuer = (parsed.searchParams.get('issuer') ?? labelIssuer).trim()
  const label = (labelAccount || rawLabel).trim()

  const algorithm = validateAlgorithm(parsed.searchParams.get('algorithm') ?? DEFAULT_ALGORITHM)

  const digitsRaw = parsed.searchParams.get('digits')
  const digits = digitsRaw ? Number(digitsRaw) : DEFAULT_DIGITS
  if (!Number.isInteger(digits)) throw new TotpError(`Invalid digits value: ${digitsRaw}`)
  validateDigits(digits)

  const periodRaw = parsed.searchParams.get('period')
  const period = periodRaw ? Number(periodRaw) : DEFAULT_PERIOD
  if (!Number.isInteger(period)) throw new TotpError(`Invalid period value: ${periodRaw}`)
  validatePeriod(period)

  return { secret: normalizeSecret(secret), issuer, label, algorithm, digits, period }
}
