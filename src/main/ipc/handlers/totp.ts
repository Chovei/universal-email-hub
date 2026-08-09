import { ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/constants/ipc-channels'
import {
  listTotpCodes,
  createTotpAccount,
  renameTotpAccount,
  deleteTotpAccount,
  verifyTotpAccount,
  markTotpVerified,
} from '../../totp/totpStore'
import { normalizeSecret, decodeBase32, validateAlgorithm, TotpError } from '../../totp/totp'
import {
  stageImportText,
  commitStagedImport,
  discardStagedImport,
} from '../../totp/importStaging'
import { decodeQrFromImageBytes, MAX_IMAGE_BYTES } from '../../totp/qrImage'

/**
 * Only TotpError messages are written for users and known to be value-free.
 * Anything else is replaced: String(err) can serialise a stack trace into
 * renderer state and the on-disk log.
 */
function safeMessage(err: unknown, fallback: string): string {
  return err instanceof TotpError ? err.message : fallback
}

/**
 * Authenticator IPC.
 *
 * Deliberately absent: any channel that returns a secret. There is no
 * getTotpSecret(), and the import channels return metadata only — a pending
 * import lives in the main process and is committed by index, so decoding a
 * QR code never hands the renderer material it did not already have.
 *
 * Secrets travel in exactly one direction, once — inward, when the user types
 * a setup key — and codes travel outward. Anything the renderer can ask for is
 * either metadata or a code that expires in seconds.
 */

const AlgorithmSchema = z.enum(['SHA1', 'SHA256', 'SHA512'])

const AddSchema = z.object({
  secret: z.string().min(1).max(512),
  issuer: z.string().max(200).default(''),
  label: z.string().min(1).max(200),
  algorithm: AlgorithmSchema.default('SHA1'),
  digits: z.number().int().min(6).max(8).default(6),
  period: z.number().int().min(15).max(300).default(30),
  accountId: z.string().max(200).nullish(),
})

const IdSchema = z.object({ id: z.string().min(1).max(200) })

const VerifySchema = z.object({
  id: z.string().min(1).max(200),
  code: z.string().min(4).max(16),
})

const RenameSchema = z.object({
  id: z.string().min(1).max(200),
  issuer: z.string().max(200),
  label: z.string().min(1).max(200),
})

const StagingIdSchema = z.string().min(1).max(100)

/** A migration URI for a large export runs well past a normal link length. */
const ScanSchema = z.object({
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string().min(1).max(16384) }),
    // Size is checked in the handler rather than here: a schema failure is a
    // ZodError, and safeMessage replaces those with a generic string — so a
    // message written into a refine() would never reach the user.
    z.object({ kind: z.literal('image'), bytes: z.instanceof(Uint8Array) }),
  ]),
  stagingId: StagingIdSchema.optional(),
})

const CommitSchema = z.object({
  stagingId: StagingIdSchema,
  indices: z.array(z.number().int().min(0).max(10000)).max(1000),
})

export function registerTotpHandlers(): void {
  ipcMain.handle(IPC.TOTP_LIST, async () => {
    try {
      return { data: listTotpCodes() }
    } catch (err) {
      return { error: { code: 'TOTP_LIST_FAILED', message: safeMessage(err, 'Could not read authenticators') } }
    }
  })

  ipcMain.handle(IPC.TOTP_ADD, async (_event, payload: unknown) => {
    try {
      const parsed = AddSchema.parse(payload)
      const secret = normalizeSecret(parsed.secret)
      decodeBase32(secret) // reject a malformed secret before it is stored
      validateAlgorithm(parsed.algorithm)

      const meta = createTotpAccount({
        secret,
        issuer: parsed.issuer.trim(),
        label: parsed.label.trim(),
        algorithm: parsed.algorithm,
        digits: parsed.digits,
        period: parsed.period,
        accountId: parsed.accountId ?? null,
      })
      // Returns metadata only — createTotpAccount's result has no secret field
      return { data: meta }
    } catch (err) {
      return {
        error: {
          code: 'TOTP_ADD_FAILED',
          message: safeMessage(err, 'Could not add authenticator'),
        },
      }
    }
  })

  /**
   * Decode a pasted link or a dropped QR image.
   *
   * The image is decoded here, in this process, by a pure-JS decoder. It is
   * never written to disk, never uploaded, and neither it nor the payload it
   * contains is logged. What comes back is a list of names and settings.
   */
  ipcMain.handle(IPC.TOTP_IMPORT_SCAN, async (_event, payload: unknown) => {
    try {
      const { source, stagingId } = ScanSchema.parse(payload)
      if (source.kind === 'image' && source.bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new TotpError('That image is too large — a screenshot of the QR code is plenty')
      }
      const text =
        source.kind === 'image'
          ? decodeQrFromImageBytes(Buffer.from(source.bytes))
          : source.text
      return { data: stageImportText(text, stagingId) }
    } catch (err) {
      return {
        error: {
          code: 'TOTP_IMPORT_SCAN_FAILED',
          message: safeMessage(err, 'That could not be read as an authenticator export'),
        },
      }
    }
  })

  ipcMain.handle(IPC.TOTP_IMPORT_COMMIT, async (_event, payload: unknown) => {
    try {
      const { stagingId, indices } = CommitSchema.parse(payload)
      return { data: commitStagedImport(stagingId, indices) }
    } catch (err) {
      return {
        error: {
          code: 'TOTP_IMPORT_COMMIT_FAILED',
          message: safeMessage(err, 'Those authenticators could not be imported'),
        },
      }
    }
  })

  ipcMain.handle(IPC.TOTP_IMPORT_DISCARD, async (_event, payload: unknown) => {
    try {
      const { stagingId } = z.object({ stagingId: StagingIdSchema }).parse(payload)
      discardStagedImport(stagingId)
      return { data: null }
    } catch {
      // Discarding is best-effort cleanup; the staging entry expires anyway.
      return { data: null }
    }
  })

  ipcMain.handle(IPC.TOTP_VERIFY, async (_event, payload: unknown) => {
    try {
      const { id, code } = VerifySchema.parse(payload)
      const ok = verifyTotpAccount(id, code)
      if (ok) markTotpVerified(id)
      return { data: { verified: ok } }
    } catch (err) {
      return { error: { code: 'TOTP_VERIFY_FAILED', message: safeMessage(err, 'Could not verify that code') } }
    }
  })

  ipcMain.handle(IPC.TOTP_RENAME, async (_event, payload: unknown) => {
    try {
      const { id, issuer, label } = RenameSchema.parse(payload)
      renameTotpAccount(id, issuer.trim(), label.trim())
      return { data: null }
    } catch (err) {
      return { error: { code: 'TOTP_RENAME_FAILED', message: safeMessage(err, 'Could not rename authenticator') } }
    }
  })

  ipcMain.handle(IPC.TOTP_DELETE, async (_event, payload: unknown) => {
    try {
      const { id } = IdSchema.parse(payload)
      deleteTotpAccount(id)
      return { data: null }
    } catch (err) {
      return { error: { code: 'TOTP_DELETE_FAILED', message: safeMessage(err, 'Could not remove authenticator') } }
    }
  })
}
