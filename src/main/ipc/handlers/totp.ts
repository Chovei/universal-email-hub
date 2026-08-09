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
import { parseOtpauthUri, normalizeSecret, decodeBase32, validateAlgorithm, TotpError } from '../../totp/totp'
import { parseMigrationUri } from '../../totp/migration'

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
 * Deliberately absent: any channel that returns a stored secret. There is no
 * getTotpSecret(). Secrets travel in exactly one direction, once — inward,
 * when the user sets an account up — and codes travel outward. Anything the
 * renderer can ask for is either metadata or a code that expires in seconds.
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

const UriSchema = z.object({ uri: z.string().min(1).max(2048) })

export function registerTotpHandlers(): void {
  ipcMain.handle(IPC.TOTP_LIST, async () => {
    try {
      return { data: listTotpCodes() }
    } catch (err) {
      return { error: { code: 'TOTP_LIST_FAILED', message: safeMessage(err, 'Could not read authenticators') } }
    }
  })

  // Parses a provisioning URI for the setup form. Returns the secret to the
  // renderer only because the renderer supplied the URI containing it in the
  // first place — no stored data is exposed.
  ipcMain.handle(IPC.TOTP_PARSE_URI, async (_event, payload: unknown) => {
    try {
      const { uri } = UriSchema.parse(payload)
      return { data: parseOtpauthUri(uri) }
    } catch (err) {
      return {
        error: {
          code: 'TOTP_URI_INVALID',
          message: safeMessage(err, 'Could not read that link'),
        },
      }
    }
  })

  // Decodes a Google Authenticator "Transfer accounts" export, which can
  // carry many accounts at once. Like parseUri, this only reads data the
  // renderer supplied; it touches nothing in storage.
  ipcMain.handle(IPC.TOTP_PARSE_MIGRATION, async (_event, payload: unknown) => {
    try {
      const { uri } = UriSchema.parse(payload)
      return { data: parseMigrationUri(uri) }
    } catch (err) {
      return {
        error: {
          code: 'TOTP_MIGRATION_INVALID',
          message: safeMessage(err, 'Could not read that export link'),
        },
      }
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
