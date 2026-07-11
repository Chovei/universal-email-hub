import { ipcMain } from 'electron'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/constants/ipc-channels'
import { BulkActionEngine } from '../../bulk/BulkActionEngine'
import type { BulkRequest, BulkQueryCriteria } from '@shared/types/ipc'

const BulkActionEnum = z.enum([
  'delete', 'archive', 'move',
  'markRead', 'markUnread',
  'star', 'unstar',
  'spam', 'notSpam',
  'export', 'copy',
])

const BulkExecuteSchema = z.object({
  operationId: z.string().uuid().optional(),
  action: BulkActionEnum,
  threadIds: z.array(z.string().min(1)).min(1).max(500_000),
  options: z.object({
    targetFolderId: z.string().optional(),
    targetAccountId: z.string().optional(),
    exportFormat: z.enum(['eml', 'csv']).optional(),
    exportPath: z.string().optional(),
  }).optional(),
})

const BulkQuerySchema = z.object({
  accountId: z.string().optional(),
  folderId: z.string().optional(),
  folderType: z.string().optional(),
  unreadOnly: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  starredOnly: z.boolean().optional(),
  hasAttachment: z.boolean().optional(),
  fromAddress: z.string().optional(),
  olderThanDays: z.number().int().min(1).optional(),
  newerThanDays: z.number().int().min(1).optional(),
})

export function registerBulkHandlers(): void {
  const engine = BulkActionEngine.getInstance()

  ipcMain.handle(IPC.BULK_EXECUTE, async (_event, payload: unknown) => {
    try {
      const parsed = BulkExecuteSchema.parse(payload)
      const operationId = parsed.operationId ?? randomUUID()
      const req: BulkRequest = { ...parsed, operationId }
      void engine.execute(req) // fire-and-forget; progress via push events
      return { data: { operationId } }
    } catch (err) {
      return { error: { code: 'BULK_EXECUTE_FAILED', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.BULK_CANCEL, async (_event, payload: unknown) => {
    try {
      const { operationId } = z.object({ operationId: z.string() }).parse(payload)
      engine.cancel(operationId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'BULK_CANCEL_FAILED', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.BULK_UNDO, async (_event, payload: unknown) => {
    try {
      const { undoToken } = z.object({ undoToken: z.string() }).parse(payload)
      await engine.undo(undoToken)
      return { data: null }
    } catch (err) {
      return { error: { code: 'BULK_UNDO_FAILED', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.BULK_QUERY_IDS, async (_event, payload: unknown) => {
    try {
      const criteria = BulkQuerySchema.parse(payload) as BulkQueryCriteria
      const ids = engine.queryIds(criteria)
      return { data: ids }
    } catch (err) {
      return { error: { code: 'BULK_QUERY_FAILED', message: String(err) } }
    }
  })
}
