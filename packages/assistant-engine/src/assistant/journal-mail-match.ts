import * as z from '@murphai/contracts/zod-runtime'
import { connectedReadData, ConnectedReadFailure, normalizeConnectedReadItems, parseConnectedRead, readRecord, type ConnectedRead } from './connected-calendar-read.js'

// Full text is restricted to confirmation phrases; general plan nouns belong
// only in the subject tier. This also catches forwarded and body-only evidence.
export const JOURNAL_MAIL_PHRASES = [
  'itinerary', 'boarding pass', 'e-ticket', 'booking reference', 'booking confirmation',
  'reservation confirmation', 'confirmation number', 'reservation number', 'check-in',
  'car rental', 'rental car', 'flight confirmation', 'schedule change', 'flight cancelled',
  'booking cancelled', 'race registration', 'registration confirmed', 'bib number', 'packet pickup', 'tee time',
  'confirmación de reserva', 'tarjeta de embarque', "carte d'embarquement", 'confirmation de réservation',
  'Buchungsbestätigung', 'Bordkarte', 'conferma prenotazione', "carta d'imbarco", 'confirmação de reserva',
  'cartão de embarque', 'reserveringsbevestiging', 'instapkaart', '予約確認', '搭乗券', '预订确认', '登机牌', '예약 확인', '탑승권',
  'تأكيد الحجز', 'بطاقة الصعود', 'подтверждение бронирования', 'посадочный талон', 'बुकिंग की पुष्टि', 'बोर्डिंग पास',
] as const
export const JOURNAL_MAIL_SUBJECT_TERMS = [
  'flight', 'itinerary', 'reservation', 'booking', 'booked', 'hotel', 'boarding pass', 'registration',
  'race', 'marathon', 'triathlon', 'cruise', 'ferry', 'train', 'rail', 'bus', 'rental', 'tickets', 'trip',
  'réservation', 'billet', 'voyage', 'inscription', 'hébergement',
  'reserva', 'vuelo', 'viaje', 'boleto', 'billete', 'inscripción', 'alojamiento',
  'buchung', 'flug', 'reise', 'fahrkarte', 'anmeldung', 'unterkunft',
  'prenotazione', 'biglietto', 'volo', 'viaggio', 'iscrizione',
  'passagem', 'voo', 'viagem', 'inscrição', 'boeking', 'vlucht', 'reservering',
  '予約', '航空券', '搭乗', '旅程', '乗車券', '报名', '预订', '机票', '行程', '예약', '항공권',
  'حجز', 'تذكرة', 'رحلة', 'бронирование', 'билет', 'рейс', 'регистрация', 'बुकिंग', 'टिकट',
] as const

