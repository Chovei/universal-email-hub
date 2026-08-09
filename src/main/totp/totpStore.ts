import { createHash } from 'crypto'
import { monotonicFactory } from 'ulid'
import { getRawSqlite } from '../db/client'
import { credentialStore, getCredentialProtection } from '../security/keychain'
import {
  decodeBase32,
  generateTotp,
  TotpError,
  verifyTotp,
  type TotpAlgorithm,
  type TotpConfig,
} from './totp'

const ulid = monotonicFactory()

/**
 * Storage for authenticator accounts.
 *
 * The split is the whole point: SQLite holds only descriptive metadata, while
 * the secret itself goes to the same OS-encrypted credential store the email
 * providers already use (Windows DPAPI via Electron safeStorage). A secret
 * never appears in a database column, never crosses IPC after setup, and
 * never reaches the renderer.
 */

const SECRET_KEY = (id: string) => `totp:${id}:secret`

/** Metadata only — deliberately has no `secret` field so it cannot leak. */
export interface TotpAccountMeta {
  id: string
  /** Optional link to an email account this authenticator belongs to. */
  accountId: string | null
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  verified: boolean
  createdAt: number
  updatedAt: number
}

interface Row {
  id: string
  accountId: string | null
  issuer: string
  label: string
  algorithm: string
  digits: number
  period: number
  verified: number
  createdAt: number
  updatedAt: number
}

const COLS = `
  id,
  account_id AS accountId,
  issuer,
  label,
  algorithm,
  digits,
  period,
  verified,
  created_at AS createdAt,
  updated_at AS updatedAt
`

