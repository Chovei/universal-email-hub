import { ipcMain, BrowserWindow } from 'electron'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/constants/ipc-channels'
import { BulkActionEngine } from '../../bulk/BulkActionEngine'
import type { BulkAction, BulkQueryCriteria, FolderExecuteRequest } from '@shared/types/ipc'

const FolderActionSchema = z.enum([
  'emptyTrash', 'emptySpam',
  'markAllRead', 'markAllUnread',
  'archiveAllRead', 'deleteAll',
])

const FolderExecuteSchema = z.object({
  operationId: z.string().uuid().optional(),
  action: FolderActionSchema,
  folderId: z.string().optional(),
  folderType: z.string().optional(),
  accountId: z.string().optional(),
})

type MappedAction = { criteria: BulkQueryCriteria; bulkAction: BulkAction; options?: { skipTrash?: boolean } }

/** Map a FolderAction to the BulkQueryCriteria and BulkAction to hand to the engine. */
function mapFolderAction(req: FolderExecuteRequest): MappedAction {
  const base: BulkQueryCriteria = {
    accountId: req.accountId,
    folderId: req.folderId,
    folderType: req.folderType,
  }

  switch (req.action) {
    case 'emptyTrash':
      return { criteria: { accountId: req.accountId, folderType: 'trash' }, bulkAction: 'delete', options: { skipTrash: true } }
    case 'emptySpam':
      return { criteria: { accountId: req.accountId, folderType: 'spam' }, bulkAction: 'delete', options: { skipTrash: true } }
    case 'markAllRead':
      return { criteria: { ...base, unreadOnly: true }, bulkAction: 'markRead' }
    case 'markAllUnread':
      return { criteria: base, bulkAction: 'markUnread' }
    case 'archiveAllRead':
      return { criteria: { ...base, readOnly: true }, bulkAction: 'archive' }
    case 'deleteAll':
      return { criteria: base, bulkAction: 'delete' }
  }
}

export function registerFolderActionHandlers(): void {
  const engine = BulkActionEngine.getInstance()

  ipcMain.handle(IPC.FOLDER_EXECUTE, async (_event, payload: unknown) => {
    try {
      const parsed = FolderExecuteSchema.parse(payload)
      const req = parsed
      const operationId = req.operationId ?? randomUUID()

      const { criteria, bulkAction, options } = mapFolderAction(req)
      const threadIds = engine.queryIds(criteria)

      if (threadIds.length === 0) {
        // Nothing to do — push an immediate "done with 0" so the renderer
        // gets a terminal event and knows the folder is already empty.
        const result = {
          operationId,
          action: bulkAction,
          succeeded: 0,
          failed: 0,
          errors: [] as string[],
        }
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send(IPC.BULK_DONE, result)
        })
        return { data: { operationId } }
      }

      engine.execute({ operationId, action: bulkAction, threadIds, options }).catch((err: unknown) => {
        const failResult = {
          operationId,
          action: bulkAction,
          succeeded: 0,
          failed: threadIds.length,
          errors: [String(err)],
        }
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send(IPC.BULK_DONE, failResult)
        })
      })

      return { data: { operationId } }
    } catch (err) {
      return { error: { code: 'FOLDER_EXECUTE_FAILED', message: String(err) } }
    }
  })
}
