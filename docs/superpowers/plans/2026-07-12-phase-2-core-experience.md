# Phase 2 — Core Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Email Hub feel instant and trustworthy with many accounts: real-time IMAP sync, visible account health, smarter verification-code detection, grouped/actionable notifications, search operators, and measured performance work.

**Architecture:** All real-time and health logic lives in the main process around the existing `SyncEngine` singleton — a new `IdleWatcher` owns one persistent IMAP connection per account and triggers the existing `runSync` path (no second sync pipeline). Pure logic (backoff, extraction scoring, search parsing) goes in dependency-free modules with unit tests, following the `imapHelpers.ts` pattern from Phase 1. Renderer changes are additive: one new IPC push channel for deep-links, one health query channel, and UI polish on touched screens.

**Tech Stack:** Electron 33, imapflow (IDLE), better-sqlite3 + Drizzle, Zustand 5, vitest.

## Global Constraints

- Never show technical errors directly to normal users (spec: convert `AUTHENTICATIONFAILED` → "Your Gmail password was rejected. Create an App Password or reconnect your account.")
- Real-time target: server receives email → detection → DB → UI → notification, near instant (spec Priority 1)
- No new runtime dependencies without justification — prefer small in-repo modules
- IPC envelope pattern: handlers return `{ data }` or `{ error: { code, message } }`, never throw
- Push events go to all windows: `BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send(...))` (or `this.win` inside SyncEngine, matching existing style)
- Every task ends with: `npx tsc --noEmit -p tsconfig.main.json && npx tsc --noEmit -p tsconfig.renderer.json && npm test`, then a commit
- Do not touch the auto-updater
- Existing `SyncStatus` consumers must keep working — extend the type with optional fields only

## File Structure

| File | Responsibility |
|---|---|
| `src/main/sync/backoff.ts` (new) | Pure exponential-backoff-with-jitter computation |
| `src/main/sync/IdleWatcher.ts` (new) | One persistent IMAP IDLE connection per account; reconnect lifecycle |
| `src/main/sync/SyncEngine.ts` (mod) | Backoff scheduling, failure tracking, IdleWatcher lifecycle, sync semaphore |
| `src/main/sync/providers/ImapProvider.ts` (mod) | Expose `makeDedicatedClient()` for the watcher |
| `src/main/sync/VerificationExtractor.ts` (mod) | Scored extraction, alphanumeric codes, false-positive guards |
| `src/main/sync/semaphore.ts` (new) | Pure counting semaphore for sync concurrency |
| `src/main/db/queries/searchQueryParser.ts` (new) | Pure search-operator parser (`has:`, `is:`, `before:`, `after:`, `account:`) |
| `src/main/db/queries/search.ts` (mod) | Merge parsed operators into SQL |
| `src/main/db/queries/verificationCodes.ts` (mod) | Duplicate-code guard |
| `src/main/db/client.ts` (mod) | New indexes in `ensureSchemaExtensions` |
| `src/main/db/schema.ts` (mod) | Same indexes declared for Drizzle |
| `src/main/notifications/NotificationService.ts` (mod) | Grouping, per-account filter, verification notify, deep-link click |
| `src/main/ipc/handlers/health.ts` (new) | `ACCOUNTS_HEALTH` query handler |
| `src/shared/types/db.ts` (mod) | `SyncStatus` extension, `AccountHealth` type |
| `src/shared/constants/ipc-channels.ts` (mod) | `ACCOUNTS_HEALTH`, `APP_NAVIGATE` |
| `src/preload/index.ts` (mod) | health + navigate bridge |
| `src/renderer/components/settings/AccountHealth.tsx` (new) | Health dashboard section |
| `src/renderer/components/layout/AppShell.tsx` (mod) | `APP_NAVIGATE` listener |
| `src/renderer/components/accounts/wizardErrors.ts` (new) | Human error mapping for the wizard |
| `src/renderer/components/accounts/AddAccountWizard.tsx` (mod) | Use wizardErrors |

---

### Task 1: Sync backoff + rich health status (foundation)

**Files:**
- Create: `src/main/sync/backoff.ts`
- Test: `src/main/sync/backoff.test.ts`
- Modify: `src/shared/types/db.ts:155-160` (SyncStatus)
- Modify: `src/main/sync/SyncEngine.ts` (worker state, scheduleNextSync, runSync)

