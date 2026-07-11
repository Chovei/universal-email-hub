import { useFolders } from '../../hooks/useFolders'
import { FolderItem } from './FolderItem'
import { useMailboxStore } from '../../stores/mailboxStore'
import type { FolderFilter } from '../../stores/mailboxStore'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

const FOLDER_TYPE_ORDER: Record<string, number> = {
  inbox: 0,
  sent: 1,
  drafts: 2,
  archive: 3,
  spam: 4,
  trash: 5,
  custom: 6,
}

interface FolderTreeProps {
  accountId: string
  onFolderAction: (action: FolderAction, folder: FolderRow) => void
}

export function FolderTree({ accountId, onFolderAction }: FolderTreeProps) {
  const { folders, isLoading } = useFolders(accountId)
  const { selectedFolderId, setFolder } = useMailboxStore()

  if (isLoading || folders.length === 0) return null

  const sorted = [...folders].sort(
    (a, b) => (FOLDER_TYPE_ORDER[a.type] ?? 99) - (FOLDER_TYPE_ORDER[b.type] ?? 99),
  )

  return (
    <div className="mt-0.5 space-y-0.5 pl-3 pr-1">
      {sorted.map((f) => (
        <FolderItem
          key={f.id}
          folder={f}
          isSelected={selectedFolderId === f.id}
          onSelect={() => {
            const folderFilterType = (f.type === 'custom' ? 'all' : f.type) as FolderFilter
            setFolder(f.id, accountId, folderFilterType)
          }}
          onAction={onFolderAction}
        />
      ))}
    </div>
  )
}
