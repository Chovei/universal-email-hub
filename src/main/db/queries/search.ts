import { getRawSqlite } from '../client'
import { parseSearchInput } from './searchQueryParser'
import type { SearchQuery, SearchResult } from '@shared/types/db'

export function indexMessage(params: {
  messageId: string
  accountId: string
  threadId: string
  subject: string
  bodyText: string
  fromAddress: string
  fromName: string | null
  toAddresses: string
}): void {
  const db = getRawSqlite()

  db.prepare(`DELETE FROM search_index WHERE message_id = ?`).run(params.messageId)

  db.prepare(`
    INSERT INTO search_index (
      message_id, account_id, thread_id,
      subject, body_text, from_address, from_name, to_addresses
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.messageId,
    params.accountId,
    params.threadId,
    params.subject,
    params.bodyText,
    params.fromAddress,
    params.fromName ?? '',
    params.toAddresses
  )
}

export function indexMessageBatch(
  items: Parameters<typeof indexMessage>[0][]
): void {
  const db = getRawSqlite()
  const deleteStmt = db.prepare(`DELETE FROM search_index WHERE message_id = ?`)
  const insertStmt = db.prepare(`
    INSERT INTO search_index (
      message_id, account_id, thread_id,
      subject, body_text, from_address, from_name, to_addresses
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const runBatch = db.transaction(() => {
    for (const item of items) {
      deleteStmt.run(item.messageId)
      insertStmt.run(
        item.messageId,
        item.accountId,
        item.threadId,
        item.subject,
        item.bodyText,
        item.fromAddress,
        item.fromName ?? '',
        item.toAddresses
      )
    }
  })

  runBatch()
}

export function removeFromIndex(messageId: string): void {
  getRawSqlite().prepare(`DELETE FROM search_index WHERE message_id = ?`).run(messageId)
}

// H6: Sentinel bytes that bracket FTS5 highlight spans.  We use U+0002/U+0003
//     (STX/ETX) because they never appear in plain-text email.  The renderer
//     HTML-escapes the whole snippet then replaces these sentinels with <mark>.
export const SNIPPET_OPEN = ''
export const SNIPPET_CLOSE = ''

export function searchMessages(payload: SearchQuery): SearchResult[] {
  const db = getRawSqlite()
  const { query, filters, limit = 50, offset = 0 } = payload

  const parsed = parseSearchInput(query)

  // Explicit UI filters win over typed operators
  const conds: string[] = []
  const condParams: unknown[] = []
  if (filters?.accountId) {
    conds.push('m.account_id = ?')
    condParams.push(filters.accountId)
  }
  if (filters?.isUnread ?? parsed.isUnread) conds.push('m.is_read = 0')
  if (filters?.hasAttachment ?? parsed.hasAttachment) conds.push('m.has_attachment = 1')
  if (filters?.isStarred ?? parsed.isStarred) conds.push('m.is_starred = 1')
  const dateFrom = filters?.dateFrom ?? parsed.dateFrom
  if (dateFrom !== undefined) {
    conds.push('m.date >= ?')
    condParams.push(dateFrom)
  }
  const dateTo = filters?.dateTo ?? parsed.dateTo
  if (dateTo !== undefined) {
    conds.push('m.date <= ?')
    condParams.push(dateTo)
  }
  if (parsed.accountEmail) {
    conds.push('m.account_id IN (SELECT id FROM accounts WHERE email LIKE ?)')
    condParams.push(`%${parsed.accountEmail}%`)
  }

  try {
    if (parsed.ftsQuery) {
      const sql = `
        SELECT
          m.id as messageId,
          m.thread_id as threadId,
          m.account_id as accountId,
          m.subject,
          snippet(search_index, 4, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '...', 32) as snippet,
          m.from_address as fromAddress,
          m.from_name as fromName,
          m.date,
          m.is_read as isRead,
          m.has_attachment as hasAttachment,
          search_index.rank as rank
        FROM search_index
        JOIN messages m ON m.id = search_index.message_id
        WHERE search_index MATCH ?
        ${conds.map((c) => `AND ${c}`).join('\n        ')}
        ORDER BY rank LIMIT ? OFFSET ?
      `
      return db.prepare(sql).all(parsed.ftsQuery, ...condParams, limit, offset) as SearchResult[]
    }

    // Operator-only query (e.g. "is:unread has:attachment") — no text to
    // MATCH, so filter the messages table directly, newest first
    if (conds.length === 0) return []
    const sql = `
      SELECT
        m.id as messageId,
        m.thread_id as threadId,
        m.account_id as accountId,
        m.subject,
        substr(COALESCE(m.body_text, ''), 1, 160) as snippet,
        m.from_address as fromAddress,
        m.from_name as fromName,
        m.date,
        m.is_read as isRead,
        m.has_attachment as hasAttachment,
        0 as rank
      FROM messages m
      WHERE ${conds.join(' AND ')}
      ORDER BY m.date DESC LIMIT ? OFFSET ?
    `
    return db.prepare(sql).all(...condParams, limit, offset) as SearchResult[]
  } catch {
    return []
  }
}

// H4: Removed OFFSET from the NOT IN loop.  With OFFSET the loop was
//     skipping un-indexed rows after each batch because NOT IN shrinks
//     while OFFSET stays fixed.  Without OFFSET, each iteration naturally
//     picks up the next batch of un-indexed rows.
export function reindexAllMessages(batchSize = 500): void {
  const db = getRawSqlite()

  const deleteStmt = db.prepare(`DELETE FROM search_index WHERE message_id = ?`)
  const insertStmt = db.prepare(`
    INSERT INTO search_index (
      message_id, account_id, thread_id,
      subject, body_text, from_address, from_name, to_addresses
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  type BatchRow = {
    messageId: string
    accountId: string
    threadId: string
    subject: string
    bodyText: string
    fromAddress: string
    fromName: string | null
    toAddresses: string
  }

  const runBatch = db.transaction((rows: BatchRow[]) => {
    for (const r of rows) {
      deleteStmt.run(r.messageId)
      insertStmt.run(
        r.messageId,
        r.accountId,
        r.threadId,
        r.subject,
        r.bodyText,
        r.fromAddress,
        r.fromName ?? '',
        (() => {
          try {
            const parsed = JSON.parse(r.toAddresses) as { address: string }[]
            return parsed.map((a) => a.address).join(' ')
          } catch {
            return r.toAddresses
          }
        })()
      )
    }
  })

  const selectStmt = db.prepare<[number], BatchRow>(`
    SELECT
      m.id         AS messageId,
      m.account_id AS accountId,
      m.thread_id  AS threadId,
      m.subject,
      COALESCE(m.body_text, '') AS bodyText,
      m.from_address AS fromAddress,
      m.from_name    AS fromName,
      m.to_addresses AS toAddresses
    FROM messages m
    WHERE m.id NOT IN (SELECT message_id FROM search_index)
    LIMIT ?
  `)

  for (;;) {
    const rows = selectStmt.all(batchSize)
    if (rows.length === 0) break
    runBatch(rows)
    if (rows.length < batchSize) break
  }
}

export function getSuggestions(partial: string, limit = 10): string[] {
  const db = getRawSqlite()
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT from_address FROM search_index
         WHERE from_address LIKE ?
         LIMIT ?`
      )
      .all(`${partial}%`, limit) as { from_address: string }[]
    return rows.map((r) => r.from_address)
  } catch {
    return []
  }
}
