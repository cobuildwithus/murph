import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from '@murphai/contracts/zod-runtime'
import {
  parseHostedGroupSharedFreshnessRequirements,
  parseHostedGroupSharedReadOptions,
} from '@murphai/hosted-execution/runtime-control'
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  type HostedVaultShareSelectableProjectionScope,
} from '@murphai/hosted-execution/vault-share'
import { parseAssistantRuntimeIssueRecord } from '@murphai/runtime-state/node'

import {
  executeMurphDynamicToolRequest,
  MURPH_DYNAMIC_TOOLS,
  MURPH_GROUP_FAMILY_TOOLS,
  MURPH_GROUP_TOOL_NAME,
  readMurphDynamicToolRequest,
} from '../src/assistant-codex/dynamic-tools.js'
import { createDynamicToolRuntimeIssueInput } from '../src/assistant-codex/tool-failure-diagnostics.js'
import type {
  AssistantHostedGroupSharedReader,
} from '../src/assistant/execution-context.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
} from '../src/assistant/issue-reporting.js'
import {
  buildSafeToolCallValidationDigest,
  SAFE_TOOL_CALL_SEMANTIC_REJECTIONS,
  type SafeToolCallValidationDigest,
} from '../src/assistant/tool-validation-digest.js'
import { buildToolCallValidationFeedback } from '../src/assistant/tool-validation-feedback.js'
import {
  asRecord,
  MURPH_GROUP_DATA_TOOL,
  MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
} from '../src/assistant-codex/dynamic-tool-catalog.js'
import { collectCanonicalToolInventory } from './support/codex-tool-contract-inventory.js'
import { compileToolInputSchema } from './support/tool-input-schema-validation.js'

const writes = vi.hoisted(() => ({
  write: vi.fn<typeof import('@murphai/runtime-state/node').writePendingAssistantRuntimeIssueRecord>(),
}))
vi.mock('@murphai/runtime-state/node', async (importOriginal) => ({
  ...await importOriginal<typeof import('@murphai/runtime-state/node')>(),
  writePendingAssistantRuntimeIssueRecord: writes.write,
}))

const policy = { environment: 'hosted' as const, surface: null, privateIssueCaptureEnabled: true }
const sleep = { projectionKind: 'sleep-duration-days.v0' } as const
const steps = { projectionKind: 'steps-days.v0' } as const
const timeZone = { projectionKind: 'time-zone.v0' } as const
const privateParticipant = 'SYNTHETIC_PRIVATE_PARTICIPANT'
const pair = { projectionScopeKey: sleep.projectionKind, date: '2026-08-04' }
const history = { fromDate: '2026-06-21', throughDate: '2026-09-18' }
// Values that must never reach a digest, issue or persisted record.
const privateTokens = [
  privateParticipant, '2026-08-04', '2026-02-30', '2026-06-21', '2026-09-18',
  'sleep-duration', 'steps-days', 'time-zone',
]

// Pre-change read_shared branch (scope transform replaced by pass-through for
// already-valid scopes). It is the oracle for exact model-visible issues.
const LEGACY_MESSAGE = 'history requires one participant, one existing health metric scope and at most 90 inclusive dates, without freshness or group_email; freshness requires exact requested wearable dates'
const legacyReadSharedSchema = z.object({
  action: z.literal('read_shared'),
  participantId: z.string().min(1).max(200).optional(),
  history: z.object({ fromDate: z.string(), throughDate: z.string() }).strict().optional(),
  audience: z.literal('group_email').optional(),
  freshness: z.array(z.object({
    projectionScopeKey: z.string().min(1).max(191),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  }).strict()).min(1).max(21).optional(),
  projectionScopes: z.array(z.custom<HostedVaultShareSelectableProjectionScope>(
    (value) => typeof value === 'object' && value !== null,
  )).min(1),
}).strict().refine((request) => {
  try {
    parseHostedGroupSharedReadOptions(request, request.projectionScopes)
    if (request.audience && (request.history || request.participantId)) return false
  } catch {
    return false
  }
  if (request.freshness === undefined) return true
  if (request.audience !== undefined) return false
  try {
    parseHostedGroupSharedFreshnessRequirements(request.freshness, request.projectionScopes)
    return true
  } catch {
    return false
  }
}, { message: LEGACY_MESSAGE, path: ['freshness'] })

