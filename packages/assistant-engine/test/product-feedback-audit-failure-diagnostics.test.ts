import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOSTED_USAGE_OPTIMIZATION_AUDIT_PREFIX,
  HOSTED_USAGE_OPTIMIZATION_AUDIT_REJECTIONS,
  type HostedRuntimeProductFeedbackRecord,
} from '@murphai/hosted-execution/runtime-control'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'
import {
  executeMurphDynamicToolRequest,
  readMurphDynamicToolRequest,
  MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL,
} from '../src/assistant-codex/dynamic-tools.js'
import { readCodexRpcSuccessResponse } from '../src/assistant-codex/app-server-protocol.js'
import { createCodexActionRuntimeIssueTracker } from '../src/assistant-codex/action-diagnostics.js'
import { normalizeCodexEvent } from '../src/assistant-codex-events.js'
import {
  toolTextResult,
  withProductFeedbackAuditFailureDetails,
} from '../src/assistant-codex/tool-failure-diagnostics.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import {
  createAssistantProductFeedbackRecorder,
  type AssistantProgressDelivery,
  type AssistantTurnProductFeedbackRecorder,
} from '../src/assistant/turn-progress.js'
import {
  MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION,
  resolveUsageOptimizerFeedbackScope,
} from '../src/assistant/weekly-usage-optimizer.js'
import { buildAssistantSystemPrompt } from '../src/assistant/system-prompt.js'
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

type Feedback = Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>
const privateValue = 'SYNTHETIC_PRIVATE_AUDIT_CONTENT'
const key = 'productFeedbackAuditRejection'
const errorMessage = 'Scheduled usage feedback requires one bounded anonymous usage audit.'
const baseDiagnostic = {
  failureStage: 'execution', failureReason: 'handler_exception', errorCategory: 'unknown',
} as const
const failureRpc = { success: false, contentItems: [{ type: 'inputText', text: 'product feedback candidate unavailable' }] }
const audit: Feedback = {
  kind: 'feature_request', relatedChangelogItemIds: [],
  summary: `${HOSTED_USAGE_OPTIMIZATION_AUDIT_PREFIX} Rounded usage coverage is incomplete; prefer bounded reads.`,
}

function createRecorder(scheduled = true) {
  const occurrenceAt = '2030-01-07T08:00:00.000Z'
  const usageOptimizerScope = resolveUsageOptimizerFeedbackScope({
    conversationScope: 'direct',
    executionContext: { hosted: { memberId: 'synthetic-member', userEnvKeys: [] } },
    messageInput: {
      turnTrigger: 'automation-cron', scheduledOccurrenceAt: occurrenceAt,
      scheduledInvocationAuthority: {
        automationId: MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION.automationId, occurrenceAt,
      },
    },
  })
  if (!usageOptimizerScope) throw new Error('Expected the real managed occurrence scope')
  const accept = vi.fn()
  const support = vi.fn(async () => ({ recorded: true }))
  const getAcceptedInputIds = vi.fn(() => ['synthetic-input'])
  const recorder = createAssistantProductFeedbackRecorder({
    ...(scheduled ? { usageOptimizerScope } : {
      acceptedInputItems: [{ id: 'synthetic-input', source: 'assistant-input' as const }],
    }),
    getAcceptedInputIds,
    productFeedbackCandidateSink: { acceptProductFeedbackCandidate: accept, deliverProductSupportEscalation: support },
  })
  if (!recorder) throw new Error('Expected the real feedback recorder')
  return { recorder, record: vi.spyOn(recorder, 'recordProductFeedback'), accept, support, getAcceptedInputIds }
}

function dispatchInput(
  args: unknown,
  recorder: AssistantTurnProductFeedbackRecorder | null,
  tool = 'submit_product_feedback',
  hostedToolContext?: AssistantHostedToolContext,
) {
  const request = readMurphDynamicToolRequest({ id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool, arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } })
  if (!request) throw new Error('Expected a production dynamic-tool request')
  return {
    request, env: {}, productFeedbackRecorder: recorder, hostedToolContext,
    fetchImpl: vi.fn<typeof fetch>(), nextUsageOrdinal: vi.fn(() => 1),
    progressDelivery: { send: vi.fn<AssistantProgressDelivery['send']>() },
  }
}

