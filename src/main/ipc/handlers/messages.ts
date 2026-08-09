import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron'
import { IPC } from '@shared/constants/ipc-channels'
import {
  ListMessagesSchema,
  MarkReadSchema,
  StarSchema,
  MoveSchema,
  DeleteSchema,
  LabelSchema,
  ArchiveSchema,
} from '../validator'
import {
  getMessageById,
  getMessagesByThread,
  getAttachmentsByMessage,
  markMessagesRead,
  starMessages,
  moveMessages,
  deleteMessages,
  addMessageLabel,
  removeMessageLabel,
} from '../../db/queries/messages'
import { listThreads, getThreadById } from '../../db/queries/threads'
import { getFolderByType } from '../../db/queries/folders'
import { SyncEngine } from '../../sync/SyncEngine'
import { buildRemoteRefs } from '../../sync/remoteRefs'
import type { GetThreadResult, ListMessagesResult } from '@shared/types/ipc'
import type { ThreadRow, MessageRow, AttachmentRow } from '@shared/types/db'
import type { RemoteMessageRef } from '@shared/types/provider'

function toThreadRow(t: ReturnType<typeof listThreads>[0]): ThreadRow {
  return {
    id: t.id,
    accountId: t.accountId,
    remoteId: t.remoteId ?? null,
    subject: t.subject,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt,
    unreadCount: t.unreadCount,
    messageCount: t.messageCount,
    isStarred: Boolean(t.isStarred),
    labels: JSON.parse(t.labels) as string[],
    participantAddresses: JSON.parse(t.participantAddresses) as ThreadRow['participantAddresses'],
    hasAttachment: Boolean(t.hasAttachment),
  }
}

function toMessageRow(m: ReturnType<typeof getMessagesByThread>[0]): MessageRow {
  return {
    id: m.id,
    threadId: m.threadId,
    accountId: m.accountId,
    folderId: m.folderId ?? null,
    remoteId: m.remoteId,
    fromAddress: m.fromAddress,
    fromName: m.fromName ?? null,
    toAddresses: JSON.parse(m.toAddresses) as MessageRow['toAddresses'],
    ccAddresses: JSON.parse(m.ccAddresses) as MessageRow['ccAddresses'],
    bccAddresses: JSON.parse(m.bccAddresses) as MessageRow['bccAddresses'],
    replyToAddresses: JSON.parse(m.replyToAddresses) as MessageRow['replyToAddresses'],
    subject: m.subject,
    bodyHtml: m.bodyHtml ?? null,
    bodyText: m.bodyText ?? null,
    date: m.date,
    isRead: Boolean(m.isRead),
    isStarred: Boolean(m.isStarred),
    isDraft: Boolean(m.isDraft),
    hasAttachment: Boolean(m.hasAttachment),
    labels: JSON.parse(m.labels) as string[],
    headers: JSON.parse(m.headers) as Record<string, string>,
    sizeBytes: m.sizeBytes ?? null,
    fetchedAt: m.fetchedAt,
  }
}

function toAttachmentRow(a: ReturnType<typeof getAttachmentsByMessage>[0]): AttachmentRow {
  return {
    id: a.id,
    messageId: a.messageId,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    remoteRef: a.remoteRef,
    localPath: a.localPath ?? null,
    isDownloaded: Boolean(a.isDownloaded),
    isInline: Boolean(a.isInline),
    contentId: a.contentId ?? null,
  }
}

function propagateToProvider(
  messageIds: string[],
  action: (engine: SyncEngine, accountId: string, refs: RemoteMessageRef[]) => void
): void {
  const engine = SyncEngine.getInstance()
  const byAccount = new Map<string, Array<{ remoteId: string; folderId: string | null }>>()
  for (const id of messageIds) {
    const msg = getMessageById(id)
    if (!msg) continue
    const existing = byAccount.get(msg.accountId) ?? []
    existing.push({ remoteId: msg.remoteId, folderId: msg.folderId ?? null })
    byAccount.set(msg.accountId, existing)
  }
  for (const [accountId, msgs] of byAccount) {
    action(engine, accountId, buildRemoteRefs(msgs))
  }
}

