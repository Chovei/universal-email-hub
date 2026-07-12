import { describe, it, expect, vi, beforeEach } from 'vitest'

// remoteRefs pulls the folders query module, which transitively imports the
// Electron-backed DB client — mock the query layer at the module boundary.
vi.mock('../db/queries/folders', () => ({
  getFolderById: vi.fn(),
}))

import { buildRemoteRefs } from './remoteRefs'
import { getFolderById } from '../db/queries/folders'

const mockGetFolderById = vi.mocked(getFolderById)

describe('buildRemoteRefs', () => {
  beforeEach(() => {
    mockGetFolderById.mockReset()
  })

  it('resolves folderId to the folder remoteId', () => {
    mockGetFolderById.mockReturnValue({ id: 'f1', remoteId: 'Archive' } as ReturnType<
      typeof getFolderById
    >)

    const refs = buildRemoteRefs([{ remoteId: '101', folderId: 'f1' }])
    expect(refs).toEqual([{ remoteId: '101', folderRemoteId: 'Archive' }])
  })

  it('memoizes folder lookups — one DB hit per distinct folder', () => {
    mockGetFolderById.mockReturnValue({ id: 'f1', remoteId: 'INBOX' } as ReturnType<
      typeof getFolderById
    >)

    buildRemoteRefs([
      { remoteId: '1', folderId: 'f1' },
      { remoteId: '2', folderId: 'f1' },
      { remoteId: '3', folderId: 'f1' },
    ])
    expect(mockGetFolderById).toHaveBeenCalledTimes(1)
  })

  it('produces null folderRemoteId for messages without a folder', () => {
    const refs = buildRemoteRefs([{ remoteId: '1', folderId: null }])
    expect(refs).toEqual([{ remoteId: '1', folderRemoteId: null }])
    expect(mockGetFolderById).not.toHaveBeenCalled()
  })

  it('produces null folderRemoteId when the folder row is missing', () => {
    mockGetFolderById.mockReturnValue(undefined)
    const refs = buildRemoteRefs([{ remoteId: '1', folderId: 'ghost' }])
    expect(refs).toEqual([{ remoteId: '1', folderRemoteId: null }])
  })
})
