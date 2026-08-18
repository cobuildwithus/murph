import { rm } from 'node:fs/promises'
import path from 'node:path'

import type { InboxServices } from '@murphai/inbox-services'
import {
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  assertStateCardinalityInvariant,
  describeStateCardinality,
  type StateCardinalityProbe,
} from '../../../config/state-cardinality-test.ts'
import type {
  executeCodexTurnWithRecovery,
} from '../src/assistant/codex-turn-runner.ts'
import {
  assistantInputCandidateFromStoredEvent,
} from '../src/assistant/input-source.ts'
import {
  upsertAssistantInputEvent,
} from '../src/assistant/input-store.ts'
import {
  assistantAutomationInputSummaryFromCandidate,
} from '../src/assistant/automation/input-summary.ts'
import {
  listAssistantOutboxIntentsForAutoReplyRoute,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  hashAssistantOutboxIdentity,
} from '../src/assistant/outbox/intents.ts'
import {
  readAssistantAutomationState,
  resolveAssistantSession as seedAssistantSession,
  saveAssistantAutomationState,
} from '../src/assistant/store.ts'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.ts'
import {
  runAssistantAutomationPass,
} from '../src/assistant/automation/run-loop.ts'
import { createTempVaultContext } from './test-helpers.ts'

const boundaries = vi.hoisted(() => ({
  executeProvider: vi.fn<typeof executeCodexTurnWithRecovery>(),
  resolveDefaults: vi.fn(),
}))

vi.mock('@murphai/operator-config/operator-config', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@murphai/operator-config/operator-config')
  >()),
  resolveAssistantOperatorDefaults: boundaries.resolveDefaults,
}))

vi.mock('../src/assistant/codex-turn-runner.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../src/assistant/codex-turn-runner.ts')
  >()),
  executeCodexTurnWithRecovery: boundaries.executeProvider,
}))

const cleanupPaths: string[] = []

const assistantHotReplyProbe = {
  name: 'auto-reply through queue-only durable handoff ignores unrelated outbox state',
  prepare: prepareHotReply,
} satisfies StateCardinalityProbe

