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
  })

  it('parses the ordinary dynamic-tool request into one event', () => {
    expect(readMurphDynamicToolRequest(dynamicToolCall(EVENT))).toEqual({
      kind: 'create-calendar-link',
      event: EVENT,
    })
  })

  it('returns an exact first-party URL suffix and an honest fallback reply', () => {
    const result = executeCreateCalendarLinkDynamicTool(EVENT)
    expect(result.rpcResult.success).toBe(true)
    const url = result.requiredFinalResponseSuffix
    expect(url?.startsWith(CALENDAR_LINK_URL_PREFIX)).toBe(true)
    const readyResult = JSON.parse(result.rpcResult.contentItems[0]?.text ?? '')
    expect(Object.keys(readyResult).sort()).toEqual(['instruction', 'status'])
    expect(readyResult.status).toBe('ready')
    expect(readyResult.instruction).not.toMatch(/https?:/u)
    const payload = url?.slice(CALENDAR_LINK_URL_PREFIX.length) ?? ''
    expect(parseCalendarEventPayload(payload)).toEqual(EVENT)
    expect(result.requiredFinalResponseFallback).toBe('The details are ready.')
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
