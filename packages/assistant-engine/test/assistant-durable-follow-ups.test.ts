import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/outbound-channel.ts', () => ({
  deliverAssistantMessageOverBinding: vi.fn(),
}))
vi.mock('@murphai/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/core')>()
  return { ...actual, registerAutomationFollowUp: vi.fn(actual.registerAutomationFollowUp) }
})
vi.mock('../src/assistant/input-store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/assistant/input-store.ts')>()
  return { ...actual, readLatestAssistantInputCursor: vi.fn(async () => null) }
})

import { initializeVault, patchAutomation, registerAutomationFollowUp } from '@murphai/core'
import { listAutomations } from '@murphai/query'
import { deliverAssistantMessageOverBinding } from '../src/outbound-channel.ts'
import {
  createAssistantOutboxIntent, deliverAssistantOutboxMessage,
  dispatchAssistantOutboxIntent, readAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import { pruneAssistantTerminalOutboxIntents } from '../src/assistant/outbox/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store.ts'
import { readLatestAssistantInputCursor } from '../src/assistant/input-store.ts'
import { registerDeliveredAssistantFollowUp, readAssistantPendingFollowUps } from '../src/assistant/follow-ups.ts'
import { readAutomationDynamicToolRequest } from '../src/assistant-codex/dynamic-tools/automation.ts'
import { resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tool-catalog.ts'

const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  vi.mocked(readLatestAssistantInputCursor).mockResolvedValue(null)
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const vault = await mkdtemp(path.join(os.tmpdir(), 'durable-follow-up-'))
  roots.push(vault)
  await initializeVault({ vaultRoot: vault })
  vi.mocked(deliverAssistantMessageOverBinding).mockResolvedValue({
    delivery: {
      channel: 'telegram', target: 'test-thread', targetKind: 'explicit',
      sentAt: new Date().toISOString(), messageLength: 30,
      providerMessageId: 'test-provider-message', providerThreadId: 'test-thread',
      idempotencyKey: null,
    },
    deliveryDeduplicated: false, deliveryTransportIdempotent: false,
    outboxIntentId: null, session: undefined,
  })
  return {
    vault, channel: 'telegram', identityId: 'test-member',
    threadId: 'test-thread', threadIsDirect: true,
    sessionId: 'session-follow-up', turnId: 'turn-original',
    message: 'Would the morning or afternoon window work?',
    followUpRequest: { afterMinutes: 20, instructions: 'Check the unresolved time choice; skip if resolved or no longer useful.' },
  }
}

describe('durable optional follow-ups', () => {
  it('starts from confirmed dispatch and replays without duplicating or resurrecting work', async () => {
    const input = await fixture()
    const queued = await deliverAssistantOutboxMessage({ ...input, dispatchMode: 'queue-only' })
    expect(await listAutomations(input.vault)).toHaveLength(0)
    const sent = await dispatchAssistantOutboxIntent({ vault: input.vault, intentId: queued.intent.intentId })
    expect(sent.intent.status).toBe('sent')
    const [child] = await listAutomations(input.vault)
    expect(child).toMatchObject({
      followUpSourceIntentId: sent.intent.intentId, status: 'active',
      continuityPolicy: 'preserve', assistantTargetOverride: { model: 'gpt-5.6-terra' },
    })
    expect(child.schedule).toEqual({
      kind: 'at', at: new Date(Date.parse(sent.intent.delivery!.sentAt) + 20 * 60_000).toISOString(),
    })
    await patchAutomation({ vaultRoot: input.vault, lookup: child.automationId, status: 'archived' })
    await registerDeliveredAssistantFollowUp({ vault: input.vault, intent: sent.intent })
    expect((await listAutomations(input.vault)).map((record) => record.status)).toEqual(['archived'])
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('retries registration after dispatch without sending the original message twice', async () => {
    const input = await fixture()
    vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error('Synthetic registry write interruption'))
    const first = await deliverAssistantOutboxMessage(input)
    expect(first.intent.deliveryConfirmationPending).toBe(true)
    expect(await listAutomations(input.vault)).toHaveLength(0)
    const recovered = await dispatchAssistantOutboxIntent({
      vault: input.vault, intentId: first.intent.intentId, force: true,
    })
    expect(recovered.intent.status).toBe('sent')
    expect(await listAutomations(input.vault)).toHaveLength(1)
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
  })

  it('rejects excess optional work without failing the original delivery', async () => {
    const input = await fixture()
    for (let index = 0; index < 3; index++) {
      const sent = await deliverAssistantOutboxMessage({ ...input, turnId: `turn-source-${index}` })
      expect(sent.kind).toBe('sent')
    }
    expect(await listAutomations(input.vault)).toHaveLength(2)
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledTimes(3)
  })

  it('invalidates a queued evaluation when new input arrives before provider entry', async () => {
    const input = await fixture()
    const sent = await deliverAssistantOutboxMessage(input)
    const [child] = await listAutomations(input.vault)
    const queued = await createAssistantOutboxIntent({
      ...input, followUpRequest: undefined, turnId: 'turn-follow-up',
      message: 'Does either time window work?', dedupeToken: 'synthetic-follow-up-occurrence',
      followUpEvaluatedThrough: null,
      automationAuthority: { automationId: child.automationId, expectedUpdatedAt: child.updatedAt },
    })
    vi.mocked(readLatestAssistantInputCursor).mockResolvedValue({
      inputId: 'input-new-answer', sourceKind: 'hosted-mailbox',
      createdAt: new Date().toISOString(), occurredAt: new Date().toISOString(),
    })
    const stale = await dispatchAssistantOutboxIntent({ vault: input.vault, intentId: queued.intentId })
    expect(stale.intent.status).toBe('failed')
    expect(stale.intent.lastError?.code).toBe('ASSISTANT_FOLLOW_UP_CONTEXT_CHANGED')
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledTimes(1)
    expect((await readAssistantOutboxIntent(input.vault, sent.intent.intentId))?.status).toBe('sent')
    expect((await listAutomations(input.vault))[0].status).toBe('active')
    const fresh = await createAssistantOutboxIntent({
      ...input, followUpRequest: undefined, turnId: 'turn-follow-up-reconsidered',
      message: queued.message, dedupeToken: 'synthetic-follow-up-occurrence',
      followUpEvaluatedThrough: await readLatestAssistantInputCursor({ vault: input.vault }),
      automationAuthority: queued.automationAuthority,
    })
    expect(fresh.intentId).not.toBe(queued.intentId)
    const retried = await dispatchAssistantOutboxIntent({ vault: input.vault, intentId: fresh.intentId })
    expect(retried.intent.status, JSON.stringify(retried.intent.lastError)).toBe('sent')
    expect(deliverAssistantMessageOverBinding).toHaveBeenCalledTimes(2)
  })

  it('retains source evidence across deferral until the child is retired', async () => {
    const input = await fixture()
    const sent = await deliverAssistantOutboxMessage(input)
    const [child] = await listAutomations(input.vault)
    const deferredAt = new Date(Date.now() + 20 * 24 * 60 * 60_000)
    await patchAutomation({
      vaultRoot: input.vault, lookup: child.automationId,
      schedule: { kind: 'at', at: deferredAt.toISOString() },
      activeUntil: new Date(deferredAt.getTime() + 60 * 60_000).toISOString(),
    })
    const pruning = { vault: input.vault, paths: resolveAssistantStatePaths(input.vault),
      now: new Date(Date.now() + 16 * 24 * 60 * 60_000) }
    await pruneAssistantTerminalOutboxIntents(pruning)
    expect(await readAssistantOutboxIntent(input.vault, sent.intent.intentId)).not.toBeNull()
    await patchAutomation({ vaultRoot: input.vault, lookup: child.automationId, status: 'archived' })
    await pruneAssistantTerminalOutboxIntents(pruning)
    expect(await readAssistantOutboxIntent(input.vault, sent.intent.intentId)).toBeNull()
  })

  it('does not create a private follow-up from a group delivery', async () => {
    const input = await fixture()
    const sent = await deliverAssistantOutboxMessage({ ...input, threadIsDirect: false })
    expect(sent.kind).toBe('sent')
    expect(await listAutomations(input.vault)).toHaveLength(0)
  })

  it('projects only unresolved private matters and tolerates unavailable optional context', async () => {
    const input = await fixture()
    await deliverAssistantOutboxMessage(input)
    const session = { binding: {
      actorId: null, channel: input.channel, conversationKey: null, delivery: null,
      identityId: input.identityId, threadId: input.threadId, threadIsDirect: true,
    } }
    const [pending] = await readAssistantPendingFollowUps({ vault: input.vault, session })
    expect(pending.followUpSourceIntentId).toBeTruthy()
    expect(await readAssistantPendingFollowUps({ vault: input.vault, session: {
      binding: { ...session.binding, threadId: 'another-private-thread' },
    } })).toEqual([])
    await patchAutomation({ vaultRoot: input.vault, lookup: pending.automationId, expectedUpdatedAt: pending.updatedAt, status: 'archived' })
    expect(await readAssistantPendingFollowUps({ vault: input.vault, session })).toEqual([])
    await writeFile(path.join(input.vault, pending.relativePath), '---\ninvalid: [\n---\n')
    expect(await readAssistantPendingFollowUps({ vault: input.vault, session })).toEqual([])
  })

  it('gives scheduled originals only attachment authority and validates finite delays', () => {
    const tools = resolveMurphDynamicTools({ automationAvailable: false, followUpAttachmentAvailable: true })
    const tool = tools.find((candidate) => candidate.name === 'automation')!
    expect(JSON.stringify(tool.inputSchema)).toContain('attach_follow_up')
    expect(JSON.stringify(tool.inputSchema)).not.toContain('reconcile')
    expect(readAutomationDynamicToolRequest({
      tool: 'automation', arguments: { action: 'attach_follow_up', afterMinutes: 20, instructions: 'Check the pending choice.' },
    })).toMatchObject({ kind: 'attach-follow-up' })
    expect(readAutomationDynamicToolRequest({
      tool: 'automation', arguments: { action: 'attach_follow_up', afterMinutes: 0, instructions: 'Check.' },
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
  })
})
