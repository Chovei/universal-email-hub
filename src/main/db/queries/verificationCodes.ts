import { getRawSqlite } from '../client'
import { monotonicFactory } from 'ulid'
import type { VerificationCodeRow } from '@shared/types/db'

const ulid = monotonicFactory()

export interface InsertVerificationCodeData {
  accountId: string
  messageId: string
  serviceName: string
  senderEmail: string
  senderName: string | null
  code: string
  subject: string
  receivedAt: number
}

function mapRow(r: Record<string, unknown>): VerificationCodeRow {
  return {
    id: r.id as string,
    accountId: r.accountId as string,
    messageId: r.messageId as string,
    serviceName: r.serviceName as string,
    senderEmail: r.senderEmail as string,
    senderName: (r.senderName as string | null) ?? null,
    code: r.code as string,
    subject: r.subject as string,
    receivedAt: r.receivedAt as number,
    isRead: Boolean(r.isRead),
  }
}

const SELECT_COLS = `
  id,
  account_id    AS accountId,
  message_id    AS messageId,
  service_name  AS serviceName,
  sender_email  AS senderEmail,
  sender_name   AS senderName,
  code,
  subject,
  received_at   AS receivedAt,
  is_read       AS isRead
`

export function insertVerificationCode(data: InsertVerificationCodeData): VerificationCodeRow {
  const db = getRawSqlite()
  const id = ulid()
  db
    .prepare(
      `INSERT INTO verification_codes
        (id, account_id, message_id, service_name, sender_email, sender_name, code, subject, received_at, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    )
    .run(
      id,
      data.accountId,
      data.messageId,
      data.serviceName,
      data.senderEmail,
      data.senderName,
      data.code,
      data.subject,
      data.receivedAt
    )

  return mapRow({ ...data, id, isRead: 0 })
}

export function listVerificationCodes(limit = 100): VerificationCodeRow[] {
  const db = getRawSqlite()
  const rows = db
    .prepare(`SELECT ${SELECT_COLS} FROM verification_codes ORDER BY received_at DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[]
  return rows.map(mapRow)
}

export function markVerificationCodesRead(ids: string[]): void {
  if (ids.length === 0) return
  const db = getRawSqlite()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE verification_codes SET is_read = 1 WHERE id IN (${placeholders})`).run(...ids)
}

export function deleteVerificationCodes(ids: string[]): void {
  if (ids.length === 0) return
  const db = getRawSqlite()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`DELETE FROM verification_codes WHERE id IN (${placeholders})`).run(...ids)
}

export function countUnreadVerificationCodes(): number {
  const db = getRawSqlite()
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM verification_codes WHERE is_read = 0')
    .get() as { n: number }
  return row.n
}
