import { eq, asc } from 'drizzle-orm'
import { getDb } from '../client'
import { accounts } from '../schema'
import type { AccountInsert, AccountSelect } from '../schema'

export function getAllAccounts(): AccountSelect[] {
  return getDb().select().from(accounts).orderBy(asc(accounts.order)).all()
}

export function getAccountById(id: string): AccountSelect | undefined {
  return getDb().select().from(accounts).where(eq(accounts.id, id)).get()
}

export function getAccountByEmail(email: string): AccountSelect | undefined {
  return getDb().select().from(accounts).where(eq(accounts.email, email)).get()
}

export function insertAccount(data: AccountInsert): AccountSelect {
  return getDb().insert(accounts).values(data).returning().get()
}

export function updateAccount(id: string, data: Partial<AccountInsert>): AccountSelect | undefined {
  return getDb()
    .update(accounts)
    .set(data)
    .where(eq(accounts.id, id))
    .returning()
    .get()
}

export function deleteAccount(id: string): void {
  getDb().delete(accounts).where(eq(accounts.id, id)).run()
}

export function setAccountSyncCursor(id: string, cursor: string | null): void {
  getDb()
    .update(accounts)
    .set({ syncCursor: cursor, lastSyncAt: Date.now() })
    .where(eq(accounts.id, id))
    .run()
}
