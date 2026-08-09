import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import {
  hotp,
  generateTotp,
  verifyTotp,
  decodeBase32,
  encodeBase32,
  normalizeSecret,
  parseOtpauthUri,
  validateAlgorithm,
  MIN_SECRET_BYTES,
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

/**
 * HMAC-SHA1 assembled by hand from the RFC 2104 ipad/opad construction, then
 * truncated per RFC 4226 §5.3. It shares nothing with the module under test —
 * not even createHmac — so an expectation taken from it is an independent
 * check rather than a restatement of hotp(). The counter is a bigint so
 * counters past 2^32 stay exact here too.
 */
function referenceHotpSha1(secret: Buffer, counter: bigint, digits: number): string {
  const blockSize = 64
  const key = secret.length > blockSize ? createHash('sha1').update(secret).digest() : secret
  const ipad = Buffer.alloc(blockSize, 0x36)
  const opad = Buffer.alloc(blockSize, 0x5c)
  for (let i = 0; i < key.length; i++) {
    ipad[i] = key[i] ^ 0x36
    opad[i] = key[i] ^ 0x5c
  }
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(counter)
  const inner = createHash('sha1').update(Buffer.concat([ipad, counterBuf])).digest()
  const mac = createHash('sha1').update(Buffer.concat([opad, inner])).digest()
  const offset = mac[mac.length - 1] & 0x0f
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, '0')
}

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

/** The message decodeBase32 rejects `key` with, or '' if it accepted it. */
function rejectionFor(key: string): string {
  try {
    decodeBase32(key)
    return ''
  } catch (err) {
    return (err as Error).message
  }
}

describe('Base32 — hardened rejections', () => {
  // 16 symbols, exactly the 10-byte minimum. Every case below is this key with
  // something done to it, so a failure points at the rule and not the fixture.
  const GOOD = 'JBSWY3DPEHPK3PXP'

  it('reports the position in the string the user actually pasted', () => {
    // Setup keys are displayed in groups of four and people paste them that
    // way. A position counted after whitespace was stripped sends the user to
    // the wrong character on screen — here, 9 instead of 11.
    try {
      decodeBase32('JBSW Y3DP 1HPK 3PXP')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TotpError)
      expect((err as Error).message).toContain('position 11')
    }
  })

  it('counts every separator the user can see, including leading space', () => {
    expect(() => decodeBase32('  JBSW-Y3DP-!HPK-3PXP')).toThrow(/position 13\b/)
    expect(() => decodeBase32('!JBSWY3DPEHPK3PXP')).toThrow(/position 1\b/)
  })

  it('rejects symbol counts no Base32 encoder can produce', () => {
    // 5 bits per symbol only lands on a byte boundary at 2, 4, 5, 7 or 8
    // symbols in the trailing block, so a remainder of 1, 3 or 6 means
    // characters were dropped or duplicated in transit.
    for (const extra of ['A', 'AAA', 'AAAAAA']) {
      const key = GOOD + extra
      expect([1, 3, 6]).toContain(key.length % 8)
      expect(() => decodeBase32(key), key).toThrow(/missing or duplicated/)
    }
  })

  it('accepts every symbol count that is legal', () => {
    for (const extra of ['', 'AA', 'AAAA', 'AAAAA', 'AAAAAAA', 'AAAAAAAA']) {
      const key = GOOD + extra
      expect([0, 2, 4, 5, 7]).toContain(key.length % 8)
      expect(() => decodeBase32(key), key).not.toThrow()
    }
  })

  it('rejects trailing bits that are not zero padding', () => {
    // 18 symbols is a legal length, but the final symbol carries only two
    // padding bits. 'A' leaves them zero as an encoder would; 'B' sets one,
    // which is data no encoder ever writes.
    expect(() => decodeBase32(`${GOOD}AA`)).not.toThrow()
    expect(() => decodeBase32(`${GOOD}AB`)).toThrow(/not part of a valid key/)
  })

  it('tells a dropped character apart from stray trailing bits', () => {
    // Two different repairs for the user — recount the key, versus recopy it —
    // so the two failures must not collapse into one message.
    const dropped = rejectionFor(`${GOOD}A`)
    const stray = rejectionFor(`${GOOD}AB`)
    expect(dropped).toMatch(/missing or duplicated/)
    expect(stray).toMatch(/not part of a valid key/)
    expect(dropped).not.toBe(stray)
  })

  it('rejects key material that appears after the padding', () => {
    // '=' can only terminate a Base32 string; a symbol after it means the
    // paste picked up whatever sat next to the key.
    expect(() => decodeBase32(`${GOOD}=A`)).toThrow(TotpError)
    expect(() => decodeBase32(`${GOOD}==A==`)).toThrow(TotpError)
  })

  it('still refuses a key one byte under the minimum', () => {
    // 15 symbols decodes to 9 bytes, and 15 % 8 is 7 — a legal remainder with
    // legal padding — so only the length rule can catch this one.
    const nineBytes = encodeBase32(Buffer.alloc(9, 0x41))
    expect(nineBytes).toHaveLength(15)
    expect(() => decodeBase32(nineBytes)).toThrow(/too short/)
    expect(decodeBase32(encodeBase32(Buffer.alloc(MIN_SECRET_BYTES, 0x41)))).toHaveLength(
      MIN_SECRET_BYTES
    )
  })

  it('never names the offending character in any rejection', () => {
    // Every one of these messages crosses IPC and lands in the on-disk log.
    for (const bad of ['JBSWY3DP1HPK3PXP', 'JBSWY3DP$HPK3PXP', 'JBSWY3DP0HPK3PXP']) {
      try {
        decodeBase32(bad)
        throw new Error('should have thrown')
      } catch (err) {
        const msg = (err as Error).message
        expect(err).toBeInstanceOf(TotpError)
        expect(msg).toContain('position')
        expect(msg).not.toContain(bad[8])
      }
    }
  })
})

