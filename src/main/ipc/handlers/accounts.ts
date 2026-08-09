import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { AddAccountSchema, UpdateAccountSchema, VerifyAccountSchema } from '../validator'
import { getAllAccounts, insertAccount, updateAccount, deleteAccount, getAccountByEmail } from '../../db/queries/accounts'
import { SyncEngine } from '../../sync/SyncEngine'
import { credentialStore } from '../../security/keychain'
import { GmailProvider } from '../../sync/providers/GmailProvider'
import { GraphProvider } from '../../sync/providers/GraphProvider'
import { ImapProvider, storeImapCredentials } from '../../sync/providers/ImapProvider'
import type { AccountRow } from '@shared/types/db'
import type { ProviderKind } from '@shared/constants/providers'
import { monotonicFactory } from 'ulid'

const ulid = monotonicFactory()

function toAccountRow(row: ReturnType<typeof getAllAccounts>[0]): AccountRow {
  return {
    id: row.id,
    provider: row.provider as ProviderKind,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl ?? null,
    color: row.color,
    isActive: Boolean(row.isActive),
    syncCursor: row.syncCursor ?? null,
    lastSyncAt: row.lastSyncAt ?? null,
    syncIntervalSeconds: row.syncIntervalSeconds,
    createdAt: row.createdAt,
    order: row.order,
    notes: row.notes ?? null,
    label: row.label ?? null,
  }
}

