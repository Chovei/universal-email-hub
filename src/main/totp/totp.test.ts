import { describe, it, expect } from 'vitest'
import {
  hotp,
  generateTotp,
  verifyTotp,
  decodeBase32,
  encodeBase32,
  normalizeSecret,
  parseOtpauthUri,
  TotpError,
} from './totp'

// RFC 4226 Appendix D / RFC 6238 Appendix B use ASCII seeds. Each algorithm
// gets a DIFFERENT seed length — reusing the 20-byte SHA-1 seed for SHA-256
// and SHA-512 is the classic way to "pass" with wrong numbers, so the seeds
// are spelled out separately here.
const SEED_SHA1 = Buffer.from('12345678901234567890', 'ascii')
const SEED_SHA256 = Buffer.from('12345678901234567890123456789012', 'ascii')
const SEED_SHA512 = Buffer.from(
  '1234567890123456789012345678901234567890123456789012345678901234',
  'ascii'
)

describe('Base32', () => {
  it('round-trips bytes', () => {
    expect(decodeBase32(encodeBase32(SEED_SHA1))).toEqual(SEED_SHA1)
  })

  it('decodes the canonical RFC 4648 example', () => {
    // "Hello!\xDE\xAD\xBE\xEF" is the widely used JBSWY3DPEHPK3PXP vector
    expect(decodeBase32('JBSWY3DPEHPK3PXP').toString('hex')).toBe('48656c6c6f21deadbeef')
  })

  it('tolerates how humans actually paste secrets', () => {
    const canonical = decodeBase32('JBSWY3DPEHPK3PXP')
    expect(decodeBase32('jbswy3dpehpk3pxp')).toEqual(canonical)
    expect(decodeBase32('JBSW Y3DP EHPK 3PXP')).toEqual(canonical)
    expect(decodeBase32('JBSW-Y3DP-EHPK-3PXP')).toEqual(canonical)
    expect(decodeBase32('JBSWY3DPEHPK3PXP====')).toEqual(canonical)
  })

  it('rejects characters outside the alphabet', () => {
    // 0/1/8/9 are excluded from Base32 to avoid O/I/B confusion
    for (const bad of ['ABC0DEF', 'ABC1DEF', 'ABC8DEF', 'ABC9DEF', 'ABC$DEF']) {
      expect(() => decodeBase32(bad)).toThrow(TotpError)
    }
  })

  it('rejects a secret too short to be real', () => {
    // "AA" decodes to a single zero byte and was previously accepted, which
    // means a truncated paste produced codes that silently never matched.
    expect(() => decodeBase32('AA')).toThrow(TotpError)
    expect(() => decodeBase32('JBSWY3DP')).toThrow(TotpError) // 5 bytes
    expect(() => decodeBase32('JBSWY3DPEHPK3PXP')).not.toThrow() // 10 bytes, ok
  })

  it('never echoes secret characters in error messages', () => {
    // The message crosses IPC and reaches the on-disk log, so it must report
    // a position rather than the character itself.
    try {
      decodeBase32('JBSWY3DP1HPK3PXP')
      throw new Error('should have thrown')
    } catch (err) {
      const msg = (err as Error).message
      expect(msg).toContain('position')
      expect(msg).not.toContain('"1"')
    }
  })

  it('rejects an empty secret', () => {
    expect(() => decodeBase32('')).toThrow(TotpError)
    expect(() => decodeBase32('   ')).toThrow(TotpError)
  })

  it('normalizes without decoding', () => {
    expect(normalizeSecret(' jbsw y3dp ')).toBe('JBSWY3DP')
  })
})

describe('HOTP — RFC 4226 Appendix D vectors', () => {
  // Secret "12345678901234567890", counters 0..9
  const expected = [
    '755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489',
  ]
  it.each(expected.map((code, counter) => [counter, code]))(
    'counter %i -> %s',
    (counter, code) => {
      expect(hotp(SEED_SHA1, counter, 'SHA1', 6)).toBe(code)
    }
  )
})

