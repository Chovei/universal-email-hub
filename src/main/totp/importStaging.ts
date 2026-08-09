import { randomUUID } from 'crypto'
import { parseMigrationUri, type MigrationEntry } from './migration'
import { generateTotp, parseOtpauthUri, TotpError, type TotpAlgorithm } from './totp'
import {
  createTotpAccounts,
  existingSecretFingerprints,
  secretFingerprint,
  type TotpAccountMeta,
} from './totpStore'

/**
 * Holds a pending import in the main process so its secrets never cross IPC.
 *
 * The renderer sends a link or an image, gets back a list describing what was
 * found — issuer, account name, algorithm, digits, period, and whether each
 * entry can be used — and commits by index. At no point does it receive a
 * seed. That matters most for the QR path: the renderer supplies an image it
 * cannot read, and if the preview carried secrets the app would be handing it
 * material it never had.
 *
 * Staged data is memory-only, expires, and is dropped as soon as it is
 * committed or cancelled.
 */

/** Long enough to read a list and pick from it; short enough not to linger. */
const STAGING_TTL_MS = 15 * 60 * 1000
/** More than a couple of in-flight imports means something is leaking. */
const MAX_STAGED = 8

export type ImportEntryStatus = 'ready' | 'duplicate' | 'invalid' | 'unsupported'

/** Everything the renderer is allowed to know about a pending entry. */
export interface ImportPreviewEntry {
  index: number
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  status: ImportEntryStatus
  /** Why this entry is not importable. Never contains key material. */
  reason?: string
}

export interface ImportPreview {
  stagingId: string
  entries: ImportPreviewEntry[]
  counts: Record<ImportEntryStatus, number>
  /**
   * Google Authenticator splits a large export across several QR codes.
   * `received` lists the one-based part numbers added so far.
   */
  parts: { received: number[]; total: number }
}

export interface ImportCommitResult {
  imported: number
  /** Entries the user selected that were not importable, with the reason. */
  skipped: { index: number; reason: string }[]
}

interface StagedEntry {
  /** Main-process only. Never serialised, never logged, never returned. */
  secret: string
  issuer: string
  label: string
  algorithm: TotpAlgorithm
  digits: number
  period: number
  problem?: string
  problemKind?: 'invalid' | 'unsupported'
  fingerprint?: string
}

interface Staged {
  id: string
  createdAt: number
  /** Keyed by zero-based batch index so re-adding the same QR replaces it. */
  parts: Map<number, StagedEntry[]>
  batchSize: number
  batchId: number | null
}

const staged = new Map<string, Staged>()

function sweep(now: number): void {
  for (const [id, entry] of staged) {
    if (now - entry.createdAt > STAGING_TTL_MS) staged.delete(id)
  }
}

function requireStaged(stagingId: string): Staged {
  sweep(Date.now())
  const found = staged.get(stagingId)
  if (!found) {
    throw new TotpError('That import is no longer open — start it again')
  }
  return found
}

function fromMigration(entry: MigrationEntry): StagedEntry {
  return {
    secret: entry.secret,
    issuer: entry.issuer,
    label: entry.label,
    algorithm: entry.algorithm,
    digits: entry.digits,
    period: entry.period,
    problem: entry.problem,
    problemKind: entry.problemKind,
  }
}

/**
 * Confirm an entry without a declared problem really does produce a code.
 * The parser validates structure; this validates arithmetic, so "ready" in
 * the preview means the import cannot fail on that entry later.
 */
function validate(entry: StagedEntry): StagedEntry {
  if (entry.problem) return entry
  try {
    generateTotp({
      secret: entry.secret,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
    })
    entry.fingerprint = secretFingerprint(entry.secret)
  } catch (err) {
    entry.problem = err instanceof TotpError ? err.message : 'This entry could not be read'
    entry.problemKind = 'invalid'
  }
  return entry
}

/** Flatten the received parts in part order. */
function ordered(entry: Staged): StagedEntry[] {
  return [...entry.parts.keys()].sort((a, b) => a - b).flatMap((key) => entry.parts.get(key) ?? [])
}

