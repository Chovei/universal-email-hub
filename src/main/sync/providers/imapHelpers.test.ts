import { describe, it, expect } from 'vitest'
import {
  mapFolderType,
  parseCursor,
  encodeCursor,
  groupRefsByFolder,
  parseAttachmentRef,
  findAttachmentByKey,
  computeGhostRemoteIds,
} from './imapHelpers'

describe('mapFolderType', () => {
  it('maps INBOX regardless of case', () => {
    expect(mapFolderType('INBOX')).toBe('inbox')
    expect(mapFolderType('Inbox')).toBe('inbox')
  })

  it('prefers SPECIAL-USE flags over name matching', () => {
    // A folder named "Old Mail" flagged \Sent must map to sent
    expect(mapFolderType('Old Mail', '\\Sent')).toBe('sent')
    expect(mapFolderType('Corbeille', '\\Trash')).toBe('trash')
    expect(mapFolderType('Basura', '\\Junk')).toBe('spam')
    expect(mapFolderType('Archiv', '\\Archive')).toBe('archive')
    expect(mapFolderType('Entwürfe', '\\Drafts')).toBe('drafts')
  })

  it('falls back to name matching for servers without SPECIAL-USE', () => {
    expect(mapFolderType('Sent Items')).toBe('sent')
    expect(mapFolderType('Deleted Items')).toBe('trash')
    expect(mapFolderType('Junk E-mail')).toBe('spam')
    expect(mapFolderType('Drafts')).toBe('drafts')
    expect(mapFolderType('Archives')).toBe('archive')
  })

  it('maps unrecognized folders to custom', () => {
    expect(mapFolderType('Receipts')).toBe('custom')
    expect(mapFolderType('Projects/Alpha')).toBe('custom')
  })

  it('maps Gmail All Mail (\\All) to archive', () => {
    expect(mapFolderType('[Gmail]/All Mail', '\\All')).toBe('archive')
  })
})

describe('cursor round-trip', () => {
  it('encodes and parses back', () => {
    const encoded = encodeCursor(123456, 789)
    expect(parseCursor(encoded)).toEqual({ uidvalidity: 123456, highestUid: 789 })
  })

  it('returns null for null, empty, and malformed cursors', () => {
    expect(parseCursor(null)).toBeNull()
    expect(parseCursor('')).toBeNull()
    expect(parseCursor('garbage')).toBeNull()
    expect(parseCursor('12:')).toBeNull()
    expect(parseCursor(':34')).toBeNull()
    expect(parseCursor('a:b')).toBeNull()
  })

  it('rejects zero uidvalidity (never valid per RFC 3501)', () => {
    expect(parseCursor('0:5')).toBeNull()
  })
})

describe('groupRefsByFolder', () => {
  it('groups UIDs by mailbox', () => {
    const { byFolder, skipped } = groupRefsByFolder([
      { remoteId: '1', folderRemoteId: 'INBOX' },
      { remoteId: '2', folderRemoteId: 'Archive' },
      { remoteId: '3', folderRemoteId: 'INBOX' },
    ])
    expect(skipped).toBe(0)
    expect(byFolder.get('INBOX')).toEqual(['1', '3'])
    expect(byFolder.get('Archive')).toEqual(['2'])
  })

  it('counts refs without folder context as skipped instead of guessing', () => {
    const { byFolder, skipped } = groupRefsByFolder([
      { remoteId: '1', folderRemoteId: 'INBOX' },
      { remoteId: '2' },
      { remoteId: '3', folderRemoteId: null },
    ])
    expect(skipped).toBe(2)
    expect(byFolder.size).toBe(1)
    expect(byFolder.get('INBOX')).toEqual(['1'])
  })

  it('returns an empty map for no refs', () => {
    const { byFolder, skipped } = groupRefsByFolder([])
    expect(byFolder.size).toBe(0)
    expect(skipped).toBe(0)
  })
})

describe('computeGhostRemoteIds', () => {
  it('returns local UIDs missing from the server set', () => {
    const ghosts = computeGhostRemoteIds(['1', '2', '3', '4'], ['1', '3'], 2)
    expect(ghosts).toEqual(['2', '4'])
  })

  it('returns empty when nothing was deleted', () => {
    expect(computeGhostRemoteIds(['1', '2'], ['1', '2'], 2)).toEqual([])
  })

  it('refuses to reconcile when the UID list disagrees with the reported count', () => {
    // A truncated/flaky SEARCH response must never cause deletions
    expect(computeGhostRemoteIds(['1', '2', '3'], ['1'], 3)).toEqual([])
  })

  it('handles a legitimately emptied folder', () => {
    expect(computeGhostRemoteIds(['1', '2'], [], 0)).toEqual(['1', '2'])
  })

  it('applies the mass-deletion guard for large suspicious wipes', () => {
    const local = Array.from({ length: 2000 }, (_, i) => String(i + 1))
    const server = local.slice(0, 400) // 1600 ghosts — >500 and >half
    expect(computeGhostRemoteIds(local, server, 400)).toEqual([])
  })

  it('allows large deletions below the guard threshold', () => {
    const local = Array.from({ length: 2000 }, (_, i) => String(i + 1))
    const server = local.slice(300) // 300 ghosts
    expect(computeGhostRemoteIds(local, server, 1700)).toHaveLength(300)
  })
})

describe('parseAttachmentRef', () => {
  it('splits on the first colon only — filenames may contain colons', () => {
    expect(parseAttachmentRef('42:abc123')).toEqual({ uid: '42', key: 'abc123' })
    expect(parseAttachmentRef('42:report: final.pdf')).toEqual({
      uid: '42',
      key: 'report: final.pdf',
    })
  })

  it('handles refs without a key', () => {
    expect(parseAttachmentRef('42')).toEqual({ uid: '42', key: '' })
  })
})

describe('findAttachmentByKey', () => {
  const atts = [
    { checksum: 'sum-a', filename: 'invoice.pdf', content: Buffer.from('A') },
    { checksum: 'sum-b', filename: 'contract.pdf', content: Buffer.from('B') },
    { checksum: 'sum-c', filename: 'invoice.pdf', content: Buffer.from('C') },
  ]

  it('matches by checksum — the primary sync-time key', () => {
    expect(findAttachmentByKey(atts, 'sum-b')?.content.toString()).toBe('B')
  })

  it('disambiguates duplicate filenames via checksum', () => {
    expect(findAttachmentByKey(atts, 'sum-c')?.content.toString()).toBe('C')
  })

  it('falls back to filename for legacy refs', () => {
    const noChecksum = [
      { filename: 'a.txt', content: Buffer.from('A') },
      { filename: 'b.txt', content: Buffer.from('B') },
    ]
    expect(findAttachmentByKey(noChecksum, 'b.txt')?.content.toString()).toBe('B')
  })

  it('returns undefined when nothing matches — never the first attachment', () => {
    expect(findAttachmentByKey(atts, 'nonexistent')).toBeUndefined()
  })
})