export function registerAccountHandlers(): void {
  ipcMain.handle(IPC.ACCOUNTS_LIST, async () => {
    try {
      const rows = getAllAccounts()
      return { data: rows.map(toAccountRow) }
    } catch (err) {
      return { error: { code: 'DB_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_ADD, async (_event, payload: unknown) => {
    try {
      const parsed = AddAccountSchema.parse(payload)
      const id = ulid()
      const now = Date.now()

      const creds = parsed.credentials

      // Store credentials for every IMAP-based provider (anything with credentials)
      if (creds) {
        storeImapCredentials(id, creds)
      }

      const email = creds?.username ?? ''
      const displayName = creds ? (creds.username.split('@')[0] ?? 'Account') : 'New Account'

      const providerColors: Record<string, string> = {
        gmail: '#EA4335',
        outlook: '#0078D4',
        graph: '#0078D4',
        icloud: '#1D7AE0',
        yahoo: '#720E9E',
        fastmail: '#3256CB',
        zoho: '#E42527',
        aol: '#FF0000',
        gmx: '#1C449B',
      }
      const color = providerColors[parsed.provider] ?? '#6366F1'

      const row = insertAccount({
        id,
        provider: parsed.provider,
        email,
        displayName,
        color,
        isActive: true,
        createdAt: now,
        order: getAllAccounts().length,
        syncIntervalSeconds: 60,
      })

      void SyncEngine.getInstance().addAccount(id, parsed.provider, creds)

      return { data: toAccountRow(row) }
    } catch (err) {
      return { error: { code: 'ADD_ACCOUNT_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_REMOVE, async (_event, accountId: string) => {
    try {
      SyncEngine.getInstance().removeAccount(accountId)
      // Credentials are stored under `account:<id>:credentials` and
      // `account:<id>:tokens`; deleting only `account:<id>` left IMAP
      // passwords and OAuth refresh tokens on disk permanently after the
      // user removed the account.
      credentialStore.deleteByPrefix(`account:${accountId}`)
      deleteAccount(accountId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'REMOVE_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_UPDATE, async (_event, accountId: string, patch: unknown) => {
    try {
      const parsed = UpdateAccountSchema.parse(patch)
      const row = updateAccount(accountId, parsed)
      if (!row) return { error: { code: 'NOT_FOUND', message: 'Account not found' } }
      return { data: toAccountRow(row) }
    } catch (err) {
      return { error: { code: 'UPDATE_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_RECONNECT, async (_event, accountId: string) => {
    try {
      await SyncEngine.getInstance().reconnect(accountId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'RECONNECT_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_REORDER, async (_event, accountIds: string[]) => {
    try {
      accountIds.forEach((id, i) => updateAccount(id, { order: i }))
      return { data: null }
    } catch (err) {
      return { error: { code: 'REORDER_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_VERIFY, async (_event, payload: unknown) => {
    try {
      const parsed = VerifyAccountSchema.parse(payload)
      const tempId = `verify_${Date.now()}`
      const provider = new ImapProvider(tempId, parsed.provider, parsed.credentials)
      const result = await provider.testConnection()
      if (result.success) {
        return { data: { success: true, email: parsed.credentials.username } }
      }
      let msg = result.error ?? 'Connection failed'
      if (/AUTHENTICATIONFAILED|AUTHENTICATE failed|Invalid credentials|LOGIN failed|authentication failed|Command failed/i.test(msg)) {
        msg = 'Authentication failed — check your email and app password (no spaces)'
      } else if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(msg)) {
        msg = 'Could not reach the mail server — check your internet connection'
      } else if (/ETIMEDOUT/i.test(msg)) {
        msg = 'Connection timed out — IMAP may be blocked or the server address is wrong'
      } else if (/certificate|SSL|TLS/i.test(msg)) {
        msg = 'SSL/TLS error — try changing the security setting'
      }
      return { data: { success: false, error: msg, detail: result.error } }
    } catch (err) {
      return { error: { code: 'VERIFY_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.ACCOUNTS_OAUTH_START, async (_event, provider: string) => {
    try {
      if (provider === 'gmail') {
        const id = ulid()
        const gmailProvider = new GmailProvider(id)

        // Opens system browser and blocks until the loopback redirect completes
        await gmailProvider.authenticate()

        const profile = await gmailProvider.getUserProfile()

        // Reject duplicate accounts
        const existing = getAccountByEmail(profile.email)
        if (existing) {
          credentialStore.delete(`account:${id}:tokens`)
          return {
            error: {
              code: 'DUPLICATE_ACCOUNT',
              message: `${profile.email} is already connected`,
            },
          }
        }

        const now = Date.now()
        const row = insertAccount({
          id,
          provider: 'gmail',
          email: profile.email,
          displayName: profile.name,
          avatarUrl: profile.picture ?? null,
          color: '#EA4335',
          isActive: true,
          createdAt: now,
          order: getAllAccounts().length,
          syncIntervalSeconds: 60,
        })

        void SyncEngine.getInstance().addAccount(id, 'gmail')

        return { data: toAccountRow(row) }
      }

      if (provider === 'graph') {
        const id = ulid()
        const graphProvider = new GraphProvider(id)

        await graphProvider.authenticate()
        const profile = await graphProvider.getUserProfile()

        const existing = getAccountByEmail(profile.email)
        if (existing) {
          credentialStore.delete(`account:${id}:tokens`)
          return {
            error: { code: 'DUPLICATE_ACCOUNT', message: `${profile.email} is already connected` },
          }
        }

        const now = Date.now()
        const row = insertAccount({
          id,
          provider: 'graph',
          email: profile.email,
          displayName: profile.name,
          avatarUrl: null,
          color: '#0078D4',
          isActive: true,
          createdAt: now,
          order: getAllAccounts().length,
          syncIntervalSeconds: 60,
        })

        void SyncEngine.getInstance().addAccount(id, 'graph')
        return { data: toAccountRow(row) }
      }

      return {
        error: {
          code: 'UNSUPPORTED_PROVIDER',
          message: `OAuth not yet implemented for ${provider}`,
        },
      }
    } catch (err) {
      return { error: { code: 'OAUTH_ERROR', message: String(err) } }
    }
  })
}

export function sendSyncStatusChanged(
  win: BrowserWindow,
  accountId: string,
  status: object
): void {
  win.webContents.send(IPC.ACCOUNTS_SYNC_STATUS_CHANGED, { accountId, status })
}
