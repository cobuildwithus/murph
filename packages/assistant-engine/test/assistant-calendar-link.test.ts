import { describe, expect, it } from 'vitest'

import {
  CALENDAR_LINK_URL_PREFIX,
  parseCalendarEventPayload,
} from '@murphai/contracts'

import {
  MURPH_CREATE_CALENDAR_LINK_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tool-catalog.js'
import {
  executeCreateCalendarLinkDynamicTool,
  parseCreateCalendarLinkArguments,
} from '../src/assistant-codex/dynamic-tools/calendar-link.js'
import { readMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.js'

const EVENT = {
  title: 'Care appointment',
  startsAt: '2026-10-14T14:30:00-04:00',
  endsAt: '2026-10-14T15:15:00-04:00',
  location: 'Downtown Clinic',
} as const

describe('assistant calendar link tool', () => {
  it('is opt-in and carries no hosted transport dependency', () => {
    expect(resolveMurphDynamicTools({})).not.toContain(
      MURPH_CREATE_CALENDAR_LINK_TOOL,
    )
    expect(resolveMurphDynamicTools({ calendarLinkAvailable: true })).toContain(
      MURPH_CREATE_CALENDAR_LINK_TOOL,
    )
    expect(MURPH_CREATE_CALENDAR_LINK_TOOL.description).toContain(
      'current private iMessage conversation',
    )
    expect(MURPH_CREATE_CALENDAR_LINK_TOOL.description).toContain(
      'This does not add the event',
    )
    expect(MURPH_CREATE_CALENDAR_LINK_TOOL.description).toContain(
      'ask for every missing required detail together',
    )
  })

  it('parses the ordinary dynamic-tool request into one event', () => {
    expect(readMurphDynamicToolRequest(dynamicToolCall(EVENT))).toEqual({
      kind: 'create-calendar-link',
      event: EVENT,
    })
  })

  it('returns a terminal first-party URL and an honest fallback reply', () => {
    const result = executeCreateCalendarLinkDynamicTool(EVENT)
    expect(result.rpcResult.success).toBe(true)
    const toolResult = result.rpcResult.contentItems[0]?.text ?? ''
    const url = toolResult.match(
      /https:\/\/www\.withmurph\.ai\/calendar\/[A-Za-z0-9_-]+/u,
    )?.[0]
    expect(url?.startsWith(CALENDAR_LINK_URL_PREFIX)).toBe(true)
    expect(JSON.parse(toolResult)).toEqual({
      url,
      instruction:
        'Say the details are ready, do not say the event was added, and put this exact URL on the final line.',
    })
    const payload = url?.slice(CALENDAR_LINK_URL_PREFIX.length) ?? ''
    expect(parseCalendarEventPayload(payload)).toEqual(EVENT)
    expect(result.requiredFinalResponseFallback).toBeUndefined()
  })

  it('rejects missing offsets and incomplete appointment details', () => {
    expect(parseCreateCalendarLinkArguments({
      ...EVENT,
      startsAt: '2026-10-14T14:30:00',
    }).ok).toBe(false)
    expect(parseCreateCalendarLinkArguments({
      startsAt: EVENT.startsAt,
      endsAt: EVENT.endsAt,
    }).ok).toBe(false)
  })
})

function dynamicToolCall(argumentsValue: unknown): Record<string, unknown> {
  return {
    id: 'request-test',
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      callId: 'call-test',
      namespace: 'murph',
      threadId: 'thread-test',
      tool: MURPH_CREATE_CALENDAR_LINK_TOOL.name,
      turnId: 'turn-test',
    },
  }
}
