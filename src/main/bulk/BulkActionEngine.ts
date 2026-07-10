import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/constants/ipc-channels'
import type {
  BulkAction, BulkRequest, BulkProgress, BulkResult, BulkQueryCriteria,
} from '@shared/types/ipc'
import { getDb } from '../db/client'
import { threads, messages, folders } from '../db/schema'
import { eq, and, inArray, lt, gt } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  markMessagesRead,
  starMessages,
  moveMessages,
  deleteMessages,
  getMessagesByThreadIds,
  type MessageSummary,
} from '../db/queries/messages'
import { getFolderByType } from '../db/queries/folders'
import { updateThreadStar } from '../db/queries/threads'

const DB_BATCH_SIZE = 500
const UNDO_LIMIT = 10_000
const UNDO_TTL_MS = 30_000

interface UndoRecord {
  action: BulkAction
  threadIds: string[]
  previousFolderIds: Record<string, string>   // messageId → folderId
  previousReadState: Record<string, boolean>   // messageId → isRead
  previousStarState: Record<string, boolean>   // threadId → isStarred
  expiresAt: number
}

const REVERSIBLE: BulkAction[] = ['archive', 'move', 'markRead', 'markUnread', 'star', 'unstar']

export class BulkActionEngine {
  private static _instance: BulkActionEngine | null = null

  static getInstance(): BulkActionEngine {
    if (!this._instance) this._instance = new BulkActionEngine()
    return this._instance
  }

  private abortControllers = new Map<string, AbortController>()
  private undoRecords = new Map<string, UndoRecord>()

  // Accumulated during execute() across all batches, used to build undo record
  private pendingUndo: Omit<UndoRecord, 'expiresAt'> | null = null

