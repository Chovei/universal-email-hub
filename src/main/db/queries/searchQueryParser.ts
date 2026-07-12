// Pure parser for search-operator syntax. Extracts structured filters
// (has:, is:, after:, before:, account:) from the raw input and rewrites
// the remaining text into an FTS5 query with field prefixes and prefix
// matching. No DB access — unit-testable in isolation.

export interface ParsedSearch {
  /** FTS5 MATCH expression; empty string when the input was operators-only */
  ftsQuery: string
  hasAttachment?: boolean
  isUnread?: boolean
  isStarred?: boolean
  /** after:YYYY-MM-DD — local midnight, ms */
  dateFrom?: number
  /** before:YYYY-MM-DD — local end of day, ms */
  dateTo?: number
  /** account:someone@example.com — matched against account email (substring) */
  accountEmail?: string
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function parseLocalDate(value: string, endOfDay: boolean): number | undefined {
  const m = DATE_RE.exec(value)
  if (!m) return undefined
  const [, y, mo, d] = m
  const date = endOfDay
    ? new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999)
    : new Date(Number(y), Number(mo) - 1, Number(d))
  return isNaN(date.getTime()) ? undefined : date.getTime()
}

export function parseSearchInput(input: string): ParsedSearch {
  const result: ParsedSearch = { ftsQuery: '' }
  const remaining: string[] = []

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase()

    if (lower === 'has:attachment') {
      result.hasAttachment = true
    } else if (lower === 'is:unread') {
      result.isUnread = true
    } else if (lower === 'is:starred') {
      result.isStarred = true
    } else if (lower.startsWith('after:')) {
      const ts = parseLocalDate(token.slice(6), false)
      if (ts !== undefined) result.dateFrom = ts
      else remaining.push(token.slice(6))
    } else if (lower.startsWith('before:')) {
      const ts = parseLocalDate(token.slice(7), true)
      if (ts !== undefined) result.dateTo = ts
      else remaining.push(token.slice(7))
    } else if (lower.startsWith('account:') && token.length > 8) {
      result.accountEmail = token.slice(8)
    } else {
      remaining.push(token)
    }
  }

  result.ftsQuery = buildFtsExpression(remaining.join(' '))
  return result
}

/**
 * Rewrite the residual text into FTS5 syntax: map from:/to:/subject:
 * shorthands to indexed column filters and apply prefix matching to plain
 * words (typing a partial word still returns results).
 */
function buildFtsExpression(input: string): string {
  let query = input.trim()
  if (!query) return ''

  query = query.replace(/\bfrom:(\S+)/gi, 'from_address:$1')
  query = query.replace(/\bto:(\S+)/gi, 'to_addresses:$1')
  query = query.replace(/\bsubject:(\S+)/gi, 'subject:$1')

  // Don't rewrite if the user wrote explicit FTS5 boolean operators
  if (!query.includes('"') && !query.includes('OR') && !query.includes('AND')) {
    const words = query.split(/\s+/).filter(Boolean)
    return words.map((w) => (w.includes(':') ? w : `${w}*`)).join(' ')
  }

  return query
}
