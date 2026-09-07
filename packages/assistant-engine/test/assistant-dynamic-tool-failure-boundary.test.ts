import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import * as deviceHandler from '../src/assistant-codex/dynamic-tools/device.js'
import {
  classifyToolFailureError,
  createDynamicToolRuntimeIssueInput,
} from '../src/assistant-codex/tool-failure-diagnostics.js'
import { readCodexRpcSuccessResponse } from '../src/assistant-codex/app-server-protocol.js'

type DispatchInput = Parameters<typeof executeMurphDynamicToolRequest>[0]
type HostedTools = NonNullable<DispatchInput['hostedToolContext']>
const sentinel = 'SYNTHETIC_PRIVATE_ARGUMENT_OUTPUT_EXCEPTION'

function hostedTools(overrides: Partial<HostedTools> = {}): HostedTools {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    sendVaultFile: vi.fn(async () => { throw new Error('Unexpected file send') }),
    vaultFileSendAvailable: false,
    ...overrides,
  }
}

function dispatchInput(tool: string, args: unknown, overrides: Partial<DispatchInput> = {}): DispatchInput {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool, arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected synthetic request')
  return {
    env: {}, fetchImpl: vi.fn<typeof fetch>(), nextUsageOrdinal: vi.fn(() => 1),
    progressDelivery: null, hostedToolContext: hostedTools(), request, ...overrides,
  }
}

function expectPrivateClassification(result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>) {
  expect(result.runtimeIssueInputs).toHaveLength(1)
  const issues = JSON.stringify(result.runtimeIssueInputs)
  expect(issues).not.toContain(sentinel)
  // Use the actual RPC result and production envelope reader, not a telemetry-
  // enriched replacement result. Private fields must not become RPC content.
  const wire = JSON.stringify({ id: 1, result: result.rpcResult })
  expect(readCodexRpcSuccessResponse(JSON.parse(wire))?.result).toEqual(result.rpcResult)
  expect(wire).not.toContain('failureDiagnostic')
  expect(wire).not.toContain('runtimeIssueInputs')
}

afterEach(() => { vi.restoreAllMocks() })