beforeEach(() => {
  boundaries.resolveDefaults.mockReset().mockResolvedValue({
    backend: null,
    identityId: null,
    selfDeliveryTargets: null,
  })
  boundaries.executeProvider.mockReset().mockImplementation(async (input) => {
    const codexContinuation = {
      kind: 'explicit-structured-history' as const,
    }
    const releaseAcceptedInputs = await input.onProviderRequestPlanned?.({
      codexContinuation,
      providerAttemptId: null,
    })
    try {
      await input.onProviderRequestStarted?.({
        providerRequestOrdinal: 0,
        startedAt: '2026-08-15T12:00:01.000Z',
      })
      return {
        kind: 'succeeded' as const,
        providerTurn: {
          assistantContractFingerprint: 'a'.repeat(64),
          attemptCount: 1,
          codexContinuation,
          codexThreadId: null,
          provider: input.route.provider,
          providerOptions: input.route.providerOptions,
          rawEvents: [],
          response: 'bounded reply',
          responseDeliveryContextOrdinal: 0,
          responseMedia: [],
          route: input.route,
          session: input.resolvedSession,
          stderr: '',
          stdout: '',
          transcriptResponse: 'bounded reply',
          usage: null,
          workingDirectory: input.plan.requestedWorkingDirectory,
        },
      }
    } finally {
      await releaseAcceptedInputs?.()
    }
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.resetModules()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describeStateCardinality('assistant foreground state-cardinality invariant', () => {
  it(assistantHotReplyProbe.name, async () => {
    await assertStateCardinalityInvariant(assistantHotReplyProbe)
  }, 180_000)
})

it('keeps a fresh reply moving after rebuilding 101 distinct current image identities', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-hot-reply-full-route-',
  )
  cleanupPaths.push(parentRoot)
  await seedRetainedRouteHistory(vaultRoot)
  const paths = resolveAssistantStatePaths(vaultRoot)
  await rm(path.join(paths.stateDirectory, 'outbox-dedupe.sqlite'), {
    force: true,
  })

  const target = createAssistantModelTarget({
    approvalPolicy: 'never',
    model: 'gpt-5.6-test',
    provider: 'codex-cli',
    sandbox: 'danger-full-access',
  })
  if (!target) {
    throw new Error('Expected a test assistant target.')
  }
  await seedAssistantSession({
    actorId: 'actor-current',
    channel: 'email',
    identityId: 'identity-current',
    target,
    threadId: 'thread-current',
    threadIsDirect: true,
    vault: vaultRoot,
  })
  const storedInput = await upsertAssistantInputEvent({
    event: createEmailInputEvent(),
    vault: vaultRoot,
  })
  const candidate = assistantInputCandidateFromStoredEvent(storedInput)
  await saveAssistantAutomationState(vaultRoot, {
    autoReply: [{
      channel: 'email',
      eligibleAfter: null,
      enabledAt: '2026-08-15T11:59:00.000Z',
    }],
    updatedAt: '2026-08-15T11:59:00.000Z',
    version: 1,
  })
  const onProviderRequestStarted = vi.fn()

  const result = await runAssistantAutomationPass({
    deliveryDispatchMode: 'queue-only',
    drainOutbox: false,
    executionContext: {
      hosted: {
        defaultTarget: target,
        memberId: 'member-test',
        userEnvKeys: [],
      },
    },
    inboxServices: createInboxServices(),
    onProviderRequestStarted,
    requestId: 'request-full-route-window',
    vault: vaultRoot,
  })

  expect(boundaries.executeProvider).toHaveBeenCalledOnce()
  expect(onProviderRequestStarted).toHaveBeenCalledOnce()
  expect(result.replies).toMatchObject({
    considered: 1,
    failed: 0,
    replied: 1,
  })
  expect(result.currentTurnDeliveryIntentIds).toEqual([expect.any(String)])
  const committed = await readAssistantOutboxIntent(
    vaultRoot,
    result.currentTurnDeliveryIntentIds[0]!,
  )
  expect(committed).toMatchObject({
    actorId: 'actor-current',
    channel: 'email',
    identityId: 'identity-current',
    status: 'pending',
    threadId: 'thread-current',
  })
  const state = await readAssistantAutomationState(vaultRoot)
  expect(state.autoReply).toContainEqual(expect.objectContaining({
    channel: 'email',
    eligibleAfter: candidate.event.cursor,
  }))
}, 180_000)

it('preserves an older exact native-reply anchor beyond the route window', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-hot-reply-native-anchor-',
  )
  cleanupPaths.push(parentRoot)
  await seedNativeReplyRouteHistory(vaultRoot)

  const target = createAssistantModelTarget({
    approvalPolicy: 'never',
    model: 'gpt-5.6-test',
    provider: 'codex-cli',
    sandbox: 'danger-full-access',
  })
  if (!target) {
    throw new Error('Expected a test assistant target.')
  }
  await seedAssistantSession({
    actorId: 'actor-native-reply',
    channel: 'linq',
    identityId: 'identity-native-reply',
    target,
    threadId: 'hidden-native-reply-thread',
    threadIsDirect: true,
    vault: vaultRoot,
  })
  const storedInput = await upsertAssistantInputEvent({
    event: createLinqNativeReplyInputEvent(),
    vault: vaultRoot,
  })
  const routeHistory = await listAssistantOutboxIntentsForAutoReplyRoute({
    actorId: 'actor-native-reply',
    channel: 'linq',
    deliveryTarget: 'real-native-reply-thread',
    identityId: 'identity-native-reply',
    providerMessageIds: ['provider-native-reply-anchor'],
    threadId: 'hidden-native-reply-thread',
    vault: vaultRoot,
  })
  expect(routeHistory).toHaveLength(100)
  expect(routeHistory.map((intent) => intent.intentId)).toContain(
    'outbox_native_reply_history_000',
  )
  const candidate = assistantInputCandidateFromStoredEvent(storedInput)
  expect(candidate.event.sourceMetadata).toMatchObject({
    kind: 'linq',
    replyToMessageId: 'provider-native-reply-anchor',
  })
  const contextItem = {
    inputCandidate: candidate,
    summary: assistantAutomationInputSummaryFromCandidate(candidate),
    telegramMetadata: null,
  }
  const {
    createAssistantAutoReplyGroupContext,
    processAssistantAutoReplyGroup,
  } = await import('../src/assistant/automation/reply.ts')
  const context = createAssistantAutoReplyGroupContext([contextItem])
  if (!context) {
    throw new Error('Expected one native-reply context.')
  }

  const result = await processAssistantAutoReplyGroup({
    allowSelfAuthored: false,
    context,
    deliveryDispatchMode: 'queue-only',
    enabledChannels: ['linq'],
    executionContext: {
      hosted: {
        defaultTarget: target,
        memberId: 'member-test',
        userEnvKeys: [],
      },
    },
    inboxServices: createInboxServices(),
    requestId: 'request-native-anchor-window',
    sessionMaxAgeMs: null,
    vault: vaultRoot,
  })

  expect(result).toMatchObject({
    failed: 0,
    replied: 1,
    skipped: 0,
  })
  expect(boundaries.executeProvider).toHaveBeenCalledOnce()
  expect(
    boundaries.executeProvider.mock.calls[0]?.[0].input.turnContext,
  ).toContain('Prior anchored answer outside the route window.')
}, 180_000)

