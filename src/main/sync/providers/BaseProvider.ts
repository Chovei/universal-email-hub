import type { IEmailProvider, OAuthTokens, BasicCredentials, ProviderFolder, SyncResult, RawMessage, Draft, PushConfig, RemoteMessageRef } from '@shared/types/provider'
import type { ProviderKind } from '@shared/constants/providers'

export abstract class BaseProvider implements IEmailProvider {
  abstract readonly kind: ProviderKind
  abstract readonly accountId: string

  abstract authenticate(): Promise<OAuthTokens | BasicCredentials>
  abstract refreshTokens(current: OAuthTokens): Promise<OAuthTokens>
  abstract revokeAccess(): Promise<void>
  abstract testConnection(): Promise<{ success: boolean; error?: string }>
  abstract listFolders(): Promise<ProviderFolder[]>
  abstract getFolder(remoteId: string): Promise<ProviderFolder>
  abstract syncFolder(folderId: string, cursor: string | null): Promise<SyncResult>
  abstract fetchMessage(remoteId: string, folderRemoteId?: string | null): Promise<RawMessage>
  abstract fetchAttachment(remoteRef: string, folderRemoteId?: string | null): Promise<Buffer>
  abstract sendMessage(draft: Draft): Promise<{ remoteId: string }>
  abstract createDraft(draft: Draft): Promise<{ remoteId: string }>
  abstract updateDraft(remoteId: string, draft: Draft): Promise<void>
  abstract deleteDraft(remoteId: string): Promise<void>
  abstract markRead(refs: RemoteMessageRef[], read: boolean): Promise<void>
  abstract star(refs: RemoteMessageRef[], starred: boolean): Promise<void>
  abstract moveMessages(refs: RemoteMessageRef[], targetFolderRemoteId: string): Promise<void>
  abstract deleteMessages(refs: RemoteMessageRef[]): Promise<void>
  abstract addLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void>
  abstract removeLabels(refs: RemoteMessageRef[], labels: string[]): Promise<void>
  abstract searchRemote(query: string, folderId?: string): Promise<RawMessage[]>
  abstract setupPush(webhookUrl?: string): Promise<PushConfig>
  abstract teardownPush(): Promise<void>
  abstract handlePushEvent(payload: unknown): Promise<SyncResult>

  protected async withRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    baseDelay = 1000
  ): Promise<T> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < retries - 1) {
          await this.sleep(baseDelay * Math.pow(2, attempt))
        }
      }
    }
    // retries <= 0 leaves lastError null; throwing null loses the stack and
    // defeats every `instanceof Error` check downstream.
    throw lastError ?? new Error('Operation failed before any attempt was made')
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
