import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from '@murphai/contracts/zod-runtime'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'

import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  MURPH_ATTACH_FOLLOW_UP_TOOL,
  MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA,
  MURPH_AUTOMATION_TOOL,
  readAutomationDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools/automation.js'
import * as wrapper from '../src/assistant-codex/dynamic-tools/dynamic-tool-wrapper.js'
import { readCodexRpcSuccessResponse } from '../src/assistant-codex/app-server-protocol.js'
import { createDynamicToolRuntimeIssueInput } from '../src/assistant-codex/tool-failure-diagnostics.js'
import {
  readModelToolCallValidationIssues,
  SAFE_TOOL_CALL_SEMANTIC_REJECTIONS,
} from '../src/assistant/tool-validation-digest.js'
import {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
} from '../src/assistant/issue-reporting.js'

type DispatchInput = Parameters<typeof executeMurphDynamicToolRequest>[0]
type HostedTools = NonNullable<DispatchInput['hostedToolContext']>
const writes = vi.hoisted(() => ({
  write: vi.fn<typeof import('@murphai/runtime-state/node').writePendingAssistantRuntimeIssueRecord>()
    .mockResolvedValue(undefined),
}))
vi.mock('@murphai/runtime-state/node', async (importOriginal) => ({
  ...await importOriginal<typeof import('@murphai/runtime-state/node')>(),
  writePendingAssistantRuntimeIssueRecord: writes.write,
}))

const sentinel = 'SYNTHETIC_PRIVATE_VALUE'
const updatedAt = '2030-01-15T10:00:00.000Z'
const schedule = { kind: 'dailyLocal', localTime: '14:00', timeZone: 'UTC' } as const

function readRequest(tool: string, args: unknown) {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool, arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected synthetic request')
  return request
}

function readRejection(args: unknown) {
  const request = readRequest('automation', args)
  if (request.kind !== 'invalid-automation-arguments') {
    throw new Error('Expected synthetic automation rejection')
  }
  return request
}

function captureParserInput() {
  const spy = vi.spyOn(wrapper, 'parseDynamicToolArguments')
  try {
    readAutomationDynamicToolRequest({ tool: 'automation', arguments: { action: 'list' } })
    const input = spy.mock.calls[0]?.[0]
    if (!input?.readSemanticRejection) throw new Error('Expected automation classifier')
    // Use the real parser's schema and digest inputs, not a copied union.
    return { ...input, readSemanticRejection: input.readSemanticRejection }
  } finally { spy.mockRestore() }
}

async function execute(
  request: DispatchInput['request'],
  port = vi.fn<NonNullable<HostedTools['automationTool']>['request']>(),
) {
  const fetchImpl = vi.fn<typeof fetch>()
  const sendVaultFile = vi.fn(async () => { throw new Error('Unexpected file send') })
  const nextUsageOrdinal = vi.fn(() => 1)
  const result = await executeMurphDynamicToolRequest({
    env: {}, fetchImpl, nextUsageOrdinal, progressDelivery: null, request,
    hostedToolContext: {
      automationTool: { request: port }, computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [],
      sendVaultFile, vaultFileSendAvailable: false,
    },
  })
  expect(fetchImpl).not.toHaveBeenCalled()
  expect(sendVaultFile).not.toHaveBeenCalled()
  expect(nextUsageOrdinal).not.toHaveBeenCalled()
  expect(writes.write).not.toHaveBeenCalled()
  return { result, port }
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  writes.write.mockClear()
  vi.restoreAllMocks()
})

