import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.js'
import {
  createCodexActionDiagnosticsReducer,
  createCodexActionRuntimeIssueTracker,
} from '../src/assistant-codex/action-diagnostics.js'
import { normalizeCodexEvent } from '../src/assistant-codex-events.js'
import type {
  AssistantHostedAutomationTool,
  AssistantHostedAutomationToolRequest,
  AssistantHostedAutomationToolResponse,
} from '../src/assistant/execution-context.js'
import {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
  type AssistantRuntimeIssueInput,
} from '../src/assistant/issue-reporting.js'

const writes = vi.hoisted(() => ({
  write: vi.fn<typeof import('@murphai/runtime-state/node').writePendingAssistantRuntimeIssueRecord>(),
}))
vi.mock('@murphai/runtime-state/node', async (importOriginal) => ({
  ...await importOriginal<typeof import('@murphai/runtime-state/node')>(),
  writePendingAssistantRuntimeIssueRecord: writes.write,
}))

const sentinel = 'SYNTHETIC_FORBIDDEN_CONTENT'
const updatedAt = '2030-01-15T10:00:00.000Z'
const schedule = { kind: 'dailyLocal', localTime: '14:00', timeZone: 'UTC' } as const
const requests: AssistantHostedAutomationToolRequest[] = [
  { action: 'inspect', lookup: sentinel },
  { action: 'patch', lookup: sentinel, expectedUpdatedAt: updatedAt, status: 'paused' },
  { action: 'save', title: sentinel, instructions: sentinel, schedule },
  { action: 'reconcile', supportSeriesId: sentinel, desiredAutomationIds: [] },
]

function responseFor(action: AssistantHostedAutomationToolRequest['action']): AssistantHostedAutomationToolResponse {
  if (action === 'reconcile') {
    return { action, supportSeriesId: sentinel, archivedCount: 0, matchedCount: 0,
      missingDesiredAutomationIds: [], unchangedCount: 0 }
  }
  const common = { automationId: sentinel, lookupId: sentinel, schedule: { ...schedule }, updatedAt,
    effectiveTimeZone: 'UTC', occurrenceProjection: { status: 'pending' as const },
    routeBinding: 'preserved' as const, status: 'active' as const }
  return action === 'inspect'
    ? { ...common, action, instructions: sentinel, title: sentinel }
    : { ...common, action, created: action === 'save' }
}

function parseAutomation(argumentsValue: unknown) {
  const parsed = readAutomationDynamicToolRequest({ tool: 'automation', arguments: argumentsValue })
  if (parsed?.kind !== 'automation') throw new Error('Expected synthetic automation request')
  return parsed
}

function expectFailure(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
  action: string, reason: string, text: string, errorCategory?: string,
  failureStage = 'execution',
) {
  const requestKind = action === 'attach_follow_up' ? 'attach-follow-up' : 'automation'
  const diagnostic = { failureStage, failureReason: reason,
    ...(errorCategory === undefined ? {} : { errorCategory }) }
  expect(result).toEqual({
    rpcResult: { success: false, contentItems: [{ type: 'inputText', text }] },
    failureDiagnostic: diagnostic,
    runtimeIssueInputs: [{
      component: 'assistant.codex-dynamic-tool', operation: requestKind,
      errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED', phase: 'tool_call',
      issueKind: 'tool_error', severity: 'warning', summary: 'Murph dynamic tool execution failed.',
      details: { requestKind, ...diagnostic, diagnosticRole: 'classification' },
    }],
  })
  expect(JSON.stringify(result.runtimeIssueInputs)).not.toContain(sentinel)
}

