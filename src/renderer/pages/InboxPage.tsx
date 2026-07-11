import { SplitPane } from '../components/layout/SplitPane'
import { ThreadList } from '../components/mailbox/ThreadList'
import { MessageReader } from '../components/mailbox/MessageReader'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

interface InboxPageProps {
  onFolderAction?: (action: FolderAction, folder: FolderRow) => void
}

export function InboxPage({ onFolderAction }: InboxPageProps) {
  return (
    <SplitPane
      left={<ThreadList onFolderAction={onFolderAction} />}
      right={<MessageReader />}
    />
  )
}
