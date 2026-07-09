import { SplitPane } from '../components/layout/SplitPane'
import { ThreadList } from '../components/mailbox/ThreadList'
import { MessageReader } from '../components/mailbox/MessageReader'

export function InboxPage() {
  return (
    <SplitPane
      left={<ThreadList />}
      right={<MessageReader />}
    />
  )
}