function toolCall(args: unknown, tool = 'group_data') {
  return { id: 1, method: 'item/tool/call', params: {
    namespace: 'murph', tool, arguments: args,
    threadId: 'synthetic-thread', turnId: 'synthetic-turn', callId: 'synthetic-call',
  } }
}

function readRequest(args: unknown, tool?: string) {
  const request = readMurphDynamicToolRequest(toolCall(args, tool))
  if (!request) throw new Error('Expected a synthetic dynamic-tool request')
  return request
}

function readDigest(args: unknown, tool?: string): SafeToolCallValidationDigest {
  const request = readRequest(args, tool)
  if (!('validationDigest' in request)) throw new Error(`Expected rejection, got ${request.kind}`)
  return request.validationDigest
}

function harness() {
  const sharedRead = vi.fn<AssistantHostedGroupSharedReader['request']>(async (request) => ({
    status: 'ok' as const,
    members: [],
    requestedProjectionScopeKeys: request.projectionScopes.map(buildHostedVaultShareProjectionScopeKey),
    ...(request.freshness
      ? { freshness: { checkedAt: '2026-08-04T14:20:00.000Z', refreshStatus: 'not_needed' as const } }
      : {}),
  }))
  const offer = vi.fn()
  const email = vi.fn()
  const sendVaultFile = vi.fn(async () => { throw new Error('Unexpected delivery') })
  const context = {
    connectedApps: null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: () => null,
    currentUserActionScope: () => null,
    currentScheduledAutomationAuthority: () => null,
    familyPlanTool: null,
    groupPermissionOfferTool: { request: offer },
    groupSharedReader: { request: sharedRead },
    groupTool: null,
    groupEmailEffect: { request: email },
    phoneCalls: null,
    privateImageUrlPublisher: null,
    sendVaultFile,
    vaultFileSendAvailable: false,
  }
  const fetchImpl = vi.fn<typeof fetch>()
  const nextUsageOrdinal = vi.fn(() => 1)
  return {
    sharedRead,
    async execute(request: ReturnType<typeof readRequest>) {
      return await executeMurphDynamicToolRequest({
        env: {}, fetchImpl, nextUsageOrdinal, progressDelivery: null, request, vaultRoot: null,
        hostedToolContext: context as AssistantHostedToolContext,
      })
    },
    expectNoOtherEffects() {
      expect(offer).not.toHaveBeenCalled()
      expect(email).not.toHaveBeenCalled()
      expect(sendVaultFile).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
      expect(writes.write).not.toHaveBeenCalled()
    },
  }
}

function expectNoPrivateValues(value: unknown) {
  const encoded = JSON.stringify(value)
  for (const token of privateTokens) expect(encoded).not.toContain(token)
  return encoded
}

afterEach(async () => {
  await flushPendingAssistantRuntimeIssueWrites()
  writes.write.mockReset()
})