async function dispatch(input: ReturnType<typeof dispatchInput>) {
  const result = await executeMurphDynamicToolRequest(input)
  expect(input.fetchImpl).not.toHaveBeenCalled()
  expect(input.nextUsageOrdinal).not.toHaveBeenCalled()
  expect(input.progressDelivery.send).not.toHaveBeenCalled()
  expect(writes.write).not.toHaveBeenCalled()
  return result
}

function privateDirectContext(): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false, currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [], vaultFileSendAvailable: false,
    sendVaultFile: vi.fn(async () => { throw new Error('Unexpected delivery') }),
    currentUserActionScope: () => ({
      acceptedInputIds: ['synthetic-input'], conversationId: 'synthetic-conversation',
      conversationScope: 'direct', inboundMailboxItemIds: ['synthetic-mailbox'],
      originSessionId: 'synthetic-session', recipientKey: 'synthetic-recipient',
    }),
  }
}

function expectNoPrivateContent(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/SYNTHETIC_PRIVATE|synthetic-member|synthetic-input|synthetic-changelog|2030-01-07|Usage optimization audit:|Scheduled usage feedback requires/u)
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  vi.restoreAllMocks()
  writes.write.mockReset()
})

describe('scheduled audit rejection through the real parser, recorder and failure owner', () => {
  const cases = [
    { name: 'wrong kind', feedback: { ...audit, kind: 'feature_interest' as const }, rejection: 'wrong_kind' },
    { name: 'changelog links', feedback: { ...audit, relatedChangelogItemIds: ['synthetic-changelog'] }, rejection: 'changelog_linked' },
    { name: 'missing prefix', feedback: { ...audit, summary: privateValue }, rejection: 'missing_prefix' },
    { name: 'overlong summary', feedback: { ...audit,
      summary: `${HOSTED_USAGE_OPTIMIZATION_AUDIT_PREFIX}${'x'.repeat(1800)}` }, rejection: 'summary_too_long' },
    { name: 'empty report', feedback: { ...audit, summary: `${HOSTED_USAGE_OPTIMIZATION_AUDIT_PREFIX} \n\t` }, rejection: 'empty_report' },
    { name: 'combined invalid rules', feedback: { kind: 'frustration' as const,
      relatedChangelogItemIds: ['synthetic-changelog'], summary: privateValue }, rejection: 'wrong_kind' },
    { name: 'links before missing prefix', feedback: { ...audit,
      relatedChangelogItemIds: ['synthetic-changelog'], summary: privateValue }, rejection: 'changelog_linked' },
  ] as const

  it.each(cases)('attributes $name without changing RPC, classification or effects', async ({ feedback, rejection }) => {
    const owner = createRecorder()
    const input = dispatchInput(feedback, owner.recorder)
    expect(input.request.kind).toBe('submit-product-feedback')
    if (input.request.kind !== 'submit-product-feedback') throw new Error('Expected schema-valid feedback')
    const before = JSON.stringify(input.request)
    const result = await dispatch(input)
    expect(owner.record).toHaveBeenCalledExactlyOnceWith(input.request.feedback)
    expect(owner.getAcceptedInputIds).not.toHaveBeenCalled()
    expect(owner.accept).not.toHaveBeenCalled()
    expect(owner.support).not.toHaveBeenCalled()
    expect(owner.recorder.readProductFeedback()).toBeNull()
    expect(JSON.stringify(input.request)).toBe(before)

    const error: unknown = await owner.record.mock.results[0]!.value.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'Error', message: errorMessage })
    expect(Object.getOwnPropertyDescriptor(error, key)).toEqual({
      value: rejection, enumerable: false, configurable: false, writable: false,
    })
    expect(Object.keys(error as Error)).toEqual([])
    expect(JSON.stringify(error)).toBe('{}')

    const diagnostic = { ...baseDiagnostic, productFeedbackAuditRejection: rejection }
    expect(result.failureDiagnostic).toEqual(diagnostic)
    const wire = JSON.stringify({ id: 1, result: result.rpcResult })
    expect(wire).toBe(JSON.stringify({ id: 1, result: failureRpc }))
    expect(readCodexRpcSuccessResponse(JSON.parse(wire))?.result).toEqual(failureRpc)
    expect(wire).not.toMatch(/productFeedbackAuditRejection|failureDiagnostic|runtimeIssueInputs/u)
    const details = { requestKind: 'submit-product-feedback', ...diagnostic, diagnosticRole: 'classification' }
    expect(result.runtimeIssueInputs).toHaveLength(1)
    expect(result.runtimeIssueInputs![0]!.details).toEqual(details)
    expectNoPrivateContent(result)

    // Only the existing reporter is allowed to schedule the later issue write.
    recordAssistantRuntimeIssueInputsBestEffort({ issues: result.runtimeIssueInputs!, vault: 'synthetic-vault',
      policy: { environment: 'hosted', surface: null, privateIssueCaptureEnabled: true } })
    await flushPendingAssistantRuntimeIssueWrites()
    expect(writes.write).toHaveBeenCalledTimes(1)
    const stored = writes.write.mock.calls[0]![0].record
    const parsed = parseAssistantRuntimeIssueRecord(JSON.parse(JSON.stringify(stored)))
    expect(parsed.details).toEqual(details)
    expect(Object.keys(parsed.details)).toHaveLength(6)
    const { productFeedbackAuditRejection: _rejection, ...legacyDetails } = parsed.details
    expect(parseAssistantRuntimeIssueRecord({ ...parsed, details: legacyDetails }).details).toEqual(legacyDetails)
    expectNoPrivateContent(stored)
  })

  it('keeps one valid in-memory candidate, deduplication and quiet completion', async () => {
    const owner = createRecorder()
    const first = await dispatch(dispatchInput(audit, owner.recorder))
    const candidate = owner.recorder.readProductFeedback()
    expect(candidate).toEqual({ ...audit, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/u) })
    const duplicate = await dispatch(dispatchInput({ ...audit, summary: `${audit.summary} Reworded.` }, owner.recorder))
    expect(owner.recorder.readProductFeedback()).toBe(candidate)
    expect(first).toEqual(toolTextResult(true, 'product feedback candidate accepted'))
    expect(duplicate).toEqual(toolTextResult(true, 'product feedback candidate already accepted'))
    const quiet = await dispatch(dispatchInput({}, owner.recorder, 'finish_without_reply'))
    expect(quiet).toEqual({ ...toolTextResult(true, 'finished without reply'), finalActionPatch: { kind: 'none' } })
    expect(owner.record).toHaveBeenCalledTimes(2)
    expect(owner.getAcceptedInputIds).toHaveBeenCalledTimes(1)
    expect(owner.accept).not.toHaveBeenCalled()
    expect(owner.support).not.toHaveBeenCalled()
    for (const result of [first, duplicate, quiet]) expect(result).not.toHaveProperty('failureDiagnostic')
  })

  it('leaves ordinary feedback and support callback failures unattributed', async () => {
    const ordinary = createRecorder(false)
    const accepted = await dispatch(dispatchInput({ kind: 'feature_interest',
      relatedChangelogItemIds: ['synthetic-changelog'], summary: privateValue }, ordinary.recorder))
    expect(accepted).toEqual(toolTextResult(true, 'product feedback candidate accepted'))
    expect(ordinary.accept).not.toHaveBeenCalled()
    expect(ordinary.support).not.toHaveBeenCalled()
    const ordinaryFailure = createRecorder(false)
    ordinaryFailure.getAcceptedInputIds.mockImplementation(() => { throw new Error(privateValue) })
    const failed = await dispatch(dispatchInput(audit, ordinaryFailure.recorder))
    expect(failed.rpcResult).toEqual(failureRpc)
    expect(failed.failureDiagnostic).toEqual(baseDiagnostic)
    expect(failed.runtimeIssueInputs![0]!.details).not.toHaveProperty(key)
    expect(ordinaryFailure.recorder.readProductFeedback()).toBeNull()

    const support = createRecorder(false)
    support.support.mockRejectedValue(new Error(privateValue))
    const feedback = { kind: 'frustration', relatedChangelogItemIds: [], summary: `Support escalation: ${privateValue}` }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await dispatch(dispatchInput(feedback, support.recorder, 'submit_product_feedback', privateDirectContext()))
      expect(result.rpcResult).toEqual(failureRpc)
      expect(result.failureDiagnostic).toEqual(baseDiagnostic)
      expect(result.runtimeIssueInputs![0]!.details).not.toHaveProperty(key)
      expectNoPrivateContent(result)
    }
    expect(support.support).toHaveBeenCalledTimes(1)
    expect(support.accept).not.toHaveBeenCalled()
    expect(support.recorder.readProductFeedback()).toBeNull()
  })

  it('does not tag admission failures, another tool or overlapping native completion rows', async () => {
    const owner = createRecorder()
    for (const input of [dispatchInput(audit, null), dispatchInput({ kind: 'unknown', summary: privateValue }, owner.recorder)]) {
      const result = await dispatch(input)
      expect(result.rpcResult.success).toBe(false)
      expect(result.failureDiagnostic).not.toHaveProperty(key)
      for (const issue of result.runtimeIssueInputs ?? []) expect(issue.details).not.toHaveProperty(key)
    }
    expect(owner.record).not.toHaveBeenCalled()
    await expect(owner.recorder.recordProductFeedback({ ...audit, kind: 'feature_interest' })).rejects.toThrow(errorMessage)
    const error: unknown = await owner.record.mock.results[0]!.value.catch((caught: unknown) => caught)
    const request = vi.fn().mockRejectedValue(error)
    const unrelated = await dispatch(dispatchInput({ action: 'read_status' }, null, 'family_plan', {
      ...privateDirectContext(), familyPlanTool: { request },
    }))
    expect(request).toHaveBeenCalledTimes(1)
    expect(unrelated.failureDiagnostic).toEqual(baseDiagnostic)
    expect(unrelated.runtimeIssueInputs![0]!.details).not.toHaveProperty(key)
    const rawEvent = { method: 'item/completed', params: { turnId: 'synthetic-turn', item: {
      id: 'synthetic-call', type: 'dynamicToolCall', namespace: 'murph', tool: 'submit_product_feedback', success: false,
    } } }
    const completion = createCodexActionRuntimeIssueTracker().recordEvent({
      activeTurnId: 'synthetic-turn', rawEvent, normalizedEvent: normalizeCodexEvent(rawEvent),
    })
    expect(completion?.details).toMatchObject({ diagnosticRole: 'completion', failureReason: 'reported_failure' })
    expect(completion?.details).not.toHaveProperty(key)
  })

  it('keeps private attribution out of the production prompt, managed instructions and tool schema', () => {
    const prompt = buildAssistantSystemPrompt({
      assistantCliContract: null, assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false, assistantKnowledgeToolsAvailable: false,
      channel: 'linq', cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
      currentLocalDate: '2030-01-07', currentTimeZone: 'UTC', modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: 'automation-cron', hostedRuntime: true, conversationScope: 'direct', onboardingGuidance: false,
    })
    const composed = [prompt, MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION.instructions,
      MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.description, JSON.stringify(MURPH_SUBMIT_PRODUCT_FEEDBACK_TOOL.inputSchema)].join('\n')
    expect(composed).toContain('submit exactly one kind=feature_request report with no relatedChangelogItemIds')
    expect(composed).toContain('never retry an ambiguous submission')
    expect(composed).toContain('"kind":"skip"')
    for (const value of [key, ...HOSTED_USAGE_OPTIMIZATION_AUDIT_REJECTIONS]) expect(composed).not.toContain(value)
  })
})

