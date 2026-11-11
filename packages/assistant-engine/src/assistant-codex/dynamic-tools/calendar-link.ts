import { toolFailureDiagnostic } from '../tool-failure-diagnostics.js'
import {
  buildCalendarEventUrl,
  calendarEventV1Bounds,
  calendarEventV1Schema,
  type CalendarEventV1,
} from '@murphai/contracts'

import type { SafeToolCallValidationDigest } from '../../assistant/tool-validation-digest.js'
import {
  parseDynamicToolArguments,
  type DynamicToolResult,
} from './dynamic-tool-wrapper.js'

export const MURPH_CREATE_CALENDAR_LINK_TOOL = {
  namespace: 'murph',
  name: 'create_calendar_link',
  deferLoading: true,
  description: [
    'Make one Add to Calendar link for an appointment the member gave or confirmed in this private conversation.',
    'The link does not add the event, so never say the event was added.',
    "Pass title, startsAt, and endsAt. Use the member's time zone for the UTC offset.",
    'When they gave no end time, use one hour after the start and say so in the reply.',
    'Ask only when the date or the start time is missing.',
    'After success the runtime appends the link to your reply, so write the reply without any URL.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: calendarEventV1Bounds.title,
        description: 'Event title.',
      },
      startsAt: {
        type: 'string',
        maxLength: 35,
        description:
          'Start as an RFC 3339 date-time with UTC offset, for example 2026-10-14T14:30:00-04:00.',
      },
      endsAt: {
        type: 'string',
        maxLength: 35,
        description:
          'End in the same format. It must be after startsAt.',
      },
      location: {
        type: 'string',
        minLength: 1,
        maxLength: calendarEventV1Bounds.location,
        description: 'Optional location.',
      },
      notes: {
        type: 'string',
        minLength: 1,
        maxLength: calendarEventV1Bounds.notes,
        description: 'Optional short notes.',
      },
    },
    required: ['title', 'startsAt', 'endsAt'],
  },
} as const

const CALENDAR_LINK_SCHEMA_ROOT_KEYS = [
  'title',
  'startsAt',
  'endsAt',
  'location',
  'notes',
] as const

export function parseCreateCalendarLinkArguments(
  value: unknown,
):
  | { ok: true; args: CalendarEventV1 }
  | { ok: false; validationDigest: SafeToolCallValidationDigest } {
  return parseDynamicToolArguments({
    schema: calendarEventV1Schema,
    schemaRootKeys: CALENDAR_LINK_SCHEMA_ROOT_KEYS,
    toolName: 'murph.create_calendar_link',
    value,
  })
}

export function executeCreateCalendarLinkDynamicTool(
  event: CalendarEventV1,
): DynamicToolResult {
  let url: string
  try {
    url = buildCalendarEventUrl(event)
  } catch {
    return {
      failureDiagnostic: toolFailureDiagnostic('oversized_result'),
      rpcResult: {
        success: false,
        contentItems: [{
          type: 'inputText',
          text: 'The event details are too long for a calendar link, so no link was made. Shorten the notes or location and call again.',
        }],
      },
      usageDraft: null,
    }
  }

  return {
    requiredFinalResponseFallback: 'The details are ready.',
    requiredFinalResponseSuffix: url,
    rpcResult: {
      success: true,
      contentItems: [{
        type: 'inputText',
        text: JSON.stringify({
          instruction:
            'The link is ready, and the runtime appends it to your reply, so write the reply without any URL. The link does not set a reminder. When the Appointment reminder rule covers this turn, it still needs its reminder.',
          status: 'ready',
        }),
      }],
    },
    usageDraft: null,
  }
}