async function prepareHotReply(unrelatedStateCount: number) {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    `assistant-hot-reply-${unrelatedStateCount}-`,
  )
  cleanupPaths.push(parentRoot)
  await seedUnrelatedOutbox(vaultRoot, unrelatedStateCount)

  const target = createAssistantModelTarget({
    approvalPolicy: 'never',
    model: 'gpt-5.6-test',
    provider: 'codex-cli',
    sandbox: 'danger-full-access',
  })
  if (!target) {
    throw new Error('Expected a test assistant target.')
  }

  const route = {
    actorId: 'actor-current',
    channel: 'email',
    identityId: 'identity-current',
    threadId: 'thread-current',
    threadIsDirect: true,
  } as const
  await seedAssistantSession({
    ...route,
    target,
    vault: vaultRoot,
  })

  const storedInput = await upsertAssistantInputEvent({
    event: createEmailInputEvent(),
    vault: vaultRoot,
  })
  const candidate = assistantInputCandidateFromStoredEvent(storedInput)
  const contextItem = {
    inputCandidate: candidate,
    summary: assistantAutomationInputSummaryFromCandidate(candidate),
    telegramMetadata: null,
  }

  return {
    root: vaultRoot,
    async loadOperation() {
      const {
        createAssistantAutoReplyGroupContext,
        processAssistantAutoReplyGroup,
      } = await import('../src/assistant/automation/reply.ts')
      const context = createAssistantAutoReplyGroupContext([contextItem])
      if (!context) {
        throw new Error('Expected one hosted auto-reply context.')
      }

      return async () => {
        boundaries.executeProvider.mockClear()
        const result = await processAssistantAutoReplyGroup({
          allowSelfAuthored: false,
          context,
          deliveryDispatchMode: 'queue-only',
          enabledChannels: ['email'],
          executionContext: {
            hosted: {
              defaultTarget: target,
              memberId: 'member-test',
              userEnvKeys: [],
            },
          },
          inboxServices: createInboxServices(),
          requestId: null,
          sessionMaxAgeMs: null,
          vault: vaultRoot,
        })

        expect(boundaries.executeProvider).toHaveBeenCalledTimes(1)
        expect(result).toMatchObject({
          failed: 0,
          replied: 1,
          skipped: 0,
        })
        expect(result.currentTurnDeliveryIntentIds).toEqual([
          expect.any(String),
        ])
      }
    },
  }
}

function createEmailInputEvent() {
  const text = 'Follow up on the reminder.'
  return {
    content: {
      text,
      transcriptText: text,
      userMessageContent: [{
        text,
        type: 'text' as const,
      }],
    },
    conversation: {
      accountId: 'identity-current',
      actorId: 'actor-current',
      actorIsSelf: false,
      source: 'email',
      threadId: 'thread-current',
      threadIsDirect: true,
    },
    occurredAt: '2026-08-15T12:00:00.000Z',
    receivedAt: '2026-08-15T12:00:00.500Z',
    replyTarget: {
      channel: 'email',
      messageId: 'message-current',
      threadId: 'thread-current',
    },
    sourceMetadata: null,
    sourceRef: {
      dedupeKey: 'dedupe-current',
      eventId: 'event-current',
      itemId: 'item-current',
      kind: 'hosted-mailbox' as const,
      lane: 'conversation' as const,
      laneSeq: '1',
      payloadSchema: 'payload-schema',
      payloadSource: 'inline' as const,
      source: 'hosted-mailbox' as const,
      wakeSchema: 'wake-schema',
    },
  }
}

