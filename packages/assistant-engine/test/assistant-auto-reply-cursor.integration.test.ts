import { readFile, rm, stat } from 'node:fs/promises'
import { initializeVault } from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import {
  advanceAssistantAutoReplyCursorLocal, enableAssistantAutoReplyChannelLocal,
  reconcileManagedAssistantAutoReplyChannelsLocal,
} from '../src/assistant/auto-reply-channels.ts'
import { runAssistantAutomationPass } from '../src/assistant/automation/run-loop.ts'
import { hasPendingAssistantAutoReplyInput } from '../src/assistant/automation/scanner.ts'
import type { AssistantAutomationOperationScope } from '../src/assistant/automation/operation-scope.ts'
import { createStoreBackedAssistantInputSource } from '../src/assistant/input-source.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { readAssistantAutomationState } from '../src/assistant/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import { createDeferred, createTempVaultContext } from './test-helpers.ts'

const boundary = vi.hoisted(() => ({ provider: vi.fn<typeof executeCodexTurnWithRecovery>(), deliver: vi.fn() }))
vi.mock('../src/assistant/codex-turn-runner.js', async (original) => ({
  ...await original<typeof import('../src/assistant/codex-turn-runner.ts')>(), executeCodexTurnWithRecovery: boundary.provider,
}))
vi.mock('../src/assistant/runtime-state-service.js', async (original) => {
  const real = await original<typeof import('../src/assistant/runtime-state-service.ts')>()
  return { ...real, createAssistantRuntimeStateService(vault: string) {
    const state = real.createAssistantRuntimeStateService(vault)
    return { ...state, outbox: { ...state.outbox, deliverMessage: boundary.deliver } }
  } }
})

const roots: string[] = []
const target = createAssistantModelTarget({ provider: 'codex-cli', model: 'gpt-6.1-sol', reasoningEffort: 'medium',
  modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only' })
if (!target) throw new Error('Expected test target')
const executionContext = { hosted: { memberId: 'member_synthetic', userEnvKeys: [], defaultTarget: target } }
beforeEach(() => {
  boundary.provider.mockReset().mockImplementation(async (input) => ({ kind: 'succeeded', providerTurn: {
    assistantContractFingerprint: 'a'.repeat(64), attemptCount: 1,
    codexContinuation: { kind: 'explicit-structured-history' }, codexThreadId: null,
    provider: input.route.provider, providerOptions: input.route.providerOptions,
    rawEvents: [], response: 'Synthetic reply.', responseDeliveryContextOrdinal: 0, responseMedia: [], route: input.route,
    session: input.resolvedSession, stderr: '', stdout: '', transcriptResponse: 'Synthetic reply.',
    usage: null, workingDirectory: input.plan.requestedWorkingDirectory,
  } }))
  boundary.deliver.mockReset().mockImplementation(async () => ({ kind: 'sent', deliveryError: null, session: null,
    intent: { intentId: `outbox_synthetic_${boundary.deliver.mock.calls.length}` },
    delivery: { channel: 'telegram', idempotencyKey: null, messageLength: 16, providerMessageId: 'message_synthetic',
      providerThreadId: '100', sentAt: new Date().toISOString(), target: '100', targetKind: 'thread' },
  }))
})
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const { parentRoot, vaultRoot: vault } = await createTempVaultContext('auto-reply-cursor-')
  roots.push(parentRoot)
  await initializeVault({ vaultRoot: vault })
  const inputSource = createStoreBackedAssistantInputSource({ vault })
  const stage = async (seq: number, source = 'telegram', createdAt = `2026-09-01T12:${String(seq).padStart(2, '0')}:00.000Z`) => {
    return (await upsertAssistantInputEvent({ vault, now: new Date(createdAt), event: {
      content: { text: `Synthetic input ${seq}`, transcriptText: `Synthetic input ${seq}`, userMessageContent: [{ type: 'text', text: `Synthetic input ${seq}` }] },
      conversation: { accountId: 'account_synthetic', actorId: 'actor_synthetic', actorIsSelf: false,
        source, threadId: '100', threadIsDirect: true },
      occurredAt: createdAt, receivedAt: createdAt,
      sourceRef: { dedupeKey: `dedupe_${seq}`, eventId: `event_${seq}`, itemId: `item_${seq}`, kind: 'hosted-mailbox',
        lane: 'conversation', laneSeq: String(seq), payloadSchema: 'murph.hosted-mailbox-payload.v1', payloadSource: 'inline',
        source: 'hosted-mailbox', wakeSchema: 'murph.hosted-execution-wake.v1' },
    } }))
  }
  const read = () => readAssistantAutomationState(vault)
  const pass = (operationScope: AssistantAutomationOperationScope) => runAssistantAutomationPass({
    vault, inputSource, drainOutbox: false, executionContext, operationScope, shouldYieldBackgroundMaintenance: () => true,
  })
  const held = () => {
    const entered = createDeferred<readonly string[]>()
    const release = createDeferred<void>()
    const done = pass({ async runAutoReplyGroup(input) {
      const result = await input.operation(input.executionContext, input.turnEnvironment)
      entered.resolve(input.inputIds)
      await release.promise
      return result
    } })
    // Surface an unexpected failure before the seam rather than waiting for the test timeout.
    void done.catch(entered.reject)
    return { entered: entered.promise, release: () => release.resolve(), done }
  }
  const reaches = async (inputId: string) => {
    expect(await hasPendingAssistantAutoReplyInput({ vault, inputSource, state: await read() })).toBe(true)
    const reached: string[] = []
    const result = await pass({ async runAutoReplyGroup(input) {
      reached.push(...input.inputIds)
      return input.operation(input.executionContext, input.turnEnvironment)
    } })
    expect(reached).toContain(inputId)
    expect(result.replies.failed).toBe(0)
  }
  return { vault, inputSource, stage, read, held, reaches }
}

it('merges progress with a channel enabled during the scan and actually handles its retained input', async () => {
  const c = await fixture()
  const seed = await c.stage(1)
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: seed.cursor })
  const a = await c.stage(2)
  const scan = c.held()
  expect(await scan.entered).toEqual([a.inputId])
  await enableAssistantAutoReplyChannelLocal({ channel: 'linq', vault: c.vault, latestInputCursor: a.cursor })
  const enabled = (await c.read()).autoReply.find((entry) => entry.channel === 'linq')!
  const b = await c.stage(3, 'linq')
  scan.release()
  expect((await scan.done).replies.failed).toBe(0)
  const fresh = await c.read()
  expect(fresh.autoReply).toHaveLength(2)
  expect(fresh.autoReply.find((entry) => entry.channel === 'linq')).toEqual(enabled)
  expect(fresh.autoReply.find((entry) => entry.channel === 'telegram')?.eligibleAfter).toEqual(a.cursor)
  await c.reaches(b.inputId)
})

