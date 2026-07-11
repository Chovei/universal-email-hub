# Phase 8B — Folder Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users execute bulk folder operations (Empty Trash, Mark All Read, Archive All Read, etc.) from the sidebar context menu, a per-folder action bar, and a global "Manage All Accounts" panel — reusing Phase 8A's BulkActionEngine and progress/notification system throughout.

**Architecture:** A new `FOLDER_EXECUTE` IPC channel accepts `{ action, folderId?, folderType?, accountId? }` and does `queryIds + execute` atomically on the main process, avoiding large IPC data transfers; progress and completion flow through the existing `BULK_PROGRESS/BULK_DONE` push events and `BulkProgressToast` unchanged. The sidebar gains per-account `FolderTree` components (built on the existing `useFolders` hook) with right-click/⋯ context menus, and a "Manage All Accounts" section at the bottom for cross-account global actions. `FolderConfirmDialog` gates all destructive actions. Sync ("Refresh Folder", "Sync All") routes through the already-exposed `window.emailAPI.sync.force(accountId?)` — no new sync channel needed.

**Tech Stack:** Electron 33, React 19, TypeScript 5, Zustand 5, Framer Motion 11, @tanstack/react-query, better-sqlite3 + Drizzle ORM, Zod, `createPortal` for ContextMenu

## Global Constraints

- **Never duplicate bulk op logic** — all folder bulk actions go through `BulkActionEngine.execute()` + `BulkActionEngine.queryIds()`; no new batching loops
- **Progress via existing system** — `BULK_PROGRESS`/`BULK_DONE` events; `BulkProgressToast` unchanged; no new toast component
- **IPC envelope pattern** — all handlers return `{ data: T }` or `{ error: { code, message } }`, never throw
- **IPC channels** defined in `src/shared/constants/ipc-channels.ts` as `IPC.CHANNEL_NAME`
- **Push events** via `BrowserWindow.getAllWindows().forEach(w => !w.isDestroyed() && w.webContents.send(channel, payload))`
- **Preload bridge** — `invoke()` and `on()` helpers; all new folder API surface added to `EmailAPI.folders` in `src/shared/types/ipc.ts`
- **Zod validation** on all IPC handler inputs; max 500k threads per operation (inherited from BulkActionEngine)
- **Confirmation required** for `emptyTrash`, `emptySpam`, `deleteAll` before execution
- **Sync** calls existing `window.emailAPI.sync.force(accountId?)` — no new IPC channel
- **Version 0.1.15** at Phase 8B completion
- **Typecheck** (`npm run typecheck`) must show zero errors after every task

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `src/renderer/components/ui/ContextMenu.tsx` | Portal-rendered right-click / overflow menu primitive |
| `src/renderer/components/sidebar/FolderItem.tsx` | Single folder row: icon, name, unread badge, ⋯ menu |
| `src/renderer/components/sidebar/FolderTree.tsx` | Per-account sorted folder list using `useFolders` |
| `src/renderer/components/folder/FolderConfirmDialog.tsx` | Full-screen modal for destructive action confirmation |
| `src/renderer/components/folder/FolderActionBar.tsx` | Inline action toolbar above thread list for selected folder |
| `src/renderer/hooks/useFolderActions.ts` | Encapsulates confirmation state + `FOLDER_EXECUTE` calls |
| `src/main/ipc/handlers/folder-actions.ts` | IPC handlers for `FOLDER_EXECUTE` |

### Modified files
| File | What changes |
|------|--------------|
| `src/shared/constants/ipc-channels.ts` | Add `FOLDER_EXECUTE` |
| `src/shared/types/ipc.ts` | Add `FolderAction`, `FolderExecuteRequest`; extend `EmailAPI.folders` |
| `src/preload/index.ts` | Wire `folders.execute` |
| `src/main/ipc/registry.ts` | Register `registerFolderActionHandlers()` |
| `src/renderer/stores/mailboxStore.ts` | Add `selectedFolderId`, `selectedFolderAccountId`, `setFolder` |
| `src/renderer/components/layout/Sidebar.tsx` | Add `FolderTree` per account + "Manage All" section |
| `src/renderer/components/layout/AppShell.tsx` | Mount `FolderConfirmDialog`, pass `onFolderAction` down |
| `src/renderer/components/mailbox/ThreadList.tsx` | Use `folderId` in `useMessages`; mount `FolderActionBar` |

---

## Task 1 — Shared IPC surface: FOLDER_EXECUTE channel + types + preload bridge

**Files:**
- Modify: `src/shared/constants/ipc-channels.ts`
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces: `IPC.FOLDER_EXECUTE`, `FolderAction`, `FolderExecuteRequest`, `window.emailAPI.folders.execute(req)`

---

- [ ] **Step 1: Add FOLDER_EXECUTE to ipc-channels.ts**

Open `src/shared/constants/ipc-channels.ts`. After the `// ── Bulk operations` block, add:

```typescript
  // ── Folder management (Phase 8B) ──────────────────────────────────────────
  FOLDER_EXECUTE: 'folder:execute',
```

- [ ] **Step 2: Add FolderAction and FolderExecuteRequest to ipc.ts**

Open `src/shared/types/ipc.ts`. After the `BulkQueryCriteria` interface (end of the bulk section), add:

