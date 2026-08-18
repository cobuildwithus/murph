import { rm } from 'node:fs/promises'

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
  saveAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'
import {
  resolveAssistantSession as seedAssistantSession,
} from '../src/assistant/store.ts'
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
