import { ipcMain, shell, dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC } from '@shared/constants/ipc-channels'
import { OpenExternalSchema } from '../validator'
import {
  getAttachmentById,
  getMessageById,
  updateAttachmentDownloaded,
} from '../../db/queries/messages'
import { SyncEngine } from '../../sync/SyncEngine'

export function registerShellHandlers(): void {
  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, async (_event, url: string) => {
    try {
      const parsed = OpenExternalSchema.parse({ url })
      await shell.openExternal(parsed.url)
      return { data: null }
    } catch (err) {
      return { error: { code: 'OPEN_EXTERNAL_ERROR', message: String(err) } }
    }
  })

  // L4: Confine openPath to the app's attachment directory so a compromised
  //     renderer can't open arbitrary filesystem paths.
  ipcMain.handle(IPC.ATTACHMENTS_OPEN, async (_event, localPath: string) => {
    try {
      if (typeof localPath !== 'string') {
        return { error: { code: 'INVALID_PATH', message: 'Invalid path' } }
      }
      const allowedDir = path.join(app.getPath('userData'), 'attachments')
      const resolved = path.resolve(localPath)
      if (!resolved.startsWith(allowedDir + path.sep) && resolved !== allowedDir) {
        return { error: { code: 'INVALID_PATH', message: 'Path outside attachment directory' } }
      }
      const result = await shell.openPath(resolved)
      if (result) {
        return { error: { code: 'OPEN_ERROR', message: result } }
      }
      return { data: null }
    } catch (err) {
      return { error: { code: 'OPEN_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ATTACHMENTS_DOWNLOAD, async (_event, attachmentId: string) => {
    try {
      const attachment = getAttachmentById(attachmentId)
      if (!attachment) {
        return { error: { code: 'NOT_FOUND', message: 'Attachment not found' } }
      }

      if (attachment.isDownloaded && attachment.localPath && fs.existsSync(attachment.localPath)) {
        return { data: { localPath: attachment.localPath } }
      }

      // L2/L3: Was a dynamic import — now uses the static import above.
      const message = getMessageById(attachment.messageId)
      if (!message) {
        return { error: { code: 'NOT_FOUND', message: 'Parent message not found' } }
      }

      const downloadDir = path.join(app.getPath('userData'), 'attachments')
      if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true })

      const buffer = await SyncEngine.getInstance().downloadAttachment(
        message.accountId,
        attachment.remoteRef
      )

      const localPath = path.join(downloadDir, `${attachment.id}_${attachment.filename}`)
      fs.writeFileSync(localPath, buffer)
      updateAttachmentDownloaded(attachmentId, localPath)

      return { data: { localPath } }
    } catch (err) {
      return { error: { code: 'DOWNLOAD_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ATTACHMENTS_SAVE_AS, async (_event, attachmentId: string) => {
    try {
      const attachment = getAttachmentById(attachmentId)
      if (!attachment) {
        return { error: { code: 'NOT_FOUND', message: 'Attachment not found' } }
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: attachment.filename,
      })

      if (canceled || !filePath) return { data: null }

      if (attachment.localPath && fs.existsSync(attachment.localPath)) {
        fs.copyFileSync(attachment.localPath, filePath)
      } else {
        // L3: Was a dynamic import — now uses the static import above.
        const message = getMessageById(attachment.messageId)
        if (!message) return { error: { code: 'NOT_FOUND', message: 'Message not found' } }

        const buffer = await SyncEngine.getInstance().downloadAttachment(
          message.accountId,
          attachment.remoteRef
        )
        fs.writeFileSync(filePath, buffer)
      }

      return { data: { localPath: filePath } }
    } catch (err) {
      return { error: { code: 'SAVE_AS_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.WINDOW_SET_BADGE, async (_event, count: number) => {
    const { setBadgeCount } = await import('../../window')
    setBadgeCount(typeof count === 'number' ? count : 0)
    return { data: null }
  })

  ipcMain.handle(IPC.DIALOG_OPEN_FILE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    })
    return { data: canceled ? [] : filePaths }
  })
}
