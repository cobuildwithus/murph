import * as z from '@murphai/contracts/zod-runtime'
import type { HostedConnectedAppsRequest, HostedConnectedAppsResponse } from '@murphai/hosted-execution/connected-apps'
import { hostedConnectedAppsReadResultSchema } from '@murphai/hosted-execution/connected-apps'
import type { AssistantConnectedAppsPort } from './connected-apps-port.js'

export type CalendarProvider = 'googlecalendar' | 'outlook'
export type ConnectedRead = (request: HostedConnectedAppsRequest) => Promise<HostedConnectedAppsResponse>
export type Coverage = 'complete' | 'partial' | 'failed'
/** Code-owned metadata only: a strict-token upstream code, its HTTP status, or the validation check that failed. */
export interface ConnectedReadDiagnostic { upstreamCode?: string; upstreamStatus?: number; failedCheck?: string }
export class ConnectedReadFailure extends Error {
  constructor(readonly reason: string, readonly structuralKeys: string[] = [], readonly diagnostic: ConnectedReadDiagnostic = {}) { super(reason) }
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function parseConnectedRead<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    // Only schema-owned structural names, never provider-controlled unknown keys
    // (a key itself can contain content or a direct identifier).
    const known = new Set(['data', 'items', 'calendars', 'value', 'messages', 'id', 'messageId', 'start', 'end', 'hitsContainers', 'hits', 'resource', 'hitId', 'moreResultsAvailable', 'next_page_token', 'nextPageToken'])
    throw new ConnectedReadFailure('shape_mismatch', [...new Set(parsed.error.issues.flatMap(issue => issue.path.filter((key): key is string => typeof key === 'string' && known.has(key))))].sort())
  }
  return parsed.data
}

/** A bad item must not erase valid neighbors or subsequent pages. */
export function normalizeConnectedReadItems<T>(raw: unknown[], normalize: (item: unknown) => T | null) {
  const items: T[] = []
  const keys = new Set<string>()
  let malformed = false
  for (const item of raw) {
    try {
      const normalized = normalize(item)
      if (normalized !== null) items.push(normalized)
    } catch (error) {
      malformed = true
      if (error instanceof ConnectedReadFailure) for (const key of error.structuralKeys) keys.add(key)
    }
  }
  return { items, failures: malformed ? [new ConnectedReadFailure('shape_mismatch', [...keys].sort())] : [] }
}

export function connectedReadData(response: HostedConnectedAppsResponse): unknown {
  if (readRecord(response.result)?.successful === false) throw new ConnectedReadFailure('provider_unsuccessful')
  const envelope = parseConnectedRead(hostedConnectedAppsReadResultSchema, response.result)
  let data = envelope.data
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { throw new ConnectedReadFailure('shape_mismatch', ['data']) }
  }
  if (!readRecord(data)) throw new ConnectedReadFailure('shape_mismatch', ['data'])
  return data
}

/** One total preparation deadline, including ports that ignore cancellation. */
export function createConnectedReadBudget(port: AssistantConnectedAppsPort | null | undefined, signal?: AbortSignal | null) {
  const deadline = new AbortController()
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => deadline.abort(new ConnectedReadFailure('deadline')), 60_000)
  let requests = 0
  async function run<T>(action: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted()
    if (combined.aborted) throw new ConnectedReadFailure('deadline')
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal?.aborted ? signal.reason : new ConnectedReadFailure('deadline'))
      combined.addEventListener('abort', onAbort, { once: true })
    })
    try { return await Promise.race([action(), aborted]) }
    finally { combined.removeEventListener('abort', onAbort) }
  }
  return {
    run,
    get requests() { return requests },
    close() { clearTimeout(timer) },
    async request(request: HostedConnectedAppsRequest): Promise<HostedConnectedAppsResponse> {
      signal?.throwIfAborted()
      if (combined.aborted) throw new ConnectedReadFailure('deadline')
      if (requests >= 40) throw new ConnectedReadFailure('request_budget')
      if (!port) throw new ConnectedReadFailure('transport_unavailable')
      requests++
      return await run(() => port.request(request, { signal: combined }))
    },
  }
}

const token = z.string().nullish()
const pageSchema = z.object({
  items: z.array(z.unknown()).optional(), calendars: z.array(z.unknown()).optional(), value: z.array(z.unknown()).optional(),
  nextPageToken: token, next_page_token: token, '@odata.nextLink': token,
}).passthrough()
export function parseCalendarPage(response: HostedConnectedAppsResponse, provider: CalendarProvider, listing = false) {
  const data = parseConnectedRead(pageSchema, connectedReadData(response))
  const items = provider === 'outlook' ? data.value : data.items ?? (listing ? data.calendars : undefined)
  if (!items) throw new ConnectedReadFailure('shape_mismatch', [provider === 'outlook' ? 'value' : 'items'])
  // OData URLs are not Composio page tokens. If the wrapper omits its opaque
  // token, retain incomplete coverage instead of constructing a token.
  return { items, next: data.next_page_token || data.nextPageToken || null, incomplete: !!data['@odata.nextLink'] && !data.next_page_token }
}