function commandEvent(output: unknown, command: string | undefined = 'vault-cli event show synthetic --format json', exitCode = 1) {
  return { method: 'item/completed', params: { threadId: sentinel, turnId: 'synthetic-turn',
    item: { type: 'commandExecution', id: sentinel, command, exitCode, aggregatedOutput: output } } }
}
function eventInput(rawEvent: unknown) {
  return { activeTurnId: 'synthetic-turn', normalizedEvent: normalizeCodexEvent(rawEvent), rawEvent }
}
function commandIssue(output: unknown, command?: string, exitCode?: number) {
  return createCodexActionRuntimeIssueTracker().recordEvent(eventInput(commandEvent(output, command, exitCode)))
}
function envelope(code: string, stage?: string) {
  return { code, message: sentinel, retryable: false, ...(stage ? { stage } : {}),
    fieldErrors: [{ path: sentinel, message: sentinel }], cause: { code: sentinel } }
}

async function dispatch(argumentsValue: unknown, options: {
  automationTool?: AssistantHostedAutomationTool | null
  abortSignal?: AbortSignal
  followUpAttachmentAllowed?: boolean
} = {}) {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool: 'automation', arguments: argumentsValue,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected synthetic dynamic-tool request')
  const fetchImpl = vi.fn<typeof fetch>()
  const sendVaultFile = vi.fn(async () => { throw new Error('Unexpected file send') })
  const nextUsageOrdinal = vi.fn(() => 0)
  const result = await executeMurphDynamicToolRequest({
    env: {}, fetchImpl, nextUsageOrdinal, progressDelivery: null, request,
    abortSignal: options.abortSignal,
    followUpAttachmentAllowed: options.followUpAttachmentAllowed,
    hostedToolContext: {
      automationTool: options.automationTool ?? null, deviceTool: null,
      computerToolsAvailable: false, currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [], sendVaultFile, vaultFileSendAvailable: false,
    },
  })
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(sendVaultFile).not.toHaveBeenCalled()
  expect(nextUsageOrdinal).not.toHaveBeenCalled()
  expect(writes.write).not.toHaveBeenCalled()
  return result
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  writes.write.mockReset()
})

