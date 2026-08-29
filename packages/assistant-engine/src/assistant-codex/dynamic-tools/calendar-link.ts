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
  description:
    'Prepare one self-contained Add to Calendar link from appointment details the member explicitly provided or confirmed in the current private text conversation. This does not add the event. Require an explicit title, start, end, and UTC offset; never guess a missing date, time, duration, or offset. When any required detail is missing, ask for every missing required detail together. Pass startsAt and endsAt as RFC 3339 date-times with offsets. After success, do not copy, compose, alter, or repeat a URL: the runtime delivers one exact confirmation and calendar link. Never claim the event was added.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: calendarEventV1Bounds.title,
        description: 'Explicit event title.',
      },
      startsAt: {
        type: 'string',
        maxLength: 35,
        description:
          'Explicit start as an RFC 3339 date-time with UTC offset, for example 2026-10-14T14:30:00-04:00.',
      },
      endsAt: {
        type: 'string',
        maxLength: 35,
        description:
          'Explicit end as an RFC 3339 date-time with UTC offset. It must be after startsAt.',
      },
      location: {
        type: 'string',
        minLength: 1,
        maxLength: calendarEventV1Bounds.location,
        description: 'Optional explicit location.',
      },
      notes: {
        type: 'string',
        minLength: 1,
        maxLength: calendarEventV1Bounds.notes,
        description: 'Optional concise notes. Keep them short enough for a calendar link.',
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
      rpcResult: {
        success: false,
        contentItems: [{
          type: 'inputText',
          text: 'The event details are too long for a reliable calendar link. Ask the member to shorten the notes or location.',
        }],
      },
      usageDraft: null,
    }
  }

  return {
    requiredFinalResponseOverride: `The details are ready.\n${url}`,
    rpcResult: {
      success: true,
      contentItems: [{
        type: 'inputText',
        text: JSON.stringify({
          instruction:
            'The runtime owns the exact final confirmation and calendar link. End the turn without copying or repeating a URL.',
          status: 'ready',
        }),
      }],
    },
    usageDraft: null,
  }
}
