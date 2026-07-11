export const IPC = {
  // ── Accounts ───────────────────────────────────────────────────────────────
  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_ADD: 'accounts:add',
  ACCOUNTS_REMOVE: 'accounts:remove',
  ACCOUNTS_UPDATE: 'accounts:update',
  ACCOUNTS_REORDER: 'accounts:reorder',
  ACCOUNTS_RECONNECT: 'accounts:reconnect',
  ACCOUNTS_OAUTH_START: 'accounts:oauthStart',
  ACCOUNTS_VERIFY: 'accounts:verify',
  /** push: main → renderer */
  ACCOUNTS_SYNC_STATUS_CHANGED: 'accounts:syncStatusChanged',

  // ── Folders ────────────────────────────────────────────────────────────────
  FOLDERS_LIST: 'folders:list',
  FOLDERS_SUBSCRIBE: 'folders:subscribe',
  /** push: main → renderer */
  FOLDERS_UNREAD_CHANGED: 'folders:unreadChanged',

  // ── Messages ───────────────────────────────────────────────────────────────
  MESSAGES_LIST: 'messages:list',
  MESSAGES_GET: 'messages:get',
  MESSAGES_GET_THREAD: 'messages:getThread',
  MESSAGES_MARK_READ: 'messages:markRead',
  MESSAGES_STAR: 'messages:star',
  MESSAGES_MOVE: 'messages:move',
  MESSAGES_DELETE: 'messages:delete',
  MESSAGES_ADD_LABEL: 'messages:addLabel',
  MESSAGES_REMOVE_LABEL: 'messages:removeLabel',
  MESSAGES_ARCHIVE: 'messages:archive',
  MESSAGES_MARK_SPAM: 'messages:markSpam',
  /** push: main → renderer */
  MESSAGES_NEW: 'messages:new',
  /** push: main → renderer */
  MESSAGES_UPDATED: 'messages:updated',
  /** push: main → renderer */
  MESSAGES_DELETED: 'messages:deleted',

  // ── Compose ────────────────────────────────────────────────────────────────
  COMPOSE_SEND: 'compose:send',
  COMPOSE_SAVE_DRAFT: 'compose:saveDraft',
  COMPOSE_UPLOAD_ATTACHMENT: 'compose:uploadAttachment',
  COMPOSE_DELETE_DRAFT: 'compose:deleteDraft',

  // ── Search ─────────────────────────────────────────────────────────────────
  SEARCH_QUERY: 'search:query',
  SEARCH_SUGGEST: 'search:suggest',

  // ── Sync ───────────────────────────────────────────────────────────────────
  SYNC_FORCE: 'sync:force',
  SYNC_GET_STATUS: 'sync:getStatus',
  SYNC_PAUSE: 'sync:pause',
  SYNC_RESUME: 'sync:resume',
  /** push: main → renderer */
  SYNC_PROGRESS: 'sync:progress',

  // ── Attachments ────────────────────────────────────────────────────────────
  ATTACHMENTS_DOWNLOAD: 'attachments:download',
  ATTACHMENTS_OPEN: 'attachments:open',
  ATTACHMENTS_SAVE_AS: 'attachments:saveAs',

  // ── Plugins ────────────────────────────────────────────────────────────────
  PLUGINS_LIST: 'plugins:list',
  PLUGINS_INSTALL: 'plugins:install',
  PLUGINS_UNINSTALL: 'plugins:uninstall',
  PLUGINS_SEND: 'plugins:send',

  // ── OS / Window ────────────────────────────────────────────────────────────
  WINDOW_SET_BADGE: 'window:setBadge',
  WINDOW_FLASH_FRAME: 'window:flashFrame',
  SHELL_OPEN_EXTERNAL: 'shell:openExternal',
  DIALOG_OPEN_FILE: 'dialog:openFile',
  DIALOG_SAVE_FILE: 'dialog:saveFile',

  // ── Settings ───────────────────────────────────────────────────────────────
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_RESET: 'settings:reset',

  // ── Auto-updater ───────────────────────────────────────────────────────────
  UPDATER_CHECK: 'updater:check',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_SKIP_VERSION: 'updater:skipVersion',
  UPDATER_GET_APP_INFO: 'updater:getAppInfo',
  /** push: main → renderer */
  UPDATER_STATUS: 'updater:status',

  // ── Verification codes ─────────────────────────────────────────────────────
  VERIFICATION_CODES_LIST: 'verificationCodes:list',
  VERIFICATION_CODES_MARK_READ: 'verificationCodes:markRead',
  VERIFICATION_CODES_DELETE: 'verificationCodes:delete',
  /** push: main → renderer — fired when a new code is detected during sync */
  VERIFICATION_CODES_NEW: 'verificationCodes:new',

  // ── Bulk operations ────────────────────────────────────────────────────────
  BULK_EXECUTE: 'bulk:execute',
  BULK_CANCEL: 'bulk:cancel',
  BULK_UNDO: 'bulk:undo',
  BULK_QUERY_IDS: 'bulk:queryIds',
  /** push: main → renderer */
  BULK_PROGRESS: 'bulk:progress',
  /** push: main → renderer */
  BULK_DONE: 'bulk:done',
  /** push: main → renderer */
  BULK_CANCELLED: 'bulk:cancelled',

  // ── Folder management (Phase 8B) ──────────────────────────────────────────
  FOLDER_EXECUTE: 'folder:execute',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
