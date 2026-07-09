import type { MessageRow, ThreadRow } from './db'

// ── Plugin manifest ────────────────────────────────────────────────────────

export type PluginPermission =
  | 'read:messages'
  | 'read:accounts'
  | 'compose:inject'
  | 'sidebar:panel'
  | 'notifications:send'
  | 'network:fetch'

export type PluginHookEvent =
  | 'app:startup'
  | 'app:shutdown'
  | 'message:opened'
  | 'message:deleted'
  | 'compose:beforeSend'
  | 'compose:afterSend'
  | 'account:added'
  | 'account:removed'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  homepage?: string
  icon?: string
  entrypoint: string
  permissions: PluginPermission[]
  allowedOrigins: string[]
  hooks: PluginHookEvent[]
  minAppVersion?: string
}

// ── Plugin message filter ──────────────────────────────────────────────────

export interface PluginMessageFilter {
  accountId?: string
  folderId?: string
  limit?: number
  unreadOnly?: boolean
}

// ── Plugin message (safe, read-only subset of MessageRow) ──────────────────

export type PluginMessage = Pick<
  MessageRow,
  | 'id'
  | 'threadId'
  | 'accountId'
  | 'subject'
  | 'fromAddress'
  | 'fromName'
  | 'date'
  | 'isRead'
  | 'isStarred'
  | 'labels'
  | 'hasAttachment'
>

// ── Plugin API surface (exposed in plugin's window.pluginAPI) ──────────────

export interface PluginAPI {
  messages: {
    list(filter: PluginMessageFilter): Promise<PluginMessage[]>
    get(id: string): Promise<PluginMessage | null>
  }
  accounts: {
    list(): Promise<{ id: string; email: string; displayName: string; provider: string }[]>
  }
  ui: {
    registerSidebarPanel(opts: {
      id: string
      icon: string
      label: string
      url: string
    }): void
    registerComposerAction(opts: {
      id: string
      icon: string
      label: string
    }): void
    showToast(message: string, type?: 'info' | 'success' | 'error'): void
  }
  hooks: {
    on(event: PluginHookEvent, handler: (ctx: unknown) => void | Promise<void>): void
  }
  storage: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  fetch(url: string, opts?: RequestInit): Promise<{ status: number; body: string }>
}

// ── Bridge messages ────────────────────────────────────────────────────────

export interface PluginBridgeRequest {
  id: string
  method: string
  params: unknown[]
}

export interface PluginBridgeResponse {
  id: string
  result?: unknown
  error?: { code: string; message: string }
}

// ── Installed plugin state ─────────────────────────────────────────────────

export interface InstalledPlugin {
  manifest: PluginManifest
  installedAt: number
  isEnabled: boolean
  path: string
}