function preview(entry: Staged): ImportPreview {
  const existing = new Set(existingSecretFingerprints().values())
  const seen = new Set<string>()
  const counts: Record<ImportEntryStatus, number> = {
    ready: 0,
    duplicate: 0,
    invalid: 0,
    unsupported: 0,
  }

  const entries = ordered(entry).map((staged_, index): ImportPreviewEntry => {
    let status: ImportEntryStatus = 'ready'
    let reason = staged_.problem

    if (staged_.problem) {
      status = staged_.problemKind === 'unsupported' ? 'unsupported' : 'invalid'
    } else if (staged_.fingerprint && existing.has(staged_.fingerprint)) {
      status = 'duplicate'
      reason = 'Already in Email Hub'
    } else if (staged_.fingerprint && seen.has(staged_.fingerprint)) {
      status = 'duplicate'
      reason = 'Appears more than once in this export'
    }

    if (staged_.fingerprint) seen.add(staged_.fingerprint)
    counts[status]++
    return {
      index,
      issuer: staged_.issuer,
      label: staged_.label,
      algorithm: staged_.algorithm,
      digits: staged_.digits,
      period: staged_.period,
      status,
      reason,
    }
  })

  return {
    stagingId: entry.id,
    entries,
    counts,
    parts: {
      received: [...entry.parts.keys()].sort((a, b) => a - b).map((index) => index + 1),
      total: entry.batchSize,
    },
  }
}

/**
 * Decode a link and stage what it contains.
 *
 * Passing an existing stagingId merges the result into that import, which is
 * how a multi-QR export is assembled: each code is added in turn and the
 * preview reports which parts have arrived.
 */
export function stageImportText(text: string, stagingId?: string): ImportPreview {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  let entries: StagedEntry[]
  let batchIndex = 0
  let batchSize = 1
  let batchId: number | null = null

  if (lower.startsWith('otpauth-migration://')) {
    const payload = parseMigrationUri(trimmed)
    entries = payload.entries.map(fromMigration)
    batchIndex = payload.batchIndex
    batchSize = payload.batchSize
    batchId = payload.batchId
  } else if (lower.startsWith('otpauth://')) {
    const single = parseOtpauthUri(trimmed)
    entries = [{ ...single }]
  } else {
    throw new TotpError(
      'That is not an authenticator link. Expected one starting otpauth:// or otpauth-migration://'
    )
  }

  entries.forEach(validate)

  const now = Date.now()
  sweep(now)

  const existing = stagingId ? staged.get(stagingId) : undefined
  if (existing) {
    // Parts of different exports would interleave into nonsense.
    if (batchId !== null && existing.batchId !== null && batchId !== existing.batchId) {
      throw new TotpError('That QR code belongs to a different export — start a new import for it')
    }
    existing.parts.set(batchIndex, entries)
    existing.batchSize = Math.max(existing.batchSize, batchSize, existing.parts.size)
    if (existing.batchId === null) existing.batchId = batchId
    return preview(existing)
  }

  if (staged.size >= MAX_STAGED) {
    // Oldest first — an abandoned import should not block a real one.
    const oldest = [...staged.values()].sort((a, b) => a.createdAt - b.createdAt)[0]
    if (oldest) staged.delete(oldest.id)
  }

  const record: Staged = {
    id: randomUUID(),
    createdAt: now,
    parts: new Map([[batchIndex, entries]]),
    batchSize,
    batchId,
  }
  staged.set(record.id, record)
  return preview(record)
}

/** The current preview for a staged import, recomputed against what is stored. */
export function stagedPreview(stagingId: string): ImportPreview {
  return preview(requireStaged(stagingId))
}

/**
 * Commit the chosen entries.
 *
 * Entries the user selected that are not importable are reported back rather
 * than silently ignored, and the accounts that do go in are written as one
 * unit — a partial import is never the outcome.
 */
export function commitStagedImport(stagingId: string, indices: number[]): ImportCommitResult {
  const record = requireStaged(stagingId)
  const view = preview(record)
  const all = ordered(record)

  const wanted = new Set(indices)
  const skipped: { index: number; reason: string }[] = []
  const chosen: StagedEntry[] = []

  for (const entry of view.entries) {
    if (!wanted.has(entry.index)) continue
    if (entry.status !== 'ready') {
      skipped.push({ index: entry.index, reason: entry.reason ?? 'Cannot be imported' })
      continue
    }
    const source = all[entry.index]
    if (source) chosen.push(source)
  }

  if (chosen.length === 0) {
    if (skipped.length > 0) return { imported: 0, skipped }
    throw new TotpError('Nothing was selected to import')
  }

  const created: TotpAccountMeta[] = createTotpAccounts(
    chosen.map((entry) => ({
      secret: entry.secret,
      issuer: entry.issuer,
      label: entry.label,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
      accountId: null,
    }))
  )

  // Committed: the staged secrets have no further purpose.
  staged.delete(stagingId)
  return { imported: created.length, skipped }
}

export function discardStagedImport(stagingId: string): void {
  staged.delete(stagingId)
}

/** Drops every pending import — used when the window goes away. */
export function discardAllStagedImports(): void {
  staged.clear()
}