function createLinqNativeReplyInputEvent() {
  const text = 'Following up on that older answer.'
  return {
    content: {
      text,
      transcriptText: text,
      userMessageContent: [{
        text,
        type: 'text' as const,
      }],
    },
    conversation: {
      accountId: 'identity-native-reply',
      actorId: 'actor-native-reply',
      actorIsSelf: false,
      source: 'linq',
      threadId: 'hidden-native-reply-thread',
      threadIsDirect: true,
    },
    occurredAt: '2026-08-15T12:10:00.000Z',
    receivedAt: '2026-08-15T12:10:00.500Z',
    replyTarget: {
      channel: 'linq',
      messageId: 'incoming-native-reply',
      threadId: 'real-native-reply-thread',
    },
    sourceMetadata: {
      externalThreadRouteAuthorityPresent: true,
      kind: 'linq' as const,
      partCount: 1,
      reactionEligible: true,
      replyToMessageId: 'provider-native-reply-anchor',
      senderHandle: '+15550000000',
      service: 'iMessage',
    },
    sourceRef: {
      dedupeKey: 'dedupe-native-reply',
      eventId: 'event-native-reply',
      itemId: 'item-native-reply',
      kind: 'hosted-mailbox' as const,
      lane: 'conversation' as const,
      laneSeq: '1',
      payloadSchema: 'payload-schema',
      payloadSource: 'inline' as const,
      source: 'hosted-mailbox' as const,
      wakeSchema: 'wake-schema',
    },
  }
}

async function seedUnrelatedOutbox(
  vaultRoot: string,
  unrelatedStateCount: number,
): Promise<void> {
  for (let index = 0; index < unrelatedStateCount; index += 1) {
    await saveAssistantOutboxIntent(
      vaultRoot,
      createUnrelatedPendingOutboxIntent(index),
    )
  }
}

async function seedRetainedRouteHistory(vaultRoot: string): Promise<void> {
  for (let index = 0; index <= 100; index += 1) {
    await saveAssistantOutboxIntent(
      vaultRoot,
      createRetainedRouteIntent(index, true),
    )
  }
}

async function seedNativeReplyRouteHistory(vaultRoot: string): Promise<void> {
  for (let index = 0; index <= 100; index += 1) {
    const base = createRetainedRouteIntent(index, false)
    const createdAt = base.createdAt
    const suffix = index.toString().padStart(3, '0')
    const message = index === 0
      ? 'Prior anchored answer outside the route window.'
      : `Newer native-reply route delivery ${suffix}`
    await saveAssistantOutboxIntent(vaultRoot, assistantOutboxIntentSchema.parse({
      ...base,
      actorId: 'actor-native-reply',
      channel: 'linq',
      dedupeKey: `dedupe-native-reply-history-${suffix}`,
      delivery: {
        ...base.delivery,
        channel: 'linq',
        messageLength: message.length,
        providerMessageId: index === 0
          ? 'provider-native-reply-anchor'
          : `provider-native-reply-history-${suffix}`,
        providerThreadId: 'real-native-reply-thread',
        target: 'real-native-reply-thread',
      },
      deliveryIdempotencyKey: `delivery-native-reply-history-${suffix}`,
      explicitTarget: 'real-native-reply-thread',
      identityId: 'identity-native-reply',
      intentId: `outbox_native_reply_history_${suffix}`,
      message,
      sessionId: `session_native_reply_history_${suffix}`,
      targetFingerprint: `target-native-reply-history-${suffix}`,
      threadId: 'hidden-native-reply-thread',
      turnId: `turn_native_reply_history_${suffix}`,
      updatedAt: createdAt,
    }))
  }
}