**Interfaces:**
- Consumes: `describeSyncError(err): { message, category }` from `src/main/sync/syncErrors.ts` (exists)
- Produces: `computeBackoffMs(baseMs: number, failures: number, maxMs?: number): number`; `SyncStatus` gains optional `errorCategory?: 'auth' | 'network' | 'rate-limit' | 'unknown'`, `consecutiveFailures?: number`, `lastSyncDurationMs?: number`, `realtime?: boolean`. Task 2 sets `realtime`; Task 3 reads everything.

- [ ] **Step 1: Write failing tests** — `src/main/sync/backoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeBackoffMs } from './backoff'

describe('computeBackoffMs', () => {
  it('returns base interval when there are no failures', () => {
    expect(computeBackoffMs(60_000, 0)).toBe(60_000)
  })
  it('doubles per consecutive failure with ±10% jitter', () => {
    for (const [failures, expected] of [[1, 120_000], [2, 240_000], [3, 480_000]] as const) {
      const ms = computeBackoffMs(60_000, failures)
      expect(ms).toBeGreaterThanOrEqual(expected * 0.9)
      expect(ms).toBeLessThanOrEqual(expected * 1.1)
    }
  })
  it('caps at maxMs', () => {
    expect(computeBackoffMs(60_000, 20, 900_000)).toBeLessThanOrEqual(900_000 * 1.1)
  })
  it('caps at 15 minutes by default', () => {
    expect(computeBackoffMs(60_000, 20)).toBeLessThanOrEqual(900_000 * 1.1)
  })
})
```

- [ ] **Step 2: Run** `npm test -- backoff` — expect FAIL (module not found)
- [ ] **Step 3: Implement** `src/main/sync/backoff.ts`:

```ts
const DEFAULT_MAX_MS = 15 * 60 * 1000

/**
 * Exponential backoff with ±10% jitter. failures=0 returns baseMs unchanged
 * so the healthy path keeps the user's configured interval.
 */
export function computeBackoffMs(baseMs: number, failures: number, maxMs = DEFAULT_MAX_MS): number {
  if (failures <= 0) return baseMs
  const raw = Math.min(baseMs * Math.pow(2, failures), maxMs)
  const jitter = raw * 0.1 * (Math.random() * 2 - 1)
  return Math.round(raw + jitter)
}
```

- [ ] **Step 4: Run** `npm test -- backoff` — expect PASS
- [ ] **Step 5: Extend SyncStatus** in `src/shared/types/db.ts` (replace the interface):

```ts
export interface SyncStatus {
  state: SyncState
  progress?: number
  lastSyncAt?: number
  lastError?: string
  errorCategory?: 'auth' | 'network' | 'rate-limit' | 'unknown'
  consecutiveFailures?: number
  lastSyncDurationMs?: number
  /** true while an IMAP IDLE watcher holds a live connection for this account */
  realtime?: boolean
}
```

- [ ] **Step 6: Wire into SyncEngine** — in `src/main/sync/SyncEngine.ts`:
  - Add `consecutiveFailures: number` to `AccountWorker` (init `0` in `addAccount`)
  - Import `computeBackoffMs` from `./backoff`
  - `scheduleNextSync`: replace `worker.timer = setTimeout(..., worker.intervalMs)` with

```ts
const delay = computeBackoffMs(worker.intervalMs, worker.consecutiveFailures)
worker.timer = setTimeout(() => void this.runSync(accountId), delay)
```

  - `runSync` success path (before `worker.status = { state: 'idle', ... }`): `worker.consecutiveFailures = 0` and record duration — add `const syncStart = Date.now()` at top of `try`, then `worker.status = { state: 'idle', lastSyncAt: Date.now(), lastSyncDurationMs: Date.now() - syncStart, realtime: worker.status.realtime }`
  - `runSync` catch path:

```ts
worker.consecutiveFailures++
const { message, category } = describeSyncError(err)
worker.status = {
  state: 'error',
  lastError: message,
  errorCategory: category,
  consecutiveFailures: worker.consecutiveFailures,
  realtime: worker.status.realtime,
}
```