describe('private audit metadata observer safety', () => {
  it.each([false, true])('keeps caught-error getters inert through dispatch (attributed=%s)', async (attributed) => {
    const read = vi.fn(() => { throw new Error('Unexpected private error read') })
    const error = Object.defineProperties({}, {
      [key]: attributed ? { value: 'missing_prefix' } : { get: read },
      ...Object.fromEntries(['code', 'name', 'message', 'stack', 'status', 'statusCode',
        'fields', 'summary', 'ids', 'dates', 'arguments', 'results', 'provider', 'context', 'cause', 'toJSON']
        .map((name) => [name, { get: read }])),
    })
    const owner = createRecorder()
    owner.record.mockRejectedValue(error)
    const result = await dispatch(dispatchInput(audit, owner.recorder))
    expect(result.rpcResult).toEqual(failureRpc)
    expect(result.failureDiagnostic).toEqual({ ...baseDiagnostic,
      ...(attributed ? { productFeedbackAuditRejection: 'missing_prefix' } : {}),
    })
    expect(owner.record).toHaveBeenCalledTimes(1)
    expect(owner.getAcceptedInputIds).not.toHaveBeenCalled()
    expect(owner.accept).not.toHaveBeenCalled()
    expect(owner.support).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expectNoPrivateContent(result)
  })

  function annotate(error: unknown) {
    // Test this new observer independently of the pre-existing generic classifier.
    const original = toolTextResult(false, 'product feedback candidate unavailable', 'handler_exception')
    Object.freeze(original.failureDiagnostic)
    Object.freeze(original.rpcResult)
    Object.freeze(original)
    const result = withProductFeedbackAuditFailureDetails(original, error)
    expect(original.failureDiagnostic).toEqual(baseDiagnostic)
    expect(result.rpcResult).toBe(original.rpcResult)
    expectNoPrivateContent(result)
    return result
  }

  it.each(HOSTED_USAGE_OPTIMIZATION_AUDIT_REJECTIONS)('copies only the fixed %s scalar', (rejection) => {
    const read = vi.fn(() => { throw new Error('Unexpected private metadata read') })
    const error = Object.defineProperties({}, {
      [key]: { value: rejection, enumerable: false },
      ...Object.fromEntries(['code', 'name', 'message', 'stack', 'fields', 'summary', 'ids', 'dates',
        'arguments', 'results', 'provider', 'context', 'cause', 'toJSON'].map((name) => [name, { get: read }])),
    })
    expect(annotate(error).failureDiagnostic).toEqual({ ...baseDiagnostic, productFeedbackAuditRejection: rejection })
    expect(read).not.toHaveBeenCalled()
  })

  it('does not invoke getters, proxy traps or coercion, or copy inherited and lookalike values', () => {
    const touch = vi.fn(() => { throw new Error('Unexpected hostile inspection') })
    const proxy = new Proxy({ [key]: 'wrong_kind' }, {
      get: touch, getPrototypeOf: touch, getOwnPropertyDescriptor: touch, ownKeys: touch,
    })
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const coercion = { toString: touch, valueOf: touch, toJSON: touch, [Symbol.toPrimitive]: touch }
    const errors: unknown[] = [
      null, undefined, false, 1, 'wrong_kind', privateValue, proxy, revoked.proxy,
      Object.create(proxy), Object.create({ [key]: 'wrong_kind' }),
      Object.defineProperty({}, key, { get: touch }), new Error('wrong_kind'),
      { code: 'wrong_kind', summary: privateValue, context: { [key]: 'wrong_kind' } },
      ...[privateValue, '', null, 0, false, [], coercion, proxy,
        ...HOSTED_USAGE_OPTIMIZATION_AUDIT_REJECTIONS.flatMap((reason) => [
          `${reason} `, `${reason}_extra`, reason.toUpperCase(), reason.replaceAll('_', '-'), new String(reason),
        ]),
      ].map((value) => ({ [key]: value })),
    ]
    for (const error of errors) expect(annotate(error).failureDiagnostic).toEqual(baseDiagnostic)
    expect(touch).not.toHaveBeenCalled()
    const success = toolTextResult(true, 'product feedback candidate accepted')
    const legacy = { rpcResult: toolTextResult(false, 'Existing legacy failure').rpcResult }
    expect(withProductFeedbackAuditFailureDetails(success, proxy)).toBe(success)
    expect(withProductFeedbackAuditFailureDetails(legacy, proxy)).toBe(legacy)
    expect(touch).not.toHaveBeenCalled()
  })
})
