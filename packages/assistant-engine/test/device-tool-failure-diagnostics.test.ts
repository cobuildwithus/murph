import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  createDynamicToolRuntimeIssueInput,
  toolTextResult,
  withDeviceToolFailureDetails,
} from '../src/assistant-codex/tool-failure-diagnostics.js'
import { readCodexRpcSuccessResponse } from '../src/assistant-codex/app-server-protocol.js'
import {
  createCodexActionDiagnosticsReducer,
  createCodexActionRuntimeIssueTracker,
} from '../src/assistant-codex/action-diagnostics.js'
import { normalizeCodexEvent } from '../src/assistant-codex-events.js'
import type { AssistantHostedDeviceTool } from '../src/assistant/execution-context.js'
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

const privateValue = 'SYNTHETIC_PRIVATE_DEVICE_CONTENT'
const provider = 'synthetic-provider'
const baseDiagnostic = {
  failureStage: 'execution', failureReason: 'handler_exception', errorCategory: 'unavailable',
} as const
const policy = { environment: 'hosted' as const, surface: null, privateIssueCaptureEnabled: true }
const deviceKeys = ['deviceAction', 'deviceErrorCode', 'deviceHttpStatus'] as const

function hostedError(code: string, status = 503) {
  return {
    name: 'HostedWebControlPlaneResponseError', code, status, statusCode: status,
    retryable: true, forwardedFromWeb: true,
    context: { status, statusCode: status, retryable: true, content: privateValue },
    body: privateValue, payload: privateValue, cause: { code: privateValue },
    message: privateValue, requestId: privateValue,
  }
}

