import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import { readCodexRpcSuccessResponse } from '../src/assistant-codex/app-server-protocol.js'
import {
  toolTextResult,
  withAutomationToolFailureDetails,
} from '../src/assistant-codex/tool-failure-diagnostics.js'
import type {
  AssistantHostedAutomationTool,
  AssistantHostedAutomationToolResponse,
  AssistantHostedDeviceTool,
} from '../src/assistant/execution-context.js'
import type { AssistantProgressDelivery } from '../src/assistant/turn-progress.js'
import {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
} from '../src/assistant/issue-reporting.js'

const writes = vi.hoisted(() => ({
  write: vi.fn<typeof import('@murphai/runtime-state/node').writePendingAssistantRuntimeIssueRecord>(),
}))
vi.mock('@murphai/runtime-state/node', async (original) => ({
  ...await original<typeof import('@murphai/runtime-state/node')>(),
  writePendingAssistantRuntimeIssueRecord: writes.write,
}))

type DispatchInput = Parameters<typeof executeMurphDynamicToolRequest>[0]
type AutomationPort = AssistantHostedAutomationTool['request']
type Result = Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>
const privateValue = 'SYNTHETIC_PRIVATE_AUTOMATION_CONTENT'
const updatedAt = '2030-01-15T10:00:00.000Z'
const schedule = { kind: 'dailyLocal', localTime: '14:00', timeZone: 'UTC' } as const
const cases = [
  { action: 'inspect', lookup: privateValue },
  { action: 'inspect_models', lookups: [privateValue] },
  { action: 'save', title: privateValue, instructions: privateValue, schedule },
  { action: 'patch', lookup: privateValue, expectedUpdatedAt: updatedAt, status: 'paused' },
  { action: 'reconcile', supportSeriesId: privateValue, desiredAutomationIds: [] },
] as const
const patch = cases[3]
const baseDiagnostic = {
  failureStage: 'execution', failureReason: 'handler_exception', errorCategory: 'unknown',
} as const
const failureRpc: Result['rpcResult'] = {
  success: false, contentItems: [{ type: 'inputText', text: 'automation operation is unavailable' }],
}

function inputFor(args: unknown, port: AutomationPort | null = null, options: {
  abortSignal?: AbortSignal
  deviceTool?: AssistantHostedDeviceTool
  tool?: string
} = {}): DispatchInput {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool: options.tool ?? 'automation', arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected production dynamic-tool request')
  return {
    request, env: {}, abortSignal: options.abortSignal,
    fetchImpl: vi.fn<typeof fetch>(), nextUsageOrdinal: vi.fn(() => 1),
    progressDelivery: { send: vi.fn<AssistantProgressDelivery['send']>() },
    hostedToolContext: {
      automationTool: port === null ? null : { request: port },
      deviceTool: options.deviceTool ?? null,
      computerToolsAvailable: false, currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [], vaultFileSendAvailable: false,
      sendVaultFile: vi.fn(async () => { throw new Error('Unexpected delivery') }),
    },
  }
}

function expectNoEffects(input: DispatchInput) {
  expect(input.fetchImpl).not.toHaveBeenCalled()
  expect(input.nextUsageOrdinal).not.toHaveBeenCalled()
  expect(input.progressDelivery?.send).not.toHaveBeenCalled()
  expect(input.hostedToolContext?.sendVaultFile).not.toHaveBeenCalled()
  expect(writes.write).not.toHaveBeenCalled()
}

async function dispatch(input: DispatchInput) {
  const result = await executeMurphDynamicToolRequest(input)
  expectNoEffects(input)
  return result
}

function expectFailure(result: Result, action: string, code?: string) {
  const diagnostic = { ...baseDiagnostic, automationAction: action,
    ...(code === undefined ? {} : { automationErrorCode: code }) }
  expect(result).toEqual({ rpcResult: failureRpc, failureDiagnostic: diagnostic,
    runtimeIssueInputs: [{
      component: 'assistant.codex-dynamic-tool', operation: 'automation',
      errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED', phase: 'tool_call',
      issueKind: 'tool_error', severity: 'warning', summary: 'Murph dynamic tool execution failed.',
      details: { requestKind: 'automation', ...diagnostic, diagnosticRole: 'classification' },
    }],
  })
  const wire = JSON.stringify({ id: 1, result: result.rpcResult })
  expect(wire).toBe(JSON.stringify({ id: 1, result: failureRpc }))
  expect(readCodexRpcSuccessResponse(JSON.parse(wire))?.result).toEqual(failureRpc)
  expect(wire).not.toMatch(/automationAction|automationErrorCode|failureDiagnostic|runtimeIssueInputs/u)
  expect(JSON.stringify(result.runtimeIssueInputs)).not.toMatch(/SYNTHETIC_PRIVATE|synthetic-thread|synthetic-turn|synthetic-call|2030-01-15/u)
}