- [ ] **Step 7: Verify** — `npx tsc --noEmit -p tsconfig.main.json && npx tsc --noEmit -p tsconfig.renderer.json && npm test` — all pass
- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat(sync): exponential backoff with jitter + rich health status"`

---

### Task 2: IMAP IDLE — real-time sync

**Files:**
- Create: `src/main/sync/IdleWatcher.ts`
- Modify: `src/main/sync/providers/ImapProvider.ts` (add `makeDedicatedClient()`)
- Modify: `src/main/sync/SyncEngine.ts` (watcher lifecycle)

**Interfaces:**
- Consumes: `computeBackoffMs` (Task 1); `ImapFlow` events `exists`, `close`, `error`; `ImapProvider.makeDedicatedClient(): ImapFlow`
- Produces: `class IdleWatcher { constructor(accountId: string, makeClient: () => ImapFlow, onNewMail: () => void, onStateChange: (connected: boolean) => void); start(): void; stop(): void }`

**Architecture decision:** the watcher lives OUTSIDE ImapProvider. Providers are stateless per-operation (one connection per call); IDLE needs a long-lived connection with its own reconnect lifecycle. SyncEngine owns watcher lifetimes exactly like it owns workers. New mail triggers the existing `runSync` — one sync pipeline, no special cases. imapflow auto-idles when a mailbox is open and no commands run; `maxIdleTime` forces periodic IDLE restarts for servers that silently drop long connections.

- [ ] **Step 1: Expose a dedicated client factory** in `ImapProvider` (public method, after `makeTransport`):

```ts
/** A fresh connection for long-lived use (IDLE watching). Caller owns lifecycle. */
makeDedicatedClient(): ImapFlow {
  return this.makeClient()
}
```

- [ ] **Step 2: Implement** `src/main/sync/IdleWatcher.ts`:

```ts
import type { ImapFlow } from 'imapflow'
import { computeBackoffMs } from './backoff'

const RECONNECT_BASE_MS = 5_000
const RECONNECT_MAX_MS = 5 * 60 * 1000
const NEW_MAIL_DEBOUNCE_MS = 750
const MAX_IDLE_TIME_MS = 10 * 60 * 1000 // restart IDLE well under the 29-min RFC limit

/**
 * Holds one persistent IMAP connection with INBOX open in IDLE and calls
 * onNewMail when the server reports new messages. Reconnects with
 * exponential backoff on any connection loss. stop() is final.
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
      client.on('close', () => this.handleDisconnect())
      client.on('error', (err: Error) => {
        console.warn(`[IdleWatcher:${this.accountId}]`, err.message)
        this.handleDisconnect()
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
      this.handleDisconnect()
    }
  }

  private scheduleNewMail(): void {
    if (this.stopped) return
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.onNewMail(), NEW_MAIL_DEBOUNCE_MS)
  }

  private handleDisconnect(): void {
    if (this.stopped) return
    this.onStateChange(false)
    this.client = null
    this.failures++
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    const delay = computeBackoffMs(RECONNECT_BASE_MS, this.failures, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => void this.connect(), delay)
  }
}
```

Note: pass `maxIdleTime: MAX_IDLE_TIME_MS` in the ImapFlow constructor options inside `ImapProvider.makeClient` — add it there so both paths benefit: `logger: false, maxIdleTime: 10 * 60 * 1000`.

- [ ] **Step 3: Lifecycle in SyncEngine**:
  - Add `idleWatcher: IdleWatcher | null` to `AccountWorker` (init `null`)
  - In `addAccount`, after `this.workers.set(accountId, worker)`, when `provider instanceof ImapProvider`:

```ts
const watcher = new IdleWatcher(
  accountId,
  () => provider.makeDedicatedClient(),
  () => void this.runSync(accountId),
  (connected) => {
    const w = this.workers.get(accountId)
    if (!w) return
    w.status = { ...w.status, realtime: connected }
    this.broadcastStatus(accountId, w.status)
  }
)
worker.idleWatcher = watcher
watcher.start()
```

  - `removeAccount` and `shutdown`: `worker.idleWatcher?.stop()`
  - `pauseAccount`: `worker.idleWatcher?.stop()`; `resumeAccount`: `worker.idleWatcher?.start()`
