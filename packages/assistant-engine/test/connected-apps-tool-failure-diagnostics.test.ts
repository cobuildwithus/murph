import { afterEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_CONNECTED_APPS_RESULT_MAX_BYTES } from '@murphai/hosted-execution/connected-apps'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  classifyToolFailureError,
  toolTextResult,
  withConnectedAppsToolFailureDetails,
} from '../src/assistant-codex/tool-failure-diagnostics.js'
import { readCodexRpcSuccessResponse } from '../src/assistant-codex/app-server-protocol.js'
import {
  createCodexActionDiagnosticsReducer,
  createCodexActionRuntimeIssueTracker,
} from '../src/assistant-codex/action-diagnostics.js'
import { normalizeCodexEvent } from '../src/assistant-codex-events.js'
import type { AssistantConnectedAppsPort } from '../src/assistant/connected-apps-port.js'
import {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
} from '../src/assistant/issue-reporting.js'

const writes = vi.hoisted(() => ({
  write: vi.fn<typeof import('@murphai/runtime-state/node').writePendingAssistantRuntimeIssueRecord>(),
}))
vi.mock('@murphai/runtime-state/node', async (importOriginal) => ({
  ...await importOriginal<typeof import('@murphai/runtime-state/node')>(),
  writePendingAssistantRuntimeIssueRecord: writes.write,
}))

const privateValue = 'SYNTHETIC_PRIVATE_CONNECTED_CONTENT'
const statusKey = 'connectedAppsHttpStatus'
const baseDiagnostic = {
  failureStage: 'execution', failureReason: 'handler_exception', errorCategory: 'unknown',
} as const
const policy = { environment: 'hosted' as const, surface: null, privateIssueCaptureEnabled: true }
const calendarRecovery = 'calendar event creation failed or returned an ambiguous result. Do not retry the calendar-create call. Search the selected calendar for the event first, then explain the ambiguous outcome to the user before taking any further write action.'
const emailRecovery = "email sending failed or returned an ambiguous result. Do not retry the email-send call. Search the selected account's Sent mail in a narrow window at or after this attempt for a message matching the exact primary recipient, subject, and substantive body. Older, duplicate, or partial matches do not prove this send completed. If the result remains uncertain, report it as unknown and take no further write action."

function responseSchemaError() {
  // Mirror the port's own-data contract; its real factory is covered in the
  // Cloudflare connected-app web-control-policy test owner.
  return Object.defineProperty(new TypeError('Hosted connected apps returned an invalid response.'), 'code', {
    value: 'CONNECTED_APPS_RESPONSE_SCHEMA_INVALID', enumerable: false,
  })
}

function hostedError(statusFields: object = { status: 413, statusCode: 413 }) {
  return Object.freeze({
    name: 'HostedWebControlPlaneResponseError', ...statusFields,
    code: 'synthetic-private-code', detail: privateValue, message: privateValue,
    body: privateValue, payload: privateValue, requestId: privateValue,
    url: privateValue, arguments: privateValue, response: privateValue,
    cause: Object.freeze({ status: 503, content: privateValue }),
    context: Object.freeze({ status: 503, content: privateValue }),
  })
}

function executeArgs(toolSlug = 'GMAIL_FETCH_EMAILS') {
  if (toolSlug === 'MURPH_OPENWEATHER_GET_NATIONAL_ALERTS') {
    return { toolSlug, arguments: { lat: 0, lon: 0 } }
  }
  const argumentsValue = toolSlug.endsWith('CREATE_EVENT')
    ? { summary: privateValue, start_datetime: '2026-10-01T10:00:00', timezone: 'UTC',
      event_duration_hour: 0, event_duration_minutes: 30 }
    : toolSlug.endsWith('SEND_EMAIL')
      ? { subject: privateValue, body: privateValue,
        ...(toolSlug === 'GMAIL_SEND_EMAIL'
          ? { recipient_email: 'synthetic@example.test' } : { to_email: 'synthetic@example.test' }) }
      : { query: privateValue }
  return { account: 'synthetic-account', agentApproved: true, toolSlug, arguments: argumentsValue }
}

