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

/** Authenticators use 6 or 8, and RFC 4226 permits 7; anything else is a typo. */
const ALLOWED_DIGITS = [6, 7, 8]
const MIN_PERIOD = 15
const MAX_PERIOD = 300

/**
 * RFC 4226 §4 R6 requires at least 128 bits of shared secret and recommends
 * 160. Ten bytes (80 bits) is the smallest thing any real service issues; a
 * shorter "secret" means the user truncated it while copying, and silently
 * accepting it produces codes that never work.
 */
export const MIN_SECRET_BYTES = 10

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

/**
 * Symbol counts that cannot end a valid Base32 encoding: 5 bits per symbol
 * only lands on a byte boundary for 2, 4, 5, 7 or 8 symbols per block, so a
 * remainder of 1, 3 or 6 means characters were lost or added in transit.
 */
const IMPOSSIBLE_REMAINDERS = new Set([1, 3, 6])

export function decodeBase32(raw: string): Buffer {
  let bits = 0
  let value = 0
  let symbols = 0
  let padded = false
  const out: number[] = []

  // Walked over the raw string rather than a normalised copy so reported
  // positions match what the user is actually looking at.
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '-') continue
    if (ch === '=') {
      padded = true
      continue
    }
    const idx = padded ? -1 : BASE32_ALPHABET.indexOf(ch.toUpperCase())
    if (idx === -1) {
      // Report the POSITION, never the character: this message is returned
      // across IPC and reaches the on-disk log, and a secret should not leak
      // itself one keystroke at a time. (0, 1, 8 and 9 are absent from the
      // alphabet because they are easily confused with O, I and B.)
      throw new TotpError(
        `The key contains a character at position ${i + 1} that cannot appear in a setup key. ` +
          `Valid characters are A–Z and 2–7.`
      )
    }
    value = (value << 5) | idx
    bits += 5
    symbols++
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }

  if (symbols === 0) throw new TotpError('Secret is empty')

  if (IMPOSSIBLE_REMAINDERS.has(symbols % 8)) {
    throw new TotpError(
      'That key is not a complete setup key — a character appears to be missing or duplicated.'
    )
  }
  // Whatever is left over must be the encoder's zero padding. Anything else is
  // data that no encoder would have produced, so the key is not what it seems.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
    throw new TotpError('That key ends in characters that are not part of a valid key.')
  }

  if (out.length < MIN_SECRET_BYTES) {
    throw new TotpError(
      'That key is too short to be a real setup key — check it was copied in full.'
    )
  }
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
  // hasOwnProperty, not `in`: `in` walks the prototype chain, so a name like
  // "constructor" would pass and then be handed to createHmac as a digest.
  if (Object.prototype.hasOwnProperty.call(ALGORITHMS, upper)) return upper as TotpAlgorithm
  throw new TotpError('That link asks for a hashing algorithm Email Hub does not support')
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
  if (!Number.isInteger(counter) || counter < 0) {
    // writeBigUInt64BE throws a RangeError for these, which is not a TotpError
    // and so would escape the callers that only expect one.
    throw new TotpError('Cannot generate a code for that point in time')
  }

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
      // One unusable step (a negative counter near the epoch) must not
      // abandon the steps that would have matched.
      continue
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
    // The type is echoed from the pasted link, so it is described rather than
    // quoted: this message reaches the on-disk log.
    throw new TotpError('That link is not a time-based (TOTP) link')
  }

  const secret = parsed.searchParams.get('secret')
  if (!secret) throw new TotpError('Link is missing its secret')
  decodeBase32(secret) // throws with a specific message if malformed

  // Label is "Issuer:account" or just "account"; the issuer query parameter
  // takes precedence when both are present. A lone '%' in the path is legal
  // per WHATWG URL but makes decodeURIComponent throw a bare URIError, so the
  // undecoded text is used instead of failing the whole link.
  const rawPath = parsed.pathname.replace(/^\//, '')
  let rawLabel: string
  try {
    rawLabel = decodeURIComponent(rawPath)
  } catch {
    rawLabel = rawPath
  }
  const [labelIssuer, labelAccount] = rawLabel.includes(':')
    ? [rawLabel.slice(0, rawLabel.indexOf(':')), rawLabel.slice(rawLabel.indexOf(':') + 1)]
    : ['', rawLabel]

  const issuer = (parsed.searchParams.get('issuer') ?? labelIssuer).trim()
  const label = labelAccount.trim() || (rawLabel.includes(':') ? issuer : rawLabel.trim())
  if (!label) throw new TotpError('That link does not name an account')

  const algorithm = validateAlgorithm(parsed.searchParams.get('algorithm') ?? DEFAULT_ALGORITHM)

  // Described, never quoted. These come from a link or a scanned QR code, and
  // this message is returned across IPC and written to the on-disk log — text
  // taken verbatim from a stranger's QR code can carry newlines and forge log
  // lines of its own.
  const digitsRaw = parsed.searchParams.get('digits')
  const digits = digitsRaw ? Number(digitsRaw) : DEFAULT_DIGITS
  if (!Number.isInteger(digits)) {
    throw new TotpError('That link asks for a code length that is not a whole number')
  }
  validateDigits(digits)

  const periodRaw = parsed.searchParams.get('period')
  const period = periodRaw ? Number(periodRaw) : DEFAULT_PERIOD
  if (!Number.isInteger(period)) {
    throw new TotpError('That link asks for a refresh interval that is not a whole number')
  }
  validatePeriod(period)

  return { secret: normalizeSecret(secret), issuer, label, algorithm, digits, period }
}