describe('advertised group freshness contract', () => {
  it('limits every freshness-bearing descriptor to the owner wearable domain', () => {
    const wearableScopes = HOSTED_VAULT_SHARE_DAILY_METRIC_PROJECTION_SPECS
      .filter((spec) => spec.source.kind === 'metric-series')
      .map((spec) => ({ projectionKind: spec.projectionKind }))
    const wearableKeys = new Set(wearableScopes.map(buildHostedVaultShareProjectionScopeKey))
    const nonwearableScopes = HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES
      .filter((scope) => !wearableKeys.has(buildHostedVaultShareProjectionScopeKey(scope)))
    // Includes exported registrations and the actual resolver's eager/route variants.
    const tools = collectCanonicalToolInventory().filter((tool) => {
      const properties = asRecord(asRecord(tool.inputSchema)?.properties)
      return properties !== null && 'freshness' in properties
    })
    expect(tools).toEqual(expect.arrayContaining([
      MURPH_GROUP_DATA_TOOL, MURPH_GROUP_SHARED_READ_PERMISSION_OFFER_TOOL,
    ]))
    expect(wearableScopes.length).toBeGreaterThan(0)
    expect(nonwearableScopes).toContainEqual(timeZone)

    for (const tool of tools) {
      const schema = asRecord(tool.inputSchema)
      if (!schema) throw new Error(`Expected ${tool.name} input schema to be a record`)
      const validate = compileToolInputSchema(schema)
      for (const scope of wearableScopes) {
        const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(scope)
        const args = { action: 'read_shared', projectionScopes: [scope],
          freshness: [{ projectionScopeKey, date: pair.date }] }
        expect(validate(args), `${tool.name}: wearable ${projectionScopeKey}`).toBe(true)
        expect(readRequest(args, tool.name).kind).toBe('group')
      }
      for (const scope of nonwearableScopes) {
        const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(scope)
        const args = { action: 'read_shared', projectionScopes: [scope] }
        // These scopes remain available as ordinary shared context.
        expect(validate(args), `${tool.name}: ordinary ${projectionScopeKey}`).toBe(true)
        expect(validate({ ...args, freshness: [{ projectionScopeKey, date: pair.date }] }),
          `${tool.name}: nonwearable freshness ${projectionScopeKey}`).toBe(false)
        expect(validate.errors).toContainEqual(expect.objectContaining({
          instancePath: '/freshness/0/projectionScopeKey', keyword: 'enum',
        }))
      }
      const unknownScope = { action: 'read_shared', projectionScopes: [sleep],
        freshness: [{ ...pair, projectionScopeKey: 'synthetic-unknown.v0' }] }
      expect(validate(unknownScope)).toBe(false)
      expect(validate.errors).toContainEqual(expect.objectContaining({
        instancePath: '/freshness/0/projectionScopeKey', keyword: 'enum',
      }))

      const bounded = Array.from({ length: 21 }, (_, day) => ({
        ...pair, date: `2030-04-${String(day + 1).padStart(2, '0')}`,
      }))
      const args = { action: 'read_shared', projectionScopes: [sleep, timeZone] }
      expect(validate({ ...args, freshness: bounded })).toBe(true)
      for (const freshness of [[], [...bounded, { ...pair, date: '2030-04-22' }], [pair, pair],
        [{ ...pair, date: 'tomorrow' }], [{ ...pair, extra: true }]]) {
        expect(validate({ ...args, freshness })).toBe(false)
      }
    }
  })
})