function dispatchInput(
  args: unknown,
  connectedApps: AssistantConnectedAppsPort | null,
  tool = 'connected_apps_execute',
  authorized = true,
) {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool, arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected a synthetic connected-app request')
  return {
    request, env: {}, fetchImpl: vi.fn<typeof fetch>(), nextUsageOrdinal: vi.fn(() => 1),
    progressDelivery: null,
    hostedToolContext: {
      connectedApps, computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [],
      currentUserActionScope: () => authorized ? {
        acceptedInputIds: ['synthetic-input'], conversationId: 'synthetic-conversation',
        conversationScope: 'direct' as const, inboundMailboxItemIds: ['synthetic-mailbox'],
        originSessionId: 'synthetic-session', recipientKey: 'synthetic-recipient',
      } : null,
      sendVaultFile: vi.fn(async () => { throw new Error('Unexpected delivery') }),
      vaultFileSendAvailable: false,
    },
  }
}

async function dispatch(input: ReturnType<typeof dispatchInput>) {
  const result = await executeMurphDynamicToolRequest(input)
  expect(input.fetchImpl).not.toHaveBeenCalled()
  expect(input.nextUsageOrdinal).not.toHaveBeenCalled()
  expect(input.hostedToolContext.sendVaultFile).not.toHaveBeenCalled()
  expect(writes.write).not.toHaveBeenCalled()
  return result
}

function expectNoPrivateContent(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/SYNTHETIC_PRIVATE|synthetic-account|synthetic-private-code|HostedWebControlPlaneResponseError|CONNECTED_APPS_RESPONSE_SCHEMA_INVALID|Hosted connected apps returned an invalid response/u)
}

function annotate(error: unknown) {
  const original = toolTextResult(false, 'Existing RPC recovery.', 'handler_exception')
  Object.freeze(original.failureDiagnostic)
  Object.freeze(original.rpcResult)
  Object.freeze(original)
  const result = withConnectedAppsToolFailureDetails(original, error)
  expect(original.failureDiagnostic).toEqual(baseDiagnostic)
  expect(result.rpcResult).toBe(original.rpcResult)
  expectNoPrivateContent(result)
  return result
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  writes.write.mockReset()
})