```typescript
// ── Folder management (Phase 8B) ──────────────────────────────────────────

/**
 * High-level folder operation. Maps to a BulkAction + BulkQueryCriteria pair
 * on the main process — the renderer never handles the thread IDs directly.
 */
export type FolderAction =
  | 'emptyTrash'      // delete all in trash
  | 'emptySpam'       // delete all in spam
  | 'markAllRead'     // markRead all unread in folder
  | 'markAllUnread'   // markUnread all in folder
  | 'archiveAllRead'  // archive all read messages in folder
  | 'deleteAll'       // move all to trash (custom folders only)

export interface FolderExecuteRequest {
  operationId?: string
  action: FolderAction
  /** Local DB folder id — use when acting on a specific folder row */
  folderId?: string
  /** Folder type — use for cross-account type operations (e.g. 'trash') */
  folderType?: string
  /** Omit to affect all accounts */
  accountId?: string
}
```

- [ ] **Step 3: Extend EmailAPI.folders in ipc.ts**

Find the `folders` block inside the `EmailAPI` interface and replace it with:

```typescript
  // Folders
  folders: {
    list(accountId: string): Promise<FolderRow[]>
    execute(req: FolderExecuteRequest): Promise<{ operationId: string } | { error: IpcError }>
    onUnreadChanged(cb: (payload: UnreadChangedPayload) => void): () => void
  }
```

- [ ] **Step 4: Wire folders.execute in preload/index.ts**

Find the `folders:` block in `src/preload/index.ts` and replace it:

```typescript
  folders: {
    list: (accountId) => invoke(IPC.FOLDERS_LIST, accountId),
    execute: (req) => invoke(IPC.FOLDER_EXECUTE, req),
    onUnreadChanged: (cb) => on(IPC.FOLDERS_UNREAD_CHANGED, cb as (...args: unknown[]) => void),
  },
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/constants/ipc-channels.ts src/shared/types/ipc.ts src/preload/index.ts
git commit -m "feat(folders): add FOLDER_EXECUTE IPC channel, FolderAction types, and preload bridge"
```

---

## Task 2 — mailboxStore: add selectedFolderId + setFolder action

**Files:**
- Modify: `src/renderer/stores/mailboxStore.ts`

**Interfaces:**
- Produces: `selectedFolderId: string | null`, `selectedFolderAccountId: string | null`, `setFolder(folderId, accountId, folderType?)`, updated `setFolderType` that clears folder selection

---

- [ ] **Step 1: Replace mailboxStore.ts entirely**

```typescript
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

type ViewMode = 'unified' | 'per-account'
type SortOrder = 'date-desc' | 'date-asc'
export type FolderFilter = 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'archive' | 'starred' | 'all'

interface MailboxStore {
  selectedThreadId: string | null
  selectedMessageId: string | null
  selectedFolderType: FolderFilter
  /** Set when the user navigates to a specific per-account folder row */
  selectedFolderId: string | null
  /** Account the selected folder belongs to */
  selectedFolderAccountId: string | null
  viewMode: ViewMode
  sortOrder: SortOrder
  cursor: string | null
  isThreadPanelOpen: boolean

  selectThread: (threadId: string | null) => void
  selectMessage: (messageId: string | null) => void
  setFolderType: (type: FolderFilter) => void
  /** Navigate to a specific folder row (per-account). Clears selectedThreadId. */
  setFolder: (folderId: string, accountId: string, folderType?: FolderFilter) => void
  setViewMode: (mode: ViewMode) => void
  setSortOrder: (order: SortOrder) => void
  setCursor: (cursor: string | null) => void
  openThreadPanel: () => void
  closeThreadPanel: () => void
}

export const useMailboxStore = create<MailboxStore>()(
  subscribeWithSelector((set) => ({
    selectedThreadId: null,
    selectedMessageId: null,
    selectedFolderType: 'inbox',
    selectedFolderId: null,
    selectedFolderAccountId: null,
    viewMode: 'unified',
    sortOrder: 'date-desc',
    cursor: null,
    isThreadPanelOpen: false,

    selectThread: (threadId) =>
      set({ selectedThreadId: threadId, selectedMessageId: null, isThreadPanelOpen: !!threadId }),

    selectMessage: (messageId) => set({ selectedMessageId: messageId }),

    setFolderType: (type) =>
      set({
        selectedFolderType: type,
        selectedFolderId: null,
        selectedFolderAccountId: null,
        selectedThreadId: null,
        cursor: null,
      }),

    setFolder: (folderId, accountId, folderType = 'custom') =>
      set({
        selectedFolderId: folderId,
        selectedFolderAccountId: accountId,
        selectedFolderType: folderType,
        selectedThreadId: null,
        cursor: null,
      }),

    setViewMode: (mode) => set({ viewMode: mode }),

    setSortOrder: (order) => set({ sortOrder: order, cursor: null }),

    setCursor: (cursor) => set({ cursor }),

    openThreadPanel: () => set({ isThreadPanelOpen: true }),

    closeThreadPanel: () => set({ isThreadPanelOpen: false, selectedThreadId: null }),
  }))
)
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

Expected: zero errors. (`FolderFilter` is now exported, which existing callers can import if needed.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/stores/mailboxStore.ts
git commit -m "feat(folders): add selectedFolderId + setFolder to mailboxStore"
```

---

## Task 3 — Folder action IPC handler (main process)

**Files:**
- Create: `src/main/ipc/handlers/folder-actions.ts`
- Modify: `src/main/ipc/registry.ts`

**Interfaces:**
- Consumes: `BulkActionEngine.getInstance()`, `IPC.FOLDER_EXECUTE`, `BulkQueryCriteria`, `FolderAction`, `BulkAction`
- Produces: `registerFolderActionHandlers()` — registers `ipcMain.handle(IPC.FOLDER_EXECUTE, ...)`

---

- [ ] **Step 1: Create src/main/ipc/handlers/folder-actions.ts**

