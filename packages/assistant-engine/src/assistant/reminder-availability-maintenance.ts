import { buildCalendarWindowRead, parseCalendarPage } from './connected-calendar-read.js'
import {
  listAutomations,
  parseAutomationAvailabilityConflictBlock,
  patchAutomation,
  readAutomationAvailabilityCalendarAuthorization,
  replaceAutomationAvailabilityConflictSnapshot,
  showAutomation,
  splitAutomationAvailabilityConflictBlock,
  type AutomationRecord,
} from '@murphai/core'

import type {
  AssistantConnectedAppsPort,
} from './connected-apps-port.js'

const REMINDER_AVAILABILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000
const REMINDER_AVAILABILITY_REFRESH_INTERVAL_MS = 23 * 60 * 60 * 1_000
const REMINDER_AVAILABILITY_MAX_BUSY_INTERVALS = 256
const REMINDER_AVAILABILITY_MAX_REFRESHES_PER_PASS = 100

interface ReminderAvailabilityWindow {
  endIso: string
  endMs: number
  startIso: string
  startMs: number
}

export interface RefreshReminderAvailabilityInput {
  connectedApps: AssistantConnectedAppsPort | null
  now?: Date
  shouldYield?: (() => boolean) | null
  signal?: AbortSignal | null
  vaultRoot: string
}

export interface RefreshReminderAvailabilityResult {
  attempted: number
  failed: number
  nextRefreshAt: string | null
  refreshed: number
  yielded?: true
}

export async function refreshReminderAvailability(
  input: RefreshReminderAvailabilityInput,
): Promise<RefreshReminderAvailabilityResult> {
  const result: RefreshReminderAvailabilityResult = {
    attempted: 0,
    failed: 0,
    nextRefreshAt: null,
    refreshed: 0,
  }
  if (input.shouldYield?.() === true) {
    return { ...result, yielded: true }
  }

  const now = input.now ?? new Date()
  const records = await listAutomations({
    status: 'active',
    vaultRoot: input.vaultRoot,
  })
  const nowMs = now.getTime()
  const candidates = records.items.flatMap((record) => {
    const refreshAtMs = resolveReminderAvailabilityRefreshAtMs(record, now)
    return refreshAtMs === null ? [] : [{ record, refreshAtMs }]
  })
  const dueCandidates = candidates
    .filter((candidate) => candidate.refreshAtMs <= nowMs)
  const due = dueCandidates.slice(0, REMINDER_AVAILABILITY_MAX_REFRESHES_PER_PASS)
  let nextRefreshAtMs = candidates.reduce<number | null>(
    (earliest, candidate) => candidate.refreshAtMs > nowMs
      ? Math.min(earliest ?? candidate.refreshAtMs, candidate.refreshAtMs)
      : earliest,
    null,
  )
  if (due.length === 0) {
    return withReminderAvailabilityNextRefreshAt(result, nextRefreshAtMs)
  }
  if (!input.connectedApps) {
    nextRefreshAtMs = Math.min(
      nextRefreshAtMs ?? Number.POSITIVE_INFINITY,
      nowMs + REMINDER_AVAILABILITY_REFRESH_INTERVAL_MS,
    )
    return withReminderAvailabilityNextRefreshAt({
      ...result,
      attempted: due.length,
      failed: due.length,
    }, nextRefreshAtMs)
  }

  const window = buildReminderAvailabilityWindow(now)
  for (const candidate of due) {
    if (input.shouldYield?.() === true) {
      return {
        ...withReminderAvailabilityNextRefreshAt(result, nowMs),
        yielded: true,
      }
    }
    result.attempted += 1
    try {
      await refreshOneReminderAvailability({
        candidate: candidate.record,
        connectedApps: input.connectedApps,
        now,
        signal: input.signal ?? null,
        vaultRoot: input.vaultRoot,
        window,
      })
      result.refreshed += 1
    } catch {
      input.signal?.throwIfAborted()
      result.failed += 1
    }
    nextRefreshAtMs = Math.min(
      nextRefreshAtMs ?? Number.POSITIVE_INFINITY,
      nowMs + REMINDER_AVAILABILITY_REFRESH_INTERVAL_MS,
    )
  }
  if (dueCandidates.length > due.length && result.refreshed > 0) {
    nextRefreshAtMs = nowMs
  }
  return withReminderAvailabilityNextRefreshAt(result, nextRefreshAtMs)
}