describe('connected-app caught failures through dispatch, classification and sanitized issue storage', () => {
  it.each([
    { name: 'transport Error', error: new Error(privateValue), text: 'connected apps API is unavailable' },
    { name: 'invalid-response TypeError', error: new TypeError('Hosted connected apps returned an invalid response.'),
      text: 'connected apps API is unavailable' },
    { name: 'port response-schema TypeError', error: responseSchemaError(),
      errorCategory: 'invalid_result', text: 'connected apps API is unavailable' },
    { name: 'structural HTTP 413', error: hostedError(), status: 413, text: 'connected apps request failed (HTTP 413)' },
    // Existing RPC projection reads status only. The new private fallback must
    // not rewrite that projection or authorize different recovery.
    { name: 'own statusCode only', error: hostedError({ statusCode: 413 }), status: 413, text: 'connected apps API is unavailable' },
  ])('preserves $name RPC bytes, category and effects', async ({ error, status, text, errorCategory = baseDiagnostic.errorCategory }) => {
    const errorBefore = Object.getOwnPropertyDescriptors(error)
    const args = executeArgs()
    const argsBefore = JSON.stringify(args)
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockRejectedValue(error)
    const input = dispatchInput(args, { request })
    expect(input.request.kind).toBe('connected-apps-execute')
    const result = await dispatch(input)
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
    const diagnostic = { ...baseDiagnostic, errorCategory, ...(status === undefined ? {} : { connectedAppsHttpStatus: status }) }
    expect(result.failureDiagnostic).toEqual(diagnostic)
    const expectedRpc = { success: false, contentItems: [{ type: 'inputText', text }] }
    const wire = JSON.stringify({ id: 1, result: result.rpcResult })
    expect(wire).toBe(JSON.stringify({ id: 1, result: expectedRpc }))
    expect(readCodexRpcSuccessResponse(JSON.parse(wire))?.result).toEqual(expectedRpc)
    expect(wire).not.toMatch(/connectedAppsHttpStatus|failureDiagnostic|runtimeIssueInputs/u)
    await expect(request.mock.results[0]!.value).rejects.toBe(error)
    expect(Object.getOwnPropertyDescriptors(error)).toEqual(errorBefore)
    expect(JSON.stringify(args)).toBe(argsBefore)
    expectNoPrivateContent(result)

    const details = { requestKind: 'connected-apps-execute', ...diagnostic, diagnosticRole: 'classification' }
    expect(result.runtimeIssueInputs).toHaveLength(1)
    expect(result.runtimeIssueInputs![0]!.details).toEqual(details)
    const before = JSON.stringify(result)
    recordAssistantRuntimeIssueInputsBestEffort({ issues: result.runtimeIssueInputs!, policy, vault: 'synthetic-vault' })
    await flushPendingAssistantRuntimeIssueWrites()
    expect(writes.write).toHaveBeenCalledTimes(1)
    const record = writes.write.mock.calls[0]![0].record
    const parsed = parseAssistantRuntimeIssueRecord(JSON.parse(JSON.stringify(record)))
    expect(parsed.details).toEqual(details)
    expect(Object.keys(parsed.details)).toHaveLength(status === undefined ? 5 : 6)
    const { connectedAppsHttpStatus: _status, ...legacyDetails } = parsed.details
    expect(parseAssistantRuntimeIssueRecord({ ...parsed, details: legacyDetails }).details).toEqual(legacyDetails)
    expect(JSON.stringify(result)).toBe(before)
    expectNoPrivateContent(record)

    const rawEvent = { method: 'item/completed', params: { turnId: 'synthetic-turn', item: {
      id: 'synthetic-call', type: 'dynamicToolCall', namespace: 'murph', tool: 'connected_apps_execute', success: false,
    } } }
    const event = { activeTurnId: 'synthetic-turn', rawEvent, normalizedEvent: normalizeCodexEvent(rawEvent) }
    const completion = createCodexActionRuntimeIssueTracker().recordEvent(event)
    expect(completion?.details).toMatchObject({ diagnosticRole: 'completion', failureReason: 'reported_failure' })
    expect(completion?.details).not.toHaveProperty(statusKey)
    const reducer = createCodexActionDiagnosticsReducer()
    reducer.recordEvent({ ...event, observedAtMs: 1 })
    reducer.recordEvent({ ...event, observedAtMs: 2 })
    expect(reducer.buildTraceEvent({ codexThreadId: null, providerActionCount: 1,
      providerStartedAtMs: null, turnCorrelation: null, turnId: null })).toMatchObject({
      codexActionDynamicToolCallCount: 1, codexActionCompletedCount: 1, codexActionFailedCount: 1,
    })
  })

  it('leaves nonenumerable private accessors inert through the real caught-error dispatch', async () => {
    const read = vi.fn(() => { throw new Error('Unexpected private read') })
    const error = Object.defineProperties({ status: 413 }, Object.fromEntries([
      'code', 'name', 'message', 'detail', 'context', 'cause', 'payload', 'arguments', 'response', 'url', 'requestId',
    ].map((key) => [key, { get: read }])))
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockRejectedValue(error)
    const args = executeArgs()
    const result = await dispatch(dispatchInput(args, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: 413 })
    expect(result.runtimeIssueInputs![0]!.details).toMatchObject({ connectedAppsHttpStatus: 413 })
    expect(read).not.toHaveBeenCalled()
    expectNoPrivateContent(result)
  })

  it.each([
    { toolSlug: 'GOOGLECALENDAR_CREATE_EVENT', text: calendarRecovery },
    { toolSlug: 'OUTLOOK_CALENDAR_CREATE_EVENT', text: calendarRecovery },
    { toolSlug: 'GMAIL_SEND_EMAIL', text: emailRecovery },
    { toolSlug: 'OUTLOOK_SEND_EMAIL', text: emailRecovery },
    { toolSlug: 'MURPH_OPENWEATHER_GET_NATIONAL_ALERTS',
      text: 'connected apps request failed (HTTP 413) Do not retry this optional alert read; continue without alert context.' },
  ])('adds private status without changing the exact $toolSlug recovery or retry count', async ({ toolSlug, text }) => {
    const args = executeArgs(toolSlug)
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockRejectedValue(hostedError())
    const result = await dispatch(dispatchInput(args, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText', text }] })
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: 413 })
    expect(result.runtimeIssueInputs).toHaveLength(1)
    expect(result.runtimeIssueInputs![0]!.details).toMatchObject({ connectedAppsHttpStatus: 413, diagnosticRole: 'classification' })
    expectNoPrivateContent(result)
  })

  it.each([
    { toolSlug: 'GOOGLECALENDAR_CREATE_EVENT', text: calendarRecovery },
    { toolSlug: 'OUTLOOK_CALENDAR_CREATE_EVENT', text: calendarRecovery },
    { toolSlug: 'GMAIL_SEND_EMAIL', text: emailRecovery },
    { toolSlug: 'OUTLOOK_SEND_EMAIL', text: emailRecovery },
  ])('keeps $toolSlug ambiguous-write recovery byte-identical for schema and transport errors', async ({ toolSlug, text }) => {
    const args = executeArgs(toolSlug)
    const argsBefore = JSON.stringify(args)
    for (const { error, errorCategory } of [
      { error: responseSchemaError(), errorCategory: 'invalid_result' },
      { error: new Error(privateValue), errorCategory: 'unknown' },
    ]) {
      const before = Object.getOwnPropertyDescriptors(error)
      const request = vi.fn<AssistantConnectedAppsPort['request']>().mockRejectedValue(error)
      const result = await dispatch(dispatchInput(args, { request }))
      expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
      expect(JSON.stringify(result.rpcResult)).toBe(JSON.stringify({
        success: false, contentItems: [{ type: 'inputText', text }],
      }))
      expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, errorCategory })
      expect(result.runtimeIssueInputs).toHaveLength(1)
      expect(result.runtimeIssueInputs![0]!.details).toEqual({
        requestKind: 'connected-apps-execute', ...baseDiagnostic, errorCategory, diagnosticRole: 'classification',
      })
      await expect(request.mock.results[0]!.value).rejects.toBe(error)
      expect(Object.getOwnPropertyDescriptors(error)).toEqual(before)
      expect(JSON.stringify(args)).toBe(argsBefore)
      expectNoPrivateContent(result)
    }
  })

  it('classifies only the exact own-data response-schema code, not prose, accessors or inherited codes', () => {
    expect(classifyToolFailureError(responseSchemaError())).toBe('invalid_result')
    const read = vi.fn(() => 'CONNECTED_APPS_RESPONSE_SCHEMA_INVALID')
    for (const error of [
      new TypeError('CONNECTED_APPS_RESPONSE_SCHEMA_INVALID'),
      Object.create({ code: 'CONNECTED_APPS_RESPONSE_SCHEMA_INVALID' }),
      Object.defineProperty(new TypeError(privateValue), 'code', { get: read }),
      { code: 'CONNECTED_APPS_RESPONSE_SCHEMA_INVALID_EXTRA' },
      { code: 'CONNECTED_APPS_RESPONSE_SCHEMA_INVALID ' },
    ]) {
      expect(classifyToolFailureError(error)).toBe('unknown')
    }
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    { tool: 'connected_apps_manage', args: { action: 'list' }, operation: 'manage' },
    { tool: 'connected_apps_search', args: { query: privateValue }, operation: 'search' },
  ])('uses the same caught-error owner for $operation', async ({ tool, args, operation }) => {
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockRejectedValue(hostedError())
    const result = await dispatch(dispatchInput(args, { request }, tool))
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation, input: args }, { signal: null })
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: 413 })
    expectNoPrivateContent(result)
  })

  it('keeps current preflight-code recovery and omits nested status', async () => {
    const error = Object.freeze({ code: 'CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE', retryable: true,
      context: { status: 413, content: privateValue } })
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockRejectedValue(error)
    const args = executeArgs('GMAIL_SEND_EMAIL')
    const result = await dispatch(dispatchInput(args, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, errorCategory: 'unavailable' })
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText',
      text: 'connected apps request failed with CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE. This failure is transient; one retry is reasonable.' }] })
    expectNoPrivateContent(result)
  })

  it('keeps a nearby valid read unchanged and never harvests HTTP status from a result', async () => {
    const response = Object.freeze({ result: Object.freeze({ status: 413, text: '<p>Synthetic result</p>' }) })
    const before = JSON.stringify(response)
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockResolvedValue(response)
    const args = executeArgs()
    const result = await dispatch(dispatchInput(args, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
    expect(result).toEqual({ rpcResult: { success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify(response.result) }] } })
    expect(JSON.stringify(response)).toBe(before)
  })

  it('omits status on an oversized result without changing its guidance', async () => {
    const response = Object.freeze({ result: Object.freeze({ status: 413,
      content: 'x'.repeat(HOSTED_CONNECTED_APPS_RESULT_MAX_BYTES + 1) }) })
    const request = vi.fn<AssistantConnectedAppsPort['request']>().mockResolvedValue(response)
    const args = executeArgs()
    const result = await dispatch(dispatchInput(args, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ operation: 'execute', input: args }, { signal: null })
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText',
      text: 'connected apps result is too large; narrow the query or request a smaller page' }] })
    expect(result.failureDiagnostic).toEqual({ failureStage: 'result', failureReason: 'oversized_result' })
    expect(result.runtimeIssueInputs![0]!.details).not.toHaveProperty(statusKey)
  })

  it('does not annotate or call the port on validation, unavailable transport or email admission', async () => {
    const request = vi.fn<AssistantConnectedAppsPort['request']>()
    const inputs = [
      dispatchInput({ toolSlug: '', arguments: {} }, { request }),
      dispatchInput(executeArgs(), null),
      dispatchInput(executeArgs('GMAIL_SEND_EMAIL'), { request }, 'connected_apps_execute', false),
    ]
    for (const input of inputs) {
      const result = await dispatch(input)
      expect(result.rpcResult.success).toBe(false)
      expect(result.failureDiagnostic).not.toHaveProperty(statusKey)
      expect(result.runtimeIssueInputs?.[0]?.details ?? {}).not.toHaveProperty(statusKey)
      expectNoPrivateContent(result)
    }
    expect(request).not.toHaveBeenCalled()
  })
})

