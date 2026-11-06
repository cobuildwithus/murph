import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  initializeVault, patchAutomation, readAutomation, readScheduledLog,
  registerAutomationFollowUp, scaffoldScheduledLogPayload, upsertAutomation, upsertScheduledLog,
} from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import { claimResolvedAssistantCronJob, executeClaimedAssistantCronJob } from '../src/assistant/cron/execution.ts'
import {
  listCanonicalAssistantCronRecords, projectCanonicalAssistantCronJob, resolveCanonicalRuntimeState,
  resolveCanonicalAssistantCronNextDeliverableOccurrenceProjection,
} from '../src/assistant/cron/canonical-jobs.ts'
import { readAssistantCronCanonicalRuntimeStore, writeAssistantCronCanonicalRuntimeStore } from '../src/assistant/cron/runtime-state.ts'
import * as cronStore from '../src/assistant/cron/store.ts'
import { reconcileAssistantCronDeliveryIntent } from '../src/assistant/cron/delivery-reconciliation.ts'
import { getAssistantCronAutomationTimingProjection, processDueAssistantCronJobsLocal, runAssistantCronJobNow } from '../src/assistant/cron.ts'
import { createAssistantOutboxIntent } from '../src/assistant/outbox.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.ts'

const boundary = vi.hoisted(() => ({
  provider: vi.fn<typeof executeCodexTurnWithRecovery>(),
  deliver: vi.fn(),
}))
vi.mock('../src/assistant/codex-turn-runner.js', async (original) => ({
  ...await original<typeof import('../src/assistant/codex-turn-runner.ts')>(),
  executeCodexTurnWithRecovery: boundary.provider,
}))
vi.mock('../src/assistant/runtime-state-service.js', async (original) => {
  const real = await original<typeof import('../src/assistant/runtime-state-service.ts')>()
  return { ...real, createAssistantRuntimeStateService(vault: string) {
    const state = real.createAssistantRuntimeStateService(vault)
    return { ...state, outbox: { ...state.outbox, deliverMessage: boundary.deliver } }
  } }
})

