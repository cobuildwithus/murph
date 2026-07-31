import { z } from 'zod'

import type {
  HostedConnectedAppsRequest,
} from '@murphai/hosted-execution/connected-apps'

import type {
  AssistantHostedAutomationTool,
} from '../../assistant/execution-context.js'
import type {
  AssistantConnectedAppsPort,
} from '../../assistant/connected-apps-port.js'
import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const maintenanceAutomationLookupSchema = z.string().trim().min(1).max(191)
const MEMBER_MAINTENANCE_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000
const MEMBER_MAINTENANCE_MAX_BUSY_INTERVALS = 256
const GOOGLE_CALENDAR_READ_TOOL = 'GOOGLECALENDAR_EVENTS_LIST'
const OUTLOOK_CALENDAR_READ_TOOL = 'OUTLOOK_GET_CALENDAR_VIEW'

const memberMaintenanceArgumentsSchema = z.object({
  action: z.literal('refresh_calendar_availability'),
  lookup: maintenanceAutomationLookupSchema,
}).strict()

export const MURPH_MEMBER_MAINTENANCE_TOOL = {
  namespace: 'murph',
  name: 'maintenance',
  description:
    'Exact-managed-automation-only tool for silent calendar conflict maintenance. It atomically refreshes one eligible automation from one host-built seven-day calendar read for its exact stored account. The host reduces provider data to busy timestamps and owns the fenced suffix replacement. The tool cannot inspect calendar content, choose an account, read email, manage connections, create automations, or change schedules, status, routes, titles, tags, support ownership, or lifecycle fields.',
  inputSchema: z.toJSONSchema(memberMaintenanceArgumentsSchema, { io: 'input' }),
} as const

export type MemberMaintenanceDynamicToolRequest =
  | {
      kind: 'member-maintenance-calendar-refresh'
      lookup: string
    }
  | {
      kind: 'invalid-member-maintenance-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readMemberMaintenanceDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): MemberMaintenanceDynamicToolRequest | null {
  if (input.tool !== MURPH_MEMBER_MAINTENANCE_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: memberMaintenanceArgumentsSchema,
    schemaRootKeys: ['action', 'lookup'],
    toolName: 'murph.maintenance',
    value: input.arguments,
  })
  if (!parsed.ok) {
    return {
      kind: 'invalid-member-maintenance-arguments',
      validationDigest: parsed.validationDigest,
    }
  }

  return {
    kind: 'member-maintenance-calendar-refresh',
    lookup: parsed.args.lookup,
  }
}