describe('Base32 — encoder and decoder agree at every real secret size', () => {
  // The length and trailing-bit rules were added to reject corrupt keys. This
  // proves they reject nothing the encoder itself produces, across every size
  // a service plausibly issues (80 to 192 bits).
  const sizes = Array.from({ length: 15 }, (_, i) => MIN_SECRET_BYTES + i)

  it.each(sizes)('round-trips a %i-byte secret unchanged', (n) => {
    const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff))
    const encoded = encodeBase32(bytes)
    expect(encoded).toMatch(/^[A-Z2-7]+$/)
    expect([1, 3, 6]).not.toContain(encoded.length % 8)
    expect(decodeBase32(encoded)).toEqual(bytes)
  })

  it.each(sizes)('round-trips a %i-byte all-ones secret unchanged', (n) => {
    // 0xff bytes leave the trailing bits set right up to the padding boundary,
    // which is where an off-by-one in the padding check would show.
    const bytes = Buffer.alloc(n, 0xff)
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes)
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

  it('reproduces the published vectors through the hand-built HMAC', () => {
    // Anchors the independent reference against RFC 4226 Appendix D before it
    // is trusted as an oracle for counters the RFCs do not tabulate.
    expect(referenceHotpSha1(SEED_SHA1, 0n, 6)).toBe('755224')
    expect(referenceHotpSha1(SEED_SHA1, 5n, 6)).toBe('254676')
    expect(referenceHotpSha1(SEED_SHA1, 9n, 6)).toBe('520489')
    // RFC 6238 t=59 is counter 1 at the default 30s period.
    expect(referenceHotpSha1(SEED_SHA1, 1n, 8)).toBe('94287082')
  })

  it('handles counters beyond 2^32 without wrapping', () => {
    // The largest tabulated vector, t=20000000000, is only counter 666,666,666
    // — comfortably inside 32 bits, so it never exercised the 64-bit write at
    // all. These timestamps put the counter at exactly 2^32 and one past it,
    // where a 32-bit write would silently fold back to counter 0 and 1.
    const secret = encodeBase32(SEED_SHA1)
    for (const counter of [2 ** 32, 2 ** 32 + 1]) {
      const expected = referenceHotpSha1(SEED_SHA1, BigInt(counter), 8)
      expect(
        generateTotp({ secret, algorithm: 'SHA1', digits: 8 }, counter * 30 * 1000).code
      ).toBe(expected)
      // The value a truncating write would produce, so the check above is
      // known to discriminate rather than to coincide.
      expect(expected).not.toBe(referenceHotpSha1(SEED_SHA1, BigInt(counter - 2 ** 32), 8))
    }
  })
})