const roots: string[] = []
const today = '2026-09-01T12:20:00.000Z'
const tomorrow = '2026-09-02T12:20:00.000Z'
const originalInstructions = 'Send the original reminder.'
const editedInstructions = 'Send the newly confirmed reminder.'
const target = createAssistantModelTarget({ provider: 'codex-cli', model: 'gpt-6.1-sol', reasoningEffort: 'medium',
  modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only' })
if (!target) throw new Error('Expected test target')
const executionContext = { hosted: { memberId: 'member_synthetic', userEnvKeys: [], defaultTarget: target,
  resolveScheduledExternalThreadRoute: async () => ({ channel: 'telegram' as const, containerMemberId: 'member_synthetic', threadId: '100', threadIsDirect: true }),
} }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(today))
  boundary.provider.mockReset().mockImplementation(async (input) => {
    await input.onProviderRequestStarted?.({ providerRequestOrdinal: 0, startedAt: new Date().toISOString() })
    const response = JSON.stringify({ kind: 'send_message', privateSummary: 'Send the scheduled reminder.', text: 'Here is your reminder.' })
    return { kind: 'succeeded', providerTurn: {
      assistantContractFingerprint: 'a'.repeat(64), attemptCount: 1,
      codexContinuation: { kind: 'explicit-structured-history' }, codexThreadId: null,
      provider: input.route.provider, providerOptions: input.route.providerOptions,
      rawEvents: [], response, responseDeliveryContextOrdinal: 0, responseMedia: [], route: input.route,
      session: input.resolvedSession, stderr: '', stdout: '', transcriptResponse: response,
      usage: null, workingDirectory: input.plan.requestedWorkingDirectory,
    } }
  })
  boundary.deliver.mockReset()
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(options: { paused?: boolean; recurring?: boolean } = {}) {
  const { parentRoot, vaultRoot: vault } = await createTempVaultContext('cron-completion-')
  roots.push(parentRoot)
  await initializeVault({ vaultRoot: vault })
  const { record } = await upsertAutomation({
    title: 'Synthetic reminder', slug: 'synthetic-reminder', instructions: originalInstructions,
    continuityPolicy: 'preserve', tags: ['assistant', 'scheduled'], vaultRoot: vault,
    status: options.paused ? 'paused' : 'active',
    schedule: options.recurring ? { kind: 'every', everyMs: 86_400_000 } : { kind: 'at', at: options.paused ? tomorrow : today },
    route: { channel: 'telegram', deliveryTarget: '100', threadIsDirect: true, identityId: null, participantId: null, threadId: '100' },
    now: new Date('2026-08-31T12:20:00.000Z'),
  })
  const paths = resolveAssistantStatePaths(vault)
  const delivery = { channel: 'telegram' as const, idempotencyKey: null, messageLength: 22,
    providerMessageId: 'message_synthetic', providerThreadId: '100', sentAt: today, target: '100', targetKind: 'thread' as const }
  boundary.deliver.mockImplementation(async () => ({
    kind: 'sent', delivery, deliveryError: null, intent: { intentId: 'outbox_inline' }, session: null,
  }))
  const claim = async (id = record.automationId) => {
    const source = (await listCanonicalAssistantCronRecords(vault, ['active', 'paused']))
      .find((candidate) => candidate.kind === 'automation' ? candidate.automationId === id : candidate.scheduledLogId === id)!
    const runtimeState = resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(paths))
    return claimResolvedAssistantCronJob({ paths, occurrenceFallbackAt: new Date().toISOString(),
      job: { kind: 'canonical', source, runtimeState, job: projectCanonicalAssistantCronJob({ source, runtimeState }) } })
  }
  const run = async (id?: string) => executeClaimedAssistantCronJob({ vault, paths, job: await claim(id), trigger: 'scheduled', executionContext })
  const read = () => readAutomation({ vaultRoot: vault, automationId: record.automationId })
  const edit = (at = tomorrow) => patchAutomation({ vaultRoot: vault, lookup: record.automationId,
    expectedUpdatedAt: record.updatedAt, instructions: editedInstructions, schedule: { kind: 'at', at },
    now: new Date('2026-09-01T12:20:01.000Z'),
  })
  const queue = async () => {
    const intent = await createAssistantOutboxIntent({ vault, channel: 'telegram', message: 'Here is your reminder.',
      sessionId: 'session_synthetic', threadId: '100', threadIsDirect: true, turnId: 'turn_synthetic' })
    boundary.deliver.mockResolvedValueOnce({ kind: 'queued', intent, delivery: null, deliveryError: null, session: null })
    expect((await run()).run.outcome).toBe('delivery_pending')
    expect((await readAssistantCronCanonicalRuntimeStore(paths)).jobs[0]?.state.pendingDeliveryIntentId).toBe(intent.intentId)
    return { ...intent, status: 'sent', sentAt: today, updatedAt: today, delivery } satisfies AssistantOutboxIntent
  }
  return { vault, paths, record, claim, run, read, edit, queue }
}

async function expectSettled(context: Awaited<ReturnType<typeof fixture>>, id = context.record.automationId) {
  const runtime = (await readAssistantCronCanonicalRuntimeStore(context.paths)).jobs.find((job) => job.jobId === id)
  expect(runtime).toBeDefined()
  expect(runtime!.state).toMatchObject({ runningClaimId: null, runningAt: null, pendingOccurrenceAt: null, retryAfterAt: null })
  expect(runtime!.state.pendingDeliveryIntentId == null).toBe(true)
}

async function expectTomorrow(context: Awaited<ReturnType<typeof fixture>>) {
  expect(await context.read()).toMatchObject({ status: 'active', schedule: { kind: 'at', at: tomorrow }, instructions: editedInstructions })
  await expectSettled(context)
  vi.setSystemTime(new Date(tomorrow))
  boundary.provider.mockClear()
  boundary.deliver.mockClear()
  expect(await processDueAssistantCronJobsLocal({ vault: context.vault, executionContext, limit: 1 }))
    .toEqual({ failed: 0, processed: 1, succeeded: 1 })
  expect(boundary.provider).toHaveBeenCalledOnce()
  expect(boundary.provider.mock.calls[0]![0].input.prompt).toContain(editedInstructions)
  expect(boundary.deliver).toHaveBeenCalledOnce()
  expect((await context.read()).status).toBe('archived')
}