```typescript
import { ipcMain, BrowserWindow } from 'electron'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/constants/ipc-channels'
import { BulkActionEngine } from '../../bulk/BulkActionEngine'
import type { BulkAction, BulkQueryCriteria, FolderAction, FolderExecuteRequest } from '@shared/types/ipc'

const FolderActionSchema = z.enum([
  'emptyTrash', 'emptySpam',
  'markAllRead', 'markAllUnread',
  'archiveAllRead', 'deleteAll',
])

const FolderExecuteSchema = z.object({
  operationId: z.string().uuid().optional(),
  action: FolderActionSchema,
  folderId: z.string().optional(),
  folderType: z.string().optional(),
  accountId: z.string().optional(),
})

/** Map a FolderAction to the BulkQueryCriteria and BulkAction to hand to the engine. */
function mapFolderAction(
  req: FolderExecuteRequest,
): { criteria: BulkQueryCriteria; bulkAction: BulkAction } {
  const base: BulkQueryCriteria = {
    accountId: req.accountId,
    folderId: req.folderId,
    folderType: req.folderType,
  }

  switch (req.action) {
    case 'emptyTrash':
      // Cross-account: clear folderType override from base, use 'trash'
      return { criteria: { accountId: req.accountId, folderType: 'trash' }, bulkAction: 'delete' }
    case 'emptySpam':
      return { criteria: { accountId: req.accountId, folderType: 'spam' }, bulkAction: 'delete' }
    case 'markAllRead':
      return { criteria: { ...base, unreadOnly: true }, bulkAction: 'markRead' }
    case 'markAllUnread':
      return { criteria: base, bulkAction: 'markUnread' }
    case 'archiveAllRead':
      return { criteria: { ...base, readOnly: true }, bulkAction: 'archive' }
    case 'deleteAll':
      return { criteria: base, bulkAction: 'delete' }
  }
}

export function registerFolderActionHandlers(): void {
  const engine = BulkActionEngine.getInstance()

  ipcMain.handle(IPC.FOLDER_EXECUTE, async (_event, payload: unknown) => {
    try {
      const parsed = FolderExecuteSchema.parse(payload)
      const req = parsed as FolderExecuteRequest
      const operationId = req.operationId ?? randomUUID()

      const { criteria, bulkAction } = mapFolderAction(req)
      const threadIds = engine.queryIds(criteria)

      if (threadIds.length === 0) {
        // Nothing to do — push an immediate "done with 0" so the renderer
        // gets a terminal event and knows the folder is already empty.
        const result = {
          operationId,
          action: bulkAction,
          succeeded: 0,
          failed: 0,
          errors: [] as string[],
        }
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send(IPC.BULK_DONE, result)
        })
        return { data: { operationId } }
      }

      engine.execute({ operationId, action: bulkAction, threadIds }).catch((err: unknown) => {
        const failResult = {
          operationId,
          action: bulkAction,
          succeeded: 0,
          failed: threadIds.length,
          errors: [String(err)],
        }
        BrowserWindow.getAllWindows().forEach((w) => {
          if (!w.isDestroyed()) w.webContents.send(IPC.BULK_DONE, failResult)
        })
      })

      return { data: { operationId } }
    } catch (err) {
      return { error: { code: 'FOLDER_EXECUTE_FAILED', message: String(err) } }
    }
  })
}
```

- [ ] **Step 2: Register in src/main/ipc/registry.ts**

Open `src/main/ipc/registry.ts`. Add:

```typescript
import { registerFolderActionHandlers } from './handlers/folder-actions'
```

Inside `registerAllIpcHandlers()`, add:

```typescript
  registerFolderActionHandlers()
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers/folder-actions.ts src/main/ipc/registry.ts
git commit -m "feat(folders): register FOLDER_EXECUTE IPC handler — queryIds + execute on main process"
```

---

## Task 4 — ContextMenu primitive

**Files:**
- Create: `src/renderer/components/ui/ContextMenu.tsx`

**Interfaces:**
- Produces: `<ContextMenu x y groups onClose />`, `ContextMenuItem`, `ContextMenuGroup`
- Consumes: Framer Motion, `createPortal`, `cn` from `../../lib/utils`

---

- [ ] **Step 1: Create src/renderer/components/ui/ContextMenu.tsx**

```typescript
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}

export interface ContextMenuGroup {
  items: ContextMenuItem[]
}

interface ContextMenuProps {
  x: number
  y: number
  groups: ContextMenuGroup[]
  onClose: () => void
}

export function ContextMenu({ x, y, groups, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Adjust position so menu never overflows the viewport
  const adjustedX = Math.min(x, window.innerWidth - 208)
  const adjustedY = Math.min(y, window.innerHeight - 48 * groups.flatMap((g) => g.items).length)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
    }
  }, [onClose])

  return createPortal(
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.1, ease: 'easeOut' }}
      style={{ position: 'fixed', left: adjustedX, top: adjustedY, zIndex: 9999 }}
      className="min-w-52 rounded-xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-2xl py-1.5 overflow-hidden"
    >
      {groups.map((group, gi) => (
        <div key={gi}>
          {gi > 0 && <div className="my-1 border-t border-[var(--color-border)]" />}
          {group.items.map((item, ii) => (
            <button
              key={ii}
              disabled={item.disabled}
              onClick={() => { item.onClick(); onClose() }}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors',
                item.destructive
                  ? 'text-red-500 hover:bg-red-500/10'
                  : 'text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
                item.disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
              )}
            >
              {item.icon && <span className="shrink-0 opacity-70">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </motion.div>,
    document.body,
  )
}
```

