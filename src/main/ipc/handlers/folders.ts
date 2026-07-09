import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { getFoldersByAccount } from '../../db/queries/folders'
import type { FolderRow } from '@shared/types/db'
import type { FolderType } from '@shared/types/provider'

function toFolderRow(f: ReturnType<typeof getFoldersByAccount>[0]): FolderRow {
  return {
    id: f.id,
    accountId: f.accountId,
    remoteId: f.remoteId,
    name: f.name,
    type: f.type as FolderType,
    totalCount: f.totalCount,
    unreadCount: f.unreadCount,
    syncCursor: f.syncCursor ?? null,
    updatedAt: f.updatedAt,
  }
}

export function registerFolderHandlers(): void {
  ipcMain.handle(IPC.FOLDERS_LIST, async (_event, accountId: string) => {
    try {
      const rows = getFoldersByAccount(accountId)
      return { data: rows.map(toFolderRow) }
    } catch (err) {
      return { error: { code: 'FOLDERS_ERROR', message: String(err) } }
    }
  })
}

export function broadcastUnreadChanged(
  win: BrowserWindow,
  folderId: string,
  count: number,
  accountId: string
): void {
  win.webContents.send(IPC.FOLDERS_UNREAD_CHANGED, { folderId, count, accountId })
}
