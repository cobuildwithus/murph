import { rm } from 'node:fs/promises'
import { initializeVault, upsertAutomation } from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { ConversationPollRequest } from '@murphai/hosted-execution/conversation-polls'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import type { persistAssistantTurnAndSession } from '../src/assistant/turn-finalizer.ts'
import { claimResolvedAssistantCronJob, executeClaimedAssistantCronJob } from '../src/assistant/cron/execution.ts'
import { listCanonicalAssistantCronRecords, projectCanonicalAssistantCronJob, resolveCanonicalRuntimeState } from '../src/assistant/cron/canonical-jobs.ts'
import { readAssistantCronCanonicalRuntimeStore } from '../src/assistant/cron/runtime-state.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { executeConversationPollTool } from '../src/assistant-codex/dynamic-tools/conversation-polls.ts'
import { createTempVaultContext } from './test-helpers.ts'

const boundary = vi.hoisted(() => ({
  provider: vi.fn<typeof executeCodexTurnWithRecovery>(),
  persist: vi.fn<typeof persistAssistantTurnAndSession>(),
  deliver: vi.fn(),
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
    transcripts: { append: vi.fn(async () => []) },
    turns: { createReceipt: vi.fn(async () => undefined), finalizeReceipt: vi.fn() },
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
const create = { action: 'create' as const, question: 'Which day?', options: ['Saturday', 'Sunday'] }
beforeEach(() => {
  vi.clearAllMocks()
  boundary.persist.mockImplementation(async (input) => input.session)
  boundary.provider.mockImplementation(async (input) => {
    const result = await executeConversationPollTool({ context: input.hostedToolContext ?? null, request: create })
    expect(result.rpcResult.success).toBe(true)
    const response = JSON.stringify({ kind: 'skip', privateSummary: 'The native poll was sent; no additional message is needed.' })
    return { kind: 'succeeded', providerTurn: {
      assistantContractFingerprint: 'a'.repeat(64), attemptCount: 1,
      codexContinuation: { kind: 'explicit-structured-history' }, codexThreadId: null,
      provider: input.route.provider, providerOptions: input.route.providerOptions,
      rawEvents: [], response, responseDeliveryContextOrdinal: 0, responseMedia: [], route: input.route,
      session: input.resolvedSession, stderr: '',  transcriptResponse: response,
      usage: null, workingDirectory: input.plan.requestedWorkingDirectory,
    } }
  })
})
afterEach(async () => { await Promise.all(cleanup.splice(0).map((p) => rm(p, { recursive: true, force: true }))) })

describe('scheduled native poll completion', () => {
  it.each([
    { channel: 'linq', direct: true, interrupt: false },
    { channel: 'linq', direct: false, interrupt: false },
    { channel: 'telegram', direct: true, interrupt: false },
    { channel: 'telegram', direct: false, interrupt: false },
    { channel: 'telegram', direct: false, interrupt: true },
  ] as const)('creates then skips and advances without duplicate text: %j', async ({ channel, direct, interrupt }) => {
    const { parentRoot, vaultRoot } = await createTempVaultContext('murph-cron-polls-')
    cleanup.push(parentRoot)
    await initializeVault({ vaultRoot })
    const occurrenceAt = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString()
    const savedTarget = channel === 'linq' ? 'saved-chat' : direct ? '100' : '-100:topic:12'
    const authorizedTarget = channel === 'linq' && direct ? 'replacement-chat' : savedTarget
    await upsertAutomation({
      automationId: 'automation_01K00000000000000000000000', slug: 'scheduled-poll', title: 'Weekly poll', continuityPolicy: 'preserve',
      summary: 'Choose a day together.', instructions: 'Create a native poll choosing Saturday or Sunday. Once sent, skip any additional message.',
      tags: ['assistant', 'scheduled'], vaultRoot, status: 'active',
      schedule: { kind: 'cron', expression: '* * * * *' },
      route: { channel, deliveryTarget: savedTarget, threadIsDirect: direct, identityId: null, participantId: null, threadId: savedTarget },
      now: new Date(Date.now() - 60000),
    })
    const paths = resolveAssistantStatePaths(vaultRoot)
    const source = (await listCanonicalAssistantCronRecords(vaultRoot))[0]!
    const claim = async () => {
      const runtimeState = resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths))
      return claimResolvedAssistantCronJob({ paths, occurrenceFallbackAt: occurrenceAt,
        job: { kind: 'canonical', source, runtimeState, job: projectCanonicalAssistantCronJob({ source, runtimeState }) } })
    }
    const poll = vi.fn(async (_request: ConversationPollRequest) => ({ status: 'sent' as const, polls: [] }))
    const executionContext = { hosted: {
      memberId: 'member_synthetic', userEnvKeys: [], defaultTarget: target,
      pollTool: { request: poll },
      resolveScheduledLinqRoute: vi.fn(async () => ({ target: authorizedTarget, conversationThreadId: authorizedTarget, threadIsDirect: direct })),
      resolveScheduledExternalThreadRoute: vi.fn(async () => ({ channel: 'telegram' as const, containerMemberId: 'member_synthetic', threadId: authorizedTarget, threadIsDirect: direct })),
    } }
    const run = async () => executeClaimedAssistantCronJob({ vault: vaultRoot, paths, job: await claim(), trigger: 'scheduled',
      deliveryDispatchMode: 'queue-only', executionContext })
    if (interrupt) {
      boundary.persist.mockRejectedValueOnce(new Error('Synthetic interruption after poll creation'))
      expect((await run()).run.outcome).toBe('failed')
      expect(resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths)).state.pendingOccurrenceAt).toBe(occurrenceAt)
    }
    const result = await run()
    expect(result.run.outcome).toBe('no_op')
    expect(poll).toHaveBeenCalledTimes(interrupt ? 2 : 1)
    for (const [request] of poll.mock.calls) expect(request).toEqual({
      origin: { kind: 'automation_occurrence', automationId: 'automation_01K00000000000000000000000', occurrenceAt },
      route: { channel, target: authorizedTarget }, request: create,
    })
    expect(boundary.deliver).not.toHaveBeenCalled()
    const { state } = resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths))
    expect(state.pendingOccurrenceAt).toBeNull()
    expect(state.lastSucceededAt).not.toBeNull()
    expect(state.runningClaimId).toBeNull()
    expect(Date.parse(projectCanonicalAssistantCronJob({ source, runtimeState: resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths)) }).state.nextRunAt!)).toBeGreaterThan(Date.parse(occurrenceAt))
  })
})