it('does not resurrect a channel disabled while its scan is held', async () => {
  const c = await fixture()
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: null })
  const a = await c.stage(1)
  const scan = c.held()
  expect(await scan.entered).toEqual([a.inputId])
  await reconcileManagedAssistantAutoReplyChannelsLocal({ desiredChannels: [], vault: c.vault })
  scan.release()
  expect((await scan.done).replies.failed).toBe(0)
  expect((await c.read()).autoReply).toEqual([])
})

it('preserves a re-enabled entry with a different seed and handles its next input', async () => {
  const c = await fixture()
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: null })
  const a = await c.stage(1)
  const scan = c.held()
  expect(await scan.entered).toEqual([a.inputId])
  await reconcileManagedAssistantAutoReplyChannelsLocal({ desiredChannels: [], vault: c.vault })
  const seed = await c.stage(2)
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: seed.cursor })
  const enabled = JSON.stringify((await c.read()).autoReply[0])
  const next = await c.stage(3)
  scan.release()
  expect((await scan.done).replies.failed).toBe(0)
  expect(JSON.stringify((await c.read()).autoReply[0])).toBe(enabled)
  await c.reaches(next.inputId)
})

it('drops progress after reseeding behind the scan baseline with the same enabledAt', async () => {
  const c = await fixture()
  const createdAt = '2026-09-01T12:00:00.000Z'
  const seed = await c.stage(1, 'telegram', createdAt)
  const skipped = await c.stage(2, 'telegram', createdAt)
  const baseline = await c.stage(3, 'telegram', createdAt)
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: baseline.cursor })
  const original = (await c.read()).autoReply[0]!
  const a = await c.stage(4)
  const scan = c.held()
  expect(await scan.entered).toEqual([a.inputId])
  await reconcileManagedAssistantAutoReplyChannelsLocal({ desiredChannels: [], vault: c.vault })
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: seed.cursor })
  const enabled = (await c.read()).autoReply[0]!
  expect(enabled.enabledAt).toBe(original.enabledAt)
  scan.release()
  expect((await scan.done).replies.failed).toBe(0)
  expect((await c.read()).autoReply[0]).toEqual(enabled)
  await c.reaches(skipped.inputId)
})

it('retains a higher proposal when the same baseline completes in reverse order, without writing', async () => {
  const c = await fixture()
  const seed = await c.stage(1)
  await enableAssistantAutoReplyChannelLocal({ channel: 'telegram', vault: c.vault, latestInputCursor: seed.cursor })
  const observed = (await c.read()).autoReply[0]!
  const low = await c.stage(2)
  const high = await c.stage(3)
  await advanceAssistantAutoReplyCursorLocal({ vault: c.vault, proposal: { channel: 'telegram', observed, cursor: high.cursor } })
  const file = resolveAssistantStatePaths(c.vault).automationStatePath
  const before = { state: await c.read(), contents: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(Date.now() + 60_000))
  const result = await advanceAssistantAutoReplyCursorLocal({ vault: c.vault, proposal: { channel: 'telegram', observed, cursor: low.cursor } })
  expect(result).toEqual(before.state)
  expect(result.autoReply[0]?.eligibleAfter).toEqual(high.cursor)
  expect(await readFile(file, 'utf8')).toBe(before.contents)
  expect((await stat(file)).mtimeMs).toBe(before.mtime)
})