- [ ] **Step 2: Typecheck**

```
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ui/ContextMenu.tsx
git commit -m "feat(folders): add ContextMenu primitive — portal-rendered, click-outside + Esc to close"
```

---

## Task 5 — FolderItem + FolderTree sidebar components

**Files:**
- Create: `src/renderer/components/sidebar/FolderItem.tsx`
- Create: `src/renderer/components/sidebar/FolderTree.tsx`

**Interfaces:**
- Consumes: `ContextMenu`, `useFolders`, `useMailboxStore.setFolder`, `FolderRow` from `@shared/types/db`, `FolderAction` from `@shared/types/ipc`
- Produces: `<FolderItem folder isSelected onSelect onAction />`, `<FolderTree accountId onFolderAction />`

---

- [ ] **Step 1: Create src/renderer/components/sidebar/FolderItem.tsx**

```typescript
import { useState, useCallback } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  Inbox, Send, FileText, Trash2, Archive, AlertTriangle,
  Folder, MoreHorizontal, MailOpen, Mail,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { ContextMenu } from '../ui/ContextMenu'
import type { ContextMenuGroup } from '../ui/ContextMenu'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

const FOLDER_ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox className="w-3.5 h-3.5" />,
  sent: <Send className="w-3.5 h-3.5" />,
  drafts: <FileText className="w-3.5 h-3.5" />,
  trash: <Trash2 className="w-3.5 h-3.5" />,
  archive: <Archive className="w-3.5 h-3.5" />,
  spam: <AlertTriangle className="w-3.5 h-3.5" />,
  custom: <Folder className="w-3.5 h-3.5" />,
}

interface FolderItemProps {
  folder: FolderRow
  isSelected: boolean
  onSelect: () => void
  onAction: (action: FolderAction, folder: FolderRow) => void
}

export function FolderItem({ folder, isSelected, onSelect, onAction }: FolderItemProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const openMenu = useCallback((x: number, y: number) => setMenu({ x, y }), [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => { e.preventDefault(); openMenu(e.clientX, e.clientY) },
    [openMenu],
  )

  const handleMoreClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openMenu(rect.right + 4, rect.top)
    },
    [openMenu],
  )

  const groups = buildMenuGroups(folder, (action) => onAction(action, folder))

  return (
    <>
      <button
        onContextMenu={handleContextMenu}
        onClick={onSelect}
        className={cn(
          'group w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm transition-colors',
          isSelected
            ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
            : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
        )}
      >
        <span className="shrink-0 opacity-60">
          {FOLDER_ICONS[folder.type] ?? FOLDER_ICONS.custom}
        </span>
        <span className="flex-1 truncate text-left text-[13px]">{folder.name}</span>
        {folder.unreadCount > 0 && (
          <span className="text-[10px] font-semibold text-[var(--color-primary)] shrink-0 mr-1">
            {folder.unreadCount > 999 ? '999+' : folder.unreadCount}
          </span>
        )}
        <button
          onClick={handleMoreClick}
          className="opacity-0 group-hover:opacity-60 hover:!opacity-100 p-0.5 rounded hover:bg-[var(--color-border)] transition-opacity shrink-0"
          aria-label={`Actions for ${folder.name}`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </button>

      <AnimatePresence>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            groups={groups}
            onClose={() => setMenu(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

function buildMenuGroups(
  folder: FolderRow,
  onAction: (action: FolderAction) => void,
): ContextMenuGroup[] {
  const syncItem = {
    label: 'Sync Folder',
    icon: null,
    onClick: () => onAction('markAllRead'), // replaced by sync in FolderTree.onAction
  }

  if (folder.type === 'trash') {
    return [
      {
        items: [
          {
            label: 'Empty Trash',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => onAction('emptyTrash'),
          },
        ],
      },
    ]
  }

  if (folder.type === 'spam') {
    return [
      {
        items: [
          {
            label: 'Empty Spam',
            icon: <AlertTriangle className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => onAction('emptySpam'),
          },
        ],
      },
    ]
  }

  const readActions: ContextMenuGroup = {
    items: [
      {
        label: 'Mark All Read',
        icon: <MailOpen className="w-3.5 h-3.5" />,
        onClick: () => onAction('markAllRead'),
      },
      {
        label: 'Mark All Unread',
        icon: <Mail className="w-3.5 h-3.5" />,
        onClick: () => onAction('markAllUnread'),
      },
    ],
  }

  if (folder.type === 'inbox' || folder.type === 'archive') {
    return [
      readActions,
      {
        items: [
          {
            label: 'Archive All Read',
            icon: <Archive className="w-3.5 h-3.5" />,
            onClick: () => onAction('archiveAllRead'),
          },
        ],
      },
    ]
  }

  if (folder.type === 'custom') {
    return [
      readActions,
      {
        items: [
          {
            label: 'Archive All Read',
            icon: <Archive className="w-3.5 h-3.5" />,
            onClick: () => onAction('archiveAllRead'),
          },
          {
            label: 'Delete All',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => onAction('deleteAll'),
          },
        ],
      },
    ]
  }

  // sent, drafts — just read actions
  return [readActions]
}
```

**Important:** `buildMenuGroups` uses `'markAllRead'` as a placeholder for the sync action — this is replaced in the `onAction` handler in **Task 6** (the parent `FolderTree` intercepts `'sync'` and calls `sync.force` directly). To avoid confusion, add a separate sync entry only for folder types that make sense. Alternatively — keep the context menu clean by NOT adding a "Sync Folder" entry here and handling sync via the FolderActionBar instead.

