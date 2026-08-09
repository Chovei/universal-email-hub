import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import { decodeQrBitmap, type Bitmap } from './qr'
import { parseMigrationUri } from './migration'

// The codes are produced by an INDEPENDENT encoder (the `qrcode` package) and
// read back by jsQR. A decoder checked against its own output proves nothing;
// this way the round trip has to agree with a separate implementation of the
// same spec.
interface RenderOptions {
  scale?: number
  /** Modules of blank margin around the code — below 4 the locator often misses. */
  quietZone?: number
  /** Light modules on dark, i.e. what a dark-mode screenshot looks like. */
  invert?: boolean
  /** Frame to centre the code in; defaults to a frame the code exactly fills. */
  width?: number
  height?: number
}

function renderQr(text: string, options: RenderOptions = {}): Bitmap {
  const scale = options.scale ?? 4
  const quietZone = options.quietZone ?? 4
  const invert = options.invert ?? false

  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const size = qr.modules.size
  const modules = qr.modules.data

  const codeEdge = (size + quietZone * 2) * scale
  const width = options.width ?? codeEdge
  const height = options.height ?? codeEdge
  const background = invert ? 0 : 255
  const foreground = invert ? 255 : 0

  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = background
    data[i * 4 + 1] = background
    data[i * 4 + 2] = background
    data[i * 4 + 3] = 255
  }

  const left = Math.floor((width - codeEdge) / 2) + quietZone * scale
  const top = Math.floor((height - codeEdge) / 2) + quietZone * scale
  for (let my = 0; my < size; my++) {
    for (let mx = 0; mx < size; mx++) {
      if (!modules[my * size + mx]) continue
      for (let dy = 0; dy < scale; dy++) {
        const row = (top + my * scale + dy) * width
        for (let dx = 0; dx < scale; dx++) {
          const px = (row + left + mx * scale + dx) * 4
          data[px] = foreground
          data[px + 1] = foreground
          data[px + 2] = foreground
          data[px + 3] = 255
        }
      }
    }
  }
  return { data, width, height }
}

function solidBitmap(width: number, height: number, value: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value
    data[i * 4 + 1] = value
    data[i * 4 + 2] = value
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

// Seeded so "noise decoded to something" can never be a flake that passes on
// the next run — the same pixels are tested every time.
function noiseBitmap(width: number, height: number, seed: number): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4)
  let state = seed
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state >>> 24
  }
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = next()
    data[i * 4 + 1] = next()
    data[i * 4 + 2] = next()
    data[i * 4 + 3] = 255
  }
  return { data, width, height }
}

// Real protobuf payloads built by hand, so the migration case exercises the
// actual wire format Google Authenticator emits rather than a stand-in string.
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
  const payload = Buffer.concat([...entries.map((e) => lengthDelimited(1, e)), ...extra])
  return `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`
}

// 20 raw bytes — what a real service issues, and long enough to clear the
// minimum-length guard once base32-encoded.
const RAW_SECRET = Buffer.from('12345678901234567890', 'ascii')

