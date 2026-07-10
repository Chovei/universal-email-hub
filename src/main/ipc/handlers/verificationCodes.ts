import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import {
  listVerificationCodes,
  markVerificationCodesRead,
  deleteVerificationCodes,
} from '../../db/queries/verificationCodes'

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

  ipcMain.handle(IPC.VERIFICATION_CODES_DELETE, (_event, ids: string[]) => {
    try {
      deleteVerificationCodes(ids)
      return { data: null }
    } catch (err) {
      return { error: { code: 'DELETE_FAILED', message: String(err) } }
    }
  })
}