> **Note to implementer:** Remove the `syncItem` variable above — it is unused. The context menu intentionally omits "Sync" (sync happens from the FolderActionBar above the thread list). Do not add dead code.

- [ ] **Step 2: Create src/renderer/components/sidebar/FolderTree.tsx**

```typescript
import { useFolders } from '../../hooks/useFolders'
import { FolderItem } from './FolderItem'
import { useMailboxStore } from '../../stores/mailboxStore'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

const FOLDER_TYPE_ORDER: Record<string, number> = {
  inbox: 0,
  sent: 1,
  drafts: 2,
  archive: 3,
  spam: 4,
  trash: 5,
  custom: 6,
}

interface FolderTreeProps {
  accountId: string
  onFolderAction: (action: FolderAction, folder: FolderRow) => void
}

export function FolderTree({ accountId, onFolderAction }: FolderTreeProps) {
  const { folders, isLoading } = useFolders(accountId)
  const { selectedFolderId, setFolder } = useMailboxStore()

  if (isLoading || folders.length === 0) return null

  const sorted = [...folders].sort(
    (a, b) => (FOLDER_TYPE_ORDER[a.type] ?? 99) - (FOLDER_TYPE_ORDER[b.type] ?? 99),
  )

  return (
    <div className="mt-0.5 space-y-0.5 pl-3 pr-1">
      {sorted.map((f) => (
        <FolderItem
          key={f.id}
          folder={f}
          isSelected={selectedFolderId === f.id}
          onSelect={() => setFolder(f.id, accountId, f.type as Parameters<typeof setFolder>[2])}
          onAction={onFolderAction}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/sidebar/FolderItem.tsx src/renderer/components/sidebar/FolderTree.tsx
git commit -m "feat(folders): add FolderItem (context menu) and FolderTree (per-account folder list)"
```

---

## Task 6 — Sidebar: per-account folder trees + "Manage All Accounts" section