describe('automation branch diagnostics', () => {
  it.each(requests)('labels unavailable $action without dispatching or persisting', async (request) => {
    expectFailure(await dispatch(request), request.action, 'unavailable',
      'automation management is unavailable for this turn')
  })

  it.each(requests)('preserves successful $action RPC content and one port call', async (request) => {
    const response = responseFor(request.action)
    const port = vi.fn<AssistantHostedAutomationTool['request']>().mockResolvedValue(response)
    const result = await dispatch(request, { automationTool: { request: port } })
    const { lookupId: _lookupId, ...payload } = 'lookupId' in response
      ? response : { ...response, lookupId: undefined }
    expect(result).toEqual({ rpcResult: { success: true,
      contentItems: [{ type: 'inputText', text: expect.any(String) }] } })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual(payload)
    expect(port).toHaveBeenCalledExactlyOnceWith(parseAutomation(request).request, { signal: null })
  })

  it('keeps onboarding rejection before the port and follow-up authority/patch unchanged', async () => {
    const port = vi.fn<AssistantHostedAutomationTool['request']>()
    const result = await dispatch({ action: 'save_onboarding_first_personal_read' },
      { automationTool: { request: port } })
    expectFailure(result, 'save', 'authority_rejected',
      'onboarding first read is unavailable outside its completion transition', undefined, 'admission')
    expect(port).not.toHaveBeenCalled()
    const followUp = { afterMinutes: 20, instructions: sentinel }
    const args = { action: 'attach_follow_up', ...followUp }
    expectFailure(await dispatch(args), 'attach_follow_up', 'authority_rejected',
      'follow-up attachment is unavailable for this turn', undefined, 'admission')
    expect(await dispatch(args, { followUpAttachmentAllowed: true })).toEqual({
      rpcResult: { success: true, contentItems: [{ type: 'inputText',
        text: 'One optional follow-up is attached to this final message, subject to delivery and conversation limits. Do not promise it will send.' }] },
      followUpRequestPatch: followUp,
    })
  })

  it.each([
    ['VAULT_AUTOMATION_CONFLICT', 'conflict', undefined,
      'automation changed since the last readback; inspect it again and decide from the current stored schedule before retrying'],
    ['invalid_option', 'handler_exception', 'invalid_input', 'automation operation is unavailable'],
    ['automation_not_found', 'handler_exception', 'not_found', 'automation operation is unavailable'],
    [sentinel, 'handler_exception', 'unknown', 'automation operation is unavailable'],
    [undefined, 'handler_exception', 'unknown', 'automation operation is unavailable'],
  ] as const)('labels only the owned top-level handler code %s', async (code, reason, handlerCode, text) => {
    const error = Object.assign(new Error(`${sentinel} VAULT_AUTOMATION_CONFLICT`), {
      code, cause: { code: 'VAULT_AUTOMATION_CONFLICT', message: sentinel }, context: { value: sentinel },
    })
    const port = vi.fn<AssistantHostedAutomationTool['request']>().mockRejectedValue(error)
    const abortSignal = new AbortController().signal
    const request = parseAutomation(requests[1])
    const result = await dispatch(requests[1], { automationTool: { request: port }, abortSignal })
    expectFailure(result, 'patch', reason, text, handlerCode)
    expect(port).toHaveBeenCalledExactlyOnceWith(request.request, { signal: abortSignal })
    expect(writes.write).not.toHaveBeenCalled()
  })

  it('keeps inspect not-found successful without a diagnostic or retry', async () => {
    const port = vi.fn<AssistantHostedAutomationTool['request']>().mockRejectedValue(
      Object.assign(new Error(sentinel), { code: 'automation_not_found', context: { value: sentinel } }),
    )
    expect(await dispatch(requests[0], { automationTool: { request: port } })).toEqual({
      rpcResult: { success: true, contentItems: [{ type: 'inputText', text: '{"action":"inspect","found":false}' }] },
    })
    expect(port).toHaveBeenCalledTimes(1)
  })

  it.each(['action_result_mismatch', 'oversized_result', 'result_serialization_failed'] as const)(
    'classifies %s without changing the rejection reply', async (reason) => {
      const response = responseFor(reason === 'action_result_mismatch' ? 'reconcile' : 'inspect')
      if (response.action === 'inspect') {
        response.instructions = reason === 'oversized_result' ? sentinel.repeat(20_000) : sentinel
        if (reason === 'result_serialization_failed') {
          // A synthetic adapter serializer fault, not an oversized result.
          Object.defineProperty(response.schedule, 'toJSON', { configurable: true,
            value: () => { throw new Error(sentinel) } })
        }
      }
      const port = vi.fn<AssistantHostedAutomationTool['request']>().mockResolvedValue(response)
      expectFailure(await dispatch(requests[0], { automationTool: { request: port } }), 'inspect', reason,
        reason === 'action_result_mismatch'
          ? 'automation operation returned an unexpected result' : 'automation result is too large', undefined, 'result')
      expect(port).toHaveBeenCalledTimes(1)
    },
  )
})