describe('read_shared semantic rejection reason at the actual parser and issue boundary', () => {
  const cases = [
    { name: 'requested scope mismatch', reason: 'shared_freshness_scope_not_requested',
      args: { action: 'read_shared', projectionScopes: [sleep],
        freshness: [{ ...pair, projectionScopeKey: steps.projectionKind }] } },
    { name: 'duplicate scope/date pair', reason: 'shared_freshness_duplicate_pair',
      args: { action: 'read_shared', projectionScopes: [sleep], freshness: [pair, pair] } },
    { name: 'invalid civil date', reason: 'shared_freshness_invalid_date',
      args: { action: 'read_shared', projectionScopes: [sleep], freshness: [{ ...pair, date: '2026-02-30' }] } },
    { name: 'requested non-wearable scope', reason: 'shared_freshness_scope_not_wearable',
      args: { action: 'read_shared', projectionScopes: [sleep, timeZone],
        freshness: [{ ...pair, projectionScopeKey: timeZone.projectionKind }] } },
    { name: 'history without participant', reason: 'shared_read_options',
      args: { action: 'read_shared', projectionScopes: [steps], history } },
    { name: 'history with freshness', reason: 'shared_read_options',
      args: { action: 'read_shared', participantId: privateParticipant, projectionScopes: [steps], history,
        freshness: [{ projectionScopeKey: steps.projectionKind, date: '2026-09-18' }] } },
    { name: 'group email with freshness', reason: 'shared_read_options',
      args: { action: 'read_shared', audience: 'group_email', projectionScopes: [sleep], freshness: [pair] } },
    { name: 'group email with participant', reason: 'shared_read_options',
      args: { action: 'read_shared', audience: 'group_email', participantId: privateParticipant, projectionScopes: [sleep] } },
  ] as const

  it.each(cases)('distinguishes $name with exact legacy model feedback and no effects', async ({ args, reason }) => {
    const ports = harness()
    const request = readRequest(args)
    expect(request.kind).toBe('invalid-group-arguments')
    if (!('validationDigest' in request)) throw new Error('Expected rejection')
    const digest = request.validationDigest
    expect(digest.semanticRejection).toBe(reason)
    expect(digest).toMatchObject({ toolName: 'murph.group_data', issueCodes: ['custom'],
      pathIssues: [{ path: 'freshness', code: 'custom',
        received: 'freshness' in args ? 'array.count_1_10' : 'undefined' }] })

    const result = await ports.execute(request)
    expect(ports.sharedRead).not.toHaveBeenCalled()
    ports.expectNoOtherEffects()
    const legacy = legacyReadSharedSchema.safeParse(args)
    if (legacy.success) throw new Error('Expected legacy rejection')
    const legacyText = JSON.stringify({ error: 'invalid_group_arguments', validationIssues: legacy.error.issues })
    expect(result.rpcResult).toEqual({ success: false, contentItems: [{ type: 'inputText', text: legacyText }] })
    expect(legacyText).toContain(LEGACY_MESSAGE)
    for (const label of ['semanticRejection', ...SAFE_TOOL_CALL_SEMANTIC_REJECTIONS]) {
      expect(legacyText).not.toContain(label)
    }
    expect(result.failureDiagnostic).toEqual({ failureStage: 'validation', failureReason: 'invalid_input' })
    expect(result.runtimeIssueInputs).toBeUndefined()

    // A persisted/reconstructed digest has no in-memory issues; its bounded
    // fallback hints are unchanged by the private reason.
    const { semanticRejection: _omitted, ...withoutReason } = JSON.parse(JSON.stringify(digest))
    expect(buildToolCallValidationFeedback(JSON.parse(JSON.stringify(digest)), 'invalid_group_arguments'))
      .toBe(buildToolCallValidationFeedback(withoutReason, 'invalid_group_arguments'))

    const issue = createDynamicToolRuntimeIssueInput({ request, reason: 'invalid_arguments' })
    expect(issue).toMatchObject({ component: 'assistant.tool-validation', errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
      details: { semanticRejection: reason, failureReason: 'invalid_input', diagnosticRole: 'classification' } })
    expectNoPrivateValues(issue)
    recordAssistantRuntimeIssueInputsBestEffort({ issues: [issue], policy, vault: 'synthetic-vault' })
    await flushPendingAssistantRuntimeIssueWrites()
    expect(writes.write).toHaveBeenCalledTimes(1)
    const record = writes.write.mock.calls[0]![0].record
    const parsed = parseAssistantRuntimeIssueRecord(JSON.parse(expectNoPrivateValues(record)))
    expect(parsed.details).toMatchObject({ semanticRejection: reason, validationFingerprint: digest.validationFingerprint })
    expect(Object.keys(parsed.details).length).toBeLessThanOrEqual(24)
    // A pre-change record without the field remains readable.
    const { semanticRejection: _legacy, ...legacyDetails } = parsed.details
    expect(parseAssistantRuntimeIssueRecord({ ...parsed, details: legacyDetails }).details).toEqual(legacyDetails)
  })

  it('reports only the first canonical failure and keeps the existing fingerprint shared across causes', () => {
    const scopeFirst = readDigest({ action: 'read_shared', projectionScopes: [sleep],
      freshness: [{ ...pair, projectionScopeKey: timeZone.projectionKind }, pair, pair] })
    expect(scopeFirst.semanticRejection).toBe('shared_freshness_scope_not_requested')
    const dateCause = readDigest({ action: 'read_shared', projectionScopes: [sleep],
      freshness: [{ ...pair, date: '2026-02-30' }, pair, pair] })
    expect(dateCause.semanticRejection).toBe('shared_freshness_invalid_date')
    expect(dateCause.validationFingerprint).toBe(scopeFirst.validationFingerprint)
    expect(readDigest({ action: 'read_shared', projectionScopes: [sleep], freshness: [pair, pair] },
      MURPH_GROUP_TOOL_NAME).semanticRejection).toBe('shared_freshness_duplicate_pair')
  })

  it.each([
    { name: 'empty scopes', args: { action: 'read_shared', projectionScopes: [] } },
    { name: 'empty freshness', args: { action: 'read_shared', projectionScopes: [sleep], freshness: [] } },
    { name: 'freshness over the bound', args: { action: 'read_shared', projectionScopes: [sleep],
      freshness: Array.from({ length: 22 }, (_, day) => ({
        ...pair, date: `2030-04-${String(day + 1).padStart(2, '0')}`,
      })) } },
    { name: 'non-ISO freshness date', args: { action: 'read_shared', projectionScopes: [sleep], freshness: [{ ...pair, date: 'tomorrow' }] } },
    { name: 'duplicate requested scopes', args: { action: 'read_shared', projectionScopes: [sleep, sleep] } },
    { name: 'forged reason key', args: { action: 'read_shared', projectionScopes: [sleep], semanticRejection: 'shared_freshness_duplicate_pair' } },
    { name: 'unrelated group action', args: { action: 'send_email', subject: '', html: '' } },
    { name: 'unknown action', args: { action: privateParticipant } },
  ])('keeps structural or unrelated rejection ($name) without a semantic reason', async ({ args }) => {
    const ports = harness()
    const request = readRequest(args)
    if (!('validationDigest' in request)) throw new Error('Expected rejection')
    expect(request.validationDigest).not.toHaveProperty('semanticRejection')
    const result = await ports.execute(request)
    expect(result.rpcResult.success).toBe(false)
    expect(ports.sharedRead).not.toHaveBeenCalled()
    ports.expectNoOtherEffects()
    expect(JSON.stringify(createDynamicToolRuntimeIssueInput({ request, reason: 'invalid_arguments' })))
      .not.toContain('semanticRejection')
  })

  it('does not attach reasons to other dynamic tools or accept forged builder input', () => {
    expect(readDigest({ action: 'connect' }, 'device')).not.toHaveProperty('semanticRejection')
    const forged: unknown = JSON.parse('"shared_freshness_duplicate_pair_x"')
    const digest = buildSafeToolCallValidationDigest({
      error: new Error('synthetic'),
      rawInput: { semanticRejection: 'shared_read_options' },
      // Simulates an untrusted caller that bypasses the type.
      semanticRejection: forged as 'shared_read_options',
      toolName: 'murph.group_data',
    })
    expect(digest).not.toHaveProperty('semanticRejection')
    // A label-shaped participantId is not itself invalid; group_email audience with a participant is.
    const value = readDigest({ action: 'read_shared', audience: 'group_email',
      participantId: 'shared_freshness_duplicate_pair', projectionScopes: [steps], history })
    expect(value.semanticRejection).toBe('shared_read_options')
    expect(JSON.stringify(value)).not.toContain('shared_freshness_duplicate_pair')
  })

  it('keeps nearby valid reads successful with exactly one fake read', async () => {
    const twentyOne = Array.from({ length: 21 }, (_, day) => ({
      ...pair, date: `2030-04-${String(day + 1).padStart(2, '0')}`,
    }))
    for (const args of [
      { projectionScopes: [sleep], freshness: twentyOne },
      { projectionScopes: [sleep] },
      { projectionScopes: [timeZone] },
      { projectionScopes: [sleep, timeZone], freshness: [pair] },
    ]) {
      const ports = harness()
      const request = readRequest({ action: 'read_shared', ...args })
      expect(request.kind).toBe('group')
      const result = await ports.execute(request)
      expect(result.rpcResult.success).toBe(true)
      expect(result.failureDiagnostic).toBeUndefined()
      expect(ports.sharedRead).toHaveBeenCalledTimes(1)
      expect(ports.sharedRead).toHaveBeenCalledWith(expect.objectContaining(args))
      if (!('freshness' in args)) expect(ports.sharedRead.mock.calls[0]![0]).not.toHaveProperty('freshness')
      ports.expectNoOtherEffects()
    }
  })

  it('keeps the vocabulary out of every model-facing tool definition', () => {
    const definitions = JSON.stringify([MURPH_DYNAMIC_TOOLS, MURPH_GROUP_FAMILY_TOOLS])
    for (const label of ['semanticRejection', ...SAFE_TOOL_CALL_SEMANTIC_REJECTIONS]) {
      expect(definitions).not.toContain(label)
    }
  })
})