export async function executeMemberMaintenanceDynamicTool(input: {
  abortSignal?: AbortSignal | null
  automationTool: AssistantHostedAutomationTool | null
  authorized: boolean
  connectedApps: AssistantConnectedAppsPort | null
  request: Exclude<
    MemberMaintenanceDynamicToolRequest,
    { kind: 'invalid-member-maintenance-arguments' }
  >
}): Promise<{
  rpcResult: {
    contentItems: Array<{ text: string; type: 'inputText' }>
    success: boolean
  }
}> {
  if (!input.authorized) {
    return maintenanceTextResult(
      false,
      'member maintenance is unavailable outside its exact managed automation',
    )
  }
  if (!input.automationTool) {
    return maintenanceTextResult(
      false,
      'member maintenance automation access is unavailable for this turn',
    )
  }

  try {
    if (!input.connectedApps) {
      return maintenanceTextResult(
        false,
        'connected apps are unavailable without hosted connected-app transport',
      )
    }
    const window = buildMaintenanceCalendarWindow()
    const authorization = await input.automationTool.request({
      action: 'authorize_maintenance_source',
      lookup: input.request.lookup,
      source: 'calendar',
    }, {
      signal: input.abortSignal ?? null,
    })
    if (
      authorization.action !== 'authorize_maintenance_source'
      || authorization.authorized !== true
      || authorization.source !== 'calendar'
    ) {
      return maintenanceTextResult(
        false,
        'the automation did not authorize calendar maintenance',
      )
    }

    const response = await input.connectedApps.request(
      buildMaintenanceCalendarRequest({
        account: authorization.account,
        toolkit: authorization.toolkit,
        window,
      }),
      { signal: input.abortSignal ?? null },
    )
    const busyIntervals = readMaintenanceBusyIntervals({
      result: response.result,
      toolkit: authorization.toolkit,
      window,
    })
    if (!busyIntervals) {
      return maintenanceTextResult(
        false,
        'calendar maintenance returned incomplete or unsupported availability data',
      )
    }
    const replacement = await input.automationTool.request({
      account: authorization.account,
      action: 'replace_maintenance_conflicts',
      busyIntervals,
      expectedUpdatedAt: authorization.expectedUpdatedAt,
      expiresAt: window.endIso,
      generatedAt: window.startIso,
      lookup: input.request.lookup,
      source: 'calendar',
      toolkit: authorization.toolkit,
    }, {
      signal: input.abortSignal ?? null,
    })
    if (replacement.action !== 'replace_maintenance_conflicts') {
      return maintenanceTextResult(
        false,
        'member maintenance returned an unexpected result',
      )
    }
    return maintenanceTextResult(true, JSON.stringify({
      action: replacement.action,
      automationId: replacement.automationId,
      changed: replacement.changed,
      lookupId: replacement.lookupId,
      status: replacement.status,
    }))
  } catch {
    return maintenanceTextResult(false, 'member maintenance operation is unavailable')
  }
}

interface MaintenanceCalendarWindow {
  endIso: string
  endMs: number
  startIso: string
  startMs: number
}

function buildMaintenanceCalendarWindow(): MaintenanceCalendarWindow {
  const startMs = Date.now()
  const endMs = startMs + MEMBER_MAINTENANCE_MAX_WINDOW_MS
  return {
    endIso: new Date(endMs).toISOString(),
    endMs,
    startIso: new Date(startMs).toISOString(),
    startMs,
  }
}

function buildMaintenanceCalendarRequest(input: {
  account: string
  toolkit: 'googlecalendar' | 'outlook'
  window: MaintenanceCalendarWindow
}): HostedConnectedAppsRequest {
  return input.toolkit === 'googlecalendar'
    ? {
        input: {
          account: input.account,
          arguments: {
            calendarId: 'primary',
            maxResults: MEMBER_MAINTENANCE_MAX_BUSY_INTERVALS,
            orderBy: 'startTime',
            showDeleted: false,
            singleEvents: true,
            timeMax: input.window.endIso,
            timeMin: input.window.startIso,
          },
          toolSlug: GOOGLE_CALENDAR_READ_TOOL,
        },
        operation: 'execute',
      }
    : {
        input: {
          account: input.account,
          arguments: {
            endDateTime: input.window.endIso,
            startDateTime: input.window.startIso,
          },
          toolSlug: OUTLOOK_CALENDAR_READ_TOOL,
        },
        operation: 'execute',
      }
}

function readMaintenanceBusyIntervals(input: {
  result: unknown
  toolkit: 'googlecalendar' | 'outlook'
  window: MaintenanceCalendarWindow
}): Array<{ end: string; start: string }> | null {
  const envelope = asRecord(input.result)
  const data = asRecord(envelope?.data)
  if (!envelope || !data) {
    return null
  }
  if (
    typeof data.nextPageToken === 'string'
    || typeof data['@odata.nextLink'] === 'string'
  ) {
    return null
  }
  const items = input.toolkit === 'googlecalendar'
    ? data.items
    : data.value
  if (!Array.isArray(items) || items.length > MEMBER_MAINTENANCE_MAX_BUSY_INTERVALS) {
    return null
  }

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

function maintenanceTextResult(success: boolean, text: string) {
  return {
    rpcResult: {
      contentItems: [{ text, type: 'inputText' as const }],
      success,
    },
  }
}
