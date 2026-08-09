import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import {
  listVerificationCodes,
  markVerificationCodesRead,
  deleteVerificationCodes,
  getMessageIdsForCodes,
} from '../../db/queries/verificationCodes'
import { getMessageById, moveMessages, getMessagesByThread } from '../../db/queries/messages'
import { getFolderByType } from '../../db/queries/folders'
import { updateThreadCounts } from '../../db/queries/threads'
import { SyncEngine } from '../../sync/SyncEngine'
import { buildRemoteRefs } from '../../sync/remoteRefs'

/**
 * Move the emails these codes came from to Trash, locally and on the server.
 * Trash rather than a hard delete: a mis-click stays recoverable from the
 * mail provider. Best effort — dismissing a code must still succeed even if
 * the message is already gone or the account has no trash folder.
 */
function trashSourceEmails(codeIds: string[]): string[] {
  const messageIds = getMessageIdsForCodes(codeIds)
  if (messageIds.length === 0) return []

  const byAccount = new Map<string, Array<{ id: string; remoteId: string; folderId: string | null }>>()
  for (const id of messageIds) {
    const msg = getMessageById(id)
    if (!msg) continue
    const list = byAccount.get(msg.accountId) ?? []
    list.push({ id: msg.id, remoteId: msg.remoteId, folderId: msg.folderId ?? null })
    byAccount.set(msg.accountId, list)
  }

  const engine = SyncEngine.getInstance()
  const moved: string[] = []

  for (const [accountId, msgs] of byAccount) {
    const trash = getFolderByType(accountId, 'trash')
    if (!trash) {
      console.warn(`[verification] ${accountId} has no trash folder — leaving its email in place`)
      continue
    }
    // Refs must be built BEFORE the local move so they carry the folder the
    // messages still occupy on the server
    const refs = buildRemoteRefs(msgs)
    const threadIds = new Set(msgs.map((m) => getMessageById(m.id)?.threadId).filter(Boolean) as string[])

    moveMessages(msgs.map((m) => m.id), trash.id)
    void engine.moveMessages(accountId, refs, trash.remoteId).catch(() => {})

    for (const threadId of threadIds) {
      const siblings = getMessagesByThread(threadId)
      updateThreadCounts(threadId, siblings.filter((m) => !m.isRead).length, siblings.length)
    }
    moved.push(...msgs.map((m) => m.id))
  }
  return moved
}

export function registerVerificationHandlers(): void {
  ipcMain.handle(IPC.VERIFICATION_CODES_LIST, (_event, limit?: number) => {
    try {
      return { data: listVerificationCodes(limit) }
    } catch (err) {
      return { error: { code: 'LIST_FAILED', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.VERIFICATION_CODES_MARK_READ, (_event, ids: string[]) => {
    try {
      markVerificationCodesRead(ids)
      return { data: null }
    } catch (err) {
      return { error: { code: 'MARK_READ_FAILED', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.VERIFICATION_CODES_DELETE, (_event, ids: string[], trashEmail = false) => {
    try {
      // Trash the source email first: once the code row is gone we can no
      // longer find which message it came from.
      let movedMessageIds: string[] = []
      if (trashEmail) {
        try {
          movedMessageIds = trashSourceEmails(ids)
        } catch (err) {
          console.warn('[verification] could not trash source email(s):', err)
        }
      }

      deleteVerificationCodes(ids)

      if (movedMessageIds.length > 0) {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.webContents.send(IPC.MESSAGES_DELETED, movedMessageIds)
        }
      }
      return { data: { trashedMessages: movedMessageIds.length } }
    } catch (err) {
      return { error: { code: 'DELETE_FAILED', message: String(err) } }
    }
  })
}