describe('decodeQrBitmap', () => {
  it('reads back a short otpauth:// URI rendered as a QR code', () => {
    const uri = 'otpauth://totp/VRChat:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=VRChat'
    expect(decodeQrBitmap(renderQr(uri))).toBe(uri)
  })

  it('reads back a real Google Authenticator export so the accounts survive the round trip', () => {
    const uri = migrationUri([
      otpParameters({ secret: RAW_SECRET, name: 'me@example.com', issuer: 'VRChat', type: 2 }),
      otpParameters({ secret: RAW_SECRET, name: 'other@example.com', issuer: 'Discord', type: 2 }),
    ])

    const decoded = decodeQrBitmap(renderQr(uri))
    expect(decoded).toBe(uri)

    // The point of the round trip: what comes off the pixels still parses.
    const payload = parseMigrationUri(decoded as string)
    expect(payload.entries.map((e) => e.issuer)).toEqual(['VRChat', 'Discord'])
    expect(payload.entries.map((e) => e.label)).toEqual(['me@example.com', 'other@example.com'])
    expect(payload.entries.every((e) => e.problem === undefined)).toBe(true)
  })

  it('reads back a bulk export of eight accounts without losing any', () => {
    // The real use case: one QR carrying an entire authenticator's worth of
    // accounts, which pushes the code to a much denser version.
    const names = ['ada', 'grace', 'alan', 'edsger', 'barbara', 'donald', 'linus', 'ken']
    const uri = migrationUri(
      names.map((name) =>
        otpParameters({ secret: RAW_SECRET, name: `${name}@example.com`, issuer: 'Example', type: 2 })
      ),
      [varintField(2, 1), varintField(3, 1), varintField(4, 0), varintField(5, 987654)]
    )

    const decoded = decodeQrBitmap(renderQr(uri))
    expect(decoded).toBe(uri)

    const payload = parseMigrationUri(decoded as string)
    expect(payload.entries).toHaveLength(8)
    expect(payload.entries.map((e) => e.label)).toEqual(names.map((n) => `${n}@example.com`))
    expect(payload.batchId).toBe(987654)
  })

  it('reads a code rendered light-on-dark, as a dark-mode screenshot would be', () => {
    const uri = 'otpauth://totp/Dark:mode@example.com?secret=JBSWY3DPEHPK3PXP'
    expect(decodeQrBitmap(renderQr(uri, { invert: true }))).toBe(uri)
  })

  it('finds a small code sitting inside a large mostly-blank frame', () => {
    // A phone screenshot is mostly not the QR code.
    const uri = 'otpauth://totp/Framed:small@example.com?secret=JBSWY3DPEHPK3PXP'
    const bitmap = renderQr(uri, { scale: 3, width: 900, height: 1400 })
    expect(bitmap.width * bitmap.height).toBeGreaterThan(1_000_000)
    expect(decodeQrBitmap(bitmap)).toBe(uri)
  })

  it('returns null for random noise rather than inventing a string', () => {
    // A decoder that returns a plausible wrong payload is worse than one that
    // fails: the user would import a seed that never produces working codes.
    expect(decodeQrBitmap(noiseBitmap(240, 240, 1))).toBeNull()
    expect(decodeQrBitmap(noiseBitmap(240, 240, 99))).toBeNull()
  })

  it('returns null for a blank bitmap', () => {
    expect(decodeQrBitmap(solidBitmap(200, 200, 255))).toBeNull()
  })

  it('returns null rather than throwing for a bitmap below the minimum edge', () => {
    expect(decodeQrBitmap(solidBitmap(20, 200, 255))).toBeNull()
    expect(decodeQrBitmap(solidBitmap(200, 20, 255))).toBeNull()
    expect(decodeQrBitmap({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull()
  })

  it('returns null rather than throwing when the data array is short for its declared size', () => {
    // A truncated buffer reaching jsQR reads past its own end; the guard has to
    // come first.
    const full = renderQr('otpauth://totp/x?secret=JBSWY3DPEHPK3PXP')
    const truncated: Bitmap = {
      data: full.data.subarray(0, full.data.length - 4),
      width: full.width,
      height: full.height,
    }
    expect(decodeQrBitmap(truncated)).toBeNull()
    expect(
      decodeQrBitmap({ data: new Uint8ClampedArray(64), width: 100, height: 100 })
    ).toBeNull()
  })

  it('decodes synchronously and identically every time, so nothing is fetched', () => {
    // Decoding happens on this machine: the call returns a string directly
    // rather than a promise, which rules out a network round trip.
    const uri = 'otpauth://totp/Local:only@example.com?secret=JBSWY3DPEHPK3PXP'
    const bitmap = renderQr(uri)

    const first = decodeQrBitmap(bitmap)
    expect(typeof first).toBe('string')
    expect(first).not.toBeInstanceOf(Promise)
    expect(decodeQrBitmap.constructor.name).toBe('Function')

    expect(decodeQrBitmap(bitmap)).toBe(first)
    expect(decodeQrBitmap(bitmap)).toBe(first)
  })
})