describe('recognized CLI failure diagnostics', () => {
  it.each([
    ['VALIDATION_ERROR', undefined, 'invalid_input'], ['invalid_option', undefined, 'invalid_input'],
    ['invalid_payload', undefined, 'invalid_input'], ['VAULT_INVALID_INPUT', undefined, 'invalid_input'],
    ['contract_invalid', 'validation', 'invalid_input'], ['contract_invalid', undefined, 'unknown'],
    ['not_found', undefined, 'not_found'], ['conflict', undefined, 'conflict'],
    ['storage_unavailable', undefined, 'unavailable'], [sentinel, undefined, 'unknown'],
  ] as const)('projects %s from direct and full JSON only', (code, stage, category) => {
    const error = envelope(code, stage)
    for (const body of [error, { ok: false, error, meta: { command: sentinel, duration: '0ms' } }]) {
      const issue = commandIssue(JSON.stringify(body))
      expect(issue).toEqual({
        component: 'assistant.codex-action', operation: 'command.execution', phase: 'provider_turn',
        issueKind: 'tool_error', severity: 'warning', errorCode: 'CODEX_COMMAND_EXIT_NONZERO',
        summary: 'Codex command execution failed during provider turn.',
        details: { failureStage: 'execution', failureReason: 'nonzero_exit', diagnosticRole: 'completion',
          errorCategory: category, actionKind: 'command.execution', durationMsBucket: 'unknown', outputBytesBucket: 'lt_1kb',
          commandFamily: 'vault-cli event', commandOrdinal: 1, exitCode: 1, vaultCliErrorCategory: category },
      })
      expect(JSON.stringify(issue)).not.toContain(sentinel)
    }
  })

  it.each([
    undefined, '', 'not_found', 'null', '[]', '{', '{"code":"not_found"}',
    '{"ok":true,"error":{"code":"not_found","message":"synthetic"}}',
    '{"code":"not_found","message":"synthetic","retryable":"yes"}',
    JSON.stringify({ cause: envelope('not_found') }),
    JSON.stringify(envelope(sentinel)).replace(sentinel, 'unrecognized'),
    `${JSON.stringify(envelope('not_found'))}\ntruncated`,
    JSON.stringify(envelope('not_found')).slice(0, -1),
    JSON.stringify({ ...envelope('not_found'), message: sentinel.repeat(1000) }),
    JSON.stringify({ ...envelope('not_found'), message: '界'.repeat(6000) }),
  ])('keeps malformed, incomplete or excessive output unknown (%#)', (output) => {
    const issue = commandIssue(output)
    expect(issue?.details?.vaultCliErrorCategory).toBe('unknown')
    expect(JSON.stringify(issue)).not.toContain(sentinel)
  })

  it('accepts the byte limit, rejects one byte over, and does not inspect a fallback fragment', () => {
    const json = JSON.stringify(envelope('conflict'))
    const exact = json + ' '.repeat(16_384 - Buffer.byteLength(json))
    expect(commandIssue(exact)?.details?.vaultCliErrorCategory).toBe('conflict')
    expect(commandIssue(exact + ' ')?.details?.vaultCliErrorCategory).toBe('unknown')
    const raw = commandEvent('truncated')
    Object.assign(raw.params.item, { aggregated_output: json })
    expect(createCodexActionRuntimeIssueTracker().recordEvent(eventInput(raw))?.details?.vaultCliErrorCategory).toBe('unknown')
  })

  it('does not parse oversized output or traverse nested error details', () => {
    const parse = vi.spyOn(JSON, 'parse')
    try {
      commandIssue(' '.repeat(16_385))
      commandIssue('界'.repeat(6000))
      expect(parse).not.toHaveBeenCalled()
      const output = JSON.stringify({ ...envelope('conflict'), cause: { nested: [sentinel] } })
      expect(commandIssue(output)?.details?.vaultCliErrorCategory).toBe('conflict')
      expect(parse).toHaveBeenCalledExactlyOnceWith(output)
    } finally { parse.mockRestore() }
  })

  it.each(['false', 'echo vault-cli event show', "bash -lc 'vault-cli event show synthetic; false'", 'unknown-cli event show synthetic', 'node script.js'])(
    'does not classify another executable as Vault CLI: %s', (command) => {
      expect(commandIssue(JSON.stringify(envelope('not_found')), command)?.details).not.toHaveProperty('vaultCliErrorCategory')
    },
  )

  it.each([
    ['vault-cli automation inspect synthetic', 'vault-cli automation'],
    ['vault-cli knowledge show synthetic', 'vault-cli knowledge'],
    ['vault-cli meal add synthetic', 'meal.add'],
    ['vault-cli meal edit synthetic', 'meal.edit'],
    ['vault-cli meal nutrients synthetic', 'meal.nutrients'],
    ['vault-cli meal show synthetic', 'meal.show'],
    ['vault-cli meal totals synthetic', 'meal.totals'],
    ['vault-cli food search-labels synthetic', 'food.search-labels'],
    ['vault-cli food search-labels-batch synthetic', 'food.search-labels-batch'],
    ['vault-cli goal list', 'goal.list'],
    ['vault-cli goal show synthetic', 'goal.show'],
    ['vault-cli memory show', 'vault-cli memory show'],
    ['vault-cli memory forget synthetic', 'command'],
    ['vault-cli batch synthetic', 'vault-cli batch'],
    ['vault-cli future-command synthetic', 'command'],
    ['vault-cli --format json event show synthetic', 'command'],
  ])('recognizes the executable independently of finite family %s', (command, family) => {
    expect(commandIssue(JSON.stringify(envelope('not_found')), command)?.details).toMatchObject({
      commandFamily: family, vaultCliErrorCategory: 'not_found', errorCategory: 'not_found',
      failureStage: 'execution', failureReason: 'nonzero_exit', diagnosticRole: 'completion',
    })
  })

  it('keeps successes/no-match quiet and started-only family, wrappers and dedupe intact', () => {
    const output = JSON.stringify(envelope('not_found'))
    expect(commandIssue(output, undefined, 0)).toBeNull()
    expect(commandIssue(output, 'rg synthetic', 1)).toBeNull()
    const tracker = createCodexActionRuntimeIssueTracker()
    const start = commandEvent(undefined, "bash -lc 'vault-cli event show synthetic --format json'")
    start.method = 'item/started'
    expect(tracker.recordEvent(eventInput(start))).toBeNull()
    const complete = commandEvent(output)
    Reflect.deleteProperty(complete.params.item, 'command')
    expect(tracker.recordEvent({ ...eventInput(complete), activeTurnId: 'other-turn' })).toBeNull()
    expect(tracker.recordEvent(eventInput(complete))?.details).toMatchObject({
      commandFamily: 'vault-cli event', commandOrdinal: 1, vaultCliErrorCategory: 'not_found',
    })
    expect(tracker.recordEvent(eventInput(complete))).toBeNull()
  })
})

