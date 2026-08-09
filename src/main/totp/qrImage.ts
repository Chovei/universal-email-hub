import { nativeImage } from 'electron'
import { decodeQrBitmap, type Bitmap } from './qr'
import { TotpError } from './totp'

/**
 * Turns an image file into pixels for the QR decoder.
 *
 * Electron's nativeImage already decodes PNG and JPEG, so no image-decoding
 * dependency is needed. Everything happens in this process: the bytes arrive
 * from the renderer, become pixels, and are discarded. They are never written
 * to disk, never logged, and never sent anywhere.
 */

/**
 * Screenshots of a phone are routinely 3000px+ on the long edge, where
 * decoding costs hundreds of milliseconds of main-process time for no benefit
 * — even a version-40 code is comfortably resolvable at this size.
 */
const MAX_EDGE = 1600

/** Enough for any screenshot; a guard against a renderer sending something absurd. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

function toBitmap(image: Electron.NativeImage): Bitmap | null {
  const { width, height } = image.getSize()
  if (width === 0 || height === 0) return null

  // nativeImage hands back BGRA with premultiplied alpha. Compositing over
  // white matters for screenshots saved as transparent PNGs, where the dark
  // modules would otherwise sit on an equally dark background.
  const bgra = image.toBitmap()
  if (bgra.length < width * height * 4) return null

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    const transparency = 255 - bgra[i + 3]
    rgba[i] = bgra[i + 2] + transparency
    rgba[i + 1] = bgra[i + 1] + transparency
    rgba[i + 2] = bgra[i] + transparency
    rgba[i + 3] = 255
  }
  return { data: rgba, width, height }
}

/**
 * Decode the QR code in an image file.
 *
 * Throws a TotpError the user can act on rather than returning null, because
 * "no code found" and "not an image at all" need different advice.
 */
export function decodeQrFromImageBytes(bytes: Buffer): string {
  if (bytes.length === 0) throw new TotpError('That file is empty')
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new TotpError('That image is too large — a screenshot of the QR code is plenty')
  }

  const original = nativeImage.createFromBuffer(bytes)
  if (original.isEmpty()) {
    throw new TotpError('That file is not an image Email Hub can read — try a PNG or JPEG')
  }

  const { width, height } = original.getSize()
  const longest = Math.max(width, height)

  // Try the cheap resized pass first; fall back to full resolution, which can
  // rescue a dense code whose modules did not survive the downscale.
  const candidates: Electron.NativeImage[] = []
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest
    candidates.push(
      original.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        quality: 'better',
      })
    )
  }
  candidates.push(original)

  for (const candidate of candidates) {
    const bitmap = toBitmap(candidate)
    if (!bitmap) continue
    const text = decodeQrBitmap(bitmap)
    if (text) return text
  }

  throw new TotpError(
    'No QR code could be found in that image. Make sure the whole code is visible and not cut off.'
  )
}
