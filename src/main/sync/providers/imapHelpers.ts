import type { FolderType, RemoteMessageRef } from '@shared/types/provider'

// Pure IMAP helpers with no runtime dependencies — kept separate from
// ImapProvider (which pulls in imapflow/electron) so they stay unit-testable.

// ── Folder type mapping ───────────────────────────────────────────────────

export function mapFolderType(name: string, specialUse?: string): FolderType {
  const n = name.toUpperCase()
  if (n === 'INBOX') return 'inbox'

  const su = (specialUse ?? '').toLowerCase()
  if (su.includes('sent')) return 'sent'
  if (su.includes('draft')) return 'drafts'
  if (su.includes('trash') || su.includes('deleted')) return 'trash'
  if (su.includes('junk') || su.includes('spam')) return 'spam'
  if (su.includes('archive')) return 'archive'
  if (su.includes('all')) return 'archive'

  // Fall back to name matching
  if (n.includes('SENT')) return 'sent'
  if (n.includes('DRAFT')) return 'drafts'
  if (n.includes('TRASH') || n.includes('DELETED')) return 'trash'
  if (n.includes('JUNK') || n.includes('SPAM')) return 'spam'
  if (n.includes('ARCHIVE')) return 'archive'

  return 'custom'
}

// ── IMAP cursor ────────────────────────────────────────────────────────────
// Format: "{uidvalidity}:{highestUid}"

export interface ImapCursor {
  uidvalidity: number
  highestUid: number
}

/**
 * imapflow exposes mailbox.uidValidity as a BigInt, while cursors round-trip
 * through Number. A BigInt is never strictly equal to a Number in JS, so
 * comparing the two directly reports "changed" on every single sync and
 * triggers an endless full re-download. Normalise everything to Number:
 * UIDVALIDITY is a 32-bit unsigned value (max 4294967295), comfortably
 * inside the safe-integer range.
 */
export function normalizeUidValidity(value: bigint | number | undefined | null): number {
  if (value === undefined || value === null) return 0
  const n = typeof value === 'bigint' ? Number(value) : value
  return Number.isFinite(n) ? n : 0
}

export function parseCursor(cursor: string | null): ImapCursor | null {
  if (!cursor) return null
  const [v, u] = cursor.split(':').map(Number)
  if (!v || !u || isNaN(v) || isNaN(u)) return null
  return { uidvalidity: v, highestUid: u }
}

export function encodeCursor(uidvalidity: number, highestUid: number): string {
  return `${uidvalidity}:${highestUid}`
}

// ── Folder-scoped ref grouping ─────────────────────────────────────────────
// IMAP UIDs are only unique within a mailbox. Refs without folder context
// are counted as skipped rather than guessed — operating on a UID in the
// wrong mailbox can silently mutate an unrelated message.

export interface GroupedRefs {
  byFolder: Map<string, string[]>
  skipped: number
}

export function groupRefsByFolder(refs: RemoteMessageRef[]): GroupedRefs {
  const byFolder = new Map<string, string[]>()
  let skipped = 0
  for (const ref of refs) {
    if (!ref.folderRemoteId) {
      skipped++
      continue
    }
    const list = byFolder.get(ref.folderRemoteId) ?? []
    list.push(ref.remoteId)
    byFolder.set(ref.folderRemoteId, list)
  }
  return { byFolder, skipped }
}

// ── Ghost-message reconciliation ───────────────────────────────────────────
// Messages deleted in another mail client disappear from the server but
// linger in the local DB. The diff is guarded three ways because a wrong
// answer here deletes user-visible mail:
//  1. the UID list must agree with the server's reported message count
//     (truncated/flaky SEARCH responses must never cause deletions)
//  2. callers only invoke this when UIDVALIDITY is unchanged
//  3. a mass-deletion cap skips wipes that look like provider glitches

const MASS_DELETE_MIN = 500

export function computeGhostRemoteIds(
  localRemoteIds: string[],
  serverUids: string[],
  serverMessageCount: number
): string[] {
  if (serverUids.length !== serverMessageCount) return []

  const serverSet = new Set(serverUids)
  const ghosts = localRemoteIds.filter((id) => !serverSet.has(id))

  if (ghosts.length > MASS_DELETE_MIN && ghosts.length > localRemoteIds.length / 2) {
    console.warn(
      `[imap] Skipping ghost reconciliation: ${ghosts.length}/${localRemoteIds.length} messages ` +
        `missing from server looks like a glitch, not deletions`
    )
    return []
  }
  return ghosts
}

// ── Attachment matching ────────────────────────────────────────────────────
// remoteRef format: "{uid}:{key}" where key is the checksum/filename recorded
// at sync time (see ImapProvider.parseFetchMessage).

export interface AttachmentLike {
  checksum?: string
  filename?: string
  content?: Buffer
}

export function parseAttachmentRef(remoteRef: string): { uid: string; key: string } {
  const sep = remoteRef.indexOf(':')
  if (sep === -1) return { uid: remoteRef, key: '' }
  return { uid: remoteRef.slice(0, sep), key: remoteRef.slice(sep + 1) }
}

export function findAttachmentByKey<T extends AttachmentLike>(
  attachments: T[],
  key: string
): T | undefined {
  // Match by the same key formula used at sync time
  const match = attachments.find((att) => (att.checksum ?? att.filename ?? 'att') === key)
  if (match) return match
  // Legacy refs (pre-fix) may not match; fall back to filename
  return attachments.find((att) => att.filename === key)
}