describe('opaque MCP and command failures', () => {
  it.each([
    ['mcpToolCall', { success: false }, 'result', 'reported_failure'],
    ['mcpToolCall', { status: 'failed' }, 'execution', 'unknown'],
    ['dynamicToolCall', { success: false }, 'result', 'reported_failure'],
  ] as const)('adds structural coverage for %s without reading provider prose', (type, outcome, stage, reason) => {
    const rawEvent = { method: 'item/completed', params: { turnId: 'synthetic-turn', item: {
      id: 'synthetic-mcp', type, tool: 'synthetic_lookup', server: 'synthetic_provider',
      ...outcome, durationMs: 2500, arguments: { content: sentinel },
      error: { code: 'invalid_option', message: sentinel, stack: sentinel },
    } } }
    const issue = createCodexActionRuntimeIssueTracker().recordEvent(eventInput(rawEvent))
    expect(issue?.details).toMatchObject({ failureStage: stage, failureReason: reason,
      diagnosticRole: 'completion', errorCategory: 'unknown', durationMsBucket: '1_5s' })
    expect(JSON.stringify(issue)).not.toContain(sentinel)
    const completed = { ...rawEvent, params: { ...rawEvent.params,
      item: { ...rawEvent.params.item, success: true, status: 'completed' } } }
    expect(createCodexActionRuntimeIssueTracker().recordEvent(eventInput(completed))).toBeNull()
  })

  it('does not parse arbitrary shell JSON even when its code is allowlisted', () => {
    const parse = vi.spyOn(JSON, 'parse')
    try {
      const issue = commandIssue(JSON.stringify(envelope('not_found')), 'node synthetic.js', 2)
      expect(parse).not.toHaveBeenCalled()
      expect(issue?.details).toMatchObject({ failureStage: 'execution', failureReason: 'nonzero_exit',
        errorCategory: 'unknown', exitCode: 2, commandFamily: 'node' })
      expect(issue?.details).not.toHaveProperty('vaultCliErrorCategory')
    } finally { parse.mockRestore() }
  })
})