export const JOURNAL_MAIL_DOMAINS = [
  'aa.com', 'delta.com', 'united.com', 'southwest.com', 'jetblue.com', 'alaskaair.com', 'spirit.com', 'flyfrontier.com',
  'britishairways.com', 'virginatlantic.com', 'lufthansa.com', 'airfrance.com', 'klm.com', 'iberia.com', 'ryanair.com', 'easyjet.com',
  'emirates.com', 'qatarairways.com', 'etihad.com', 'singaporeair.com', 'cathaypacific.com', 'ana.co.jp', 'jal.co.jp', 'qantas.com', 'aircanada.com',
  'booking.com', 'expedia.com', 'hotels.com', 'airbnb.com', 'vrbo.com', 'agoda.com', 'trip.com', 'priceline.com', 'hostelworld.com',
  'marriott.com', 'hilton.com', 'hyatt.com', 'ihg.com', 'accor.com', 'wyndhamhotels.com', 'choicehotels.com', 'bestwestern.com',
  'amtrak.com', 'thetrainline.com', 'eurostar.com', 'sncf-connect.com', 'bahn.de', 'trenitalia.com', 'renfe.com', 'flixbus.com', 'greyhound.com',
  'hertz.com', 'avis.com', 'budget.com', 'enterprise.com', 'nationalcar.com', 'sixt.com', 'turo.com',
  'ticketmaster.com', 'eventbrite.com', 'axs.com', 'seetickets.com', 'dice.fm', 'runsignup.com', 'active.com', 'raceentry.com', 'ironman.com',
  'nyrr.org', 'letsdothis.com', 'ultrasignup.com', 'tripit.com', 'wanderlog.com', 'viator.com', 'getyourguide.com', 'classpass.com',
] as const
const day = 86_400_000
export function journalMailWindows(now: Date, firstPass: boolean) {
  return Array.from({ length: firstPass ? 3 : 1 }, (_, index) => ({
    start: new Date(now.getTime() - (firstPass ? (index + 1) * 30 : 7) * day),
    end: new Date(now.getTime() - (firstPass ? index * 30 : 0) * day),
  }))
}
// Quote spaces, apostrophes and hyphens: an unquoted hyphen can read as exclusion.
const quote = (term: string) => /[\s'-]/u.test(term) ? `"${term}"` : term
type MailProvider = 'gmail' | 'outlook'
type QueryTerm = { tier: 'category' | 'domain' | 'phrase' | 'subject'; value: string }
const queryLimit = 1_800
// Reserve the longest valid Date epoch so batch membership never depends on
// the current date. KQL date bounds have a fixed YYYY-MM-DD width.
const prefixBudget = {
  gmail: 'after:-8640000000000 before:-8640000000000 -in:chats -in:sent -in:drafts '.length,
  outlook: 'received>=0000-01-01 AND received<0000-01-01 AND '.length,
}

function renderQueryTerms(provider: MailProvider, terms: QueryTerm[]) {
  const values = (tier: QueryTerm['tier']) => terms.filter(term => term.tier === tier).map(term => tier === 'domain' ? term.value : quote(term.value))
  const domains = values('domain'), phrases = values('phrase'), subjects = values('subject')
  const clauses = values('category')
  if (provider === 'gmail') {
    if (domains.length) clauses.push(`from:{${domains.join(' ')}}`)
    if (phrases.length) clauses.push(`{${phrases.join(' ')}}`)
    if (subjects.length) clauses.push(`(-category:promotions -subject:"support ticket" -subject:"support tickets" subject:{${subjects.join(' ')}})`)
    return `{${clauses.join(' ')}}`
  }
  if (domains.length) clauses.push(`from:(${domains.join(' OR ')})`)
  if (phrases.length) clauses.push(`(${phrases.join(' OR ')})`)
  if (subjects.length) clauses.push(`((${subjects.map(term => `subject:${term}`).join(' OR ')}) AND NOT subject:"support ticket" AND NOT subject:"support tickets")`)
  return `(${clauses.join(' OR ')})`
}

function packQueryTerms(provider: MailProvider) {
  const terms: QueryTerm[] = [
    ...(provider === 'gmail' ? [{ tier: 'category' as const, value: 'category:reservations' }] : []),
    ...JOURNAL_MAIL_DOMAINS.map(value => ({ tier: 'domain' as const, value })),
    ...JOURNAL_MAIL_PHRASES.map(value => ({ tier: 'phrase' as const, value })),
    ...JOURNAL_MAIL_SUBJECT_TERMS.map(value => ({ tier: 'subject' as const, value })),
  ]
  const batches: string[] = []
  let batch: QueryTerm[] = []
  for (const term of terms) {
    if (prefixBudget[provider] + renderQueryTerms(provider, [...batch, term]).length > queryLimit) {
      if (!batch.length) throw new Error('Journal mail query term exceeds its budget.')
      batches.push(renderQueryTerms(provider, batch))
      batch = []
    }
    batch.push(term)
    if (prefixBudget[provider] + renderQueryTerms(provider, batch).length > queryLimit) throw new Error('Journal mail query term exceeds its budget.')
  }
  if (batch.length) batches.push(renderQueryTerms(provider, batch))
  return batches
}

// Compute greedy packing once, in tier/list priority order; only bounds vary.
const queryBatches = { gmail: packQueryTerms('gmail'), outlook: packQueryTerms('outlook') }
export function buildJournalMailQueries(provider: MailProvider, start: Date, end: Date): string[] {
  const prefix = provider === 'gmail'
    ? `after:${Math.floor(start.getTime() / 1000)} before:${Math.floor(end.getTime() / 1000)} -in:chats -in:sent -in:drafts `
    : `received>=${start.toISOString().slice(0, 10)} AND received<${new Date(end.getTime() + day).toISOString().slice(0, 10)} AND `
  return queryBatches[provider].map(batch => prefix + batch)
}

const message = z.record(z.string(), z.unknown())
const gmailPage = z.object({ messages: z.array(z.unknown()), nextPageToken: z.string().nullish() }).passthrough()
const outlookHit = z.object({ hitId: z.string().min(1), resource: message, summary: z.string().optional() }).passthrough()
const outlookPage = z.object({ value: z.array(z.object({ hitsContainers: z.array(z.object({
  hits: z.array(z.unknown()),
  moreResultsAvailable: z.boolean(),
}).passthrough()) }).passthrough()), next_page_token: z.string().nullish() }).passthrough()

export function parseJournalMailPage(response: Parameters<typeof connectedReadData>[0], provider: 'gmail' | 'outlook') {
  const data = connectedReadData(response)
  if (provider === 'gmail') {
    const parsed = parseConnectedRead(gmailPage, data)
    return { items: parsed.messages, failures: [], next: parsed.nextPageToken || null, more: !!parsed.nextPageToken }
  }
  const parsed = parseConnectedRead(outlookPage, data)
  const containers = parsed.value.flatMap(v => v.hitsContainers)
  if (containers.length === 0) throw new ConnectedReadFailure('shape_mismatch', ['hitsContainers'])
  const normalized = normalizeConnectedReadItems(containers.flatMap(c => c.hits), raw => {
    const hit = parseConnectedRead(outlookHit, raw)
    return { ...hit.resource, id: hit.hitId, snippet: hit.summary ?? hit.resource.bodyPreview }
  })
  return { ...normalized,
    next: parsed.next_page_token || null, more: containers.some(c => c.moreResultsAvailable) || !!parsed.next_page_token }
}

export function normalizeJournalMail(raw: unknown, provider: 'gmail' | 'outlook') {
  const item = parseConnectedRead(message, raw)
  const id = item.messageId ?? item.id
  if (typeof id !== 'string' || !id) throw new ConnectedReadFailure('shape_mismatch', ['id'])
  return { id, subject: typeof item.subject === 'string' ? item.subject : '',
    receivedAt: mailReceivedAt(item.messageTimestamp ?? item.receivedDateTime ?? item.internalDate ?? item.date),
    ...mailSenderFields(item.sender ?? item.from),
    snippet: mailSnippet(item), provider }

}

export async function readJournalMail(input: { read: ConnectedRead; account: string; provider: 'gmail' | 'outlook'; now: Date; firstPass: boolean }) {
  const items: ReturnType<typeof normalizeJournalMail>[] = []
  let partial = false
  let pagesRead = 0
  const failures: unknown[] = []
  for (const window of journalMailWindows(input.now, input.firstPass)) {
    for (const query of buildJournalMailQueries(input.provider, window.start, window.end)) {
      let next: string | null = null
      try {
        for (let page = 0; page < 2; page++) {
          const result = parseJournalMailPage(await input.read({ operation: 'read', input: { account: input.account,
            toolSlug: input.provider === 'gmail' ? 'GMAIL_FETCH_EMAILS' : 'OUTLOOK_SEARCH_MESSAGES',
            arguments: input.provider === 'gmail'
              ? { query, max_results: 25, include_payload: false, verbose: false, ...(next ? { page_token: next } : {}) }
              : { query, size: 25, enable_top_results: false, ...(next ? { page_token: next } : { from_index: page * 25 }) },
          } }), input.provider)
          const normalized = normalizeConnectedReadItems(result.items.slice(0, 25), item => normalizeJournalMail(item, input.provider))
          pagesRead++
          items.push(...normalized.items)
          failures.push(...result.failures, ...normalized.failures)
          if (result.failures.length || normalized.failures.length) partial = true
          if (result.items.length > 25 || (page === 1 && result.more)) partial = true
          if (!result.more) break
          next = result.next
        }
      } catch (error) { failures.push(error); partial = true }
    }
  }
  if (pagesRead === 0 && failures.length) throw failures[0]
  const unique = [...new Map(items.map(item => [item.id, item])).values()]
  unique.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt) || a.id.localeCompare(b.id))
  return { items: unique, failures, coverage: partial ? 'partial' as const : 'complete' as const }
}

function mailReceivedAt(received: unknown): string {
  const timestamp = typeof received === 'number' || (typeof received === 'string' && /^\d+$/u.test(received))
    ? Number(received)
    : typeof received === 'string' && /(?:Z|[+-]\d\d:\d\d)$/iu.test(received) ? Date.parse(received) : NaN
  if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) throw new ConnectedReadFailure('shape_mismatch', ['messages'])
  return new Date(timestamp).toISOString()
}

function mailSenderFields(sender: unknown) {
  const address = typeof sender === 'string' ? sender : readRecord(readRecord(sender)?.emailAddress)?.address
  const name = typeof sender === 'string' ? sender.replace(/\s*<[^>]*>\s*$/u, '').replace(/^"|"$/gu, '') : readRecord(readRecord(sender)?.emailAddress)?.name
  const domain = typeof address === 'string' ? /@([^>\s]+)>?$/u.exec(address)?.[1]?.toLowerCase() ?? null : null
  return { senderName: typeof name === 'string' && !name.includes('@') ? name : null, senderDomain: domain }
}

function mailSnippet(item: Record<string, unknown>) {
  const value = item.snippet ?? item.preview ?? item.bodyPreview
  return typeof value === 'string' ? value : null
}
