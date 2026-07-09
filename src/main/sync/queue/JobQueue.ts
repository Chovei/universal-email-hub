import { getRawSqlite } from '../../db/client'
import { syncJobs } from '../../db/schema'
import type { SyncJob, QueuedJob } from './types'
import type { SyncJobType } from '@shared/types/db'

export class JobQueue {
  enqueue(job: SyncJob): number {
    const db = getRawSqlite()
    const result = db
      .prepare(
        `INSERT INTO sync_jobs (account_id, folder_id, type, priority, payload, status, attempts, next_run_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)`
      )
      .run(
        job.accountId,
        job.folderId ?? null,
        job.type,
        job.priority,
        job.payload ? JSON.stringify(job.payload) : null,
        job.nextRunAt,
        Date.now()
      )
    return result.lastInsertRowid as number
  }

  dequeueNext(limit = 5): QueuedJob[] {
    const db = getRawSqlite()
    const now = Date.now()

    const rows = db
      .prepare(
        `SELECT * FROM sync_jobs
         WHERE status = 'pending' AND next_run_at <= ?
         ORDER BY priority ASC, created_at ASC
         LIMIT ?`
      )
      .all(now, limit) as Record<string, unknown>[]

    return rows.map((r) => ({
      id: r['id'] as number,
      accountId: r['account_id'] as string,
      folderId: r['folder_id'] as string | undefined,
      type: r['type'] as SyncJobType,
      priority: r['priority'] as number,
      payload: r['payload'] ? JSON.parse(r['payload'] as string) : undefined,
      status: r['status'] as QueuedJob['status'],
      attempts: r['attempts'] as number,
      lastError: r['last_error'] as string | undefined,
      nextRunAt: r['next_run_at'] as number,
      createdAt: r['created_at'] as number,
    }))
  }

  markRunning(id: number): void {
    getRawSqlite()
      .prepare(`UPDATE sync_jobs SET status = 'running' WHERE id = ?`)
      .run(id)
  }

  markDone(id: number): void {
    getRawSqlite()
      .prepare(`UPDATE sync_jobs SET status = 'done' WHERE id = ?`)
      .run(id)
  }

  markFailed(id: number, error: string, attempts: number): void {
    const db = getRawSqlite()
    if (attempts >= 5) {
      db.prepare(
        `UPDATE sync_jobs SET status = 'dead', last_error = ?, attempts = ? WHERE id = ?`
      ).run(error, attempts, id)
    } else {
      const backoff = Math.min(Math.pow(2, attempts) * 1000, 60_000)
      db.prepare(
        `UPDATE sync_jobs SET status = 'pending', last_error = ?, attempts = ?, next_run_at = ? WHERE id = ?`
      ).run(error, attempts, Date.now() + backoff, id)
    }
  }

  clearDone(): void {
    getRawSqlite()
      .prepare(`DELETE FROM sync_jobs WHERE status IN ('done', 'dead') AND created_at < ?`)
      .run(Date.now() - 24 * 60 * 60 * 1000)
  }

  hasJobOfType(accountId: string, type: SyncJobType): boolean {
    const result = getRawSqlite()
      .prepare(
        `SELECT 1 FROM sync_jobs WHERE account_id = ? AND type = ? AND status IN ('pending', 'running') LIMIT 1`
      )
      .get(accountId, type)
    return !!result
  }
}
