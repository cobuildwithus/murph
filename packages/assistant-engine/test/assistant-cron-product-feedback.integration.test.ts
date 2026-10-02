import { rm } from 'node:fs/promises'
import { initializeVault, upsertAutomation } from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { HostedRuntimeProductFeedbackRecord } from '@murphai/hosted-execution/runtime-control'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import type { persistAssistantTurnAndSession } from '../src/assistant/turn-finalizer.ts'
import { claimResolvedAssistantCronJob, executeClaimedAssistantCronJob } from '../src/assistant/cron/execution.ts'
import { listCanonicalAssistantCronRecords, projectCanonicalAssistantCronJob, resolveCanonicalRuntimeState } from '../src/assistant/cron/canonical-jobs.ts'
import { readAssistantCronCanonicalRuntimeStore } from '../src/assistant/cron/runtime-state.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION } from '../src/assistant/weekly-usage-optimizer.ts'
import { createDeferred, createTempVaultContext } from './test-helpers.ts'

const boundary = vi.hoisted(() => ({
  provider: vi.fn<typeof executeCodexTurnWithRecovery>(),
  persist: vi.fn<typeof persistAssistantTurnAndSession>(),
  deliver: vi.fn(), finalize: vi.fn(),
}))
vi.mock('../src/assistant/codex-turn-runner.js', async (original) => ({
  ...await original<typeof import('../src/assistant/codex-turn-runner.ts')>(),
  executeCodexTurnWithRecovery: boundary.provider,
}))
vi.mock('../src/assistant/turn-finalizer.js', async (original) => ({
  ...await original<typeof import('../src/assistant/turn-finalizer.ts')>(),
  persistAssistantTurnAndSession: boundary.persist,
}))
vi.mock('../src/assistant/runtime-state-service.js', () => ({
  createAssistantRuntimeStateService: () => ({
    diagnostics: { recordEvent: vi.fn(async () => undefined) },
    outbox: { deliverMessage: boundary.deliver },
    sessions: { save: vi.fn(async (session) => session) },
    status: { refreshSnapshot: vi.fn(async () => undefined) },
    transcripts: { append: vi.fn(async () => []) },
    turns: { createReceipt: vi.fn(async () => undefined), finalizeReceipt: boundary.finalize },
  }),
}))
vi.mock('../src/assistant/service-usage.js', async (original) => ({
  ...await original<typeof import('../src/assistant/service-usage.ts')>(),
  recordAssistantUsageEvent: vi.fn(async () => undefined),
  recordAdditionalAssistantUsageEvents: vi.fn(async () => undefined),
}))
vi.mock('@murphai/operator-config/operator-config', async (original) => ({
  ...await original<typeof import('@murphai/operator-config/operator-config')>(),
  resolveAssistantOperatorDefaults: vi.fn(async () => ({ backend: null, identityId: null, selfDeliveryTargets: null })),
}))
const cleanup: string[] = []
const target = createAssistantModelTarget({ provider: 'codex-cli', model: 'gpt-6.1-sol', reasoningEffort: 'medium',
  modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only' })
if (!target) throw new Error('Expected test target')
const candidate: HostedRuntimeProductFeedbackRecord = {
  kind: 'feature_request', summary: 'Usage optimization audit: Repeated broad reads dominate usage. Prefer bounded results.',
  relatedChangelogItemIds: [], idempotencyKey: 'synthetic-usage-review-occurrence',
}
let decision: 'skip' | 'send_message'
let failAt: 'provider' | 'commit' | 'delivery' | 'finalize' | 'cancel' | null
let abort: AbortController
let order: string[]
beforeEach(() => {
  vi.clearAllMocks()
  decision = 'skip'; failAt = null; abort = new AbortController(); order = []
  boundary.provider.mockImplementation(async (input) => {
    order.push('provider')
    await input.input.onProviderRequestStarted?.({ acceptedInputIds: [], providerRequestOrdinal: 1, startedAt: new Date().toISOString() })
    if (failAt === 'provider') throw new Error('Synthetic provider failure')
    if (failAt === 'cancel') abort.abort(new Error('Synthetic cancellation'))
    const response = JSON.stringify(decision === 'skip'
      ? { kind: 'skip', privateSummary: 'Weekly usage review completed.' }
      : { kind: 'send_message', text: 'Synthetic scheduled update.', privateSummary: 'Update ready.' })
    return { kind: 'succeeded', providerTurn: {
      assistantContractFingerprint: 'a'.repeat(64), attemptCount: 1,
      codexContinuation: { kind: 'explicit-structured-history' }, codexThreadId: null,
      provider: input.route.provider, providerOptions: input.route.providerOptions,
      productFeedbackCandidate: candidate, rawEvents: [], response,
      responseDeliveryContextOrdinal: 0, responseMedia: [], route: input.route,
      session: input.resolvedSession, stderr: '', stdout: '', transcriptResponse: response,
      usage: null, workingDirectory: input.plan.requestedWorkingDirectory,
    } }
  })
  boundary.persist.mockImplementation(async (input) => {
    order.push('commit')
    if (failAt === 'commit') throw new Error('Synthetic commit failure')
    return input.session
  })
  boundary.deliver.mockImplementation(async (input) => {
    order.push('delivery')
    if (failAt === 'delivery') return { kind: 'failed', delivery: null,
      deliveryError: { code: 'SYNTHETIC_DELIVERY_FAILED', message: 'Synthetic delivery failure' },
      intent: { intentId: 'synthetic-intent' }, session: null }
    return { kind: input.dispatchMode === 'queue-only' ? 'queued' : 'sent', delivery: {
      channel: 'email', messageId: 'synthetic-message', sentAt: new Date().toISOString(),
      target: 'synthetic@example.test', targetKind: 'explicit', idempotencyKey: input.deliveryIdempotencyKey,
    }, deliveryError: null,
      intent: { intentId: 'synthetic-intent' }, session: null }
  })
  boundary.finalize.mockImplementation(async () => {
    order.push('finalize')
    if (failAt === 'finalize') throw new Error('Synthetic finalization failure')
  })
})
afterEach(async () => { await Promise.all(cleanup.splice(0).map((p) => rm(p, { recursive: true, force: true }))) })

async function runCron(accept: (record: HostedRuntimeProductFeedbackRecord) => void, queueOnly = true) {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-cron-feedback-')
  cleanup.push(parentRoot)
  await initializeVault({ vaultRoot })
  const occurrenceAt = new Date(Date.now() - 1000).toISOString()
  await upsertAutomation({ ...MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION,
    tags: [...MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION.tags], vaultRoot, status: 'active',
    schedule: { kind: 'at', at: occurrenceAt },
    route: { channel: 'email', deliveryTarget: 'synthetic@example.test', threadIsDirect: true,
      identityId: null, participantId: null, threadId: null },
    now: new Date(Date.now() - 60000),
  })
  const paths = resolveAssistantStatePaths(vaultRoot)
  const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]!
  const runtimeState = resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths))
  const job = await claimResolvedAssistantCronJob({ paths, occurrenceFallbackAt: occurrenceAt,
    job: { kind: 'canonical', source, runtimeState, job: projectCanonicalAssistantCronJob({ source, runtimeState }) } })
  return executeClaimedAssistantCronJob({ vault: vaultRoot, paths, job, trigger: 'scheduled',
    signal: abort.signal, ...(queueOnly ? { deliveryDispatchMode: 'queue-only' as const } : {}),
    executionContext: { hosted: { memberId: 'member_synthetic', userEnvKeys: [], defaultTarget: target,
      productFeedbackCandidateSink: { acceptProductFeedbackCandidate: accept } } },
  })
}