describe('private automation discriminant attribution', () => {
  it.each([
    ['list', 'automation_action_list'],
    ['show', 'automation_action_show'],
    ['edit', 'automation_action_edit'],
    ['update', 'automation_action_update'],
    [sentinel, 'automation_action_unrecognized_string'],
    ['', 'automation_action_unrecognized_string'],
    ['LIST', 'automation_action_unrecognized_string'],
    ['list ', 'automation_action_unrecognized_string'],
    ['automation_action_list', 'automation_action_unrecognized_string'],
  ] as const)('adds only the finite private label for %s', async (action, reason) => {
    const input = captureParserInput()
    const toolBytes = JSON.stringify([MURPH_AUTOMATION_TOOL, MURPH_ATTACH_FOLLOW_UP_TOOL])
    const args = { action, status: ['active'], [sentinel]: sentinel,
      [`${sentinel}_other`]: { semanticRejection: 'automation_action_list' } }
    const parse = vi.spyOn(input.schema, 'safeParse')
    const request = readRejection(args)
    expect(parse).toHaveBeenCalledExactlyOnceWith(args)
    const parsed = parse.mock.results[0]
    if (parsed?.type !== 'return' || parsed.value.success) {
      throw new Error('Expected original Zod rejection')
    }
    expect(readModelToolCallValidationIssues(request.validationDigest)).toBe(parsed.value.error.issues)
    parse.mockRestore()

    const control = wrapper.parseDynamicToolArguments({
      ...input, value: args, readSemanticRejection: undefined,
    })
    if (control.ok) throw new Error('Expected control rejection')
    const controlRequest = { ...request, validationDigest: control.validationDigest }
    expect(request.validationDigest).toEqual({ ...control.validationDigest, semanticRejection: reason })
    expect(SAFE_TOOL_CALL_SEMANTIC_REJECTIONS).toContain(reason)
    expect(readModelToolCallValidationIssues(request.validationDigest))
      .toEqual(readModelToolCallValidationIssues(control.validationDigest))
    expect(JSON.stringify(request.validationDigest)).not.toContain(sentinel)

    const candidate = await execute(request)
    const baseline = await execute(controlRequest)
    for (const { result, port } of [candidate, baseline]) {
      expect(port).not.toHaveBeenCalled()
      expect(result.rpcResult.success).toBe(false)
      // Intake remains caller-owned; dispatch must not add another issue.
      expect(result.runtimeIssueInputs ?? []).toEqual([])
    }
    expect(candidate.result).toEqual(baseline.result)
    const wire = JSON.stringify({ id: 1, result: candidate.result.rpcResult })
    expect(wire).toBe(JSON.stringify({ id: 1, result: baseline.result.rpcResult }))
    expect(readCodexRpcSuccessResponse(JSON.parse(wire))?.result).toEqual(candidate.result.rpcResult)
    for (const privateField of ['semanticRejection', 'failureDiagnostic', 'runtimeIssueInputs']) {
      expect(wire).not.toContain(privateField)
    }
    expect(JSON.stringify([MURPH_AUTOMATION_TOOL, MURPH_ATTACH_FOLLOW_UP_TOOL])).toBe(toolBytes)
    expect(JSON.stringify(z.toJSONSchema(input.schema, { io: 'input' })))
      .toBe(JSON.stringify(MURPH_AUTOMATION_RUNTIME_INPUT_SCHEMA))

    // Exercise the existing intake builder, reporter sanitizer, and unchanged
    // persisted-record parser. Each independent call writes exactly one row.
    const issues = [request, controlRequest].map((entry) => createDynamicToolRuntimeIssueInput({
      request: entry, reason: 'invalid_arguments',
    }))
    for (const issue of issues) {
      expect(issue).toMatchObject({ errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
        component: 'assistant.tool-validation', operation: 'murph.automation',
        details: { diagnosticRole: 'classification' } })
      const before = writes.write.mock.calls.length
      recordAssistantRuntimeIssueInputsBestEffort({
        issues: [issue], vault: 'synthetic-vault',
        policy: { environment: 'hosted', privateIssueCaptureEnabled: true,
          surface: null, releaseSha: '1'.repeat(40) },
      })
      await flushPendingAssistantRuntimeIssueWrites()
      expect(writes.write).toHaveBeenCalledTimes(before + 1)
    }
    const records = writes.write.mock.calls.map(([entry]) =>
      parseAssistantRuntimeIssueRecord(JSON.parse(JSON.stringify(entry.record))),
    )
    expect(records).toHaveLength(2)
    const [enriched, generic] = records
    if (!enriched || !generic) throw new Error('Expected both synthetic records')
    expect(enriched.schema).toBe(generic.schema)
    expect(enriched.fingerprint).toBe(generic.fingerprint)
    expect(enriched.details).toEqual({ ...generic.details, semanticRejection: reason })
    expect(generic.details).not.toHaveProperty('semanticRejection')
    expect(Object.keys(enriched.details).length).toBeLessThanOrEqual(24)
    expect(JSON.stringify(writes.write.mock.calls)).not.toContain(sentinel)
    expect(JSON.stringify(records)).not.toContain(sentinel)
  })

  it('omits attribution for malformed fields of every current union action', async () => {
    const input = captureParserInput()
    const { schema, readSemanticRejection } = input
    // Narrow the real parser schema without constructors omitted by bounded Zod.
    if (!('options' in schema) || !Array.isArray(schema.options)) {
      throw new Error('Expected real action union')
    }
    const options: readonly unknown[] = schema.options
    expect(options.length).toBeGreaterThan(0)
    for (const option of options) {
      const actionSchema: unknown = option instanceof z.ZodObject ? option.shape.action : null
      if (actionSchema === null || typeof actionSchema !== 'object'
        || !('values' in actionSchema) || !(actionSchema.values instanceof Set)) {
        throw new Error('Expected literal action schema')
      }
      const actions: ReadonlySet<unknown> = actionSchema.values
      expect(actions.size).toBeGreaterThan(0)
      for (const action of actions) {
        expect(typeof action).toBe('string')
        expect(readSemanticRejection({ action })).toBeNull()
        const request = readRejection({ action, [sentinel]: sentinel })
        expect(request.validationDigest).not.toHaveProperty('semanticRejection')
        const control = wrapper.parseDynamicToolArguments({
          ...input, value: { action, [sentinel]: sentinel }, readSemanticRejection: undefined,
        })
        if (control.ok) throw new Error('Expected malformed-field rejection')
        expect(request.validationDigest).toEqual(control.validationDigest)
        const candidate = await execute(request)
        const baseline = await execute({ ...request, validationDigest: control.validationDigest })
        for (const { result, port } of [candidate, baseline]) {
          expect(result.rpcResult.success).toBe(false)
          expect(result.runtimeIssueInputs ?? []).toEqual([])
          expect(port).not.toHaveBeenCalled()
        }
        expect(JSON.stringify({ id: 1, result: candidate.result.rpcResult }))
          .toBe(JSON.stringify({ id: 1, result: baseline.result.rpcResult }))
      }
    }
  })

  it.each([
    { action: 'inspect', lookup: 'synthetic-automation' },
    { action: 'save', title: 'Synthetic cue', instructions: 'Take a stretch break.', schedule },
    { action: 'patch', lookup: 'synthetic-automation', expectedUpdatedAt: updatedAt, status: 'paused' },
  ] as const)('keeps valid $action admission and one handler call', async (args) => {
    const input = captureParserInput()
    const classifier = vi.fn(input.readSemanticRejection)
    const parsed = wrapper.parseDynamicToolArguments({ ...input, value: args, readSemanticRejection: classifier })
    expect(parsed.ok).toBe(true)
    expect(parsed).toEqual(wrapper.parseDynamicToolArguments({
      ...input, value: args, readSemanticRejection: undefined,
    }))
    expect(classifier).not.toHaveBeenCalled()
    const request = readRequest('automation', args)
    if (request.kind !== 'automation') throw new Error('Expected accepted automation')
    expect(request).not.toHaveProperty('validationDigest')
    const common = { automationId: 'synthetic-automation', lookupId: 'synthetic-automation',
      schedule, updatedAt, effectiveTimeZone: 'UTC', occurrenceProjection: { status: 'pending' as const },
      routeBinding: 'preserved' as const, status: 'active' as const }
    const response = args.action === 'inspect'
      ? { ...common, action: args.action, title: 'Synthetic cue', instructions: 'Take a stretch break.' }
      : { ...common, action: args.action, created: args.action === 'save' }
    const port = vi.fn<NonNullable<HostedTools['automationTool']>['request']>().mockResolvedValue(response)
    const { result } = await execute(request, port)
    expect(port).toHaveBeenCalledExactlyOnceWith(request.request, { signal: null })
    expect(result.rpcResult.success).toBe(true)
    expect(result.runtimeIssueInputs ?? []).toEqual([])
    const { lookupId: _lookupId, ...payload } = response
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text!)).toEqual(payload)
    expect(JSON.stringify(result)).not.toContain('semanticRejection')
  })

  it('leaves another tool unlabelled', async () => {
    const request = readRequest('device', { action: sentinel })
    if (!('validationDigest' in request)) throw new Error('Expected device rejection')
    expect(request.validationDigest).not.toHaveProperty('semanticRejection')
    const issue = createDynamicToolRuntimeIssueInput({ request, reason: 'invalid_arguments' })
    expect(issue.details).not.toHaveProperty('semanticRejection')
    const { result, port } = await execute(request)
    expect(port).not.toHaveBeenCalled()
    expect(result.runtimeIssueInputs ?? []).toEqual([])
    expect(JSON.stringify(result.rpcResult)).not.toContain('semanticRejection')
  })

  it('reads only an own string data property, without coercion or traversal', () => {
    const { readSemanticRejection } = captureParserInput()
    const forbidden = vi.fn(() => { throw new Error(sentinel) })
    const accessor = Object.defineProperty({}, 'action', { enumerable: true, get: forbidden })
    const coercible = { toString: forbidden, [Symbol.toPrimitive]: forbidden }
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    for (const value of [null, undefined, [], 'list', 1, false, {}, { action: null },
      { action: 1 }, { action: coercible }, accessor, Object.create(accessor),
      Object.create({ action: 'list' }), Object.assign([], { action: 'list' }),
      revoked.proxy, new Proxy({}, { getOwnPropertyDescriptor: forbidden })]) {
      expect(readSemanticRejection(value)).toBeNull()
    }
    const own = Object.defineProperties(Object.create(null), {
      action: { value: 'list', enumerable: true },
      cause: { get: forbidden }, [sentinel]: { get: forbidden },
    })
    expect(readSemanticRejection(new Proxy(own, { get: forbidden, getPrototypeOf: forbidden })))
      .toBe('automation_action_list')
    // Only the explicit throwing descriptor trap above may execute.
    expect(forbidden).toHaveBeenCalledTimes(1)
  })

  it('keeps the original rejection when the classifier encounters a descriptor fault', () => {
    const input = captureParserInput()
    const cause = vi.fn(() => { throw new Error(sentinel) })
    const error = Object.defineProperty(new Error(sentinel), 'cause', { get: cause })
    const hostile = new Proxy({}, { getOwnPropertyDescriptor: () => { throw error } })
    const args = { action: 'list' }
    const control = wrapper.parseDynamicToolArguments({ ...input, value: args, readSemanticRejection: undefined })
    const actual = wrapper.parseDynamicToolArguments({ ...input, value: args,
      readSemanticRejection: () => input.readSemanticRejection(hostile) })
    expect(actual).toEqual(control)
    if (actual.ok || control.ok) throw new Error('Expected original rejections')
    expect(readModelToolCallValidationIssues(actual.validationDigest))
      .toEqual(readModelToolCallValidationIssues(control.validationDigest))
    expect(actual.validationDigest).not.toHaveProperty('semanticRejection')
    expect(JSON.stringify(actual.validationDigest)).not.toContain(sentinel)
    expect(cause).not.toHaveBeenCalled()
  })
})
