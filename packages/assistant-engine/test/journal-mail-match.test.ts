import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildJournalMailQueries, journalMailWindows, JOURNAL_MAIL_DOMAINS, JOURNAL_MAIL_PHRASES, JOURNAL_MAIL_SUBJECT_TERMS, normalizeJournalMail, parseJournalMailPage } from '../src/assistant/journal-mail-match.js'

interface MailFixture {
  category?: string; subject: string; body?: string; sender?: string
  promotions?: boolean; reservationCategory?: boolean; providers?: ('gmail' | 'outlook')[]
}
const corpus: { positive: MailFixture[]; negative: MailFixture[] } = JSON.parse(readFileSync(new URL('./fixtures/journal-mail-recall.json', import.meta.url), 'utf8'))
// Mirrors provider tiers: subject nouns never inspect the body, while strong
// phrases do. Sender matching requires a complete domain or its subdomain.
function containsTerm(text: string, term: string) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(term)) return text.toLowerCase().includes(term.toLowerCase())
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(text)
}
function matchesTiers(item: MailFixture, provider: 'gmail' | 'outlook') {
  const domain = /@([^>\s]+)>?$/u.exec(item.sender ?? '')?.[1]?.toLowerCase()
  const sender = domain && JOURNAL_MAIL_DOMAINS.some(allowed => domain === allowed || domain.endsWith(`.${allowed}`))
  const phrase = JOURNAL_MAIL_PHRASES.some(term => containsTerm(item.subject + '\n' + (item.body ?? ''), term))
  const subject = JOURNAL_MAIL_SUBJECT_TERMS.some(term => containsTerm(item.subject, term))
    && !/support tickets?/iu.test(item.subject)
    && !(provider === 'gmail' && item.promotions)
  return !!((provider === 'gmail' && item.reservationCategory) || sender || phrase || subject)
}
const start = new Date('2026-10-16T08:00:00Z')
const end = new Date('2026-11-15T08:00:00Z')

// Read each serialized scope separately: phrases repeated as subject terms
// are distinct tier entries, not accidental duplicates across batches.
function queryTierValues(queries: string[], provider: 'gmail' | 'outlook') {
  const result = { domains: [] as string[], phrases: [] as string[], subjects: [] as string[] }
  const unquote = (value: string) => value.trim().replace(/^"|"$/gu, '')
  const words = (value: string) => (value.match(/"[^"]+"|[^\s]+/gu) ?? []).map(unquote)
  for (const query of queries) {
    if (provider === 'gmail') {
      for (const match of query.matchAll(/from:\{([^}]+)\}/gu)) result.domains.push(...words(match[1]!))
      for (const match of query.matchAll(/subject:\{([^}]+)\}/gu)) result.subjects.push(...words(match[1]!))
      const rest = query.replace(/(?:from|subject):\{[^}]+\}/gu, '')
      for (const match of rest.matchAll(/\{([^{}]+)\}/gu)) {
        if (!match[1]!.includes(':')) result.phrases.push(...words(match[1]!))
      }
    } else {
      for (const match of query.matchAll(/from:\(([^)]+)\)/gu)) result.domains.push(...match[1]!.split(' OR '))
      for (const match of query.matchAll(/(?<!NOT )subject:("[^"]+"|[^)\s]+)/gu)) result.subjects.push(unquote(match[1]!))
      const rest = query.replace(/from:\([^)]+\)/gu, '').replace(/subject:("[^"]+"|[^)\s]+)/gu, '')
      for (const match of rest.matchAll(/\(([^()]+)\)/gu)) {
        if (!/\b(?:AND|NOT)\b/u.test(match[1]!)) result.phrases.push(...match[1]!.split(' OR ').map(unquote).filter(value => value && value !== 'OR'))
      }
    }
  }
  return result
}

