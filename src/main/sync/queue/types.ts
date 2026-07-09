import type { SyncJobType } from '@shared/types/db'

export interface SyncJob {
  id?: number
  accountId: string
  folderId?: string
  type: SyncJobType
  priority: number
  payload?: unknown
  nextRunAt: number
}

export interface QueuedJob extends SyncJob {
  id: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'dead'
  attempts: number
  lastError?: string
  createdAt: number
}