function dispatchInput(args: unknown, deviceTool: AssistantHostedDeviceTool | null, tool = 'device') {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool, arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected a synthetic dynamic-tool request')
  return {
    request, env: {}, fetchImpl: vi.fn<typeof fetch>(), nextUsageOrdinal: vi.fn(() => 1),
    progressDelivery: null,
    hostedToolContext: {
      deviceTool, computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [],
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
  // Dispatch returns private issue inputs; the existing issue owner writes later.
  expect(writes.write).not.toHaveBeenCalled()
  return result
}

function annotate(error: unknown) {
  const original = toolTextResult(false, 'Existing projected failure.', 'handler_exception', { status: 503 })
  const result = withDeviceToolFailureDetails(original, 'connect', error)
  expect(original.failureDiagnostic).toEqual(baseDiagnostic)
  expect(result.rpcResult).toBe(original.rpcResult)
  return result
}

function expectNoPrivateContent(value: unknown) {
  const encoded = JSON.stringify(value)
  expect(encoded).not.toContain(privateValue)
  expect(encoded).not.toContain(provider)
  return encoded
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  writes.write.mockReset()
})

describe('device failure evidence at the actual dispatch and issue boundary', () => {
  const cases = [
    {
      name: 'unsupported connect selection', action: 'connect',
      error: new VaultCliError('device_connect_provider_unavailable', privateValue, { provider }),
      deviceErrorCode: 'device_connect_provider_unavailable',
      projected: {
        code: 'device_connect_provider_unavailable',
        hint: 'Retry connect with a provider exposed in the current device context.',
        message: 'That device provider is not available to connect.',
        retryable: false, stage: 'device-connect',
      },
    },
    {
      name: 'missing reconcile capability', action: 'reconcile',
      error: new VaultCliError('device_reconcile_unavailable', privateValue, { accountId: privateValue }),
      deviceErrorCode: 'device_reconcile_unavailable',
      projected: {
        code: 'device_reconcile_unavailable', hint: 'Retry reconcile later for the same account.',
        message: 'Device account reconciliation is not available right now.',
        retryable: true, stage: 'device-reconcile',
      },
    },
    {
      name: 'typed connect HTTP failure', action: 'connect',
      error: hostedError('HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE'),
      deviceErrorCode: 'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE', deviceHttpStatus: 503,
      projected: {
        code: 'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE', hint: 'Retry connect later for the same provider.',
        message: 'Device connection links are temporarily unavailable.',
        retryable: true, stage: 'device-connect',
      },
    },
    {
      name: 'unknown code with structural HTTP evidence', action: 'connect',
      error: hostedError(privateValue), deviceHttpStatus: 503,
      projected: {
        code: 'device_operation_outcome_unknown',
        hint: 'Run list_accounts and inspect the current account state before deciding whether to retry connect.',
        message: 'The device operation completion could not be confirmed.',
        retryable: false, stage: 'device-connect',
      },
    },
  ] as const

  it.each(cases)('distinguishes $name without changing RPC bytes or effects', async (example) => {
    const args = example.action === 'connect'
      ? { action: example.action, provider }
      : { action: example.action, accountId: privateValue }
    const request = vi.fn<AssistantHostedDeviceTool['request']>().mockRejectedValue(example.error)
    const result = await dispatch(dispatchInput(args, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith(args, { signal: null })
    const diagnostic = {
      ...baseDiagnostic, deviceAction: example.action,
      ...('deviceErrorCode' in example ? { deviceErrorCode: example.deviceErrorCode } : {}),
      ...('deviceHttpStatus' in example ? { deviceHttpStatus: example.deviceHttpStatus } : {}),
    }
    expect(result.failureDiagnostic).toEqual(diagnostic)
    const expectedRpc = { success: false,
      contentItems: [{ type: 'inputText', text: JSON.stringify({ error: example.projected }) }] }
    const wire = JSON.stringify({ id: 1, result: result.rpcResult })
    expect(wire).toBe(JSON.stringify({ id: 1, result: expectedRpc }))
    expect(readCodexRpcSuccessResponse(JSON.parse(wire))?.result).toEqual(expectedRpc)
    for (const key of [...deviceKeys, 'failureDiagnostic', 'runtimeIssueInputs']) expect(wire).not.toContain(key)
    expectNoPrivateContent(result)
    expect(result.runtimeIssueInputs).toHaveLength(1)
    const issues = result.runtimeIssueInputs!
    const details = { requestKind: 'device', ...diagnostic, diagnosticRole: 'classification' }
    expect(issues[0]?.details).toEqual(details)
    expect(Object.keys(details).length).toBeLessThanOrEqual(8)

    recordAssistantRuntimeIssueInputsBestEffort({ issues, policy, vault: 'synthetic-vault' })
    await flushPendingAssistantRuntimeIssueWrites()
    expect(writes.write).toHaveBeenCalledTimes(1)
    const record = writes.write.mock.calls[0]![0].record
    const parsed = parseAssistantRuntimeIssueRecord(JSON.parse(expectNoPrivateContent(record)))
    expect(parsed.details).toEqual(details)
    // Every subset of optional fields, including a pre-change record, is accepted.
    for (let mask = 0; mask < 8; mask += 1) {
      const legacyDetails = { ...parsed.details }
      deviceKeys.forEach((key, index) => { if (mask & (1 << index)) delete legacyDetails[key] })
      expect(parseAssistantRuntimeIssueRecord({ ...parsed, details: legacyDetails }).details).toEqual(legacyDetails)
    }

    const rawEvent = { method: 'item/completed', params: { turnId: 'synthetic-turn', item: {
      id: 'synthetic-call', type: 'dynamicToolCall', namespace: 'murph', tool: 'device', success: false,
    } } }
    const event = { activeTurnId: 'synthetic-turn', rawEvent, normalizedEvent: normalizeCodexEvent(rawEvent) }
    const completion = createCodexActionRuntimeIssueTracker().recordEvent(event)
    expect(completion?.details).toMatchObject({ failureReason: 'reported_failure', diagnosticRole: 'completion' })
    for (const key of deviceKeys) expect(completion?.details).not.toHaveProperty(key)
    const reducer = createCodexActionDiagnosticsReducer()
    reducer.recordEvent({ ...event, observedAtMs: 1 })
    reducer.recordEvent({ ...event, observedAtMs: 2 })
    expect(reducer.buildTraceEvent({ codexThreadId: null, providerActionCount: 1,
      providerStartedAtMs: null, turnCorrelation: null, turnId: null })).toMatchObject({
      codexActionDynamicToolCallCount: 1, codexActionCompletedCount: 1, codexActionFailedCount: 1,
    })
  })

  it('keeps private decoy accessors inert through the real caught-error dispatch', async () => {
    const read = vi.fn(() => { throw new Error('Unexpected private read') })
    const error = Object.defineProperties(hostedError('HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE'),
      Object.fromEntries(['body', 'payload', 'cause', 'message', 'requestId', 'stack', 'toJSON']
        .map((key) => [key, { get: read }])))
    const request = vi.fn<AssistantHostedDeviceTool['request']>().mockRejectedValue(error)
    const result = await dispatch(dispatchInput({ action: 'connect', provider }, { request }))
    expect(request).toHaveBeenCalledExactlyOnceWith({ action: 'connect', provider }, { signal: null })
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect',
      deviceErrorCode: 'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE', deviceHttpStatus: 503 })
    expectNoPrivateContent(result)
    expect(read).not.toHaveBeenCalled()
  })

  it('keeps a nearby successful list unchanged with no diagnostics or new effects', async () => {
    const response = { action: 'list_accounts' as const, accounts: [], provider: null, sourceProvider: null }
    const request = vi.fn<AssistantHostedDeviceTool['request']>().mockResolvedValue(response)
    expect(await dispatch(dispatchInput({ action: 'list_accounts' }, { request }))).toEqual({
      rpcResult: { success: true, contentItems: [{ type: 'inputText',
        text: '{"accounts":[],"action":"list_accounts","provider":null,"sourceProvider":null}' }] },
    })
    expect(request).toHaveBeenCalledExactlyOnceWith({ action: 'list_accounts' }, { signal: null })
  })

  it.each([
    { action: privateValue }, { action: 'connect' }, { action: 'reconcile', accountId: '' },
    { action: 'list_accounts', [privateValue]: privateValue },
  ])('preserves invalid-argument rejection before the port (%#)', async (args) => {
    const request = vi.fn<AssistantHostedDeviceTool['request']>()
    const input = dispatchInput(args, { request })
    expect(input.request.kind).toBe('invalid-device-arguments')
    const result = await dispatch(input)
    expect(request).not.toHaveBeenCalled()
    expect(result.failureDiagnostic).toEqual({ failureStage: 'validation', failureReason: 'invalid_input' })
    expect(result.runtimeIssueInputs).toBeUndefined()
    const issue = createDynamicToolRuntimeIssueInput({ request: input.request, reason: 'invalid_arguments' })
    for (const key of deviceKeys) expect(issue.details).not.toHaveProperty(key)
    expectNoPrivateContent(issue)
  })

  it('preserves unsupported-tool and unavailable-port admission without device error evidence', async () => {
    const request = vi.fn<AssistantHostedDeviceTool['request']>()
    const input = dispatchInput({ content: privateValue }, { request }, privateValue)
    const result = await dispatch(input)
    expect(input.request.kind).toBe('unsupported-dynamic-tool')
    expect(result.rpcResult.success).toBe(false)
    expect(result.runtimeIssueInputs).toBeUndefined()
    expect(request).not.toHaveBeenCalled()
    const issue = createDynamicToolRuntimeIssueInput({ request: input.request, reason: 'unsupported' })
    for (const key of deviceKeys) expect(issue.details).not.toHaveProperty(key)
    expectNoPrivateContent(issue)
    const unavailable = await dispatch(dispatchInput({ action: 'list_accounts' }, null))
    expect(unavailable.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText',
      text: 'device management is unavailable for this turn' }] })
    expect(unavailable.failureDiagnostic).toEqual({ failureStage: 'execution', failureReason: 'unavailable' })
    expect(unavailable.runtimeIssueInputs).toHaveLength(1)
  })

  it('does not change the existing issue key/write caps or disabled capture', async () => {
    const request = vi.fn<AssistantHostedDeviceTool['request']>()
      .mockRejectedValue(hostedError('HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE'))
    const result = await dispatch(dispatchInput({ action: 'connect', provider }, { request }))
    const issue = result.runtimeIssueInputs![0]!
    const details = { ...issue.details,
      ...Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`extra${index}`, true])) }
    const issues = Array.from({ length: 10 }, () => ({ ...issue, details }))
    recordAssistantRuntimeIssueInputsBestEffort({ issues, policy, vault: 'synthetic-vault' })
    await flushPendingAssistantRuntimeIssueWrites()
    expect(writes.write).toHaveBeenCalledTimes(8)
    for (const [input] of writes.write.mock.calls) {
      const parsed = parseAssistantRuntimeIssueRecord(input.record)
      expect(Object.keys(parsed.details)).toHaveLength(24)
      expect(parsed.details).toMatchObject(issue.details!)
    }
    writes.write.mockClear()
    recordAssistantRuntimeIssueInputsBestEffort({ issues,
      policy: { ...policy, privateIssueCaptureEnabled: false }, vault: 'synthetic-vault' })
    expect(writes.write).not.toHaveBeenCalled()
  })
})

