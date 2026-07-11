import { useState, useCallback } from 'react'
import type { FolderAction, FolderExecuteRequest } from '@shared/types/ipc'
import type { FolderRow } from '@shared/types/db'

const DESTRUCTIVE: Set<FolderAction> = new Set(['emptyTrash', 'emptySpam', 'deleteAll'])

/** Folder type implied by a cross-account global action (no specific folder selected). */
const GLOBAL_FOLDER_TYPE: Partial<Record<FolderAction, string>> = {
  emptyTrash: 'trash',
  emptySpam: 'spam',
}

export interface PendingFolderAction {
  request: FolderExecuteRequest
  folder?: FolderRow
}

export function useFolderActions() {
  const [pending, setPending] = useState<PendingFolderAction | null>(null)

  const requestAction = useCallback(
    (action: FolderAction, folder?: FolderRow, accountId?: string) => {
      const req: FolderExecuteRequest = {
        action,
        folderId: folder?.id,
        // For global actions (no folder), use the implicit folder type
        folderType: folder ? undefined : GLOBAL_FOLDER_TYPE[action],
        accountId: accountId ?? folder?.accountId,
      }

      if (DESTRUCTIVE.has(action)) {
        setPending({ request: req, folder })
      } else {
        void window.emailAPI.folders.execute(req)
      }
    },
    [],
  )

  const confirm = useCallback(async () => {
    if (!pending) return
    await window.emailAPI.folders.execute(pending.request)
    setPending(null)
  }, [pending])

  const cancel = useCallback(() => setPending(null), [])

  return { requestAction, confirm, cancel, pending }
}