function toMeta(r: Row): TotpAccountMeta {
  return {
    id: r.id,
    accountId: r.accountId,
    issuer: r.issuer,
    label: r.label,
    algorithm: r.algorithm as TotpAlgorithm,
    digits: r.digits,
    period: r.period,
    verified: Boolean(r.verified),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export function listTotpAccounts(): TotpAccountMeta[] {
  const rows = getRawSqlite()
    .prepare(`SELECT ${COLS} FROM totp_accounts ORDER BY issuer, label`)
    .all() as Row[]
  return rows.map(toMeta)
}

export function getTotpAccount(id: string): TotpAccountMeta | undefined {
  const row = getRawSqlite()
    .prepare(`SELECT ${COLS} FROM totp_accounts WHERE id = ?`)
    .get(id) as Row | undefined
  return row ? toMeta(row) : undefined
}

export interface CreateTotpAccountInput {
  secret: string
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  accountId?: string | null
}

/**
 * Persist a new authenticator. Refuses outright when the OS cannot encrypt:
 * writing a permanent 2FA seed to disk in plaintext is worse than not
 * supporting the feature on that machine.
 */
export function createTotpAccount(input: CreateTotpAccountInput): TotpAccountMeta {
  const [meta] = createTotpAccounts([input])
  return meta
}

const INSERT_SQL = `INSERT INTO totp_accounts
    (id, account_id, issuer, label, algorithm, digits, period, verified, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`

/**
 * Persist several authenticators as one unit.
 *
 * Importing a Google Authenticator export is the case this exists for: a
 * partial import is the worst outcome available, because the user has no way
 * to tell which accounts made it and the export QR is usually gone by the
 * time they find out. Either every account lands or none does.
 */
export function createTotpAccounts(inputs: CreateTotpAccountInput[]): TotpAccountMeta[] {
  if (inputs.length === 0) return []

  if (!getCredentialProtection().encrypted) {
    // A TotpError, so the IPC layer passes this explanation through instead of
    // replacing it with a generic failure: it is the one message that tells
    // the user why nothing will ever save on this machine.
    throw new TotpError(
      'Your system cannot encrypt stored credentials, so Email Hub will not save an authenticator secret here. ' +
        'See Settings → Security.'
    )
  }

  // Prove every secret works before anything is written, so a single bad
  // entry cannot leave a half-configured account behind.
  for (const input of inputs) {
    generateTotp({
      secret: input.secret,
      algorithm: input.algorithm,
      digits: input.digits,
      period: input.period,
    })
  }

  const now = Date.now()
  const prepared = inputs.map((input) => ({ id: ulid(), input }))
  const written: string[] = []

  const undoSecrets = (): void => {
    for (const id of written) {
      // A failure here would otherwise replace the real error with a second
      // one and leave the orphan this is trying to remove.
      try {
        credentialStore.delete(SECRET_KEY(id))
      } catch {
        /* reconcileTotpSecrets sweeps what is left at next start */
      }
    }
  }

  try {
    // Secrets first: a metadata row with no secret is unusable, whereas an
    // orphaned secret is invisible and gets swept up at next start. One write
    // for the whole batch, not one per account.
    const secrets: Record<string, string> = {}
    for (const { id, input } of prepared) {
      secrets[SECRET_KEY(id)] = input.secret
      written.push(id)
    }
    credentialStore.setMany(secrets)

    const sqlite = getRawSqlite()
    const insertAll = sqlite.transaction((rows: typeof prepared) => {
      const stmt = sqlite.prepare(INSERT_SQL)
      for (const { id, input } of rows) {
        stmt.run(
          id,
          input.accountId ?? null,
          input.issuer,
          input.label,
          input.algorithm,
          input.digits,
          input.period,
          now,
          now
        )
      }
    })
    insertAll(prepared)
  } catch (err) {
    undoSecrets()
    throw err
  }

  return prepared.map(({ id }) => {
    const meta = getTotpAccount(id)
    if (!meta) throw new Error('Authenticator was saved but could not be read back')
    return meta
  })
}

export function renameTotpAccount(id: string, issuer: string, label: string): void {
  getRawSqlite()
    .prepare(`UPDATE totp_accounts SET issuer = ?, label = ?, updated_at = ? WHERE id = ?`)
    .run(issuer, label, Date.now(), id)
}

export function markTotpVerified(id: string): void {
  getRawSqlite()
    .prepare(`UPDATE totp_accounts SET verified = 1, updated_at = ? WHERE id = ?`)
    .run(Date.now(), id)
}

/**
 * Removes the metadata row AND the stored secret.
 *
 * The secret goes first. Neither store can enlist in the other's transaction,
 * so one of the two failure modes has to be chosen: a row without a secret
 * shows the user "stored secret is missing" and can be removed again, while a
 * secret without a row is invisible and unremovable.
 */
export function deleteTotpAccount(id: string): void {
  credentialStore.delete(SECRET_KEY(id))
  getRawSqlite().prepare(`DELETE FROM totp_accounts WHERE id = ?`).run(id)
}

/**
 * Fingerprints of the stored secrets, for duplicate detection.
 *
 * SHA-256 over the decoded bytes, so the same seed written in different case
 * or spacing collides as it should. These exist only inside this process for
 * the lifetime of a comparison: they are never stored, logged, or returned
 * across IPC. Fingerprinting rather than comparing plaintext also means the
 * caller doing the comparing never holds a seed.
 */
export function secretFingerprint(secret: string): string {
  return createHash('sha256').update(decodeBase32(secret)).digest('hex')
}

/** Fingerprints of every authenticator already saved, keyed by account id. */
export function existingSecretFingerprints(): Map<string, string> {
  const out = new Map<string, string>()
  for (const meta of listTotpAccounts()) {
    const secret = credentialStore.get(SECRET_KEY(meta.id))
    if (!secret) continue
    try {
      out.set(meta.id, secretFingerprint(secret))
    } catch {
      // A stored secret that no longer decodes cannot match anything.
    }
  }
  return out
}

/**
 * Build a generation config for an account. Private to the main process —
 * the returned object carries the secret, so it must never be sent anywhere.
 */
function configFor(meta: TotpAccountMeta): TotpConfig | null {
  const secret = credentialStore.get(SECRET_KEY(meta.id))
  if (!secret) return null
  return {
    secret,
    algorithm: meta.algorithm,
    digits: meta.digits,
    period: meta.period,
  }
}

/** What the renderer is allowed to see: a short-lived code, never the seed. */
export interface TotpCodeView extends TotpAccountMeta {
  code: string | null
  remainingSeconds: number
  /** Set when the secret could not be read back (e.g. credential store reset). */
  error?: string
}

export function listTotpCodes(atMs: number = Date.now()): TotpCodeView[] {
  return listTotpAccounts().map((meta) => {
    const config = configFor(meta)
    if (!config) {
      return {
        ...meta,
        code: null,
        remainingSeconds: 0,
        error: 'Stored secret is missing — remove this authenticator and add it again.',
      }
    }
    try {
      const { code, remainingSeconds } = generateTotp(config, atMs)
      return { ...meta, code, remainingSeconds }
    } catch {
      // Never surface the underlying message: it can quote the secret's
      // characters back.
      return {
        ...meta,
        code: null,
        remainingSeconds: 0,
        error: 'Stored secret could not be used to generate a code.',
      }
    }
  })
}

export interface ReconcileResult {
  removed: number
  /** Orphans deliberately left alone because deleting them looked unsafe. */
  retained: number
}

/**
 * Delete stored secrets that no longer have a metadata row.
 *
 * An orphan is normally the tail of a delete whose credential write failed:
 * invisible in the UI, permanent, and impossible for the user to remove.
 *
 * But the database can also be replaced wholesale — initDatabase renames a
 * database it cannot open aside and starts fresh, on the stated grounds that
 * mail re-syncs from the provider and credentials live in the OS store. That
 * reasoning does not hold here: the credential store IS the only copy of a
 * TOTP seed, and there is nothing to re-sync from. Reaping orphans against a
 * database that was just recreated would permanently destroy every
 * authenticator the user owns, from one transient file-lock error.
 *
 * So orphans are only removed when at least one authenticator still exists to
 * prove the database is the real one. Zero rows plus orphaned seeds is either
 * a lost database or a user who removed their last authenticator, and the
 * difference is not knowable from here — keeping a handful of dead keys costs
 * nothing, while guessing wrong is unrecoverable.
 */
export function reconcileTotpSecrets(): ReconcileResult {
  const accounts = listTotpAccounts()
  const orphans = credentialStore
    .keys()
    .filter((key) => key.startsWith('totp:') && !accounts.some((a) => SECRET_KEY(a.id) === key))

  if (orphans.length === 0) return { removed: 0, retained: 0 }
  if (accounts.length === 0) return { removed: 0, retained: orphans.length }

  let removed = 0
  for (const key of orphans) {
    credentialStore.delete(key)
    removed++
  }
  return { removed, retained: 0 }
}

/** Confirms the user's authenticator agrees with ours (Phase 10 setup check). */
export function verifyTotpAccount(id: string, candidate: string, atMs: number = Date.now()): boolean {
  const meta = getTotpAccount(id)
  if (!meta) return false
  const config = configFor(meta)
  if (!config) return false
  return verifyTotp(config, candidate, atMs)
}
