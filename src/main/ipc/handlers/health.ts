import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { SyncEngine } from '../../sync/SyncEngine'
import { getDb } from '../../db/client'
import { accounts } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import type { AccountHealth } from '@shared/types/db'

export function registerHealthHandlers(): void {
  ipcMain.handle(IPC.ACCOUNTS_HEALTH, async () => {
    try {
      const db = getDb()
      const statuses = SyncEngine.getInstance().getAllStatus()
      const rows = db
        .select({
          accountId: accounts.id,
          email: accounts.email,
          displayName: accounts.displayName,
          provider: accounts.provider,
          messageCount: sql<number>`(SELECT COALESCE(SUM(message_count), 0) FROM threads WHERE threads.account_id = accounts.id)`,
          unreadCount: sql<number>`(SELECT COALESCE(SUM(unread_count), 0) FROM threads WHERE threads.account_id = accounts.id)`,
        })
        .from(accounts)
        .where(eq(accounts.isActive, true))
        .all()

      const data: AccountHealth[] = rows.map((r) => ({
        ...r,
        status: statuses[r.accountId] ?? { state: 'idle' as const },
      }))
      return { data }
    } catch (err) {
      return { error: { code: 'HEALTH_ERROR', message: String(err) } }
    }
  })
}