export function registerMessageHandlers(): void {
  ipcMain.handle(IPC.MESSAGES_LIST, async (_event, payload: unknown) => {
    try {
      const parsed = ListMessagesSchema.parse(payload)
      const cursor = parsed.cursor ? parseInt(parsed.cursor, 10) : undefined

      const rows = listThreads({
        accountId: parsed.accountId,
        folderId: parsed.folderId,
        folderType: parsed.folderType,
        cursor,
        limit: parsed.limit,
        unreadOnly: parsed.unreadOnly,
        starredOnly: parsed.starredOnly,
      })

      const threads = rows.map(toThreadRow)
      const lastThread = threads[threads.length - 1]
      const nextCursor = rows.length === parsed.limit && lastThread
        ? String(lastThread.lastMessageAt)
        : null

      const result: ListMessagesResult = {
        threads,
        cursor: nextCursor,
        hasMore: rows.length === parsed.limit,
      }

      return { data: result }
    } catch (err) {
      return { error: { code: 'LIST_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_GET_THREAD, async (_event, threadId: string) => {
    try {
      const thread = getThreadById(threadId)
      if (!thread) {
        return { error: { code: 'NOT_FOUND', message: 'Thread not found' } }
      }

      const msgs = getMessagesByThread(threadId)
      const messagesWithAttachments = msgs.map((m) => ({
        ...toMessageRow(m),
        attachments: getAttachmentsByMessage(m.id).map(toAttachmentRow),
      }))

      const result: GetThreadResult = {
        thread: toThreadRow(thread),
        messages: messagesWithAttachments,
      }

      return { data: result }
    } catch (err) {
      return { error: { code: 'THREAD_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_GET, async (_event, messageId: unknown) => {
    try {
      if (typeof messageId !== 'string' || messageId.length === 0 || messageId.length > 200) {
        return { error: { code: 'INVALID_ID', message: 'Invalid message id' } }
      }
      const msg = getMessageById(messageId)
      if (!msg) return { error: { code: 'NOT_FOUND', message: 'Message not found' } }
      return { data: toMessageRow(msg) }
    } catch (err) {
      return { error: { code: 'GET_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_MARK_READ, async (_event, payload: unknown) => {
    try {
      const { messageIds, read } = MarkReadSchema.parse(payload)
      markMessagesRead(messageIds, read)
      propagateToProvider(messageIds, (engine, accountId, refs) =>
        void engine.markMessagesRead(accountId, refs, read)
      )
      return { data: null }
    } catch (err) {
      return { error: { code: 'MARK_READ_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_STAR, async (_event, payload: unknown) => {
    try {
      const { messageIds, starred } = StarSchema.parse(payload)
      starMessages(messageIds, starred)
      propagateToProvider(messageIds, (engine, accountId, refs) =>
        void engine.starMessages(accountId, refs, starred)
      )
      return { data: null }
    } catch (err) {
      return { error: { code: 'STAR_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_MOVE, async (_event, payload: unknown) => {
    try {
      const { messageIds, targetFolderId } = MoveSchema.parse(payload)
      // Propagate BEFORE the local move — refs must carry the folder the
      // messages currently occupy on the server, not the target folder
      const { getFolderById } = await import('../../db/queries/folders')
      const targetFolder = getFolderById(targetFolderId)
      if (targetFolder) {
        propagateToProvider(messageIds, (engine, accountId, refs) =>
          void engine.moveMessages(accountId, refs, targetFolder.remoteId)
        )
      }
      moveMessages(messageIds, targetFolderId)
      return { data: null }
    } catch (err) {
      return { error: { code: 'MOVE_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_DELETE, async (_event, payload: unknown) => {
    try {
      const { messageIds } = DeleteSchema.parse(payload)
      propagateToProvider(messageIds, (engine, accountId, refs) =>
        void engine.deleteRemoteMessages(accountId, refs)
      )
      deleteMessages(messageIds)
      return { data: null }
    } catch (err) {
      return { error: { code: 'DELETE_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_ADD_LABEL, async (_event, payload: unknown) => {
    try {
      const { messageIds, label } = LabelSchema.parse(payload)
      addMessageLabel(messageIds, label)
      return { data: null }
    } catch (err) {
      return { error: { code: 'LABEL_ERROR', message: String(err) } }
    }
  })

  ipcMain.handle(IPC.MESSAGES_REMOVE_LABEL, async (_event, payload: unknown) => {
    try {
      const { messageIds, label } = LabelSchema.parse(payload)
      removeMessageLabel(messageIds, label)
      return { data: null }
    } catch (err) {
      return { error: { code: 'LABEL_ERROR', message: String(err) } }
    }
  })

  // H7: Zod validation added; H7/M7: removed wrong fallback to 'sent' folder
  ipcMain.handle(IPC.MESSAGES_ARCHIVE, async (_event, payload: unknown) => {
    try {
      const messageIds = ArchiveSchema.parse(payload)
      const engine = SyncEngine.getInstance()
      const byAccount = new Map<
        string,
        { localIds: string[]; msgs: Array<{ remoteId: string; folderId: string | null }> }
      >()
      for (const id of messageIds) {
        const msg = getMessageById(id)
        if (!msg) continue
        const entry = byAccount.get(msg.accountId) ?? { localIds: [], msgs: [] }
        entry.localIds.push(msg.id)
        entry.msgs.push({ remoteId: msg.remoteId, folderId: msg.folderId ?? null })
        byAccount.set(msg.accountId, entry)
      }
      for (const [accountId, { localIds, msgs }] of byAccount) {
        const archiveFolder = getFolderByType(accountId, 'archive')
        if (archiveFolder) {
          // Build refs BEFORE the local move — refs must carry the folder the
          // messages are currently in on the server, not the target folder
          const refs = buildRemoteRefs(msgs)
          moveMessages(localIds, archiveFolder.id)
          void engine.moveMessages(accountId, refs, archiveFolder.remoteId)
        }
      }
      return { data: null }
    } catch (err) {
      return { error: { code: 'ARCHIVE_ERROR', message: String(err) } }
    }
  })
}

export function broadcastNewMessages(win: BrowserWindow, payload: object): void {
  win.webContents.send(IPC.MESSAGES_NEW, payload)
}

export function broadcastUpdatedMessages(win: BrowserWindow, payload: object): void {
  win.webContents.send(IPC.MESSAGES_UPDATED, payload)
}

export function broadcastDeletedMessages(win: BrowserWindow, messageIds: string[]): void {
  win.webContents.send(IPC.MESSAGES_DELETED, messageIds)
}
