import { describe, it, expect } from 'vitest'
import { parseSearchInput } from './searchQueryParser'

describe('parseSearchInput', () => {
  it('passes plain text through as a prefix query', () => {
    const p = parseSearchInput('quarterly report')
    expect(p.ftsQuery).toContain('quarterly')
    expect(p.ftsQuery).toContain('report')
  })

  it('extracts has:attachment and is:unread', () => {
    const p = parseSearchInput('invoice has:attachment is:unread')
    expect(p.hasAttachment).toBe(true)
    expect(p.isUnread).toBe(true)
    expect(p.ftsQuery).not.toContain('has:')
    expect(p.ftsQuery).not.toContain('is:')
    expect(p.ftsQuery).toContain('invoice')
  })

  it('extracts is:starred', () => {
    expect(parseSearchInput('is:starred budget').isStarred).toBe(true)
  })

  it('parses after:/before: into ms timestamps', () => {
    const p = parseSearchInput('after:2026-01-01 before:2026-02-01 report')
    expect(p.dateFrom).toBe(new Date(2026, 0, 1).getTime())
    expect(p.dateTo).toBe(new Date(2026, 1, 1, 23, 59, 59, 999).getTime())
    expect(p.ftsQuery).not.toContain('after:')
  })

  it('ignores malformed dates', () => {
    const p = parseSearchInput('before:notadate x')
    expect(p.dateTo).toBeUndefined()
    expect(p.ftsQuery).toContain('x')
  })

  it('extracts account: filter', () => {
    const p = parseSearchInput('account:klaas@gmail.com hello')
    expect(p.accountEmail).toBe('klaas@gmail.com')
    expect(p.ftsQuery).not.toContain('account:')
  })

  it('keeps from:/to:/subject: as FTS field filters', () => {
    const p = parseSearchInput('from:github.com alerts')
    expect(p.ftsQuery).toContain('from_address:github.com')
    const p2 = parseSearchInput('to:me@x.com subject:invoice')
    expect(p2.ftsQuery).toContain('to_addresses:me@x.com')
    expect(p2.ftsQuery).toContain('subject:invoice')
  })

  it('returns empty ftsQuery for operator-only input', () => {
    const p = parseSearchInput('is:unread has:attachment')
    expect(p.ftsQuery).toBe('')
    expect(p.isUnread).toBe(true)
    expect(p.hasAttachment).toBe(true)
  })

  it('handles empty input', () => {
    const p = parseSearchInput('')
    expect(p.ftsQuery).toBe('')
    expect(p.hasAttachment).toBeUndefined()
  })
})
