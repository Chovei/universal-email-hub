import sanitizeHtml from 'sanitize-html'
import type { RawMessage } from '@shared/types/provider'
import type { ThreadRow, MessageRow } from '@shared/types/db'
import { monotonicFactory } from 'ulid'

const EMAIL_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'html', 'head', 'body', 'meta', 'style',
    'div', 'span', 'p', 'br', 'hr', 'wbr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a', 'b', 'i', 'strong', 'em', 'u', 's', 'del', 'ins', 'mark',
    'small', 'big', 'sup', 'sub', 'code', 'pre', 'tt', 'kbd', 'samp', 'var',
    'font', 'center', 'blockquote', 'cite', 'abbr', 'acronym', 'address', 'q', 'bdi', 'bdo',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',
    'img',
    'figure', 'figcaption', 'section', 'article', 'header', 'footer', 'aside', 'nav', 'main',
    'ruby', 'rp', 'rt', 'time', 'data', 'details', 'summary',
  ],
  allowedAttributes: {
    '*': ['style', 'class', 'id', 'dir', 'lang', 'align', 'valign', 'title'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'border', 'style'],
    table: ['cellpadding', 'cellspacing', 'border', 'width', 'bgcolor', 'summary'],
    td: ['colspan', 'rowspan', 'bgcolor', 'width', 'height', 'nowrap'],
    th: ['colspan', 'rowspan', 'scope'],
    col: ['span', 'width'],
    colgroup: ['span'],
    font: ['color', 'face', 'size'],
    meta: ['charset', 'name', 'content'],
  },
  allowedSchemesByTag: {
    a: ['http', 'https', 'mailto'],
    img: ['http', 'https', 'cid', 'data'],
  },
  allowProtocolRelative: false,
  allowVulnerableTags: true,
}

const ulid = monotonicFactory()

export interface NormalizedResult {
  thread: Omit<ThreadRow, 'messageCount' | 'unreadCount'>
  message: Omit<MessageRow, 'threadId'>
}

export function normalizeMessage(
  raw: RawMessage,
  accountId: string,
  folderId: string | null,
  existingThreadId?: string
): NormalizedResult {
  const messageId = ulid()
  const threadId = existingThreadId ?? ulid()

  const fromDisplay = raw.from.name
    ? `${raw.from.name} <${raw.from.address}>`
    : raw.from.address

  const snippet = stripHtml(raw.bodyText || raw.bodyHtml || '').slice(0, 200)

  const thread: Omit<ThreadRow, 'messageCount' | 'unreadCount'> = {
    id: threadId,
    accountId,
    remoteId: raw.threadRemoteId || null,
    subject: raw.subject || '(No Subject)',
    snippet,
    lastMessageAt: raw.date.getTime(),
    isStarred: raw.isStarred,
    hasAttachment: raw.attachments.length > 0,
    labels: raw.labels,
    participantAddresses: buildParticipants(raw),
  }

  const message: Omit<MessageRow, 'threadId'> = {
    id: messageId,
    accountId,
    folderId,
    remoteId: raw.remoteId,
    fromAddress: raw.from.address,
    fromName: raw.from.name ?? null,
    toAddresses: raw.to,
    ccAddresses: raw.cc,
    bccAddresses: raw.bcc,
    replyToAddresses: raw.replyTo ?? [],
    subject: raw.subject || '(No Subject)',
    bodyHtml: raw.bodyHtml ? sanitizeHtml(raw.bodyHtml, EMAIL_SANITIZE_OPTIONS) : null,
    bodyText: raw.bodyText || null,
    date: raw.date.getTime(),
    isRead: raw.isRead,
    isStarred: raw.isStarred,
    isDraft: raw.isDraft,
    hasAttachment: raw.attachments.length > 0,
    labels: raw.labels,
    headers: raw.headers,
    sizeBytes: raw.sizeBytes || null,
    fetchedAt: Date.now(),
  }

  return { thread, message }
}

function buildParticipants(raw: RawMessage): ThreadRow['participantAddresses'] {
  const seen = new Set<string>()
  const participants: ThreadRow['participantAddresses'] = []

  const add = (addr: { name?: string; address: string }) => {
    if (!seen.has(addr.address)) {
      seen.add(addr.address)
      participants.push({ name: addr.name, address: addr.address })
    }
  }

  add(raw.from)
  raw.to.forEach(add)
  raw.cc.forEach(add)

  return participants.slice(0, 10)
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Zawinski's threading algorithm ─────────────────────────────────────────

export interface ThreadingInput {
  messageId: string
  inReplyTo?: string
  references?: string[]
  subject: string
}

export function buildThreadGroups(
  messages: ThreadingInput[]
): Map<string, string[]> {
  const idMap = new Map<string, string>()
  const parentMap = new Map<string, string | null>()

  for (const msg of messages) {
    idMap.set(msg.messageId, msg.messageId)
    parentMap.set(msg.messageId, null)
  }

  for (const msg of messages) {
    const refs = msg.references ?? []
    if (msg.inReplyTo) refs.push(msg.inReplyTo)

    const parent = refs.filter((id) => idMap.has(id)).pop()
    if (parent) {
      parentMap.set(msg.messageId, parent)
    }
  }

  // Find root of each message
  const findRoot = (id: string, visited = new Set<string>()): string => {
    if (visited.has(id)) return id
    visited.add(id)
    const parent = parentMap.get(id)
    if (!parent) return id
    return findRoot(parent, visited)
  }

  const groups = new Map<string, string[]>()
  for (const msg of messages) {
    const root = findRoot(msg.messageId)
    const existing = groups.get(root) ?? []
    existing.push(msg.messageId)
    groups.set(root, existing)
  }

  return groups
}
