import type { ImapFlow } from 'imapflow'
import { computeBackoffMs } from './backoff'

const RECONNECT_BASE_MS = 5_000
const RECONNECT_MAX_MS = 5 * 60 * 1000
const NEW_MAIL_DEBOUNCE_MS = 750

/**
 * Holds one persistent IMAP connection with INBOX open in IDLE and calls
 * onNewMail when the server reports new messages. Reconnects with
 * exponential backoff on any connection loss. stop() is final until the
 * next start().
 *
 * Lives outside ImapProvider on purpose: providers are stateless
 * per-operation (one connection per call), while IDLE needs a long-lived
 * connection with its own reconnect lifecycle. SyncEngine owns watcher
 * lifetimes exactly like it owns workers.
 */
export class IdleWatcher {
  private client: ImapFlow | null = null
  private stopped = false
  private failures = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly accountId: string,
    private readonly makeClient: () => ImapFlow,
    private readonly onNewMail: () => void,
    private readonly onStateChange: (connected: boolean) => void
  ) {}

  start(): void {
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.reconnectTimer = null
    this.debounceTimer = null
    const c = this.client
    this.client = null
    if (c) void c.logout().catch(() => c.close())
    this.onStateChange(false)
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    try {
      const client = this.makeClient()
      this.client = client

      client.on('exists', () => this.scheduleNewMail())
      client.on('close', () => this.handleDisconnect(client))
      client.on('error', (err: Error) => {
        console.warn(`[IdleWatcher:${this.accountId}]`, err.message)
        this.handleDisconnect(client)
      })

      await client.connect()
      await client.mailboxOpen('INBOX')
      this.failures = 0
      this.onStateChange(true)
      // imapflow auto-idles from here; 'exists' fires on new mail
    } catch (err) {
      console.warn(
        `[IdleWatcher:${this.accountId}] connect failed:`,
        err instanceof Error ? err.message : err
      )
      this.handleDisconnect(this.client)
    }
  }

  private scheduleNewMail(): void {
    if (this.stopped) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.onNewMail(), NEW_MAIL_DEBOUNCE_MS)
  }

  /**
   * `source` guards against stale events: after a reconnect, close/error
   * events from the previous client must not tear down the new connection.
   */
  private handleDisconnect(source: ImapFlow | null): void {
    if (this.stopped) return
    if (source !== null && source !== this.client) return
    this.onStateChange(false)
    this.client = null
    this.failures++
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    const delay = computeBackoffMs(RECONNECT_BASE_MS, this.failures, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }
}