- [ ] **Step 4: Verify** — typechecks + tests + `npm run build` pass
- [ ] **Step 5: Commit** — `git commit -m "feat(sync): IMAP IDLE real-time sync with auto-reconnect"`

---

### Task 3: Account health surface (IPC + Settings UI)

**Files:**
- Create: `src/main/ipc/handlers/health.ts`, `src/renderer/components/settings/AccountHealth.tsx`
- Modify: `src/shared/constants/ipc-channels.ts`, `src/shared/types/ipc.ts` (EmailAPI), `src/preload/index.ts`, `src/main/ipc/registry.ts`, `src/renderer/components/settings/SettingsPage.tsx`

**Interfaces:**
- Consumes: `SyncEngine.getAllStatus(): Record<string, SyncStatus>`; `SyncStatus` fields from Task 1/2
- Produces: `AccountHealth` type in `src/shared/types/db.ts`:

```ts
export interface AccountHealth {
  accountId: string
  email: string
  displayName: string
  provider: string
  status: SyncStatus
  messageCount: number
  unreadCount: number
}
```

- [ ] **Step 1: IPC channel** — add to ipc-channels.ts under Accounts: `ACCOUNTS_HEALTH: 'accounts:health',`
- [ ] **Step 2: Handler** `src/main/ipc/handlers/health.ts`:

```ts
import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import { SyncEngine } from '../../sync/SyncEngine'
import { getDb } from '../../db/client'
import { accounts, threads } from '../../db/schema'
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
        status: statuses[r.accountId] ?? { state: 'idle' },
      }))
      return { data }
    } catch (err) {
      return { error: { code: 'HEALTH_ERROR', message: String(err) } }
    }
  })
}
```

(`threads` import is used by the subqueries only via raw SQL — drop the unused import if tsc flags it.)

- [ ] **Step 3: Registry + preload** — call `registerHealthHandlers()` in `registerAllIpcHandlers`; add to `EmailAPI.accounts` type and preload: `health: () => invoke(IPC.ACCOUNTS_HEALTH)`
- [ ] **Step 4: UI** `src/renderer/components/settings/AccountHealth.tsx` — a Settings section listing each account as a row: colored status chip (`Connected ✓` green when idle+realtime or idle, `Syncing…` blue, `Needs reconnect` red when errorCategory auth, `Server unreachable` amber when network, `Rate limited` amber, `Paused` gray), `email`, provider label via `PROVIDER_META[provider]?.label`, "Last sync X min ago" from `lastSyncAt`, message/unread counts, and the friendly `lastError` when in error state. Refresh via `useQuery({ queryKey: ['accountHealth'], queryFn: ... , refetchInterval: 15000 })` and live-update on `ACCOUNTS_SYNC_STATUS_CHANGED` push. Mount it in SettingsPage above existing sections with heading "Account Health".
- [ ] **Step 5: Verify + commit** — `git commit -m "feat(health): account health dashboard with live status"`

---

### Task 4: Verification extractor v2 (accuracy + dedupe)

**Files:**
- Modify: `src/main/sync/VerificationExtractor.ts`
- Test: `src/main/sync/VerificationExtractor.test.ts`
- Modify: `src/main/db/queries/verificationCodes.ts` (dedupe guard), `src/main/sync/SyncEngine.ts:461-477` (use new API)

**Interfaces:**
- Produces: `extractVerification(subject: string, bodyText: string): { code: string; confidence: number } | null` (keeps `isVerificationEmail`, `detectServiceName` exports unchanged); `hasRecentDuplicate(accountId: string, code: string, receivedAt: number): boolean` in verificationCodes queries.

Detection rules (all unit-tested):
- Context pattern (`code is`, `code:`, `use code`, etc. within 40 chars of the value) → confidence 0.95
- Code in subject line with keyword subject → 0.9
- Bare 6–8 digit number in body of a keyword-matched email → 0.7
- Bare 4–5 digit number → 0.5 only if the email also matches BODY_KEYWORDS (not subject alone)
- Alphanumeric codes: `[A-Z0-9]{6,10}` containing ≥1 digit, context-gated only
- Rejections: 4-digit years 1900–2099 standalone; values immediately preceded by `order|invoice|tracking|ticket|case|ref` within 20 chars; phone-number shapes (`+`, `(`, or 9+ digits with separators); currency-adjacent values (`$`, `€`, `£` within 3 chars)
- Threshold: only store codes with confidence ≥ 0.5. Dedupe: skip insert when the same `(accountId, code)` exists within ±24 h of `receivedAt`, or the same `messageId` already produced a row.