describe('one-shot completion against real registries', () => {
  it('keeps a reschedule made inside inline delivery, then delivers the edited occurrence tomorrow', async () => {
    const context = await fixture()
    const deliver = boundary.deliver.getMockImplementation()!
    boundary.deliver.mockImplementationOnce(async (...args) => { await context.edit(); return deliver(...args) })
    const result = await context.run()
    expect(result.run.outcome).toBe('delivered')
    expect(result.removedAfterRun).toBe(false)
    await expectTomorrow(context)
  })

  it('keeps a reschedule after reconciliation reads its source, then delivers tomorrow', async () => {
    const context = await fixture()
    const intent = await context.queue()
    const finalize = cronStore.finalizeAssistantCronPendingRunDelivery
    vi.spyOn(cronStore, 'finalizeAssistantCronPendingRunDelivery').mockImplementationOnce(async (input) => {
      await context.edit()
      return finalize(input)
    })
    expect(await reconcileAssistantCronDeliveryIntent({ intent, vault: context.vault })).toEqual({ reconciled: 1 })
    await expectTomorrow(context)
  })

  it('keeps an edit made before reconciliation reads its source', async () => {
    const context = await fixture()
    const intent = await context.queue()
    await context.edit()
    expect(await reconcileAssistantCronDeliveryIntent({ intent, vault: context.vault })).toEqual({ reconciled: 1 })
    await expectTomorrow(context)
  })

  it('keeps a same-at revision active and runs its edited content again', async () => {
    const context = await fixture()
    const deliver = boundary.deliver.getMockImplementation()!
    boundary.deliver.mockImplementationOnce(async (...args) => { await context.edit(today); return deliver(...args) })
    expect((await context.run()).removedAfterRun).toBe(false)
    expect(await context.read()).toMatchObject({ status: 'active', instructions: editedInstructions, schedule: { kind: 'at', at: today } })
    await expectSettled(context)
    boundary.provider.mockClear()
    expect(await processDueAssistantCronJobsLocal({ vault: context.vault, executionContext, limit: 1 })).toMatchObject({ succeeded: 1 })
    expect(boundary.provider.mock.calls[0]![0].input.prompt).toContain(editedInstructions)
    expect((await context.read()).status).toBe('archived')
  })

  it('leaves a manually run paused one-shot paused', async () => {
    const context = await fixture({ paused: true })
    const before = await readFile(path.join(context.vault, context.record.relativePath), 'utf8')
    const result = await runAssistantCronJobNow({ vault: context.vault, job: context.record.automationId, executionContext })
    expect(result.run.outcome).toBe('delivered')
    expect(result.run.scheduledOccurrenceAt).toBe(today)
    expect(result.removedAfterRun).toBe(false)
    expect(await readFile(path.join(context.vault, context.record.relativePath), 'utf8')).toBe(before)
    await expectSettled(context)
  })

  it.each(['inline', 'delayed'] as const)('archives unchanged parents and keeps follow-up children on %s completion', async (mode) => {
    const context = await fixture()
    const child = await registerAutomationFollowUp({
      ...context.record, automationId: undefined, slug: 'follow-up-child', vaultRoot: context.vault,
      followUpSourceIntentId: 'outbox_parent', followUpParentAutomationId: context.record.automationId,
      parentExpectedUpdatedAt: context.record.updatedAt, activeUntil: '2026-09-03T12:20:00.000Z',
      schedule: { kind: 'at', at: tomorrow },
    })
    expect(child).not.toBeNull()
    if (mode === 'inline') {
      expect((await context.run()).removedAfterRun).toBe(true)
    } else {
      const intent = await context.queue()
      expect(await reconcileAssistantCronDeliveryIntent({ intent, vault: context.vault })).toEqual({ reconciled: 1 })
      const first = await context.read()
      expect(await reconcileAssistantCronDeliveryIntent({ intent, vault: context.vault })).toEqual({ reconciled: 0 })
      expect(await context.read()).toEqual(first)
    }
    expect(await context.read()).toMatchObject({ ...context.record, status: 'archived', updatedAt: today, markdown: expect.any(String) })
    expect((await readAutomation({ vaultRoot: context.vault, automationId: child!.automationId })).status).toBe('active')
  })

  it('keeps a scheduled-log edit after its action and runs the moved occurrence tomorrow', async () => {
    const context = await fixture({ paused: true })
    const { record } = await upsertScheduledLog({ ...scaffoldScheduledLogPayload(), scheduledLogId: undefined,
      vaultRoot: context.vault, status: 'active', schedule: { kind: 'at', at: today }, now: new Date('2026-09-01T12:00:00.000Z') })
    // Scheduled logs have no delivery boundary: their real action has finished when the run is appended.
    const append = cronStore.appendAssistantCronRun
    vi.spyOn(cronStore, 'appendAssistantCronRun').mockImplementationOnce(async (...args) => {
      await upsertScheduledLog({ ...record, summary: record.summary ?? undefined, vaultRoot: context.vault, body: 'The confirmed edited log.',
        schedule: { kind: 'at', at: tomorrow }, now: new Date('2026-09-01T12:20:01.000Z') })
      return append(...args)
    })
    expect((await context.run(record.scheduledLogId)).removedAfterRun).toBe(false)
    expect(await readScheduledLog({ vaultRoot: context.vault, scheduledLogId: record.scheduledLogId }))
      .toMatchObject({ status: 'active', body: 'The confirmed edited log.', schedule: { kind: 'at', at: tomorrow } })
    await expectSettled(context, record.scheduledLogId)
    vi.setSystemTime(new Date(tomorrow))
    expect(await processDueAssistantCronJobsLocal({ vault: context.vault, executionContext, limit: 1 })).toMatchObject({ succeeded: 1 })
    expect((await readScheduledLog({ vaultRoot: context.vault, scheduledLogId: record.scheduledLogId })).status).toBe('archived')
  })
})