describe('common dynamic-tool failure boundary', () => {
  it.each([
    ['device', { action: 'list_accounts' }, 'device', 'unavailable', 'execution',
      'device management is unavailable for this turn'],
    ['labs', { action: 'search', query: 'synthetic' }, 'labs', 'unavailable', 'execution',
      'lab catalog discovery is unavailable for this turn'],
    ['member_memory', { action: 'show' }, 'member-memory', 'authority_rejected', 'admission',
      'member-memory maintenance is unavailable for this turn'],
    ['pending_vault_files', { action: 'list' }, 'pending-vault-files-list', 'authority_rejected', 'admission',
      'pending vault-file management requires current user input in a direct conversation'],
    ['ask_grok', { question: sentinel }, 'ask-grok', 'unavailable', 'execution',
      'X search is not configured (XAI_API_KEY is missing); no search ran'],
    ['generate_voice_memo', { text: sentinel }, 'generate-voice-memo', 'unavailable', 'execution',
      'voice memo generation is only available for deliverable iMessage or Telegram replies'],
    ['plan_usage', {}, 'plan-usage', 'unavailable', 'execution',
      'plan usage is unavailable for this turn'],
    ['send_progress_update', { text: sentinel }, 'send-progress-update', 'unavailable', 'execution',
      'progress updates are not available for this turn'],
  ] as const)('classifies modular/inline %s without touching ports', async (tool, args, kind, reason, stage, text) => {
    const input = dispatchInput(tool, args)
    const result = await executeMurphDynamicToolRequest(input)
    expect(input.request.kind).toBe(kind)
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText', text }] })
    expect(result.failureDiagnostic).toEqual({ failureStage: stage, failureReason: reason })
    expect(result.runtimeIssueInputs?.[0]).toEqual({
      component: 'assistant.codex-dynamic-tool', operation: kind, phase: 'tool_call',
      issueKind: 'tool_error', severity: 'warning', errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED',
      summary: 'Murph dynamic tool execution failed.',
      details: { requestKind: kind, failureStage: stage, failureReason: reason, diagnosticRole: 'classification' },
    })
    expectPrivateClassification(result)
    expect(input.fetchImpl).not.toHaveBeenCalled()
    expect(input.nextUsageOrdinal).not.toHaveBeenCalled()
    expect(input.hostedToolContext?.sendVaultFile).not.toHaveBeenCalled()
  })

  it('covers an unannotated handler at the real dispatch boundary without parsing its text', async () => {
    const rpcResult = { success: false, contentItems: [{ type: 'inputText' as const,
      text: `${sentinel}: not_found timeout invalid_option` }] }
    vi.spyOn(deviceHandler, 'executeDeviceDynamicTool').mockResolvedValueOnce({ rpcResult })
    const request = vi.fn<NonNullable<HostedTools['deviceTool']>['request']>()
    const result = await executeMurphDynamicToolRequest(dispatchInput('device', { action: 'list_accounts' }, {
      hostedToolContext: hostedTools({ deviceTool: { request } }),
    }))
    expect(result.rpcResult).toBe(rpcResult)
    expect(result.failureDiagnostic).toEqual({ failureStage: 'result', failureReason: 'unknown' })
    expectPrivateClassification(result)
    expect(request).not.toHaveBeenCalled()
  })

  it('maps a typed modular exception without changing its projected RPC or port call', async () => {
    const error = new VaultCliError('device_reconcile_unavailable', sentinel, { providerErrorMessage: sentinel })
    const request = vi.fn<NonNullable<HostedTools['deviceTool']>['request']>().mockRejectedValue(error)
    const abortSignal = new AbortController().signal
    const args = { action: 'reconcile', accountId: sentinel }
    const result = await executeMurphDynamicToolRequest(dispatchInput('device', args, {
      abortSignal, hostedToolContext: hostedTools({ deviceTool: { request } }),
    }))
    expect(request).toHaveBeenCalledExactlyOnceWith(args, { signal: abortSignal })
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText', text: JSON.stringify({ error: {
      code: 'device_reconcile_unavailable',
      hint: 'Retry reconcile later for the same account.',
      message: 'Device account reconciliation is not available right now.',
      retryable: true, stage: 'device-reconcile',
    } }) }] })
    expect(result.failureDiagnostic).toEqual({ failureStage: 'execution', failureReason: 'handler_exception',
      errorCategory: 'unavailable' })
    expectPrivateClassification(result)
  })

  it('classifies typed HTTP context at an inline catch, not arbitrary provider detail', async () => {
    const error = new VaultCliError(sentinel, sentinel, {
      status: 429, providerErrorCode: sentinel, providerErrorMessage: sentinel,
      providerRequestId: sentinel, transportErrorName: sentinel,
    })
    const read = vi.fn<NonNullable<HostedTools['planUsageTool']>['read']>().mockRejectedValue(error)
    const result = await executeMurphDynamicToolRequest(dispatchInput('plan_usage', {}, {
      hostedToolContext: hostedTools({ planUsageTool: { read } }),
    }))
    expect(read).toHaveBeenCalledExactlyOnceWith({ includeSubscriptionActionQuote: true })
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText', text: 'plan usage could not be read' }] })
    expect(result.failureDiagnostic).toEqual({ failureStage: 'execution', failureReason: 'handler_exception',
      errorCategory: 'rate_limited' })
    expectPrivateClassification(result)
  })

  it('preserves the bounded calendar serializer rejection through its adapter', async () => {
    const result = await executeMurphDynamicToolRequest(dispatchInput('create_calendar_link', {
      title: 'Synthetic appointment', startsAt: '2030-01-01T10:00:00Z', endsAt: '2030-01-01T11:00:00Z',
      notes: '界'.repeat(600),
    }))
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText',
      text: 'The event details are too long for a reliable calendar link. Ask the member to shorten the notes or location.' }] })
    expect(result.failureDiagnostic).toEqual({ failureStage: 'result', failureReason: 'oversized_result' })
    expectPrivateClassification(result)
  })

  it('preserves successful device serialization and one port call', async () => {
    const response = { action: 'list_accounts' as const, accounts: [], provider: null, sourceProvider: null }
    const request = vi.fn<NonNullable<HostedTools['deviceTool']>['request']>().mockResolvedValue(response)
    const result = await executeMurphDynamicToolRequest(dispatchInput('device', { action: 'list_accounts' }, {
      hostedToolContext: hostedTools({ deviceTool: { request } }),
    }))
    expect(result).toEqual({ rpcResult: { success: true, contentItems: [{ type: 'inputText',
      text: JSON.stringify({ accounts: [], action: 'list_accounts', provider: null, sourceProvider: null }) }] } })
    expect(request).toHaveBeenCalledExactlyOnceWith({ action: 'list_accounts' }, { signal: null })
  })

  it('does not relabel an expected unavailable domain outcome as a failed call', async () => {
    const ensure = vi.fn<NonNullable<HostedTools['imessageContactTool']>['ensure']>()
      .mockResolvedValue({ status: 'unavailable', phoneNumber: null, verifiedSenderPhoneHint: null })
    const result = await executeMurphDynamicToolRequest(dispatchInput('imessage_contact', {}, {
      hostedToolContext: hostedTools({ imessageContactTool: { ensure },
        claimIMessageContactAssistantInputId: () => 'synthetic-input' }),
    }))
    expect(ensure).toHaveBeenCalledExactlyOnceWith({ assistantInputId: 'synthetic-input' })
    expect(result).toEqual({ rpcResult: { success: true, contentItems: [{ type: 'inputText',
      text: 'No Murph iMessage number was assigned. The member can continue using Telegram and ask again later. Never guess or invent a phone number, and do not promise when one will become available.' }] } })
  })
})