function createRetainedRouteIntent(
  index: number,
  generatedImage: boolean,
): AssistantOutboxIntent {
  const suffix = index.toString().padStart(3, '0')
  const createdAt = new Date(
    Date.parse('2026-08-14T00:00:00.000Z') + index * 1_000,
  ).toISOString()
  const message = generatedImage
    ? 'Generated image delivery'
    : `Recent route delivery ${suffix}`
  const sessionId = `session_route_history_${suffix}`
  const turnId = `turn_route_history_${suffix}`
  const deliveryIdempotencyKey = `delivery-route-history-${suffix}`
  const media = generatedImage
    ? [{
        alt: `Generated image ${suffix}`,
        contentType: 'image/png' as const,
        filename: `generated-${suffix}.png`,
        kind: 'vault_image' as const,
        ref: `raw/captures/generated-${suffix}.png`,
        sha256: index.toString(16).padStart(64, '0'),
        sizeBytes: index + 1,
        source: 'gpt-image-2',
      }]
    : []

  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId: `outbox_route_history_${suffix}`,
    sessionId,
    turnId,
    createdAt,
    updatedAt: createdAt,
    lastAttemptAt: createdAt,
    nextAttemptAt: null,
    sentAt: createdAt,
    attemptCount: 1,
    status: 'sent',
    message,
    media,
    card: null,
    subject: null,
    operation: null,
    dedupeKey: hashAssistantOutboxIdentity({
      dedupeToken: deliveryIdempotencyKey,
      media,
      message,
      subject: null,
      sessionId,
      turnId,
    }),
    targetFingerprint: `target-route-history-${suffix}`,
    channel: 'email',
    identityId: 'identity-current',
    actorId: 'actor-current',
    threadId: 'thread-current',
    threadIsDirect: true,
    replyToMessageId: null,
    bindingDelivery: null,
    deliverySource: null,
    explicitTarget: 'thread-current',
    delivery: {
      channel: 'email',
      idempotencyKey: `delivery-route-history-${suffix}`,
      messageLength: message.length,
      providerMessageId: `provider-route-history-${suffix}`,
      providerThreadId: 'thread-current',
      sentAt: createdAt,
      target: 'thread-current',
      targetKind: 'thread',
    },
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey,
    deliveryTransportIdempotent: true,
    answeredMailboxItemIds: [],
    preparedDispatchToken: null,
    lastError: null,
  })
}

function createUnrelatedPendingOutboxIntent(index: number): AssistantOutboxIntent {
  const suffix = index.toString().padStart(4, '0')
  const createdAt = new Date(
    Date.parse('2026-08-14T00:00:00.000Z') + index * 1_000,
  ).toISOString()

  return assistantOutboxIntentSchema.parse({
    schema: 'murph.assistant-outbox-intent.v1',
    intentId: `outbox_noise_${suffix}`,
    sessionId: `session_noise_${suffix}`,
    turnId: `turn_noise_${suffix}`,
    createdAt,
    updatedAt: createdAt,
    lastAttemptAt: null,
    nextAttemptAt: createdAt,
    sentAt: null,
    attemptCount: 0,
    status: 'pending',
    message: `unrelated pending delivery ${suffix}`,
    media: [],
    card: null,
    subject: null,
    operation: null,
    dedupeKey: `dedupe-noise-${suffix}`,
    targetFingerprint: `target-noise-${suffix}`,
    channel: 'email',
    identityId: 'identity-noise',
    actorId: 'actor-noise',
    threadId: 'thread-noise',
    threadIsDirect: true,
    replyToMessageId: null,
    bindingDelivery: null,
    deliverySource: null,
    explicitTarget: 'thread-noise',
    delivery: null,
    deliveryConfirmationPending: false,
    deliveryIdempotencyKey: null,
    deliveryTransportIdempotent: false,
    answeredMailboxItemIds: [],
    preparedDispatchToken: null,
    lastError: null,
  })
}

function createInboxServices(): InboxServices {
  const unreachable = async () => {
    throw new Error('Unexpected inbox service call.')
  }

  return {
    bootstrap: unreachable,
    init: unreachable,
    sourceAdd: unreachable,
    sourceList: unreachable,
    sourceRemove: unreachable,
    sourceSetEnabled: unreachable,
    doctor: unreachable,
    setup: unreachable,
    repairEnvelopes: unreachable,
    compactParserAttempts: unreachable,
    parse: unreachable,
    requeue: unreachable,
    backfill: unreachable,
    run: unreachable,
    status: unreachable,
    stop: unreachable,
    list: unreachable,
    listAttachments: unreachable,
    showAttachment: unreachable,
    showAttachmentStatus: unreachable,
    show: unreachable,
    search: unreachable,
    preserveDocumentAttachments: unreachable,
    promoteMeal: unreachable,
    promoteDocument: unreachable,
    promoteJournal: unreachable,
    promoteExperimentNote: unreachable,
  }
}