function responseFor(action: typeof cases[number]['action']): AssistantHostedAutomationToolResponse {
  if (action === 'reconcile') return { action, supportSeriesId: privateValue, archivedCount: 0,
    matchedCount: 0, missingDesiredAutomationIds: [], unchangedCount: 0 }
  const common = { automationId: privateValue, lookupId: privateValue, schedule, updatedAt,
    effectiveTimeZone: 'UTC', occurrenceProjection: { status: 'pending' as const },
    routeBinding: 'preserved' as const, status: 'active' as const }
  return action === 'inspect' || action === 'inspect_models'
    ? { ...common, action: 'inspect', instructions: privateValue, title: privateValue }
    : { ...common, action, created: action === 'save' }
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  writes.write.mockReset()
  vi.restoreAllMocks()
})

describe('private caught automation evidence through the real dynamic contract', () => {
  it.each(cases)('retains parsed $action for an uncatalogued handler failure without retry', async (args) => {
    const error = Object.assign(new Error(privateValue), {
      code: privateValue, name: privateValue, stack: privateValue,
      cause: { code: 'VAULT_AUTOMATION_MISSING' }, context: { action: privateValue },
    })
    const port = vi.fn<AutomationPort>().mockRejectedValue(error)
    const abortSignal = new AbortController().signal
    const input = inputFor(args, port, { abortSignal })
    if (input.request.kind !== 'automation') throw new Error('Expected schema-valid automation')
    const before = JSON.stringify(input.request)
    expectFailure(await dispatch(input), args.action)
    expect(port).toHaveBeenCalledExactlyOnceWith(args.action === 'inspect_models'
      ? { action: 'inspect', lookup: privateValue, view: 'model_review' }
      : input.request.request, { signal: abortSignal })
    expect(JSON.stringify(input.request)).toBe(before)
  })

  it.each([
    { args: patch, code: 'VAULT_AUTOMATION_EMPTY_PATCH' },
    { args: patch, code: 'VAULT_AUTOMATION_MISSING' },
    { args: cases[4], code: 'VAULT_AUTOMATION_RECONCILIATION_LIMIT_EXCEEDED' },
  ])('retains only the exact core code $code without reclassifying it', async ({ args, code }) => {
    const error = Object.defineProperty(new Error(privateValue), 'code', { value: code })
    const port = vi.fn<AutomationPort>().mockRejectedValue(error)
    const result = await dispatch(inputFor(args, port))
    expectFailure(result, args.action, code)
    expect(port).toHaveBeenCalledTimes(1)
    // The catch does not persist. Only the established reporter may write later.
    recordAssistantRuntimeIssueInputsBestEffort({ issues: result.runtimeIssueInputs!, vault: 'synthetic-vault',
      policy: { environment: 'hosted', surface: null, privateIssueCaptureEnabled: true } })
    await flushPendingAssistantRuntimeIssueWrites()
    expect(writes.write).toHaveBeenCalledTimes(1)
    const stored = writes.write.mock.calls[0]![0].record
    const parsed = parseAssistantRuntimeIssueRecord(JSON.parse(JSON.stringify(stored)))
    expect(parsed.details).toEqual(result.runtimeIssueInputs![0]!.details)
    expect(JSON.stringify(parsed.details)).not.toContain(privateValue)
    const { automationAction: _action, automationErrorCode: _code, ...legacy } = parsed.details!
    expect(parseAssistantRuntimeIssueRecord({ ...parsed, details: legacy }).details).toEqual(legacy)
  })

  it.each([
    undefined, null, 123, true, {}, ['VAULT_AUTOMATION_MISSING'], Symbol('synthetic'),
    'vault_automation_missing', 'VAULT_AUTOMATION_MISSING_EXTRA',
    ' VAULT_AUTOMATION_MISSING', 'EIO', 'ZodError',
  ])('omits an unadmitted or non-scalar source code %#', async (code) => {
    const port = vi.fn<AutomationPort>().mockRejectedValue({ code, message: privateValue })
    expectFailure(await dispatch(inputFor(patch, port)), 'patch')
    expect(port).toHaveBeenCalledTimes(1)
  })

  it.each([null, undefined, 17, privateValue])('keeps an unsupported thrown value unknown %#', async (error) => {
    const port = vi.fn<AutomationPort>().mockRejectedValue(error)
    expectFailure(await dispatch(inputFor(patch, port)), 'patch')
    expect(port).toHaveBeenCalledTimes(1)
  })

  it('does not admit inherited, nested, named or message-shaped codes', async () => {
    const inherited: object = Object.create({ code: 'VAULT_AUTOMATION_MISSING' })
    for (const error of [inherited, {
      name: 'VAULT_AUTOMATION_MISSING', message: 'VAULT_AUTOMATION_EMPTY_PATCH',
      stack: 'VAULT_AUTOMATION_RECONCILIATION_LIMIT_EXCEEDED',
      cause: { code: 'VAULT_AUTOMATION_MISSING' }, context: { code: 'VAULT_AUTOMATION_MISSING' },
    }]) {
      const port = vi.fn<AutomationPort>().mockRejectedValue(error)
      expectFailure(await dispatch(inputFor(patch, port)), 'patch')
      expect(port).toHaveBeenCalledTimes(1)
    }
  })
})