**Files:**
- Modify: `src/renderer/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `FolderTree`, `FolderRow`, `FolderAction`
- New prop: `onFolderAction: (action: FolderAction, folder?: FolderRow, accountId?: string) => void`

The `onFolderAction` signature handles both per-folder actions (folder is set) and global "Manage All" actions (folder and accountId are undefined).

---

- [ ] **Step 1: Add imports to Sidebar.tsx**

Add to the existing imports:

```typescript
import { FolderTree } from '../sidebar/FolderTree'
import { RefreshCw, MailOpen, Archive, Trash2 as Trash, AlertTriangle as Spam } from 'lucide-react'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'
```

(Import only the icons not already imported. Check the existing import list first and add only missing ones.)

- [ ] **Step 2: Add onFolderAction prop to Sidebar**

Change the `SidebarProps` interface (or add it if not yet defined):

```typescript
interface SidebarProps {
  onAddAccount?: () => void
  onFolderAction: (action: FolderAction, folder?: FolderRow, accountId?: string) => void
}
```

Update the function signature:

```typescript
export function Sidebar({ onAddAccount, onFolderAction }: SidebarProps) {
```

- [ ] **Step 3: Add per-account FolderTree after each AccountItem**

Find the block inside `{!collapsed && groupAccounts.map((account) => (...))}` and add `FolderTree` below each `AccountItem`:

```tsx
{!collapsed && groupAccounts.map((account) => (
  <div key={account.id}>
    <AccountItem
      account={account}
      isActive={activeAccountId === account.id}
      onClick={() => {
        setActiveAccount(account.id)
        setActivePanel('inbox')
        setFolderType('inbox')
      }}
    />
    {activeAccountId === account.id && (
      <FolderTree
        accountId={account.id}
        onFolderAction={(action, folder) => onFolderAction(action, folder, account.id)}
      />
    )}
  </div>
))}
```

- [ ] **Step 4: Add "Manage All Accounts" section**

Inside the scrollable `flex-1` area, at the very bottom (just before the closing `</div>` of the scrollable section), add:

```tsx
{/* Manage All Accounts */}
<div className="h-px bg-[var(--color-sidebar-border)] my-2" />
<div className="px-1">
  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
    Manage All
  </p>
  {[
    {
      label: 'Mark Everything Read',
      icon: <MailOpen className="w-3.5 h-3.5" />,
      action: 'markAllRead' as FolderAction,
    },
    {
      label: 'Archive All Read',
      icon: <Archive className="w-3.5 h-3.5" />,
      action: 'archiveAllRead' as FolderAction,
    },
    {
      label: 'Empty All Trash',
      icon: <Trash className="w-3.5 h-3.5" />,
      action: 'emptyTrash' as FolderAction,
    },
    {
      label: 'Empty All Spam',
      icon: <Spam className="w-3.5 h-3.5" />,
      action: 'emptySpam' as FolderAction,
    },
    {
      label: 'Refresh All Accounts',
      icon: <RefreshCw className="w-3.5 h-3.5" />,
      action: null, // handled as sync, not folder execute
    },
  ].map(({ label, icon, action }) => (
    <button
      key={label}
      onClick={() => {
        if (action === null) {
          void window.emailAPI.sync.force()
        } else {
          onFolderAction(action, undefined, undefined)
        }
      }}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
    >
      <span className="shrink-0 opacity-60">{icon}</span>
      {label}
    </button>
  ))}
</div>
```

- [ ] **Step 5: Typecheck**

```
npm run typecheck
```

Expected: zero errors. Fix any import-not-found errors for icons by checking which icons are already imported.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/layout/Sidebar.tsx
git commit -m "feat(folders): add per-account FolderTree and Manage All section to Sidebar"
```

---

## Task 7 — useFolderActions hook + FolderConfirmDialog

**Files:**
- Create: `src/renderer/hooks/useFolderActions.ts`
- Create: `src/renderer/components/folder/FolderConfirmDialog.tsx`

**Interfaces:**
- Produces:
  - `useFolderActions()` → `{ requestAction, confirm, cancel, pending }`
  - `<FolderConfirmDialog pending onConfirm onCancel />`
- Consumes: `FolderExecuteRequest`, `FolderAction`, `FolderRow`

---

- [ ] **Step 1: Create src/renderer/hooks/useFolderActions.ts**

```typescript
import { useState, useCallback } from 'react'
import type { FolderAction, FolderExecuteRequest } from '@shared/types/ipc'
import type { FolderRow } from '@shared/types/db'

const DESTRUCTIVE: Set<FolderAction> = new Set(['emptyTrash', 'emptySpam', 'deleteAll'])

/** Folder type implied by a cross-account global action (no specific folder selected). */
const GLOBAL_FOLDER_TYPE: Partial<Record<FolderAction, string>> = {
  emptyTrash: 'trash',
  emptySpam: 'spam',
}

export interface PendingFolderAction {
  request: FolderExecuteRequest
  folder?: FolderRow
}

export function useFolderActions() {
  const [pending, setPending] = useState<PendingFolderAction | null>(null)

  const requestAction = useCallback(
    (action: FolderAction, folder?: FolderRow, accountId?: string) => {
      const req: FolderExecuteRequest = {
        action,
        folderId: folder?.id,
        // For global actions (no folder), use the implicit folder type
        folderType: folder ? undefined : GLOBAL_FOLDER_TYPE[action],
        accountId: accountId ?? folder?.accountId,
      }

      if (DESTRUCTIVE.has(action)) {
        setPending({ request: req, folder })
      } else {
        void window.emailAPI.folders.execute(req)
      }
    },
    [],
  )

  const confirm = useCallback(async () => {
    if (!pending) return
    await window.emailAPI.folders.execute(pending.request)
    setPending(null)
  }, [pending])

  const cancel = useCallback(() => setPending(null), [])

  return { requestAction, confirm, cancel, pending }
}
```

- [ ] **Step 2: Create src/renderer/components/folder/FolderConfirmDialog.tsx**

```typescript
import { motion } from 'framer-motion'
import type { FolderRow } from '@shared/types/db'
import type { PendingFolderAction } from '../../hooks/useFolderActions'

const ACTION_COPY: Record<string, { title: string; verb: string }> = {
  emptyTrash: { title: 'Empty Trash', verb: 'permanently delete' },
  emptySpam: { title: 'Empty Spam', verb: 'permanently delete' },
  deleteAll: { title: 'Delete All Emails', verb: 'move to Trash' },
}

interface FolderConfirmDialogProps {
  pending: PendingFolderAction
  onConfirm: () => void
  onCancel: () => void
}

export function FolderConfirmDialog({ pending, onConfirm, onCancel }: FolderConfirmDialogProps) {
  const { request, folder } = pending
  const copy = ACTION_COPY[request.action]
  if (!copy) return null

  const count = folder?.totalCount ?? 0
  const storageEstimateMB = count > 0 ? Math.round((count * 75_000) / (1024 * 1024)) : 0
  const isGlobal = !folder
  const scope = isGlobal ? 'all accounts' : folder.name

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-80 rounded-2xl bg-[var(--color-background)] border border-[var(--color-border)] shadow-2xl p-5 space-y-4"
      >
        {/* Header */}
        <div>
          <h2 className="font-semibold text-base text-[var(--color-foreground)]">{copy.title}</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{scope}</p>
        </div>

        {/* Details */}
        <div className="space-y-1.5 text-sm text-[var(--color-foreground)]">
          {count > 0 ? (
            <p>
              This will {copy.verb}{' '}
              <span className="font-semibold">{count.toLocaleString()} email{count !== 1 ? 's' : ''}</span>.
              {isGlobal && ' This affects all connected accounts.'}
            </p>
          ) : (
            <p>
              This will {copy.verb} all emails
              {isGlobal ? ' across all connected accounts' : ` in ${folder?.name ?? 'this folder'}`}.
            </p>
          )}
          {storageEstimateMB > 0 && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Estimated storage recovered: ~{storageEstimateMB} MB
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-sm font-medium bg-[var(--color-muted)] text-[var(--color-foreground)] hover:bg-[var(--color-border)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            Continue
          </button>
        </div>
      </motion.div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/useFolderActions.ts src/renderer/components/folder/FolderConfirmDialog.tsx
git commit -m "feat(folders): add useFolderActions hook and FolderConfirmDialog"
```

---

## Task 8 — FolderActionBar + ThreadList integration

**Files:**
- Create: `src/renderer/components/folder/FolderActionBar.tsx`
- Modify: `src/renderer/components/mailbox/ThreadList.tsx`

**Interfaces:**
- Produces: `<FolderActionBar folder onAction onSync isSyncing />`
- ThreadList now reads `selectedFolderId` + `selectedFolderAccountId` from mailboxStore, passes `folderId` to `useMessages`, renders `FolderActionBar` above the list when a specific folder is selected
- New prop on ThreadList: `onFolderAction: (action: FolderAction, folder: FolderRow) => void`

---

- [ ] **Step 1: Create src/renderer/components/folder/FolderActionBar.tsx**

```typescript
import { useState, useCallback } from 'react'
import {
  Trash2, AlertTriangle, MailOpen, Mail, Archive, RefreshCw,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'

interface ActionDef {
  action: FolderAction
  label: string
  icon: React.ReactNode
  destructive?: boolean
}

function getActions(folder: FolderRow): ActionDef[] {
  if (folder.type === 'trash') {
    return [{ action: 'emptyTrash', label: 'Empty Trash', icon: <Trash2 className="w-3.5 h-3.5" />, destructive: true }]
  }
  if (folder.type === 'spam') {
    return [{ action: 'emptySpam', label: 'Empty Spam', icon: <AlertTriangle className="w-3.5 h-3.5" />, destructive: true }]
  }
  const base: ActionDef[] = [
    { action: 'markAllRead', label: 'Mark All Read', icon: <MailOpen className="w-3.5 h-3.5" /> },
    { action: 'archiveAllRead', label: 'Archive All Read', icon: <Archive className="w-3.5 h-3.5" /> },
  ]
  if (folder.type === 'custom') {
    base.push({ action: 'deleteAll', label: 'Delete All', icon: <Trash2 className="w-3.5 h-3.5" />, destructive: true })
  }
  return base
}

interface FolderActionBarProps {
  folder: FolderRow
  onAction: (action: FolderAction) => void
  onSync: () => void
}

export function FolderActionBar({ folder, onAction, onSync }: FolderActionBarProps) {
  const [isSyncing, setIsSyncing] = useState(false)

  const handleSync = useCallback(async () => {
    setIsSyncing(true)
    onSync()
    setTimeout(() => setIsSyncing(false), 2000) // visual feedback for 2s
  }, [onSync])

  const actions = getActions(folder)

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-background)] shrink-0">
      {/* Folder info */}
      <div className="flex-1 min-w-0">
        <span className="text-xs text-[var(--color-muted-foreground)] truncate">
          {folder.totalCount.toLocaleString()} total
          {folder.unreadCount > 0 && ` · ${folder.unreadCount.toLocaleString()} unread`}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        {actions.map((a) => (
          <button
            key={a.action}
            onClick={() => onAction(a.action)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap',
              a.destructive
                ? 'text-red-500 hover:bg-red-500/10'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)]',
            )}
          >
            {a.icon}
            {a.label}
          </button>
        ))}

        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

        <button
          onClick={handleSync}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-muted)] transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', isSyncing && 'animate-spin')} />
          Sync
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Modify ThreadList.tsx**

Open `src/renderer/components/mailbox/ThreadList.tsx`.

**2a. Add imports:**

```typescript
import { FolderActionBar } from '../folder/FolderActionBar'
import { useFolders } from '../../hooks/useFolders'
import type { FolderRow } from '@shared/types/db'
import type { FolderAction } from '@shared/types/ipc'
```

**2b. Add new prop to ThreadListProps interface:**

```typescript
interface ThreadListProps {
  className?: string
  onFolderAction: (action: FolderAction, folder: FolderRow) => void
}
```

**2c. Inside the ThreadList function, after the existing store reads, add:**

```typescript
const { selectedFolderId, selectedFolderAccountId } = useMailboxStore()
const { folders } = useFolders(selectedFolderAccountId)
const currentFolder = selectedFolderId
  ? folders.find((f) => f.id === selectedFolderId) ?? null
  : null
```

**2d. Update the useMessages call** to pass `folderId` when a specific folder is selected:

Find the existing `useMessages({ ... })` call and replace it with:

```typescript
const { threads, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useMessages({
  accountId: selectedFolderId ? selectedFolderAccountId ?? undefined : singleAccountId ?? undefined,
  folderId: selectedFolderId ?? undefined,
  folderType: selectedFolderId ? undefined : (isStarred ? undefined : selectedFolderType),
  starredOnly: !selectedFolderId && isStarred ? true : undefined,
  limit: 50,
})
```

**2e. In the return JSX**, add `FolderActionBar` between the `ThreadListHeader` and the thread list. Find the outermost `<div className={cn('flex flex-col h-full ...`)}>` and, after `<ThreadListHeader .../>`, add:

```tsx
{currentFolder && (
  <FolderActionBar
    folder={currentFolder}
    onAction={(action) => props.onFolderAction(action, currentFolder)}
    onSync={() => {
      if (selectedFolderAccountId) {
        void window.emailAPI.sync.force(selectedFolderAccountId)
      }
    }}
  />
)}
```

(Note: rename the parameter `{ className, onFolderAction }` in the function signature and use `onFolderAction` directly — avoid shadowing `props`.)

**2f. Update ThreadListHeader** to show the folder name when a specific folder is selected. Find `ThreadListHeader` component and update its `folderLabel` derivation:

```typescript
// In ThreadListHeader, add folder prop:
function ThreadListHeader({
  threadCount,
  isLoading,
  folder,
}: {
  threadCount: number
  isLoading: boolean
  folder?: FolderRow | null
}) {
  const { selectedFolderType } = useMailboxStore()
  const selectedCount = useSelectionStore(selectSelectedCount)
  const folderLabel = folder?.name
    ?? (selectedFolderType.charAt(0).toUpperCase() + selectedFolderType.slice(1))

  // ... rest unchanged
}
```

Pass `folder={currentFolder}` from ThreadList's JSX when calling `<ThreadListHeader>`.

- [ ] **Step 3: Typecheck**

```
npm run typecheck
```

Expected: zero errors. The `useMessages` payload change is safe because `ListMessagesPayload` already has `folderId?: string`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/folder/FolderActionBar.tsx src/renderer/components/mailbox/ThreadList.tsx
git commit -m "feat(folders): add FolderActionBar and wire selectedFolderId into ThreadList"
```

---

## Task 9 — AppShell wiring: FolderConfirmDialog + prop threading

**Files:**
- Modify: `src/renderer/components/layout/AppShell.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `useFolderActions`, `FolderConfirmDialog`, new Sidebar/ThreadList props
- Produces: fully functional folder management end-to-end

---

- [ ] **Step 1: Add imports to AppShell.tsx**

```typescript
import { AnimatePresence } from 'framer-motion'
import { useFolderActions } from '../../hooks/useFolderActions'
import { FolderConfirmDialog } from '../folder/FolderConfirmDialog'
```

(Check which of these are already imported and add only the missing ones.)

- [ ] **Step 2: Wire useFolderActions inside AppShell()**

Inside the `AppShell` function body, add:

```typescript
const { requestAction, confirm, cancel, pending } = useFolderActions()
```

- [ ] **Step 3: Pass onFolderAction to Sidebar**

Find `<Sidebar .../>` in the JSX and add the prop:

```tsx
<Sidebar
  onAddAccount={...}
  onFolderAction={requestAction}
/>
```

- [ ] **Step 4: Pass onFolderAction to the component rendering ThreadList**

Find where `<ThreadList .../>` is rendered (likely inside the main content area or a router). Add the prop:

```tsx
<ThreadList
  className={...}
  onFolderAction={requestAction}
/>
```

- [ ] **Step 5: Mount FolderConfirmDialog**

Inside the root `<div>` (just before the closing tag, after any other modals like BulkProgressToast), add:

```tsx
<AnimatePresence>
  {pending && (
    <FolderConfirmDialog
      pending={pending}
      onConfirm={() => void confirm()}
      onCancel={cancel}
    />
  )}
</AnimatePresence>
```

- [ ] **Step 6: Bump version to 0.1.15**

```bash
node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); p.version='0.1.15'; fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
```

- [ ] **Step 7: Typecheck**

```
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 8: Run app and verify all acceptance criteria**

```
npm run dev
```

Walk through each criterion:

- [ ] **Empty Trash works** — click an account folder tree → Trash → click "Empty Trash" in FolderActionBar → confirm dialog appears with count → click Continue → BulkProgressToast shows progress → Trash is empty
- [ ] **Empty Spam works** — same flow for Spam folder
- [ ] **Mark All Read works** — navigate to any folder → click "Mark All Read" → threads become read, unread badge disappears immediately after BULK_DONE
- [ ] **Archive All Read works** — navigate to Inbox → "Archive All Read" → read threads disappear from inbox view
- [ ] **Folder counts update immediately** — after any operation, folder unread/total badges in sidebar update (via FOLDERS_UNREAD_CHANGED events + queryClient invalidation)
- [ ] **Sidebar updates correctly** — FolderTree shows per-account folders; unread counts shown; selected folder highlighted
- [ ] **Progress reporting works** — BulkProgressToast appears with progress bar and cancellation for large operations
- [ ] **Existing functionality unchanged** — unified inbox, thread reading, Phase 8A bulk selection all still work; no regressions

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/layout/AppShell.tsx package.json
git commit -m "feat(folders): wire FolderConfirmDialog + onFolderAction in AppShell — Phase 8B complete"
```

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Empty Trash | T3 handler (emptyTrash→delete+queryIds), T8 FolderActionBar, T7 confirm dialog |
| Empty Spam | T3 handler (emptySpam→delete+queryIds), same UI path |
| Mark All Read | T3 handler (markAllRead→markRead+unreadOnly), T8 FolderActionBar |
| Mark All Unread | T3 handler, FolderItem context menu (T5) |
| Archive All Read | T3 handler (archiveAllRead→archive+readOnly), T8 FolderActionBar |
| Delete All (custom folders) | T3 handler (deleteAll→delete), T5 context menu, T7 confirm |
| Refresh Folder | T8 FolderActionBar "Sync" button → `window.emailAPI.sync.force(accountId)` |
| Sync Folder | Same as Refresh Folder |
| Sync All Accounts | T6 Sidebar "Refresh All" → `window.emailAPI.sync.force()` (no accountId) |
| Confirmation dialogs for destructive actions | T7 FolderConfirmDialog |
| Show progress | Existing BulkProgressToast — no new component needed |
| Cancellation | Existing BulkActionBar cancel — no change needed |
| Success/error notifications | Existing BulkProgressToast |
| Never freeze the UI | engine.execute fire-and-forget (T3) |
| Per-account per-folder context menu | T5 FolderItem, T6 Sidebar FolderTree |
| Global "Manage All" section | T6 Sidebar bottom section |
| Folder info (total, unread) | T8 FolderActionBar subtitle + T8 ThreadListHeader folder name |
| Sidebar updates after operations | FOLDERS_UNREAD_CHANGED + queryClient invalidation (existing, verified) |
| 100 accounts / millions of emails | BulkActionEngine batching (inherited from Phase 8A) |
| Version 0.1.15 | T9 |

**Items not in this plan (intentional scope limit):**
- Estimated storage in the sidebar folder list (only shown in FolderConfirmDialog and FolderActionBar; not shown as a column)
- Last sync time display (folder.updatedAt exists but a "X minutes ago" formatter is a nice-to-have, not a spec deliverable)
- Per-folder subscription toggle for IMAP (Phase 8C)
- Folder create / rename / delete (Phase 8C)
- "Mark All Unread" disabled state for providers that don't support it (Phase 8C — currently shows for all, may no-op on provider sync; documented limitation)