- [ ] **Step 1: Write the failing tests** (representative set — include all):

```ts
import { describe, it, expect } from 'vitest'
import { extractVerification, isVerificationEmail } from './VerificationExtractor'

describe('extractVerification', () => {
  it('extracts context-labelled codes with high confidence', () => {
    const r = extractVerification('Your Discord verification code', 'Your code is: 482913')
    expect(r?.code).toBe('482913')
    expect(r!.confidence).toBeGreaterThanOrEqual(0.9)
  })
  it('extracts codes from the subject line', () => {
    const r = extractVerification('483920 is your Instagram code', 'Enter it to continue')
    expect(r?.code).toBe('483920')
  })
  it('extracts spaced/hyphenated 6-digit codes', () => {
    expect(extractVerification('Security code', 'Use code 123 456 to sign in')?.code).toBe('123456')
    expect(extractVerification('Security code', 'Your code: 123-456')?.code).toBe('123456')
  })
  it('extracts alphanumeric codes only with context', () => {
    expect(extractVerification('Steam Guard code', 'Your Steam Guard code is: H7K2P9')?.code).toBe('H7K2P9')
    expect(extractVerification('Newsletter', 'Meeting room B4C7X2 is booked')).toBeNull()
  })
  it('rejects years', () => {
    expect(extractVerification('Verify your account', 'Founded in 2024, we secure logins.')).toBeNull()
  })
  it('rejects order/tracking numbers', () => {
    expect(extractVerification('Order confirmation code inside', 'Your order 583920 has shipped')).toBeNull()
  })
  it('rejects currency amounts', () => {
    expect(extractVerification('Payment verification', 'You paid $4829.13 today')).toBeNull()
  })
  it('gives bare 4-digit codes low confidence and requires body keywords', () => {
    const r = extractVerification('Your PIN reminder', 'Your one-time code 4829 expires soon')
    expect(r?.code).toBe('4829')
    expect(r!.confidence).toBeLessThan(0.7)
    expect(extractVerification('Hello', 'Meet at 1430 tomorrow')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to fail**, **Step 3: Implement** the scoring extractor (keep the existing SERVICE_DOMAINS + `detectServiceName` + `isVerificationEmail` untouched; replace `extractCode` internals, export a thin `extractCode` wrapper returning `extractVerification(...)?.code ?? null` for backward compat)
- [ ] **Step 4: Dedupe guard** in `src/main/db/queries/verificationCodes.ts`:

```ts
export function hasRecentDuplicate(accountId: string, code: string, receivedAt: number, messageId: string): boolean {
  const row = getDb()
    .select({ id: verificationCodes.id })
    .from(verificationCodes)
    .where(
      or(
        eq(verificationCodes.messageId, messageId),
        and(
          eq(verificationCodes.accountId, accountId),
          eq(verificationCodes.code, code),
          gt(verificationCodes.receivedAt, receivedAt - 86_400_000),
          lt(verificationCodes.receivedAt, receivedAt + 86_400_000)
        )
      )
    )
    .get()
  return row !== undefined
}
```

- [ ] **Step 5: SyncEngine integration** — replace the `extractCode` call block with `extractVerification`; skip when `null`; call `hasRecentDuplicate(accountId, v.code, msgRow.date, msgRow.id)` before insert
- [ ] **Step 6: Verify + commit** — `git commit -m "feat(verification): scored extraction, alphanumeric codes, false-positive guards, dedupe"`

---

### Task 5: Notifications v2 (grouping, per-account, verification, deep-link)

**Files:**
- Modify: `src/main/notifications/NotificationService.ts`, `src/shared/constants/ipc-channels.ts` (`APP_NAVIGATE: 'app:navigate'`), `src/preload/index.ts` (`onNavigate`), `src/shared/types/ipc.ts`, `src/renderer/components/layout/AppShell.tsx` (listener), `src/main/sync/SyncEngine.ts` (call notifyVerificationCode)

**Interfaces:**
- Produces: `NotificationService.notifyVerificationCode(payload: { serviceName: string; code: string; accountEmail: string })`; push channel `APP_NAVIGATE` with payload `{ panel: 'inbox' | 'verification' | 'settings' | 'search' }`; preload `emailAPI.app = { onNavigate(cb) }`.

Behavior:
- `notifyNewMessages`: first filter by `settings.notifications.perAccount[accountId] !== false`; ≤3 messages → one notification each (current behavior); >3 → single grouped "N new emails" with sender preview list in body; click → focus window + `APP_NAVIGATE {panel:'inbox'}`
- `notifyVerificationCode`: title `` `${serviceName} verification code` ``, body `` `${code} — ${accountEmail}` ``, click → focus + `APP_NAVIGATE {panel:'verification'}`; respects enabled/quiet-hours/per-account like message notifications
- SyncEngine: after successful `insertVerificationCode`, call `NotificationService.getInstance().notifyVerificationCode(...)`
- AppShell: `useEffect` subscribing `window.emailAPI.app.onNavigate(({panel}) => setActivePanel(panel))`

- [ ] Steps: implement, typecheck, test, build, commit — `git commit -m "feat(notifications): grouping, per-account filtering, verification-code alerts, deep links"`

---

### Task 6: Search operators

**Files:**
- Create: `src/main/db/queries/searchQueryParser.ts`
- Test: `src/main/db/queries/searchQueryParser.test.ts`
- Modify: `src/main/db/queries/search.ts` (merge parsed filters; keep `buildFtsQuery` field mapping)

**Interfaces:**
- Produces:

```ts
export interface ParsedSearch {
  ftsQuery: string          // cleaned text + from:/to:/subject: field syntax
  hasAttachment?: boolean   // has:attachment
  isUnread?: boolean        // is:unread
  isStarred?: boolean       // is:starred
  dateFrom?: number         // after:YYYY-MM-DD (local midnight, ms)
  dateTo?: number           // before:YYYY-MM-DD (end of day, ms)
  accountEmail?: string     // account:someone@x.com
}
export function parseSearchInput(input: string): ParsedSearch
```

- `searchMessages` merges: explicit `payload.filters` win over parsed operators; `accountEmail` adds `AND m.account_id IN (SELECT id FROM accounts WHERE email LIKE ?)` with `%${accountEmail}%`
- Empty `ftsQuery` after stripping operators (e.g. input `is:unread has:attachment`) → fall back to `*`-free path: use a plain SQL query without MATCH (SELECT recent messages with the filters, ORDER BY m.date DESC)

- [ ] **Step 1: Tests** (write all; representative):

```ts
import { describe, it, expect } from 'vitest'
import { parseSearchInput } from './searchQueryParser'