describe('existing intake and outer-exception owners', () => {
  it('keeps schema rejection with its existing safe digest and no duplicate branch row', async () => {
    const input = dispatchInput('device', { action: sentinel, [sentinel]: sentinel })
    expect(input.request.kind).toBe('invalid-device-arguments')
    const result = await executeMurphDynamicToolRequest(input)
    expect(result.rpcResult.success).toBe(false)
    expect(result.runtimeIssueInputs).toBeUndefined()
    const issue = createDynamicToolRuntimeIssueInput({ request: input.request, reason: 'invalid_arguments' })
    expect(issue).toMatchObject({ component: 'assistant.tool-validation', errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
      details: { failureStage: 'validation', failureReason: 'invalid_input', diagnosticRole: 'classification' } })
    expect(JSON.stringify(issue)).not.toContain(sentinel)
  })

  it('keeps unsupported names out of the existing admission diagnostic', async () => {
    const input = dispatchInput(sentinel, { content: sentinel })
    expect(input.request.kind).toBe('unsupported-dynamic-tool')
    const result = await executeMurphDynamicToolRequest(input)
    expect(result.rpcResult.success).toBe(false)
    expect(result.runtimeIssueInputs).toBeUndefined()
    const issue = createDynamicToolRuntimeIssueInput({ request: input.request, reason: 'unsupported' })
    expect(issue).toMatchObject({ errorCode: 'ASSISTANT_DYNAMIC_TOOL_UNSUPPORTED', details: {
      failureStage: 'admission', failureReason: 'unsupported_request', diagnosticRole: 'classification',
      namespacePresent: true, toolPresent: true,
    } })
    expect(JSON.stringify(issue)).not.toContain(sentinel)
  })

  it('rethrows the exact exception for the existing caller owner, without retry or extra dispatch', async () => {
    const error = Object.assign(new Error(sentinel), { code: 'invalid_option', stack: sentinel })
    const scope = vi.fn(() => { throw error })
    const input = dispatchInput('device', { action: 'list_accounts' }, {
      hostedToolContext: hostedTools({ currentHostedImageCompletionEffectScope: scope }),
    })
    await expect(executeMurphDynamicToolRequest(input)).rejects.toBe(error)
    expect(scope).toHaveBeenCalledTimes(1)
    expect(input.fetchImpl).not.toHaveBeenCalled()
    const issue = createDynamicToolRuntimeIssueInput({ request: input.request, reason: 'execution_failed', error })
    expect(issue).toMatchObject({ errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED', details: {
      failureStage: 'execution', failureReason: 'handler_exception', errorCategory: 'invalid_input',
      diagnosticRole: 'classification',
    } })
    expect(JSON.stringify(issue)).not.toContain(sentinel)
  })
})

describe('bounded typed exception metadata', () => {
  it.each([
    [new VaultCliError('opaque', sentinel, { timedOut: true }), 'timeout'],
    [Object.assign(new Error(sentinel), { statusCode: 404 }), 'not_found'],
    [Object.assign(new Error('not_found timeout invalid_option'), { code: sentinel }), 'unknown'],
    [{ code: 'x'.repeat(10_000), context: { status: 429 }, cause: { code: 'invalid_option' } }, 'unknown'],
    [null, 'unknown'],
  ])('maps only fixed scalar contract evidence %#', (error, expected) => {
    expect(classifyToolFailureError(error)).toBe(expected)
  })

  it('does not execute exception getters and cannot replace a result with a classifier exception', () => {
    const getter = vi.fn(() => { throw new Error(sentinel) })
    const error = Object.defineProperties({}, {
      code: { get: getter }, message: { get: getter }, name: { get: getter },
      status: { get: getter }, stack: { get: getter },
    })
    expect(classifyToolFailureError(error)).toBe('unknown')
    expect(getter).not.toHaveBeenCalled()
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: getter })
    expect(classifyToolFailureError(proxy)).toBe('unknown')
  })
})