async function refreshOneReminderAvailability(input: {
  candidate: AutomationRecord
  connectedApps: AssistantConnectedAppsPort
  now: Date
  signal: AbortSignal | null
  vaultRoot: string
  window: ReminderAvailabilityWindow
}): Promise<void> {
  const authorization = requireReminderAvailabilityAuthorization(
    input.candidate,
    input.now,
  )
  const response = await input.connectedApps.request(
    buildCalendarWindowRead({
      account: authorization.account, provider: authorization.toolkit,
      start: input.window.startIso, end: input.window.endIso,
      limit: REMINDER_AVAILABILITY_MAX_BUSY_INTERVALS,
    }),
    { signal: input.signal },
  )
  input.signal?.throwIfAborted()
  const busyIntervals = readReminderAvailabilityBusyIntervals({
    result: response.result,
    toolkit: authorization.toolkit,
    window: input.window,
  })
  if (!busyIntervals) {
    throw new Error('Calendar availability data was incomplete.')
  }

  const latest = await showAutomation({
    automationId: input.candidate.automationId,
    vaultRoot: input.vaultRoot,
  })
  if (!latest || latest.updatedAt !== input.candidate.updatedAt) {
    throw new Error('Reminder changed during calendar refresh.')
  }
  const latestAuthorization = requireReminderAvailabilityAuthorization(
    latest,
    input.now,
  )
  if (
    latestAuthorization.account !== authorization.account
    || latestAuthorization.toolkit !== authorization.toolkit
  ) {
    throw new Error('Reminder calendar authority changed during refresh.')
  }
  input.signal?.throwIfAborted()

  const instructions = replaceAutomationAvailabilityConflictSnapshot({
    busyIntervals,
    expiresAt: input.window.endIso,
    generatedAt: input.window.startIso,
    instructions: latest.instructions,
    now: input.now,
  })
  await patchAutomation({
    expectedUpdatedAt: latest.updatedAt,
    instructions,
    lookup: latest.automationId,
    now: input.now,
    vaultRoot: input.vaultRoot,
  })
}

function resolveReminderAvailabilityRefreshAtMs(
  record: AutomationRecord,
  now: Date,
): number | null {
  try {
    requireReminderAvailabilityAuthorization(record, now)
  } catch {
    return null
  }
  try {
    const { block } = splitAutomationAvailabilityConflictBlock(
      record.instructions,
    )
    if (!block) {
      return now.getTime()
    }
    const snapshot = parseAutomationAvailabilityConflictBlock(block, {
      enforceFreshGeneratedAt: true,
      now,
    })
    return Date.parse(snapshot.generatedAt)
      + REMINDER_AVAILABILITY_REFRESH_INTERVAL_MS
  } catch {
    return now.getTime()
  }
}

function withReminderAvailabilityNextRefreshAt(
  result: RefreshReminderAvailabilityResult,
  nextRefreshAtMs: number | null,
): RefreshReminderAvailabilityResult {
  return {
    ...result,
    nextRefreshAt: nextRefreshAtMs === null
      ? null
      : new Date(nextRefreshAtMs).toISOString(),
  }
}

function requireReminderAvailabilityAuthorization(
  record: AutomationRecord,
  now: Date,
) {
  const activeUntilMs = record.activeUntil === null
    ? null
    : Date.parse(record.activeUntil)
  if (
    record.status !== 'active'
    || record.schedule.kind === 'at'
    || record.route.threadIsDirect !== true
    || record.supportKind === 'weekly_digest'
    || record.tags.includes('runtime-maintenance')
    || (
      activeUntilMs !== null
      && (!Number.isFinite(activeUntilMs) || activeUntilMs <= now.getTime())
    )
  ) {
    throw new Error('Automation is not eligible for reminder availability.')
  }
  const authorization = readAutomationAvailabilityCalendarAuthorization(
    record.instructions,
  )
  if (!authorization) {
    throw new Error('Automation has no calendar availability authorization.')
  }
  return authorization
}

function buildReminderAvailabilityWindow(
  now: Date,
): ReminderAvailabilityWindow {
  const startMs = now.getTime()
  const endMs = startMs + REMINDER_AVAILABILITY_WINDOW_MS
  return {
    endIso: new Date(endMs).toISOString(),
    endMs,
    startIso: now.toISOString(),
    startMs,
  }
}

function readReminderAvailabilityBusyIntervals(input: {
  result: unknown
  toolkit: 'googlecalendar' | 'outlook'
  window: ReminderAvailabilityWindow
}): Array<{ end: string; start: string }> | null {
  const page = parseCalendarPage({ result: input.result }, input.toolkit)
  const items = page.items
  if (page.next || page.incomplete || items.length > REMINDER_AVAILABILITY_MAX_BUSY_INTERVALS) return null

  const intervals: Array<{ endMs: number; startMs: number }> = []
  for (const item of items) {
    const record = asRecord(item)
    if (!record) {
      return null
    }
    if (
      input.toolkit === 'googlecalendar'
      && (
        record.status === 'cancelled'
        || record.transparency === 'transparent'
      )
    ) {
      continue
    }
    if (input.toolkit === 'outlook' && record.showAs === 'free') {
      continue
    }
    const start = readProviderDateTime(record.start)
    const end = readProviderDateTime(record.end)
    if (!start || !end || start >= end) {
      return null
    }
    const startMs = Math.max(start, input.window.startMs)
    const endMs = Math.min(end, input.window.endMs)
    if (startMs < endMs) {
      intervals.push({ endMs, startMs })
    }
  }

  intervals.sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs
  )
  const merged: Array<{ endMs: number; startMs: number }> = []
  for (const interval of intervals) {
    const previous = merged.at(-1)
    if (previous && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs)
    } else {
      merged.push({ ...interval })
    }
  }
  return merged.map((interval) => ({
    end: new Date(interval.endMs).toISOString(),
    start: new Date(interval.startMs).toISOString(),
  }))
}

function readProviderDateTime(value: unknown): number | null {
  const record = asRecord(value)
  let candidate = typeof record?.dateTime === 'string'
    ? record.dateTime
    : null
  if (candidate && !/(?:Z|[+-]\d{2}:\d{2})$/u.test(candidate)) {
    candidate = record?.timeZone === 'UTC' ? `${candidate}Z` : null
  }
  if (!candidate) {
    return null
  }
  const parsed = Date.parse(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