describe('TOTP — RFC 6238 Appendix B vectors (8 digits)', () => {
  const cases: Array<[number, string, string, string]> = [
    // unix seconds, SHA1, SHA256, SHA512
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
    [1111111111, '14050471', '67062674', '99943326'],
    [1234567890, '89005924', '91819424', '93441116'],
    [2000000000, '69279037', '90698825', '38618901'],
    [20000000000, '65353130', '77737706', '47863826'],
  ]

  it.each(cases)('t=%i SHA1 -> %s', (t, sha1) => {
    expect(
      generateTotp({ secret: encodeBase32(SEED_SHA1), algorithm: 'SHA1', digits: 8 }, (t) * 1000).code
    ).toBe(sha1)
  })

  it.each(cases)('t=%i SHA256 -> %s', (t, _s1, sha256) => {
    expect(
      generateTotp({ secret: encodeBase32(SEED_SHA256), algorithm: 'SHA256', digits: 8 }, (t) * 1000).code
    ).toBe(sha256)
  })

  it.each(cases)('t=%i SHA512 -> %s', (t, _s1, _s256, sha512) => {
    expect(
      generateTotp({ secret: encodeBase32(SEED_SHA512), algorithm: 'SHA512', digits: 8 }, (t) * 1000).code
    ).toBe(sha512)
  })

  it('handles counters beyond 2^32 without wrapping', () => {
    // t=20000000000 exceeds a 32-bit counter; a truncated write gives a
    // different, plausible-looking code
    expect(
      generateTotp({ secret: encodeBase32(SEED_SHA1), algorithm: 'SHA1', digits: 8 }, 20000000000 * 1000).code
    ).toBe('65353130')
  })
})

describe('TOTP — 6-digit default matches authenticator apps', () => {
  it('derives the 6-digit code as the last six of the 8-digit one', () => {
    const at = 59_000
    const six = generateTotp({ secret: encodeBase32(SEED_SHA1) }, at).code
    const eight = generateTotp({ secret: encodeBase32(SEED_SHA1), digits: 8 }, at).code
    expect(six).toHaveLength(6)
    expect(six).toBe(eight.slice(-6))
  })

  it('zero-pads short codes', () => {
    // Every generated code must be exactly `digits` long
    for (let t = 0; t < 2000; t += 37) {
      expect(generateTotp({ secret: encodeBase32(SEED_SHA1) }, t * 1000).code).toHaveLength(6)
    }
  })
})