export interface ConnectedCalendar { id: string; owned: boolean; primary: boolean; memberAddress?: string | null }
export async function listConnectedCalendars(input: { read: ConnectedRead; account: string; provider: CalendarProvider; excludedCalendarIds?: string[] }) {
  let next: string | null = null
  const raw: unknown[] = []
  const visited = new Set<string>()
  let incomplete = false
  const failures: unknown[] = []
  for (let page = 0; page < 4; page++) {
    try {
    const result = parseCalendarPage(await input.read({ operation: 'read', input: {
      account: input.account,
      toolSlug: input.provider === 'googlecalendar' ? 'GOOGLECALENDAR_LIST_CALENDARS' : 'OUTLOOK_LIST_CALENDARS',
      arguments: input.provider === 'googlecalendar'
        ? { max_results: 100, show_hidden: false, ...(next ? { page_token: next } : {}) }
        : { top: 100, select: ['id', 'isDefaultCalendar', 'owner'], ...(next ? { page_token: next } : {}) },
    } }), input.provider, true)
    raw.push(...result.items)
    incomplete ||= result.incomplete
    next = result.next
    if (!next || visited.has(next) || raw.length >= 100) break
    visited.add(next)
    } catch (error) {
      if (raw.length === 0) throw error
      failures.push(error)
      incomplete = true
      break
    }
  }
  const primaryOwner = calendarMemberAddress(raw, input.provider)
  const excluded = new Set(input.excludedCalendarIds)
  const normalized = normalizeConnectedReadItems(raw, item => normalizeCalendar(item, input.provider, primaryOwner))
  failures.push(...normalized.failures)
  const calendars = normalized.items.filter(calendar => !excluded.has(calendar.id))
  incomplete ||= normalized.failures.length > 0
  incomplete ||= calendars.some(calendar => !calendar.owned && !calendar.memberAddress)
  calendars.sort((a, b) => a.id.localeCompare(b.id))
  return { calendars: calendars.slice(0, 10), failures, coverage: next || incomplete || calendars.length > 10 ? 'partial' as const : 'complete' as const }
}

const googleFields = 'items(id,status,summary,start,end,organizer(self,email),attendees(self,email,responseStatus),location,eventType,updated,transparency),nextPageToken'
const outlookFields = ['id', 'subject', 'start', 'end', 'isAllDay', 'isCancelled', 'isOrganizer', 'organizer', 'attendees', 'responseStatus', 'location', 'lastModifiedDateTime', 'showAs']

export function buildCalendarWindowRead(input: {
  provider: CalendarProvider; account: string; calendarId?: string; start: string; end: string; pageToken?: string | null; limit?: number
}): HostedConnectedAppsRequest {
  return { operation: 'read', input: { account: input.account,
    toolSlug: input.provider === 'googlecalendar' ? 'GOOGLECALENDAR_EVENTS_LIST' : 'OUTLOOK_GET_CALENDAR_VIEW',
    arguments: input.provider === 'googlecalendar'
      ? { calendarId: input.calendarId ?? 'primary', timeMin: input.start, timeMax: input.end, singleEvents: true,
          showDeleted: true, orderBy: 'startTime', maxResults: input.limit ?? 250, fields: googleFields, ...(input.pageToken ? { pageToken: input.pageToken } : {}) }
      : { ...(input.calendarId ? { calendar_id: input.calendarId } : {}), start_datetime: input.start, end_datetime: input.end,
          timezone: 'UTC', top: input.limit ?? 250, orderby: 'start/dateTime asc', select: outlookFields, ...(input.pageToken ? { page_token: input.pageToken } : {}) },
  } }
}

export async function readConnectedCalendarWindow(input: Parameters<typeof buildCalendarWindowRead>[0] & { read: ConnectedRead }) {
  const items: unknown[] = []
  const limit = input.limit ?? 250
  let next: string | null = null
  const visited = new Set<string>()
  let incomplete = false
  const failures: unknown[] = []
  let pagesRead = 0
  for (let page = 0; page < 4; page++) {
    try {
    const result = parseCalendarPage(await input.read(buildCalendarWindowRead({ ...input, pageToken: next, limit: limit - items.length })), input.provider)
    pagesRead++
    items.push(...result.items)
    incomplete ||= result.incomplete
    next = result.next
    if (!next || items.length >= limit || visited.has(next)) break
    visited.add(next)
    } catch (error) {
      if (pagesRead === 0) throw error
      failures.push(error)
      incomplete = true
      break
    }
  }
  return { items: items.slice(0, limit), failures, coverage: next || incomplete || items.length > limit ? 'partial' as const : 'complete' as const }
}

