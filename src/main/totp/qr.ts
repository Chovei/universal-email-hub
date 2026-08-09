import jsQR from 'jsqr'

/**
 * QR decoding, done entirely on this machine.
 *
 * Nothing here touches the network: jsQR is a pure-JS decoder that takes a
 * pixel buffer and returns the encoded text. The image is never uploaded, no
 * cloud OCR is involved, and the decoded payload never leaves the main
 * process — it goes straight into the import staging table.
 *
 * Reed–Solomon error correction, finder-pattern location and perspective
 * correction are the one part of this subsystem worth a dependency rather
 * than a hand-rolled implementation: a decoder that is subtly wrong produces
 * a plausible string rather than a failure.
 *
 * This module is deliberately free of Electron so it can be exercised
 * directly against rendered QR bitmaps in tests; see qrImage.ts for the
 * file-to-pixels half.
 */

export interface Bitmap {
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Below this a QR code cannot carry a migration payload at any density. */
const MIN_EDGE = 21

function centerCrop(bitmap: Bitmap, fraction: number): Bitmap | null {
  const width = Math.floor(bitmap.width * fraction)
  const height = Math.floor(bitmap.height * fraction)
  if (width < MIN_EDGE || height < MIN_EDGE) return null

  const left = Math.floor((bitmap.width - width) / 2)
  const top = Math.floor((bitmap.height - height) / 2)
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = ((top + y) * bitmap.width + left) * 4
    out.set(bitmap.data.subarray(from, from + width * 4), y * width * 4)
  }
  return { data: out, width, height }
}

function attempt(bitmap: Bitmap): string | null {
  // attemptBoth covers dark-mode screenshots, where the code is light on dark.
  const found = jsQR(bitmap.data, bitmap.width, bitmap.height, {
    inversionAttempts: 'attemptBoth',
  })
  return found?.data ?? null
}

/**
 * Read the text out of a QR code in a bitmap, or null if there is none.
 *
 * Falls back to a centre crop because the usual input is a phone screenshot:
 * the code sits in the middle of a screen full of other high-contrast UI,
 * which occasionally distracts the locator.
 */
export function decodeQrBitmap(bitmap: Bitmap): string | null {
  if (bitmap.width < MIN_EDGE || bitmap.height < MIN_EDGE) return null
  if (bitmap.data.length < bitmap.width * bitmap.height * 4) return null

  const direct = attempt(bitmap)
  if (direct) return direct

  for (const fraction of [0.7, 0.5]) {
    const cropped = centerCrop(bitmap, fraction)
    if (!cropped) break
    const found = attempt(cropped)
    if (found) return found
  }
  return null
}