describe('cron notification product feedback commit boundary', () => {
  it.each(['skip', 'send_message'] as const)('forwards exactly one accepted candidate after %s commits', async (kind) => {
    decision = kind
    const accept = vi.fn((record: HostedRuntimeProductFeedbackRecord) => { order.push('feedback'); expect(record).toEqual(candidate) })
    const result = await runCron(accept)
    expect(boundary.provider).toHaveBeenCalledTimes(1)
    expect(result.run.outcome).not.toBe('failed')
    expect(boundary.provider.mock.calls[0]?.[0].input.scheduledInvocationAuthority?.automationId)
      .toBe(MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION.automationId)
    expect(accept).toHaveBeenCalledExactlyOnceWith(candidate, {
      committedUsageOptimizerScope: {
        memberId: 'member_synthetic',
        occurrenceAt: boundary.provider.mock.calls[0]?.[0].input.scheduledOccurrenceAt,
      },
    })
    expect(order.indexOf('feedback')).toBeGreaterThan(order.indexOf('commit'))
    if (kind === 'send_message') expect(order.indexOf('feedback')).toBeGreaterThan(order.indexOf('finalize'))
    else expect(boundary.deliver).not.toHaveBeenCalled()
  })
  it.each([
    ['skip', 'provider'], ['skip', 'commit'], ['skip', 'cancel'],
    ['send_message', 'provider'], ['send_message', 'commit'], ['send_message', 'delivery'],
    ['send_message', 'finalize'], ['send_message', 'cancel'],
  ] as const)('does not forward %s on %s failure before completion', async (kind, failure) => {
    failAt = failure
    decision = kind
    const accept = vi.fn()
    await runCron(accept)
    expect(boundary.provider).toHaveBeenCalledTimes(1)
    expect(accept).not.toHaveBeenCalled()
  })
  it.each(['skip', 'send_message'] as const)('waits for %s persistence before accepting feedback', async (kind) => {
    decision = kind
    const commit = createDeferred<void>()
    boundary.persist.mockImplementation(async (input) => { await commit.promise; return input.session })
    const accept = vi.fn()
    const running = runCron(accept)
    await vi.waitFor(() => expect(boundary.persist).toHaveBeenCalledTimes(1))
    expect(accept).not.toHaveBeenCalled()
    commit.resolve()
    await running
    expect(accept).toHaveBeenCalledExactlyOnceWith(candidate, {
      committedUsageOptimizerScope: {
        memberId: 'member_synthetic',
        occurrenceAt: boundary.provider.mock.calls[0]?.[0].input.scheduledOccurrenceAt,
      },
    })
  })
  it('accepts once after an immediate send is finalized', async () => {
    decision = 'send_message'
    const accept = vi.fn(() => { order.push('feedback') })
    const result = await runCron(accept, false)
    expect(result.run.outcome).not.toBe('failed')
    expect(accept).toHaveBeenCalledExactlyOnceWith(candidate, {
      committedUsageOptimizerScope: {
        memberId: 'member_synthetic',
        occurrenceAt: boundary.provider.mock.calls[0]?.[0].input.scheduledOccurrenceAt,
      },
    })
    expect(order).toEqual(['provider', 'commit', 'delivery', 'finalize', 'feedback'])
  })
  it('keeps an optional sink failure from undoing a committed run', async () => {
    const accept = vi.fn(() => { throw new Error('Synthetic optional sink failure') })
    const result = await runCron(accept)
    expect(result.run.outcome).not.toBe('failed')
    expect(accept).toHaveBeenCalledTimes(1)
    expect(boundary.persist).toHaveBeenCalledTimes(1)
  })
})