describe('parseSearchInput', () => {
  it('passes plain text through', () => {
    expect(parseSearchInput('quarterly report').ftsQuery).toContain('quarterly')
  })
  it('extracts has:attachment and is:unread', () => {
    const p = parseSearchInput('invoice has:attachment is:unread')
    expect(p.hasAttachment).toBe(true)
    expect(p.isUnread).toBe(true)
    expect(p.ftsQuery).not.toContain('has:')
  })
  it('parses after:/before: into ms timestamps', () => {
    const p = parseSearchInput('after:2026-01-01 before:2026-02-01 report')
    expect(p.dateFrom).toBe(new Date(2026, 0, 1).getTime())
    expect(p.dateTo).toBe(new Date(2026, 1, 1, 23, 59, 59, 999).getTime())
  })
  it('ignores malformed dates', () => {
    expect(parseSearchInput('before:notadate x').dateTo).toBeUndefined()
  })
  it('extracts account: filter', () => {
    expect(parseSearchInput('account:klaas@gmail.com hello').accountEmail).toBe('klaas@gmail.com')
  })
  it('keeps from:/to:/subject: in the FTS query for field matching', () => {
    expect(parseSearchInput('from:github.com alerts').ftsQuery).toContain('from_address:github.com')
  })
})
```

- [ ] Implement parser, wire into `searchMessages`, verify, commit — `git commit -m "feat(search): operator syntax — has:, is:, after:, before:, account:"`

---

### Task 7: Performance — indexes + sync concurrency

**Files:**
- Create: `src/main/sync/semaphore.ts` + `src/main/sync/semaphore.test.ts`
- Modify: `src/main/db/schema.ts` (declare), `src/main/db/client.ts` `ensureSchemaExtensions` (idempotent DDL), `src/main/sync/SyncEngine.ts` (gate runSync)

Indexes (both in schema.ts and as `CREATE INDEX IF NOT EXISTS` in ensureSchemaExtensions):
- `messages_from_address_idx` ON messages (from_address) — sender queries + suggestions
- `verification_codes_message_idx` ON verification_codes (message_id) — dedupe lookups
- `verification_codes_account_code_idx` ON verification_codes (account_id, code, received_at) — dedupe window scans

Semaphore:

```ts
export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++
      return () => this.release()
    }
    return new Promise((resolve) => {
      this.queue.push(() => { this.active++; resolve(() => this.release()) })
    })
  }
  private release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}