const eventTime = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() }).passthrough()
const eventSchema = z.object({
  id: z.string().min(1), start: eventTime.optional(), end: eventTime.optional(),
  summary: z.string().optional(), subject: z.string().optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional(),
  isCancelled: z.boolean().optional(), isAllDay: z.boolean().optional(),
  location: z.union([z.string(), z.object({ displayName: z.string().optional() }).passthrough()]).optional(),
  eventType: z.string().optional(), updated: z.string().optional(), lastModifiedDateTime: z.string().optional(),
}).passthrough()
export function normalizeConnectedCalendarEvent(raw: unknown, provider: CalendarProvider, calendar: ConnectedCalendar) {
  const item = parseConnectedRead(eventSchema, raw)
  const { organizerSelf, selfResponse, attended } = calendarParticipation(item, provider, calendar)
  if (!calendar.owned && !organizerSelf && !attended) return null
  const cancelled = item.status === 'cancelled' || item.isCancelled === true
  return {
    id: item.id,
    ...calendarTimes(item, cancelled),
    ...calendarDisplayFields(item),
    status: cancelled ? 'cancelled' : item.status === 'tentative' || selfResponse === 'tentativelyAccepted' ? 'tentative' : 'confirmed',
    organizerSelf, selfResponse: typeof selfResponse === 'string' ? selfResponse : null,
    calendarOwnership: calendar.primary ? 'primary' : calendar.owned ? 'owned' : 'participating',
  }

}

function calendarMemberAddress(raw: unknown[], provider: CalendarProvider): string | null {
  const primary = raw.map(readRecord).find(item => item?.isDefaultCalendar === true || item?.primary === true)
  const owner = provider === 'googlecalendar' ? primary?.id : readRecord(primary?.owner)?.address
  return typeof owner === 'string' ? owner.toLowerCase() : null
}

function normalizeCalendar(raw: unknown, provider: CalendarProvider, memberAddress: string | null): ConnectedCalendar {
  const item = parseConnectedRead(z.object({ id: z.string().min(1) }).passthrough(), raw)
  const id = item.id
  const primary = item.primary === true || item.isDefaultCalendar === true
  const owner = readRecord(item.owner)?.address
  return { id, primary, memberAddress, owned: provider === 'googlecalendar'
    ? item.accessRole === 'owner'
    : primary || (memberAddress !== null && typeof owner === 'string' && owner.toLowerCase() === memberAddress) }
}

function calendarParticipation(item: z.infer<typeof eventSchema>, provider: CalendarProvider, calendar: ConnectedCalendar) {
  const address = (value: unknown) => {
    const record = readRecord(value)
    const email = provider === 'googlecalendar' ? record?.email : readRecord(record?.emailAddress)?.address
    return typeof email === 'string' ? email.toLowerCase() : null
  }
  const isMember = (value: unknown) => !!calendar.memberAddress && address(value) === calendar.memberAddress
  // Provider self/isOrganizer flags refer to the owner of this calendar copy,
  // not necessarily the authenticated member on a shared calendar.
  const organizerSelf = isMember(item.organizer) || (calendar.owned && (provider === 'googlecalendar' ? readRecord(item.organizer)?.self === true : item.isOrganizer === true))
  const self = Array.isArray(item.attendees) ? item.attendees.map(readRecord).find(a => isMember(a) || (calendar.owned && a?.self === true)) : undefined
  const selfResponse = provider === 'googlecalendar' ? self?.responseStatus : self ? readRecord(self.status)?.response : calendar.owned ? readRecord(item.responseStatus)?.response : null
  const attended = !!self
  return { organizerSelf, selfResponse, attended }
}

function calendarTimes(item: z.infer<typeof eventSchema>, cancelled: boolean) {
  const start = item.start?.dateTime ?? item.start?.date
  const end = item.end?.dateTime ?? item.end?.date
  if (!cancelled && (!start || !end)) throw new ConnectedReadFailure('shape_mismatch', ['start', 'end'])
  return { start: start ?? null, end: end ?? null,
    allDay: item.isAllDay === true || typeof item.start?.date === 'string', timeZone: item.start?.timeZone ?? null }
}

function calendarDisplayFields(item: z.infer<typeof eventSchema>) {
  return { title: item.summary ?? item.subject ?? '',
    location: typeof item.location === 'string' ? item.location : readRecord(item.location)?.displayName ?? null,
    eventType: item.eventType ?? null, updated: item.updated ?? item.lastModifiedDateTime ?? null }
}