describe('bounded connected-app status observer, independent of unchanged RPC error projection', () => {
  it.each([100, 200, 413, 429, 599])('accepts only an own integer HTTP status (%s)', (status) => {
    const error = hostedError({ status })
    const before = Object.getOwnPropertyDescriptors(error)
    expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: status })
    expect(Object.getOwnPropertyDescriptors(error)).toEqual(before)
  })

  it.each([undefined, null, false, -1, 0, 99, 600, 413.5, NaN, Infinity, -Infinity, '413', {}, [], new Number(413)])(
    'omits invalid status without coercion (%#)', (status) => {
      expect(annotate({ status }).failureDiagnostic).toEqual(baseDiagnostic)
    },
  )

  it('uses only a nullish own status fallback, never prototypes, context or causes', () => {
    for (const error of [{ statusCode: 413 }, { status: null, statusCode: 413 }, { status: undefined, statusCode: 413 }]) {
      expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: 413 })
    }
    expect(annotate({ status: 429, statusCode: 413 }).failureDiagnostic?.connectedAppsHttpStatus).toBe(429)
    for (const status of ['413', 99, 600, false]) {
      expect(annotate({ status, statusCode: 413 }).failureDiagnostic).toEqual(baseDiagnostic)
    }
    const inherited = Object.create({ status: 413, statusCode: 413 })
    Object.assign(inherited, { context: { status: 413 }, cause: { status: 413 }, response: { status: 413 } })
    expect(annotate(inherited).failureDiagnostic).toEqual(baseDiagnostic)
  })

  it('does not invoke accessors, private decoys, coercion or serialization hooks', () => {
    const read = vi.fn(() => { throw new Error('Unexpected private read') })
    const decoys = Object.fromEntries(['code', 'name', 'message', 'stack', 'context', 'cause', 'body',
      'payload', 'arguments', 'response', 'result', 'url', 'requestId', 'toJSON', 'toString']
      .map((key) => [key, { get: read }]))
    const accessors = Object.defineProperties({}, { ...decoys, status: { get: read }, statusCode: { get: read } })
    expect(annotate(accessors).failureDiagnostic).toEqual(baseDiagnostic)
    const fallback = Object.defineProperties({ statusCode: 413 }, { ...decoys, status: { get: read } })
    expect(annotate(fallback).failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: 413 })
    const known = Object.defineProperties({ status: 413 }, decoys)
    expect(annotate(known).failureDiagnostic).toEqual({ ...baseDiagnostic, connectedAppsHttpStatus: 413 })
    expect(annotate({ status: { toJSON: read, [Symbol.toPrimitive]: read } }).failureDiagnostic).toEqual(baseDiagnostic)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects ordinary/revoked proxies before descriptor reads and never follows proxy prototypes', () => {
    const trap = vi.fn(() => { throw new Error('Unexpected proxy trap') })
    const proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap, has: trap })
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    for (const error of [proxy, revoked.proxy, Object.create(proxy), { status: proxy }, null, undefined, privateValue, 413]) {
      expect(annotate(error).failureDiagnostic).toEqual(baseDiagnostic)
    }
    expect(trap).not.toHaveBeenCalled()
  })

  it('leaves success and legacy unannotated results untouched without error inspection', () => {
    const trap = vi.fn(() => { throw new Error('Unexpected proxy trap') })
    const error = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap })
    const success = toolTextResult(true, 'Existing success.')
    const legacy = { rpcResult: { success: false, contentItems: [] } }
    expect(withConnectedAppsToolFailureDetails(success, error)).toBe(success)
    expect(withConnectedAppsToolFailureDetails(legacy, error)).toBe(legacy)
    expect(trap).not.toHaveBeenCalled()
  })
})