describe('unchanged quiet, success, validation and cancellation paths', () => {
  it.each(cases)('keeps successful $action content and its single port call without diagnostics', async (args) => {
    const response = responseFor(args.action)
    const port = vi.fn<AutomationPort>().mockResolvedValue(response)
    const result = await dispatch(inputFor(args, port))
    const { lookupId: _lookup, ...payload } = 'lookupId' in response
      ? response : { ...response, lookupId: undefined }
    expect(result).toEqual({ rpcResult: { success: true, contentItems: [{ type: 'inputText', text: expect.any(String) }] } })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual(args.action === 'inspect_models'
      ? { action: 'inspect_models', results: [{ lookup: privateValue, ...payload }], requiresIndividualInspection: [] }
      : payload)
    expect(port).toHaveBeenCalledTimes(1)
  })

  it.each([cases[0], cases[1]])('keeps $action missing lookup successful and private fields absent', async (args) => {
    const port = vi.fn<AutomationPort>().mockRejectedValue({ code: 'automation_not_found', message: privateValue })
    const result = await dispatch(inputFor(args, port))
    const payload = args.action === 'inspect'
      ? { action: 'inspect', found: false }
      : { action: 'inspect_models', results: [{ lookup: privateValue, found: false }], requiresIndividualInspection: [] }
    expect(result).toEqual({ rpcResult: { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(payload) }] } })
    expect(port).toHaveBeenCalledTimes(1)
  })

  it('leaves the existing conflict result and classification unchanged', async () => {
    const port = vi.fn<AutomationPort>().mockRejectedValue({ code: 'VAULT_AUTOMATION_CONFLICT' })
    const result = await dispatch(inputFor(patch, port))
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText',
      text: 'automation changed since the last readback; inspect it again and decide from the current stored schedule before retrying' }] })
    expect(result.failureDiagnostic).toEqual({ failureStage: 'execution', failureReason: 'conflict' })
    expect(result.runtimeIssueInputs?.[0]?.details).toEqual({ requestKind: 'automation',
      failureStage: 'execution', failureReason: 'conflict', diagnosticRole: 'classification' })
    expect(port).toHaveBeenCalledTimes(1)
  })

  it.each([{ action: privateValue }, { action: 'patch', lookup: privateValue }, { action: 'inspect_models', lookups: [] }])(
    'does not fabricate an action or code from failed parsing %#', async (args) => {
      const port = vi.fn<AutomationPort>()
      const input = inputFor({ ...args, code: 'VAULT_AUTOMATION_MISSING' }, port)
      expect(input.request.kind).toBe('invalid-automation-arguments')
      const result = await dispatch(input)
      expect(result.failureDiagnostic).toEqual({ failureStage: 'validation', failureReason: 'invalid_input' })
      expect(result.runtimeIssueInputs).toBeUndefined()
      expect(port).not.toHaveBeenCalled()
    },
  )

  it('leaves unavailable automation and unrelated device failures without automation fields', async () => {
    const unavailable = await dispatch(inputFor(patch))
    expect(unavailable.failureDiagnostic).toEqual({ failureStage: 'execution', failureReason: 'unavailable' })
    const automation = vi.fn<AutomationPort>()
    const device = vi.fn<AssistantHostedDeviceTool['request']>().mockRejectedValue({ code: 'VAULT_AUTOMATION_MISSING' })
    const input = inputFor({ action: 'list_accounts' }, automation, {
      tool: 'device', deviceTool: { request: device },
    })
    const result = await dispatch(input)
    expect(result.rpcResult.success).toBe(false)
    expect(result.failureDiagnostic).not.toHaveProperty('automationAction')
    expect(result.failureDiagnostic).not.toHaveProperty('automationErrorCode')
    expect(result.runtimeIssueInputs?.[0]?.details).not.toHaveProperty('automationAction')
    expect(result.runtimeIssueInputs?.[0]?.details).not.toHaveProperty('automationErrorCode')
    expect(automation).not.toHaveBeenCalled()
    expect(device).toHaveBeenCalledTimes(1)
  })

  it.each([{ args: patch, calls: 1 }, { args: cases[1], calls: 0 }])(
    'preserves pre-aborted $args.action dispatch behavior without a cancellation inference', async ({ args, calls }) => {
      const controller = new AbortController()
      const reason = new Error(privateValue)
      controller.abort(reason)
      const port = vi.fn<AutomationPort>().mockRejectedValue(reason)
      expectFailure(await dispatch(inputFor(args, port, { abortSignal: controller.signal })), args.action)
      expect(port).toHaveBeenCalledTimes(calls)
      expect(controller.signal.reason).toBe(reason)
    },
  )
})

