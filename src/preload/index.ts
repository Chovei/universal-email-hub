import type { IpcRendererEvent } from 'electron';
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/constants/ipc-channels'
import type { EmailAPI } from '../shared/types/ipc'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

function on(channel: string, cb: (...args: unknown[]) => void): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const emailAPI: EmailAPI = {
  accounts: {
    list: () => invoke(IPC.ACCOUNTS_LIST),
    add: (payload) => invoke(IPC.ACCOUNTS_ADD, payload),
    remove: (accountId) => invoke(IPC.ACCOUNTS_REMOVE, accountId),
    update: (accountId, patch) => invoke(IPC.ACCOUNTS_UPDATE, accountId, patch),
    reconnect: (accountId) => invoke(IPC.ACCOUNTS_RECONNECT, accountId),
    reorder: (accountIds) => invoke(IPC.ACCOUNTS_REORDER, accountIds),
    oauthStart: (provider) => invoke(IPC.ACCOUNTS_OAUTH_START, provider),
    verify: (payload) => invoke(IPC.ACCOUNTS_VERIFY, payload),
    health: () => invoke(IPC.ACCOUNTS_HEALTH),
    onSyncStatusChanged: (cb) => on(IPC.ACCOUNTS_SYNC_STATUS_CHANGED, cb as (...args: unknown[]) => void),
  },

  folders: {
    list: (accountId) => invoke(IPC.FOLDERS_LIST, accountId),
    execute: (req) => invoke(IPC.FOLDER_EXECUTE, req),
    onUnreadChanged: (cb) => on(IPC.FOLDERS_UNREAD_CHANGED, cb as (...args: unknown[]) => void),
  },

  messages: {
    list: (payload) => invoke(IPC.MESSAGES_LIST, payload),
    get: (messageId) => invoke(IPC.MESSAGES_GET, messageId),
    getThread: (threadId) => invoke(IPC.MESSAGES_GET_THREAD, threadId),
    markRead: (payload) => invoke(IPC.MESSAGES_MARK_READ, payload),
    star: (payload) => invoke(IPC.MESSAGES_STAR, payload),
    move: (payload) => invoke(IPC.MESSAGES_MOVE, payload),
    delete: (payload) => invoke(IPC.MESSAGES_DELETE, payload),
    addLabel: (payload) => invoke(IPC.MESSAGES_ADD_LABEL, payload),
    removeLabel: (payload) => invoke(IPC.MESSAGES_REMOVE_LABEL, payload),
    archive: (messageIds) => invoke(IPC.MESSAGES_ARCHIVE, messageIds),
    onNew: (cb) => on(IPC.MESSAGES_NEW, cb as (...args: unknown[]) => void),
    onUpdated: (cb) => on(IPC.MESSAGES_UPDATED, cb as (...args: unknown[]) => void),
    onDeleted: (cb) => on(IPC.MESSAGES_DELETED, cb as (...args: unknown[]) => void),
  },

  compose: {
    send: (payload) => invoke(IPC.COMPOSE_SEND, payload),
    saveDraft: (payload) => invoke(IPC.COMPOSE_SAVE_DRAFT, payload),
    uploadAttachment: (payload) => invoke(IPC.COMPOSE_UPLOAD_ATTACHMENT, payload),
    deleteDraft: (remoteId, accountId) =>
      invoke(IPC.COMPOSE_DELETE_DRAFT, remoteId, accountId),
  },

  search: {
    query: (payload) => invoke(IPC.SEARCH_QUERY, payload),
    suggest: (partial) => invoke(IPC.SEARCH_SUGGEST, partial),
  },

  sync: {
    force: (accountId) => invoke(IPC.SYNC_FORCE, accountId),
    getStatus: () => invoke(IPC.SYNC_GET_STATUS),
    pause: (accountId) => invoke(IPC.SYNC_PAUSE, accountId),
    resume: (accountId) => invoke(IPC.SYNC_RESUME, accountId),
    onProgress: (cb) => on(IPC.SYNC_PROGRESS, cb as (...args: unknown[]) => void),
  },

  attachments: {
    download: (attachmentId) => invoke(IPC.ATTACHMENTS_DOWNLOAD, attachmentId),
    open: (localPath) => invoke(IPC.ATTACHMENTS_OPEN, localPath),
    saveAs: (attachmentId) => invoke(IPC.ATTACHMENTS_SAVE_AS, attachmentId),
  },

  plugins: {
    list: () => invoke(IPC.PLUGINS_LIST),
    install: (manifestPath) => invoke(IPC.PLUGINS_INSTALL, manifestPath),
    uninstall: (pluginId) => invoke(IPC.PLUGINS_UNINSTALL, pluginId),
  },

  settings: {
    get: () => invoke(IPC.SETTINGS_GET),
    set: (key, value) => invoke(IPC.SETTINGS_SET, key, value),
    reset: () => invoke(IPC.SETTINGS_RESET),
    securityStatus: () => invoke(IPC.SETTINGS_SECURITY_STATUS),
  },

  shell: {
    openExternal: (url) => invoke(IPC.SHELL_OPEN_EXTERNAL, url),
    openFile: (localPath) => invoke(IPC.ATTACHMENTS_OPEN, localPath),
    showOpenDialog: () => invoke(IPC.DIALOG_OPEN_FILE),
  },

  window: {
    setBadge: (count) => invoke(IPC.WINDOW_SET_BADGE, count),
    onBadgeCount: (cb) => on(IPC.WINDOW_SET_BADGE, cb as (...args: unknown[]) => void),
  },

  app: {
    onNavigate: (cb) => on(IPC.APP_NAVIGATE, cb as (...args: unknown[]) => void),
  },

  updater: {
    check: () => invoke(IPC.UPDATER_CHECK),
    install: () => invoke(IPC.UPDATER_INSTALL),
    skipVersion: (version) => invoke(IPC.UPDATER_SKIP_VERSION, version),
    getAppInfo: () => invoke(IPC.UPDATER_GET_APP_INFO),
    onStatus: (cb) => on(IPC.UPDATER_STATUS, cb as (...args: unknown[]) => void),
  },

  verificationCodes: {
    list: (limit?: number) => invoke(IPC.VERIFICATION_CODES_LIST, limit),
    markRead: (ids: string[]) => invoke(IPC.VERIFICATION_CODES_MARK_READ, ids),
    delete: (ids: string[], trashEmail?: boolean) =>
      invoke(IPC.VERIFICATION_CODES_DELETE, ids, trashEmail ?? false),
    onNew: (cb) => on(IPC.VERIFICATION_CODES_NEW, cb as (...args: unknown[]) => void),
  },

  totp: {
    list: () => invoke(IPC.TOTP_LIST),
    parseUri: (uri: string) => invoke(IPC.TOTP_PARSE_URI, { uri }),
    add: (payload) => invoke(IPC.TOTP_ADD, payload),
    verify: (id: string, code: string) => invoke(IPC.TOTP_VERIFY, { id, code }),
    rename: (id: string, issuer: string, label: string) => invoke(IPC.TOTP_RENAME, { id, issuer, label }),
    remove: (id: string) => invoke(IPC.TOTP_DELETE, { id }),
  },

  bulk: {
    execute: (req) => invoke(IPC.BULK_EXECUTE, req),
    cancel: (operationId) => invoke(IPC.BULK_CANCEL, { operationId }),
    undo: (undoToken) => invoke(IPC.BULK_UNDO, { undoToken }),
    queryIds: (criteria) => invoke(IPC.BULK_QUERY_IDS, criteria),
    onProgress: (cb) => on(IPC.BULK_PROGRESS, cb as (...args: unknown[]) => void),
    onDone: (cb) => on(IPC.BULK_DONE, cb as (...args: unknown[]) => void),
    onCancelled: (cb) => on(IPC.BULK_CANCELLED, cb as (...args: unknown[]) => void),
  },
}

contextBridge.exposeInMainWorld('emailAPI', emailAPI)

// Type declaration for renderer usage
declare global {
  interface Window {
    emailAPI: EmailAPI
  }
}
