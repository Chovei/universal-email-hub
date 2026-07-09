import { ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { IPC } from '@shared/constants/ipc-channels'
import { SendSchema, SaveDraftSchema, UploadAttachmentSchema } from '../validator'
import { SyncEngine } from '../../sync/SyncEngine'
import type { UploadAttachmentResult } from '@shared/types/ipc'

const ALLOWED_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return ALLOWED_MIME_TYPES[ext] ?? 'application/octet-stream'
}

export function registerComposeHandlers(): void {
  ipcMain.handle(IPC.COMPOSE_SEND, async (_event, payload: unknown) => {
    try {
      const parsed = SendSchema.parse(payload)
      const engine = SyncEngine.getInstance()
      const remoteId = await engine.sendMessage(parsed.fromAccountId, parsed)
      return { data: { remoteId } }
    } catch (err) {
      return { error: { code: 'SEND_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.COMPOSE_SAVE_DRAFT, async (_event, payload: unknown) => {
    try {
      const parsed = SaveDraftSchema.parse(payload)
      const engine = SyncEngine.getInstance()
      const remoteId = await engine.saveDraft(parsed.fromAccountId, parsed)
      return { data: { remoteId } }
    } catch (err) {
      return { error: { code: 'SAVE_DRAFT_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.COMPOSE_UPLOAD_ATTACHMENT, async (_event, payload: unknown) => {
    try {
      const { filePath } = UploadAttachmentSchema.parse(payload)

      if (!fs.existsSync(filePath)) {
        return { error: { code: 'FILE_NOT_FOUND', message: 'File does not exist' } }
      }

      const stat = fs.statSync(filePath)
      if (stat.size > 25 * 1024 * 1024) {
        return { error: { code: 'FILE_TOO_LARGE', message: 'File exceeds 25 MB limit' } }
      }

      const result: UploadAttachmentResult = {
        localPath: filePath,
        filename: path.basename(filePath),
        mimeType: getMimeType(filePath),
        size: stat.size,
      }

      return { data: result }
    } catch (err) {
      return { error: { code: 'UPLOAD_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.COMPOSE_DELETE_DRAFT, async (_event, remoteId: string, accountId: string) => {
    try {
      await SyncEngine.getInstance().deleteDraft(accountId, remoteId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'DELETE_DRAFT_ERROR', message: String(err) } }
    }
  })
}