describe('bounded device-only error inspection (no recovery projection changes)', () => {
  it.each([
    'device_connect_provider_unavailable', 'device_reconcile_unavailable',
    'ACCOUNT_DISCONNECTED', 'ACCOUNT_REAUTHORIZATION_REQUIRED', 'CONNECTION_NOT_FOUND',
    'RECONCILE_WAKE_NOT_ACCEPTED', 'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE',
    'HOSTED_DEVICE_CONNECT_PERSONAL_MEMBER_REQUIRED', 'HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED',
    'HOSTED_DEVICE_CONNECT_LINK_INVALID_MESSAGING_RETURN_TARGET', 'INVALID_REQUEST',
  ])('retains only the exact owned code %s', (code) => {
    expect(annotate({ code }).failureDiagnostic).toEqual({ ...baseDiagnostic,
      deviceAction: 'connect', deviceErrorCode: code })
  })

  it.each([
    privateValue, 'device_connect_provider_unavailable_PRIVATE', ' DEVICE_RECONCILE_UNAVAILABLE',
    'device_reconcile_unavailable ', 'hosted_device_connect_link_unavailable',
    'HOSTED_DEVICE_CONNECT_LINK_UNAVAILABLE\n', 'x'.repeat(10_000), 'storage_unavailable',
    undefined, null, 503, {},
  ])('omits arbitrary or non-device codes without suppressing status or failure (%#)', (code) => {
    const result = annotate({ code, status: 503 })
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect', deviceHttpStatus: 503 })
    expect(result.rpcResult.success).toBe(false)
    expectNoPrivateContent(result)
  })

  it.each([100, 200, 400, 429, 503, 599])('retains finite top-level HTTP status %s independently of code', (status) => {
    expect(annotate({ code: 'device_connect_provider_unavailable', status }).failureDiagnostic).toEqual({
      ...baseDiagnostic, deviceAction: 'connect', deviceErrorCode: 'device_connect_provider_unavailable',
      deviceHttpStatus: status,
    })
  })

  it.each([undefined, null, -1, 0, 99, 600, 503.5, NaN, Infinity, '503', {}, new Number(503)])(
    'omits invalid HTTP status without coercion (%#)', (status) => {
      expect(annotate({ status }).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect' })
    },
  )

  it('uses only a nullish top-level status fallback; nested and inherited evidence is absent', () => {
    for (const error of [{ statusCode: 503 }, { status: null, statusCode: 503 }]) {
      expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect', deviceHttpStatus: 503 })
    }
    expect(annotate({ status: 429, statusCode: 503 }).failureDiagnostic?.deviceHttpStatus).toBe(429)
    expect(annotate({ status: '503', statusCode: 503 }).failureDiagnostic).not.toHaveProperty('deviceHttpStatus')
    const error = Object.create({ code: 'device_reconcile_unavailable', status: 503, statusCode: 503 })
    Object.assign(error, { cause: { code: 'device_reconcile_unavailable', status: 503 },
      context: { code: 'device_reconcile_unavailable', status: 503 }, body: privateValue, payload: privateValue })
    expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect' })
    expectNoPrivateContent(annotate(error))
  })

  it('does not execute getters, coercion, serialization hooks, or private decoys', () => {
    const read = vi.fn(() => { throw new Error('Unexpected private read') })
    const decoys = Object.fromEntries([
      'context', 'cause', 'body', 'payload', 'name', 'message', 'stack', 'provider',
      'accountId', 'arguments', 'results', 'response', 'error', 'toJSON', 'toString',
    ].map((key) => [key, { get: read }]))
    const error = Object.defineProperties({}, { ...decoys,
      code: { get: read }, status: { get: read }, statusCode: { get: read } })
    expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect' })
    const value = { toString: read, toJSON: read, [Symbol.toPrimitive]: read }
    expect(annotate({ code: value, status: value }).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect' })
    const known = Object.defineProperties({ code: 'device_reconcile_unavailable', status: 503 }, decoys)
    expect(annotate(known).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect',
      deviceErrorCode: 'device_reconcile_unavailable', deviceHttpStatus: 503 })
    expectNoPrivateContent(annotate(known))
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects ordinary/revoked proxies and never consults proxy prototypes or scalar values', () => {
    const trap = vi.fn(() => { throw new Error('Unexpected proxy trap') })
    const proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, ownKeys: trap, has: trap })
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    for (const error of [proxy, revoked.proxy, Object.create(proxy), { code: proxy, status: proxy }]) {
      expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, deviceAction: 'connect' })
    }
    expect(trap).not.toHaveBeenCalled()
  })

  it('never inspects success or unannotated legacy results, and preserves the parsed action vocabulary', () => {
    const trap = vi.fn(() => { throw new Error('Unexpected proxy trap') })
    const error = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap })
    const success = toolTextResult(true, 'Existing success.')
    const legacy = { rpcResult: { success: false, contentItems: [] } }
    expect(withDeviceToolFailureDetails(success, 'connect', error)).toBe(success)
    expect(withDeviceToolFailureDetails(legacy, 'connect', error)).toBe(legacy)
    expect(trap).not.toHaveBeenCalled()
    for (const args of [
      { action: 'list_accounts' }, { action: 'connect', provider },
      { action: 'reconcile', accountId: privateValue },
      { action: 'configure_no_data_outreach', mode: 'off', sourceProvider: 'garmin' },
    ]) {
      const input = dispatchInput(args, null)
      if (input.request.kind !== 'device') throw new Error('Expected a validated synthetic device request')
      expect(withDeviceToolFailureDetails(toolTextResult(false, 'Existing failure.'),
        input.request.request.action, null).failureDiagnostic?.deviceAction).toBe(args.action)
    }
  })
})
