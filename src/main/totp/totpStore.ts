import { monotonicFactory } from 'ulid'
import { getRawSqlite } from '../db/client'
import { credentialStore, getCredentialProtection } from '../security/keychain'
import { generateTotp, verifyTotp, type TotpAlgorithm, type TotpConfig } from './totp'

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
  if (!getCredentialProtection().encrypted) {
    throw new Error(
      'Your system cannot encrypt stored credentials, so Email Hub will not save an authenticator secret here. ' +
        'See Settings → Security.'
    )
  }

  // Prove the secret works before committing anything, so a typo cannot leave
  // a half-configured account behind.
  generateTotp({
    secret: input.secret,
    algorithm: input.algorithm,
    digits: input.digits,
    period: input.period,
  })

  const id = ulid()
  const now = Date.now()

  // Secret first: a metadata row with no secret is unusable, whereas an
  // orphaned secret is invisible and harmless.
  credentialStore.set(SECRET_KEY(id), input.secret)

  try {
    getRawSqlite()
      .prepare(
        `INSERT INTO totp_accounts
          (id, account_id, issuer, label, algorithm, digits, period, verified, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
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
  } catch (err) {
    credentialStore.delete(SECRET_KEY(id))
    throw err
  }

  return getTotpAccount(id)!
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

/** Removes the metadata row AND the stored secret. */
export function deleteTotpAccount(id: string): void {
  getRawSqlite().prepare(`DELETE FROM totp_accounts WHERE id = ?`).run(id)
  credentialStore.delete(SECRET_KEY(id))
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

/**
 * Delete stored secrets that no longer have a metadata row.
 *
 * The database can legitimately be replaced wholesale — corruption recovery
 * renames it aside and starts fresh (see initDatabase). The credential store
 * is untouched by that, so without this the seeds would linger with nothing
 * in the UI referencing them: invisible, permanent, and impossible for the
 * user to remove. Runs at startup.
 */
export function reconcileTotpSecrets(): number {
  const known = new Set(listTotpAccounts().map((a) => SECRET_KEY(a.id)))
  let removed = 0
  for (const key of credentialStore.keys()) {
    if (key.startsWith('totp:') && !known.has(key)) {
      credentialStore.delete(key)
      removed++
    }
  }
  return removed
}

/** Confirms the user's authenticator agrees with ours (Phase 10 setup check). */
export function verifyTotpAccount(id: string, candidate: string, atMs: number = Date.now()): boolean {
  const meta = getTotpAccount(id)
  if (!meta) return false
  const config = configFor(meta)
  if (!config) return false
  return verifyTotp(config, candidate, atMs)
}