describe('pending delivery projection readback', () => {
  it.each(['omitted', 'null', 'id'] as const)('reads a real runtime store with pendingDeliveryIntentId %s', async (mode) => {
    const context = await fixture({ recurring: true })
    const source = (await listCanonicalAssistantCronRecords(context.vault))[0]!
    const runtime = resolveCanonicalRuntimeState(source, await readAssistantCronCanonicalRuntimeStore(context.paths))
    const intent = mode === 'id' ? await createAssistantOutboxIntent({
      vault: context.vault, channel: 'telegram', message: 'Synthetic pending reminder.',
      sessionId: 'session_synthetic', threadId: '100', threadIsDirect: true, turnId: 'turn_synthetic',
    }) : null
    if (mode === 'omitted') delete runtime.state.pendingDeliveryIntentId
    else runtime.state.pendingDeliveryIntentId = intent?.intentId ?? null
    await writeAssistantCronCanonicalRuntimeStore(context.paths, { version: 1, jobs: [runtime] })
    const before = await readFile(context.paths.cronAutomationStatePath, 'utf8')
    const readback = (await readAssistantCronCanonicalRuntimeStore(context.paths)).jobs[0]!
    expect(readback.state.pendingDeliveryIntentId).toBe(mode === 'omitted' ? undefined : intent?.intentId ?? null)
    const projection = resolveCanonicalAssistantCronNextDeliverableOccurrenceProjection(source, readback, new Date(today))
    expect(projection).toEqual(mode === 'id'
      ? { nextOccurrenceAt: null, unverifiedReason: 'runtime_state_pending', verified: false }
      : { nextOccurrenceAt: today, unverifiedReason: null, verified: true })
    expect(await readFile(context.paths.cronAutomationStatePath, 'utf8')).toBe(before)
  })

  it('queues a recurrence, reconciles sent, inspects the next occurrence, and actually runs it', async () => {
    const context = await fixture({ recurring: true })
    const intent = await context.queue()
    expect(await getAssistantCronAutomationTimingProjection(context.vault, context.record.relativePath, 'UTC'))
      .toMatchObject({ occurrenceVerified: false, occurrenceUnverifiedReason: 'runtime_state_pending' })
    expect(await reconcileAssistantCronDeliveryIntent({ intent, vault: context.vault })).toEqual({ reconciled: 1 })
    expect(await getAssistantCronAutomationTimingProjection(context.vault, context.record.relativePath, 'UTC'))
      .toMatchObject({ occurrenceVerified: true, occurrenceUnverifiedReason: null, nextOccurrenceAt: tomorrow })
    vi.setSystemTime(new Date(tomorrow))
    boundary.provider.mockClear()
    boundary.deliver.mockClear()
    expect(await processDueAssistantCronJobsLocal({ vault: context.vault, executionContext, limit: 1 })).toEqual({ failed: 0, processed: 1, succeeded: 1 })
    expect(boundary.provider).toHaveBeenCalledOnce()
    expect(boundary.deliver).toHaveBeenCalledOnce()
    expect((await context.read()).status).toBe('active')
  })
})