describe('automation optional evidence rejects hostile objects without extra evaluation', () => {
  it('does not invoke getters or proxy traps at the new evidence boundary', () => {
    const getter = vi.fn(() => { throw new Error(privateValue) })
    const accessor = Object.defineProperties({}, { code: { get: getter }, name: { get: getter },
      message: { get: getter }, stack: { get: getter }, cause: { get: getter }, context: { get: getter } })
    const proxy = new Proxy({}, { get: getter, getOwnPropertyDescriptor: getter, getPrototypeOf: getter })
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const result = toolTextResult(false, 'automation operation is unavailable', 'handler_exception')
    for (const error of [accessor, proxy, revoked.proxy]) {
      const enriched = withAutomationToolFailureDetails(result, 'patch', error)
      expect(enriched.failureDiagnostic).toEqual({ ...baseDiagnostic, automationAction: 'patch' })
      expect(enriched.rpcResult).toBe(result.rpcResult)
    }
    expect(getter).not.toHaveBeenCalled()
    const success = toolTextResult(true, 'synthetic successful result')
    expect(withAutomationToolFailureDetails(success, 'patch', proxy)).toBe(success)
    const unannotated: Result = { rpcResult: failureRpc }
    expect(withAutomationToolFailureDetails(unannotated, 'patch', proxy)).toBe(unannotated)
    expect(getter).not.toHaveBeenCalled()
  })

  it('adds no getter reads beyond the existing patch conflict predicate', async () => {
    // The legacy behavior guard reads code once. The new diagnostic reader must
    // not execute it again or admit its returned code as own-data evidence.
    const getter = vi.fn(() => 'VAULT_AUTOMATION_EMPTY_PATCH')
    const error = Object.defineProperty({}, 'code', { get: getter })
    const port = vi.fn<AutomationPort>().mockRejectedValue(error)
    expectFailure(await dispatch(inputFor(patch, port)), 'patch')
    expect(getter).toHaveBeenCalledTimes(1)
    expect(port).toHaveBeenCalledTimes(1)
  })

  it('adds no proxy traps beyond the existing behavior predicate and category classifier', async () => {
    const get = vi.fn(Reflect.get)
    const getPrototypeOf = vi.fn(Reflect.getPrototypeOf)
    const getOwnPropertyDescriptor = vi.fn(Reflect.getOwnPropertyDescriptor)
    const error = new Proxy({ code: 'VAULT_AUTOMATION_EMPTY_PATCH' }, { get, getPrototypeOf, getOwnPropertyDescriptor })
    const port = vi.fn<AutomationPort>().mockRejectedValue(error)
    expectFailure(await dispatch(inputFor(patch, port)), 'patch')
    expect(get.mock.calls.map((call) => call[1])).toEqual(['code'])
    expect(getPrototypeOf).toHaveBeenCalledTimes(1)
    expect(getOwnPropertyDescriptor.mock.calls.map((call) => call[1])).toEqual(['code', 'status', 'statusCode'])
    expect(port).toHaveBeenCalledTimes(1)
  })

  it('preserves the exact legacy rejection when the behavior predicate getter throws', async () => {
    const thrown = new Error(privateValue)
    const getter = vi.fn(() => { throw thrown })
    const port = vi.fn<AutomationPort>().mockRejectedValue(Object.defineProperty({}, 'code', { get: getter }))
    const input = inputFor(patch, port)
    await expect(executeMurphDynamicToolRequest(input)).rejects.toBe(thrown)
    expect(getter).toHaveBeenCalledTimes(1)
    expect(port).toHaveBeenCalledTimes(1)
    expectNoEffects(input)
  })
})