describe('period boundaries', () => {
  const secret = encodeBase32(SEED_SHA1)

  it('reports a full period at the instant a step begins', () => {
    expect(generateTotp({ secret }, 30_000).remainingSeconds).toBe(30)
    expect(generateTotp({ secret }, 60_000).remainingSeconds).toBe(30)
  })

  it('counts down to 1 in the final second of a step', () => {
    expect(generateTotp({ secret }, 59_000).remainingSeconds).toBe(1)
    expect(generateTotp({ secret }, 89_000).remainingSeconds).toBe(1)
  })

  it('keeps the same code throughout a step and changes at the rollover', () => {
    const a = generateTotp({ secret }, 30_000).code
    const b = generateTotp({ secret }, 59_999).code
    const c = generateTotp({ secret }, 60_000).code
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('honours a non-default period', () => {
    const r = generateTotp({ secret, period: 60 }, 60_000)
    expect(r.period).toBe(60)
    expect(r.remainingSeconds).toBe(60)
  })
})

describe('input validation', () => {
  const secret = encodeBase32(SEED_SHA1)

  it('rejects unsupported digit counts', () => {
    expect(() => generateTotp({ secret, digits: 4 })).toThrow(TotpError)
    expect(() => generateTotp({ secret, digits: 10 })).toThrow(TotpError)
  })

  it('rejects unsupported periods', () => {
    expect(() => generateTotp({ secret, period: 0 })).toThrow(TotpError)
    expect(() => generateTotp({ secret, period: 5 })).toThrow(TotpError)
    expect(() => generateTotp({ secret, period: 1000 })).toThrow(TotpError)
  })

  it('rejects unsupported algorithms', () => {
    // @ts-expect-error deliberately invalid
    expect(() => generateTotp({ secret, algorithm: 'MD5' })).toThrow(TotpError)
  })

  it('rejects an invalid secret', () => {
    expect(() => generateTotp({ secret: 'not!valid' })).toThrow(TotpError)
  })
})

describe('verifyTotp', () => {
  const secret = encodeBase32(SEED_SHA1)
  const at = 1234567890 * 1000

  it('accepts the current code', () => {
    const { code } = generateTotp({ secret }, at)
    expect(verifyTotp({ secret }, code, at)).toBe(true)
  })

  it('tolerates one step of clock skew in either direction', () => {
    const previous = generateTotp({ secret }, at - 30_000).code
    const next = generateTotp({ secret }, at + 30_000).code
    expect(verifyTotp({ secret }, previous, at)).toBe(true)
    expect(verifyTotp({ secret }, next, at)).toBe(true)
  })

  it('rejects a code two steps away with the default window', () => {
    const far = generateTotp({ secret }, at + 90_000).code
    expect(verifyTotp({ secret }, far, at)).toBe(false)
  })

  it('ignores spaces the user types', () => {
    const { code } = generateTotp({ secret }, at)
    expect(verifyTotp({ secret }, `${code.slice(0, 3)} ${code.slice(3)}`, at)).toBe(true)
  })

  it('returns false rather than throwing on a bad secret', () => {
    expect(verifyTotp({ secret: 'bad!' }, '123456', at)).toBe(false)
  })
})

describe('parseOtpauthUri', () => {
  it('parses a standard provisioning URI', () => {
    const r = parseOtpauthUri('otpauth://totp/VRChat:myaccount?secret=JBSWY3DPEHPK3PXP&issuer=VRChat')
    expect(r).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'VRChat',
      label: 'myaccount',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    })
  })

  it('reads non-default parameters', () => {
    const r = parseOtpauthUri(
      'otpauth://totp/Acme:me?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60'
    )
    expect(r.algorithm).toBe('SHA256')
    expect(r.digits).toBe(8)
    expect(r.period).toBe(60)
  })

  it('falls back to the issuer embedded in the label', () => {
    expect(parseOtpauthUri('otpauth://totp/GitHub:me?secret=JBSWY3DPEHPK3PXP').issuer).toBe('GitHub')
  })

  it('handles a label with no issuer', () => {
    const r = parseOtpauthUri('otpauth://totp/justme?secret=JBSWY3DPEHPK3PXP')
    expect(r.issuer).toBe('')
    expect(r.label).toBe('justme')
  })

  it('decodes percent-encoded labels', () => {
    expect(parseOtpauthUri('otpauth://totp/My%20Site:a%40b.com?secret=JBSWY3DPEHPK3PXP').label).toBe(
      'a@b.com'
    )
  })

  it('rejects malformed and unsupported links', () => {
    const bad = [
      'not a uri',
      'https://example.com/?secret=JBSWY3DPEHPK3PXP',
      'otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP&counter=1',
      'otpauth://totp/x',
      'otpauth://totp/x?secret=',
      'otpauth://totp/x?secret=INVALID!!',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=MD5',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4',
      'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&period=0',
    ]
    for (const uri of bad) {
      expect(() => parseOtpauthUri(uri), uri).toThrow(TotpError)
    }
  })

  it('produces a config that generates working codes end to end', () => {
    const p = parseOtpauthUri('otpauth://totp/VRChat:me?secret=JBSWY3DPEHPK3PXP&issuer=VRChat')
    const r = generateTotp(p, 1234567890 * 1000)
    expect(r.code).toMatch(/^\d{6}$/)
    expect(verifyTotp(p, r.code, 1234567890 * 1000)).toBe(true)
  })
})