describe('TOTP — 6-digit default matches authenticator apps', () => {
  it('emits the published code at t=59 at both widths', () => {
    // Comparing the 6-digit code to the last six of the 8-digit one is an
    // identity of modular arithmetic and holds for any truncation, right or
    // wrong. Both numbers here are published instead: 94287082 is the RFC 6238
    // Appendix B SHA-1 vector at t=59, and t=59 is counter 1, whose RFC 4226
    // Appendix D 6-digit vector is 287082.
    const at = 59_000
    expect(generateTotp({ secret: encodeBase32(SEED_SHA1), digits: 8 }, at).code).toBe('94287082')
    expect(generateTotp({ secret: encodeBase32(SEED_SHA1) }, at).code).toBe('287082')
  })

  it('emits the published 7-digit width RFC 4226 permits', () => {
    // 7 is legal per RFC 4226 §5.3 but no vector table covers it, so the
    // expectation comes from the independent HMAC rather than from hotp().
    expect(generateTotp({ secret: encodeBase32(SEED_SHA1), digits: 7 }, 59_000).code).toBe(
      referenceHotpSha1(SEED_SHA1, 1n, 7)
    )
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

describe('validateAlgorithm', () => {
  it('accepts the three supported digests however they are cased', () => {
    expect(validateAlgorithm('sha1')).toBe('SHA1')
    expect(validateAlgorithm('Sha256')).toBe('SHA256')
    expect(validateAlgorithm('SHA512')).toBe('SHA512')
  })

  it('rejects names inherited from Object.prototype', () => {
    // A membership test that walks the prototype chain lets a name like
    // "constructor" through, and it then reaches createHmac as a digest name.
    for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(() => validateAlgorithm(name), name).toThrow(TotpError)
    }
  })

  it('rejects those names when a pasted link carries them', () => {
    for (const algorithm of ['constructor', 'toString', '__proto__']) {
      expect(() =>
        parseOtpauthUri(`otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=${algorithm}`)
      ).toThrow(TotpError)
    }
  })

  it('does not quote the requested algorithm back to the log', () => {
    try {
      validateAlgorithm('WHIRLPOOL')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TotpError)
      expect((err as Error).message).not.toContain('WHIRLPOOL')
    }
  })
})

describe('hotp counter guard', () => {
  it('rejects counters that are not whole and non-negative', () => {
    // writeBigUInt64BE raises a RangeError for each of these, and a RangeError
    // slips past the callers that only expect a TotpError.
    for (const counter of [-1, -0.5, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => hotp(SEED_SHA1, counter), String(counter)).toThrow(TotpError)
    }
  })

  it('accepts zero, the smallest legal counter', () => {
    expect(hotp(SEED_SHA1, 0)).toBe('755224')
  })

  it('says nothing about the counter it refused', () => {
    try {
      hotp(SEED_SHA1, -1)
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TotpError)
      expect((err as Error).message).not.toContain('-1')
    }
  })

  it('surfaces a pre-epoch timestamp as a TotpError, not a RangeError', () => {
    // generateTotp floors a negative timestamp into a negative counter, so the
    // guard is what keeps the failure inside the type callers catch.
    const secret = encodeBase32(SEED_SHA1)
    for (const at of [-1000, -30_000, -86_400_000]) {
      expect(() => generateTotp({ secret }, at), String(at)).toThrow(TotpError)
    }
  })
})

describe('verifyTotp across an unusable step', () => {
  const secret = encodeBase32(SEED_SHA1)

  it('keeps checking the window after a step that cannot be generated', () => {
    // At t=0 the -1 step is counter -1 and throws. Abandoning the window there
    // would reject the code the user is actually looking at. Both expected
    // codes are RFC 4226 Appendix D vectors: counter 0 and counter 1.
    expect(verifyTotp({ secret }, '755224', 0)).toBe(true)
    expect(verifyTotp({ secret }, '287082', 0)).toBe(true)
  })

  it('still refuses a code from outside the window at the epoch', () => {
    // Counter 2 — one step too far — must not be swept in by the tolerance.
    expect(verifyTotp({ secret }, '359152', 0)).toBe(false)
  })

  it('returns false rather than throwing when no step is usable', () => {
    expect(verifyTotp({ secret }, '755224', -100_000)).toBe(false)
  })

  it('widens correctly when a larger window is asked for', () => {
    expect(verifyTotp({ secret }, '359152', 0, 2)).toBe(true)
    expect(verifyTotp({ secret }, '969429', 0, 2)).toBe(false) // counter 3
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

describe('parseOtpauthUri — hardened cases', () => {
  it('keeps a label that contains a bare percent sign', () => {
    // A '%' not followed by two hex digits is legal in a WHATWG URL path but
    // makes decodeURIComponent raise a bare URIError, which used to take down
    // the whole link and leave the user with no idea why.
    const r = parseOtpauthUri('otpauth://totp/Acme:100%bonus?secret=JBSWY3DPEHPK3PXP')
    expect(r.issuer).toBe('Acme')
    expect(r.label).toBe('100%bonus')
  })

  it('leaves every undecodable escape shape intact instead of raising URIError', () => {
    // Each of these makes decodeURIComponent throw. The link is still usable,
    // so the undecoded text is kept rather than the whole import failing.
    const cases: Array<[string, string]> = [
      ['otpauth://totp/50%off?secret=JBSWY3DPEHPK3PXP', '50%off'],
      ['otpauth://totp/Acme:%?secret=JBSWY3DPEHPK3PXP', '%'],
      ['otpauth://totp/%zz?secret=JBSWY3DPEHPK3PXP', '%zz'],
      ['otpauth://totp/a%2?secret=JBSWY3DPEHPK3PXP', 'a%2'],
    ]
    for (const [uri, label] of cases) {
      expect(parseOtpauthUri(uri).label, uri).toBe(label)
    }
  })

  it('still decodes a label whose escapes are well formed', () => {
    expect(parseOtpauthUri('otpauth://totp/A%20B:me%2Bx%40y.z?secret=JBSWY3DPEHPK3PXP').label).toBe(
      'me+x@y.z'
    )
  })

  it('rejects a link that names no account', () => {
    // An entry with no name is unidentifiable in the list afterwards, and the
    // issuer alone is not enough when a user holds two accounts at one service.
    for (const uri of [
      'otpauth://totp/?secret=JBSWY3DPEHPK3PXP',
      'otpauth://totp?secret=JBSWY3DPEHPK3PXP',
      'otpauth://totp/?secret=JBSWY3DPEHPK3PXP&issuer=Acme',
      'otpauth://totp/%20?secret=JBSWY3DPEHPK3PXP',
    ]) {
      expect(() => parseOtpauthUri(uri), uri).toThrow(/does not name an account/)
    }
  })

  it('falls back to the issuer when the label is only "Issuer:"', () => {
    const r = parseOtpauthUri('otpauth://totp/VRChat:?secret=JBSWY3DPEHPK3PXP')
    expect(r.issuer).toBe('VRChat')
    expect(r.label).toBe('VRChat')
  })

  it('does not echo the link type back in its rejection', () => {
    // The type is attacker-chosen text from a scanned QR code, and this message
    // reaches the on-disk log.
    try {
      parseOtpauthUri('otpauth://SteamGuard/me?secret=JBSWY3DPEHPK3PXP')
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TotpError)
      const msg = (err as Error).message
      expect(msg.toLowerCase()).not.toContain('steamguard')
      expect(msg).toContain('time-based')
    }
  })

  it('does not quote link-supplied digits or period text either', () => {
    // Same reasoning that removed the link type from its message: these values
    // come straight from a scanned QR code and the message reaches the on-disk
    // log, so quoting them lets a hostile export write arbitrary text — line
    // breaks included — into the log.
    for (const param of ['digits', 'period']) {
      try {
        parseOtpauthUri(
          `otpauth://totp/me?secret=JBSWY3DPEHPK3PXP&${param}=FAKE%0A2026-01-01%20ERROR%20injected`
        )
        throw new Error('should have thrown')
      } catch (err) {
        expect(err, param).toBeInstanceOf(TotpError)
        const msg = (err as Error).message
        expect(msg, param).not.toContain('FAKE')
        expect(msg, param).not.toContain('\n')
      }
    }
  })

  it('still names HOTP plainly, since that type is ours to describe', () => {
    expect(() => parseOtpauthUri('otpauth://hotp/me?secret=JBSWY3DPEHPK3PXP&counter=1')).toThrow(
      /HOTP/
    )
  })

  it('passes the hardened Base32 rules through to a pasted link', () => {
    // A truncated QR payload must fail at the link, not at first code use.
    expect(() => parseOtpauthUri('otpauth://totp/me?secret=JBSWY3DPEHPK3PXPA')).toThrow(
      /missing or duplicated/
    )
    expect(() => parseOtpauthUri('otpauth://totp/me?secret=JBSWY3DPEHPK3PXPAB')).toThrow(
      /not part of a valid key/
    )
    expect(() => parseOtpauthUri('otpauth://totp/me?secret=JBSWY3DP')).toThrow(/too short/)
  })
})