describe('existing diagnostic transport and denominator', () => {
  it('keeps one generic failed action per completed call, separate from branch evidence', async () => {
    const result = await dispatch(requests[0])
    const rawEvent = { method: 'item/completed', params: { turnId: 'synthetic-turn', item: {
      id: sentinel, type: 'dynamicToolCall', namespace: 'murph', tool: 'automation', success: false,
    } } }
    const input = eventInput(rawEvent)
    const generic = createCodexActionRuntimeIssueTracker().recordEvent(input)
    expect(generic?.errorCode).toBe('CODEX_DYNAMIC_TOOL_CALL_FAILED')
    expect(result.runtimeIssueInputs).toHaveLength(1)
    const reducer = createCodexActionDiagnosticsReducer()
    reducer.recordEvent({ ...input, observedAtMs: 1 })
    reducer.recordEvent({ ...input, observedAtMs: 2 })
    expect(reducer.buildTraceEvent({ codexThreadId: null, providerActionCount: 1,
      providerStartedAtMs: null, turnCorrelation: null, turnId: null })).toMatchObject({
      codexActionDynamicToolCallCount: 1, codexActionCompletedCount: 1, codexActionFailedCount: 1,
    })
  })

  it('round-trips new details through the real sanitizer/parser with the existing cap and best-effort writes', async () => {
    const automation = await dispatch(requests[0], { automationTool: { request: vi.fn<AssistantHostedAutomationTool['request']>().mockRejectedValue(
      Object.assign(new Error(sentinel), { code: 'invalid_option', cause: { content: sentinel } }),
    ) } })
    const cli = commandIssue(JSON.stringify({ ok: false, error: envelope('conflict'), meta: { content: sentinel } }))
    if (!cli || !automation.runtimeIssueInputs) throw new Error('Expected synthetic diagnostics')
    const issues: AssistantRuntimeIssueInput[] = [...automation.runtimeIssueInputs, cli]
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    writes.write.mockReturnValue(pending)
    const policy = { environment: 'hosted' as const, surface: null, privateIssueCaptureEnabled: true }
    try {
      expect(recordAssistantRuntimeIssueInputsBestEffort({
        issues: Array.from({ length: 10 }, (_, index) => issues[index % 2]!), policy, vault: 'synthetic-vault',
      })).toBeUndefined()
      expect(writes.write).toHaveBeenCalledTimes(8)
      for (const [index, [input]] of writes.write.mock.calls.entries()) {
        const encoded = JSON.stringify(input.record)
        expect(encoded).not.toContain(sentinel)
        const parsed = parseAssistantRuntimeIssueRecord(JSON.parse(encoded))
        expect(parsed.details).toEqual(issues[index % 2]!.details)
        expect(parsed.operation).toBe(issues[index % 2]!.operation)
        expect(parsed.errorCode).toBe(issues[index % 2]!.errorCode)
      }
    } finally { release() }
    await flushPendingAssistantRuntimeIssueWrites()
    writes.write.mockReset().mockRejectedValue(new Error(sentinel))
    recordAssistantRuntimeIssueInputsBestEffort({ issues, policy, vault: 'synthetic-vault' })
    await expect(flushPendingAssistantRuntimeIssueWrites()).resolves.toBeUndefined()
    expect(writes.write).toHaveBeenCalledTimes(2)
    writes.write.mockClear()
    recordAssistantRuntimeIssueInputsBestEffort({ issues,
      policy: { ...policy, privateIssueCaptureEnabled: false }, vault: 'synthetic-vault' })
    expect(writes.write).not.toHaveBeenCalled()
  })
})