```

Tests: limit respected (start 5 acquires with limit 2 → only 2 run until release), FIFO order, release wakes queued waiter.

SyncEngine: module-level `const syncSemaphore = new Semaphore(4)`; in `runSync`, wrap the whole body after the guard clauses:

```ts
const release = await syncSemaphore.acquire()
try { /* existing body */ } finally { release(); }
```

(The existing `worker.syncing` re-entrancy guard stays BEFORE acquire so queued duplicates are dropped, not serialized.)

- [ ] TDD steps as usual; verify; commit — `git commit -m "perf(sync): cap concurrent account syncs at 4; add hot-path indexes"`

---

### Task 8: Onboarding — human error explanations

**Files:**
- Create: `src/renderer/components/accounts/wizardErrors.ts` + `src/renderer/components/accounts/wizardErrors.test.ts`
- Modify: `src/renderer/components/accounts/AddAccountWizard.tsx` (verify-failure rendering)

**Interfaces:**
- Produces: `humanizeWizardError(providerId: string, raw: string): { title: string; hint: string }`

Mappings (tested):
- `AUTHENTICATIONFAILED` / `Invalid credentials` / `LOGIN failed` + provider gmail → title "Your Gmail sign-in was rejected", hint "Use an App Password — your normal password won't work. Create one at myaccount.google.com/apppasswords."
- Same for yahoo/icloud/aol (each names its own App Password page); generic imap → "Check your username and password. Some providers require enabling IMAP first."
- `ENOTFOUND`/`ECONNREFUSED`/`ETIMEDOUT` → "Can't reach the mail server" + "Check the server address and your internet connection."
- `certificate` / `self signed` → "Secure connection failed" + "The server's TLS certificate could not be verified."
- fallback → "Connection failed" + raw message (last resort only)

Wizard: where the verify error is rendered, show `title` prominently and `hint` as secondary text; keep raw error behind a collapsed "Technical details" disclosure.

- [ ] TDD steps; verify; commit — `git commit -m "feat(onboarding): human-readable connection errors in account wizard"`

---

## Deferred (explicitly out of Phase 2 scope, revisit in Phase 3)

- Renderer virtualization audit & bundle-size code-splitting (P6): needs profiling data from real 100-account usage first — premature without measurement
- Broad UX audit of every screen (P8): folded into the screens this plan touches (Settings health, wizard errors, verification center); a dedicated design pass deserves its own plan
- Verification Center UI overhaul (P4 UI half): copy button + history exist today; "Open email" navigation lands with the deep-link plumbing from Task 5 and can be wired in the VerificationCenter component as a small follow-up

## Self-Review

- Spec coverage: P1→Task 2 (+1 foundation), P2→Tasks 1+3, P3→Task 8, P4→Task 4 (+deferred UI note), P5→Task 5, P6→Task 7 (+deferred profiling note), P7→Task 6, P8→folded/deferred with justification. ✅
- Placeholders: none — every step names files, code, and commands. ✅
- Type consistency: `SyncStatus.realtime` (Tasks 1/2/3), `AccountHealth` (Task 3), `extractVerification` return `{ code, confidence }` (Task 4), `ParsedSearch` (Task 6), `Semaphore.acquire(): Promise<() => void>` (Task 7). ✅