  private push(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload)
    }
  }

  async execute(req: BulkRequest): Promise<BulkResult> {
    const { operationId, action, threadIds } = req
    const ac = new AbortController()
    this.abortControllers.set(operationId, ac)
    this.pendingUndo = null

    if (REVERSIBLE.includes(action) && threadIds.length <= UNDO_LIMIT) {
      this.pendingUndo = {
        action, threadIds: [],
        previousFolderIds: {}, previousReadState: {}, previousStarState: {},
      }
    }

    const result: BulkResult = { operationId, action, succeeded: 0, failed: 0, errors: [] }
    const batches: string[][] = []
    for (let i = 0; i < threadIds.length; i += DB_BATCH_SIZE) {
      batches.push(threadIds.slice(i, i + DB_BATCH_SIZE))
    }

    const startTime = Date.now()
    let completed = 0

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      if (ac.signal.aborted) {
        this.push(IPC.BULK_CANCELLED, { operationId, completed, remaining: threadIds.length - completed })
        this.abortControllers.delete(operationId)
        this.pendingUndo = null
        return result
      }

      const batch = batches[batchIdx]!
      try {
        this.executeBatch(action, batch, req.options ?? {})
        completed += batch.length
        result.succeeded += batch.length
      } catch (err) {
        result.failed += batch.length
        if (result.errors.length < 20) result.errors.push(err instanceof Error ? err.message : String(err))
      }

      const elapsed = (Date.now() - startTime) / 1000 || 0.001
      const rate = completed / elapsed
      const remaining = threadIds.length - completed
      const eta = rate > 0 ? Math.round(remaining / rate) : 0

      const progress: BulkProgress = {
        operationId, action,
        total: threadIds.length, completed, failed: result.failed,
        percentage: Math.round((completed / threadIds.length) * 100),
        currentBatch: batchIdx + 1,
        estimatedSecondsRemaining: eta,
        errors: result.errors,
      }
      this.push(IPC.BULK_PROGRESS, progress)

      // Yield to keep main process responsive between batches
      await new Promise<void>((resolve) => setImmediate(resolve))
    }

    // Store undo record
    if (this.pendingUndo) {
      const token = randomUUID()
      this.undoRecords.set(token, { ...this.pendingUndo, expiresAt: Date.now() + UNDO_TTL_MS })
      setTimeout(() => this.undoRecords.delete(token), UNDO_TTL_MS)
      result.undoToken = token
      this.pendingUndo = null
    }

    this.push(IPC.BULK_DONE, result)
    this.abortControllers.delete(operationId)
    return result
  }

  private executeBatch(
    action: BulkAction,
    threadIds: string[],
    options: NonNullable<BulkRequest['options']>,
  ): void {
    const msgs = getMessagesByThreadIds(threadIds)
    const messageIds = msgs.map((m) => m.id)

    switch (action) {
      case 'markRead':
      case 'markUnread': {
        const read = action === 'markRead'
        if (this.pendingUndo) {
          for (const m of msgs) this.pendingUndo.previousReadState[m.id] = m.isRead
          this.pendingUndo.threadIds.push(...threadIds)
        }
        markMessagesRead(messageIds, read)
        break
      }

      case 'star':
      case 'unstar': {
        const starred = action === 'star'
        if (this.pendingUndo) {
          for (const id of threadIds) this.pendingUndo.previousStarState[id] = !starred
          this.pendingUndo.threadIds.push(...threadIds)
        }
        starMessages(messageIds, starred)
        for (const id of threadIds) updateThreadStar(id, starred)
        break
      }

      case 'archive': {
        const byAccount = this.groupByAccount(msgs)
        if (this.pendingUndo) {
          for (const m of msgs) {
            if (m.folderId) this.pendingUndo.previousFolderIds[m.id] = m.folderId
          }
          this.pendingUndo.threadIds.push(...threadIds)
        }
        for (const [accountId, accountMsgs] of byAccount) {
          const archiveFolder = getFolderByType(accountId, 'archive')
          if (archiveFolder) {
            moveMessages(accountMsgs.map((m) => m.id), archiveFolder.id)
          } else {
            markMessagesRead(accountMsgs.map((m) => m.id), true)
          }
        }
        break
      }

      case 'delete': {
        const byAccount = this.groupByAccount(msgs)
        for (const [accountId, accountMsgs] of byAccount) {
          const trashFolder = getFolderByType(accountId, 'trash')
          if (trashFolder) {
            moveMessages(accountMsgs.map((m) => m.id), trashFolder.id)
          } else {
            deleteMessages(accountMsgs.map((m) => m.id))
          }
        }
        break
      }

      case 'move': {
        if (!options.targetFolderId) throw new Error('targetFolderId is required for move')
        if (this.pendingUndo) {
          for (const m of msgs) {
            if (m.folderId) this.pendingUndo.previousFolderIds[m.id] = m.folderId
          }
          this.pendingUndo.threadIds.push(...threadIds)
        }
        moveMessages(messageIds, options.targetFolderId)
        break
      }

      case 'spam': {
        const byAccount = this.groupByAccount(msgs)
        for (const [accountId, accountMsgs] of byAccount) {
          const spamFolder = getFolderByType(accountId, 'spam')
          if (spamFolder) moveMessages(accountMsgs.map((m) => m.id), spamFolder.id)
        }
        break
      }

      case 'notSpam': {
        const byAccount = this.groupByAccount(msgs)
        for (const [accountId, accountMsgs] of byAccount) {
          const inboxFolder = getFolderByType(accountId, 'inbox')
          if (inboxFolder) moveMessages(accountMsgs.map((m) => m.id), inboxFolder.id)
        }
        break
      }

      case 'export':
      case 'copy':
        // Implemented in Task 10
        break
    }
  }

  private groupByAccount(msgs: MessageSummary[]): Map<string, MessageSummary[]> {
    const map = new Map<string, MessageSummary[]>()
    for (const m of msgs) {
      const list = map.get(m.accountId) ?? []
      list.push(m)
      map.set(m.accountId, list)
    }
    return map
  }

  cancel(operationId: string): void {
    this.abortControllers.get(operationId)?.abort()
  }

  async undo(undoToken: string): Promise<void> {
    const record = this.undoRecords.get(undoToken)
    if (!record || Date.now() > record.expiresAt) return
    this.undoRecords.delete(undoToken)

    const { action, previousFolderIds, previousReadState, previousStarState, threadIds } = record

    if (action === 'markRead' || action === 'markUnread') {
      const byState = new Map<boolean, string[]>()
      for (const [id, wasRead] of Object.entries(previousReadState)) {
        const list = byState.get(wasRead) ?? []
        list.push(id)
        byState.set(wasRead, list)
      }
      for (const [wasRead, ids] of byState) markMessagesRead(ids, wasRead)
    }

    if (action === 'archive' || action === 'move') {
      const byFolder = new Map<string, string[]>()
      for (const [msgId, folderId] of Object.entries(previousFolderIds)) {
        const list = byFolder.get(folderId) ?? []
        list.push(msgId)
        byFolder.set(folderId, list)
      }
      for (const [folderId, ids] of byFolder) moveMessages(ids, folderId)
    }

    if (action === 'star') {
      const msgs = getMessagesByThreadIds(threadIds)
      starMessages(msgs.map((m) => m.id), false)
      for (const id of threadIds) updateThreadStar(id, false)
    }

    if (action === 'unstar') {
      const msgs = getMessagesByThreadIds(threadIds)
      starMessages(msgs.map((m) => m.id), true)
      for (const id of threadIds) updateThreadStar(id, true)
    }
  }

  queryIds(criteria: BulkQueryCriteria): string[] {
    const db = getDb()
    const conditions: SQL[] = []
    const now = Date.now()

    if (criteria.accountId) conditions.push(eq(threads.accountId, criteria.accountId))
    if (criteria.unreadOnly) conditions.push(gt(threads.unreadCount, 0))
    if (criteria.readOnly) conditions.push(eq(threads.unreadCount, 0))
    if (criteria.starredOnly) conditions.push(eq(threads.isStarred, true))
    if (criteria.olderThanDays) {
      conditions.push(lt(threads.lastMessageAt, now - criteria.olderThanDays * 86_400_000))
    }
    if (criteria.newerThanDays) {
      conditions.push(gt(threads.lastMessageAt, now - criteria.newerThanDays * 86_400_000))
    }

    // Criteria that require a join go through a subquery on messages
    const msgConditions: SQL[] = []
    if (criteria.folderId) msgConditions.push(eq(messages.folderId, criteria.folderId))
    if (criteria.hasAttachment) msgConditions.push(eq(messages.hasAttachment, true))
    if (criteria.fromAddress) msgConditions.push(eq(messages.fromAddress, criteria.fromAddress))
    if (criteria.folderType) {
      const folderSub = db
        .select({ id: folders.id })
        .from(folders)
        .where(eq(folders.type, criteria.folderType))
      msgConditions.push(inArray(messages.folderId, folderSub))
    }
    if (msgConditions.length > 0) {
      const sub = db
        .select({ id: messages.threadId })
        .from(messages)
        .where(and(...msgConditions))
      conditions.push(inArray(threads.id, sub))
    }

    const rows = db
      .select({ id: threads.id })
      .from(threads)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all()

    return rows.map((r) => r.id)
  }
}