describe('Journal mail recall and deterministic query contract', () => {
  it.each(['gmail', 'outlook'] as const)('protects precision tiers across at least 150 realistic %s messages', provider => {
    expect(corpus.positive.length).toBeGreaterThanOrEqual(150)
    expect(corpus.positive.filter(item => !matchesTiers(item, provider))).toEqual([])
    expect(corpus.negative.filter(item => (!item.providers || item.providers.includes(provider)) && matchesTiers(item, provider))).toEqual([])
    for (const category of ['air', 'rail', 'bus', 'ferry', 'cruise', 'lodging', 'rental', 'tickets', 'race', 'event-registration', 'activity', 'changes', 'cancellations', 'forwards', 'non-English']) {
      expect(corpus.positive.some(item => item.category === category)).toBe(true)
    }
    expect(JOURNAL_MAIL_DOMAINS.length).toBeGreaterThanOrEqual(60)
  })
  it('keeps the reservation classifier independent of promotions and generic nouns out of full text', () => {
    expect(matchesTiers({ subject: 'Your documents', reservationCategory: true, promotions: true }, 'gmail')).toBe(true)
    for (const word of ['appointment', 'class', 'course', 'workshop', 'tour', 'transfer', 'stay', 'entry', 'confirmed', 'confirmation', 'ticket', 'camp', 'departure', 'arrival', 'vol']) {
      expect(JOURNAL_MAIL_PHRASES).not.toContain(word)
      expect(matchesTiers({ subject: 'An update', body: word }, 'gmail')).toBe(false)
    }
  })
  it.each(['gmail', 'outlook'] as const)('snapshots fixed %s batches with every tier entry exactly once in priority order', provider => {
    const queries = buildJournalMailQueries(provider, start, end)
    expect(queries).toMatchSnapshot()
    expect(queries).toHaveLength(2)
    expect(queryTierValues(queries, provider)).toEqual({
      domains: [...JOURNAL_MAIL_DOMAINS], phrases: [...JOURNAL_MAIL_PHRASES], subjects: [...JOURNAL_MAIL_SUBJECT_TERMS],
    })
    expect(queries.join('\n').match(/category:reservations/gu) ?? []).toHaveLength(provider === 'gmail' ? 1 : 0)
    const otherDates = buildJournalMailQueries(provider, new Date('2000-01-01T00:00:00Z'), new Date('2000-02-01T00:00:00Z'))
    const body = (query: string) => query.slice(provider === 'gmail' ? query.indexOf(' {') : query.indexOf(' AND ('))
    expect(otherDates.map(body)).toEqual(queries.map(body))
  })
  it.each(['gmail', 'outlook'] as const)('bounds every %s batch to 1800 characters including bounds and exclusions', provider => {
    const queries = buildJournalMailQueries(provider, start, end)
    for (const query of queries) {
      expect(query.length).toBeLessThanOrEqual(1800)
      if (query.includes('subject:')) expect(query).toContain('support tickets')
      if (provider === 'gmail') expect(query).toContain('-in:chats -in:sent -in:drafts')
    }
    const extremes = buildJournalMailQueries(provider, new Date('1900-01-01T00:00:00Z'), end)
    for (const query of extremes) expect(query.length).toBeLessThanOrEqual(1800)
  })
  it('uses UTC date-only KQL bounds with an exclusive upper day', () => {
    for (const query of buildJournalMailQueries('outlook', start, end)) {
      expect(query).toContain('received>=2026-10-16 AND received<2026-11-16 AND')
      expect(query).not.toContain('T08:00')
    }
    for (const query of buildJournalMailQueries('outlook', new Date('2026-10-15T23:00:00-04:00'), new Date('2026-11-15T23:00:00-04:00'))) {
      expect(query).toContain('received>=2026-10-16 AND received<2026-11-17 AND')
    }
  })
  it('partitions the initial ninety days and later scans seven days from injected now', () => {
    expect(journalMailWindows(end, true)).toEqual([
      { start, end },
      { start: new Date('2026-09-16T08:00:00Z'), end: start },
      { start: new Date('2026-08-17T08:00:00Z'), end: new Date('2026-09-16T08:00:00Z') },
    ])
    expect(journalMailWindows(end, false)).toEqual([{ start: new Date('2026-11-08T08:00:00Z'), end }])
  })
  it('accepts empty Gmail pages and JSON-string data but rejects missing metadata', () => {
    expect(parseJournalMailPage({ result: { data: '{"messages":[],"nextPageToken":""}' } }, 'gmail')).toEqual({ items: [], failures: [], next: null, more: false })
    expect(() => normalizeJournalMail({ messageId: 'id' }, 'gmail')).toThrow('shape_mismatch')
    expect(() => parseJournalMailPage({ result: { data: { messages: null } } }, 'gmail')).toThrow('shape_mismatch')
    expect(normalizeJournalMail({ id: 'blank', receivedDateTime: end.toISOString() }, 'outlook').subject).toBe('')
    expect(normalizeJournalMail({ id: 'blank', subject: '', receivedDateTime: end.toISOString() }, 'outlook').subject).toBe('')
  })
  it('normalizes offsets and epochs without using the host timezone', () => {
    const base = { id: 'id', subject: 'Booking' }
    expect(normalizeJournalMail({ ...base, messageTimestamp: '2026-11-15T03:00:00-05:00' }, 'gmail').receivedAt).toBe(end.toISOString())
    expect(normalizeJournalMail({ ...base, internalDate: end.getTime() }, 'gmail').receivedAt).toBe(end.toISOString())
    expect(() => normalizeJournalMail({ ...base, messageTimestamp: '2026-11-15T08:00:00' }, 'gmail')).toThrow('shape_mismatch')
  })
  it('projects only metadata from Gmail and Microsoft Search hits', () => {
    expect(normalizeJournalMail({ messageId: 'id', subject: 'Booking', sender: 'Travel Desk <desk@example.test>', messageTimestamp: end.toISOString(), preview: 'A journey', payload: { body: 'private' } }, 'gmail')).toEqual({
      id: 'id', subject: 'Booking', senderName: 'Travel Desk', senderDomain: 'example.test', receivedAt: end.toISOString(), snippet: 'A journey', provider: 'gmail',
    })
    const page = parseJournalMailPage({ result: { data: { value: [{ hitsContainers: [{ moreResultsAvailable: false,
      hits: [{ hitId: 'immutable', summary: 'Booking preview', resource: { id: 'mutable', subject: 'Booking', receivedDateTime: end.toISOString(), from: { emailAddress: { name: 'Desk', address: 'desk@example.test' } }, body: 'private' } }] }] }] } } }, 'outlook')
    expect(normalizeJournalMail(page.items[0]!, 'outlook')).toMatchObject({ id: 'immutable', snippet: 'Booking preview', senderName: 'Desk', senderDomain: 'example.test' })
  })
})
