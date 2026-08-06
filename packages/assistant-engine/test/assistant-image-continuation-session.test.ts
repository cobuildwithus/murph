import { rm } from 'node:fs/promises'

import {
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  AssistantHostedImageGenerationLauncher,
} from '../src/assistant/execution-context.js'
import {
  conversationRefFromAssistantInputConversation,
} from '../src/assistant/conversation-ref.js'
import {
  createAssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'
import {
  buildResolveAssistantSessionInput,
} from '../src/assistant/session-resolution.js'
import type {
  AssistantMessageInput,
} from '../src/assistant/service-contracts.js'
import {
  shouldGroupAdjacentConversationInput,
} from '../src/assistant/automation/grouping.js'
import type {
  AssistantAutomationInputSummary,
} from '../src/assistant/automation/input-summary.js'
import {
  getAssistantSession,
  resolveAssistantSession,
} from '../src/assistant/store.js'
import { createTempVaultContext } from './test-helpers.js'

const ORIGIN_SESSION_ID = `asst_${'a'.repeat(32)}`
const OTHER_SESSION_ID = `asst_${'b'.repeat(32)}`

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('exact asynchronous image session continuation', () => {
  it('carries the exact session locator only on runtime-authored input', () => {
    const conversation = conversationRefFromAssistantInputConversation({
      accountId: 'identity_1',
      actorId: null,
      actorIsSelf: false,
      sessionId: ORIGIN_SESSION_ID,
      source: 'linq',
      threadId: 'thread_1',
      threadIsDirect: true,
    })

    expect(conversation).toMatchObject({
      channel: 'linq',
      directness: 'direct',
      identityId: 'identity_1',
      participantId: null,
      sessionId: ORIGIN_SESSION_ID,
      threadId: 'thread_1',
    })

    const ordinaryConversation = conversationRefFromAssistantInputConversation({
      accountId: 'identity_1',
      actorId: 'actor_1',
      actorIsSelf: false,
      source: 'linq',
      threadId: 'thread_1',
      threadIsDirect: true,
    })
    expect(ordinaryConversation.sessionId).toBeNull()

    const resolution = buildResolveAssistantSessionInput(
      {
        conversation,
        vault: '/unused',
      },
      null,
      createDefaultLocalAssistantModelTarget(),
    )
    expect(resolution).toMatchObject({
      actorId: null,
      channel: 'linq',
      identityId: 'identity_1',
      sessionId: ORIGIN_SESSION_ID,
      threadId: 'thread_1',
      threadIsDirect: true,
    })
  })

  it('resumes the exact session without clearing or rebinding its participant', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-image-continuation-session-',
    )
    cleanupPaths.push(parentRoot)

    const created = await resolveAssistantSession({
      actorId: 'linq-participant',
      channel: 'linq',
      identityId: 'linq-identity',
      target: createCodexTarget(),
      threadId: 'linq-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    expect(created.session.binding.actorId).toBe('linq-participant')

    // The trusted completion is system-authored, so its conversation carries
    // `actorId: null` next to the exact originating session id.
    const completionConversation = conversationRefFromAssistantInputConversation({
      accountId: 'linq-identity',
      actorId: null,
      actorIsSelf: false,
      sessionId: created.session.sessionId,
      source: 'linq',
      threadId: 'linq-thread',
      threadIsDirect: true,
    })

    const resumed = await resolveAssistantSession({
      conversation: completionConversation,
      createIfMissing: false,
      vault: vaultRoot,
    })
    expect(resumed.created).toBe(false)
    expect(resumed.session.sessionId).toBe(created.session.sessionId)
    expect(resumed.resolutionDiagnostics).toMatchObject({
      sessionResolutionLookupSource: 'session-id',
    })
    expect(resumed.session.binding.actorId).toBe('linq-participant')

    // Only the system-authored no-actor case is exempt. A differing non-null
    // actor on an explicit session is a retarget, so it still fails closed.
    await expect(
      resolveAssistantSession({
        conversation: conversationRefFromAssistantInputConversation({
          accountId: 'linq-identity',
          actorId: 'linq-other-participant',
          actorIsSelf: false,
          sessionId: created.session.sessionId,
          source: 'linq',
          threadId: 'linq-thread',
          threadIsDirect: true,
        }),
        createIfMissing: false,
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_ROUTING_CONFLICT',
    })

    const persisted = await getAssistantSession(
      vaultRoot,
      created.session.sessionId,
    )
    expect(persisted.binding.actorId).toBe('linq-participant')

    // Channel, identity, thread, and directness isolation still fails closed.
    await expect(
      resolveAssistantSession({
        conversation: conversationRefFromAssistantInputConversation({
          accountId: 'linq-identity',
          actorId: null,
          actorIsSelf: false,
          sessionId: created.session.sessionId,
          source: 'linq',
          threadId: 'other-thread',
          threadIsDirect: true,
        }),
        createIfMissing: false,
        vault: vaultRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_SESSION_ROUTING_CONFLICT',
    })

    // An explicit opt-in retarget still rebinds the participant.
    const rebound = await resolveAssistantSession({
      actorId: 'linq-other-participant',
      allowBindingRebind: true,
      channel: 'linq',
      createIfMissing: false,
      identityId: 'linq-identity',
      sessionId: created.session.sessionId,
      threadId: 'linq-thread',
      threadIsDirect: true,
      vault: vaultRoot,
    })
    expect(rebound.session.binding.actorId).toBe('linq-other-participant')
  })

  it('does not coalesce completion inputs from different session owners', () => {
    const first = createSummary({ sessionId: ORIGIN_SESSION_ID })

    expect(
      shouldGroupAdjacentConversationInput(first, createSummary({ sessionId: null })),
    ).toBe(false)
    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createSummary({ sessionId: OTHER_SESSION_ID }),
      ),
    ).toBe(false)
    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createSummary({ sessionId: ORIGIN_SESSION_ID }),
      ),
    ).toBe(true)
  })

  it('does not coalesce different session owners in the authenticated group-room fast path', () => {
    // The group-room fast path intentionally ignores the input actor, so exact
    // session ownership is the only boundary left between a system-authored
    // continuation and adjacent group messages.
    const first = createGroupRoomSummary({ sessionId: ORIGIN_SESSION_ID })

    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createGroupRoomSummary({ sessionId: null }),
      ),
    ).toBe(false)
    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createGroupRoomSummary({ sessionId: OTHER_SESSION_ID }),
      ),
    ).toBe(false)
    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createGroupRoomSummary({ sessionId: ORIGIN_SESSION_ID }),
      ),
    ).toBe(true)
    expect(
      shouldGroupAdjacentConversationInput(
        createGroupRoomSummary({ sessionId: null }),
        createGroupRoomSummary({ sessionId: null }),
      ),
    ).toBe(true)
  })

  it('binds the continuation session without disturbing the launch scope', () => {
    const launch = vi.fn<AssistantHostedImageGenerationLauncher['launch']>(
      () => 'started',
    )
    const readStatus = vi.fn<
      NonNullable<AssistantHostedImageGenerationLauncher['readStatus']>
    >(() => 'pending')
    const context = createAssistantHostedToolContext({
      executionContext: {
        imageGenerationLauncher: { launch, readStatus },
        memberId: 'member_1',
        userEnvKeys: [],
      },
      messageInput: {
        vault: '/unused',
      } as AssistantMessageInput,
      session: {
        sessionId: ORIGIN_SESSION_ID,
      } as AssistantSession,
    })

    context.imageGenerationLauncher?.launch({
      operationId: 'operation_1',
      originAssistantInputId: `ain_${'1'.repeat(32)}`,
      originAssistantInputIdExact: true,
      scopeId: 'caller_selected_scope',
      run: async () => ({
        media: null,
        runtimeIssue: null,
        savedImageRef: null,
      }),
    })

    expect(launch).toHaveBeenCalledOnce()
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      continuationSessionId: ORIGIN_SESSION_ID,
      scopeId: 'caller_selected_scope',
    }))
    expect(
      context.imageGenerationLauncher?.readStatus?.('caller_selected_scope'),
    ).toBe('pending')
    expect(readStatus).toHaveBeenCalledOnce()
    expect(readStatus).toHaveBeenCalledWith('caller_selected_scope')
  })
})

function createSummary(input: {
  sessionId: string | null
}): AssistantAutomationInputSummary {
  return {
    actorIsSelf: false,
    attachmentCount: 0,
    conversation: {
      accountId: 'identity_1',
      actorId: null,
      actorIsSelf: false,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      source: 'linq',
      threadId: 'thread_1',
      threadIsDirect: true,
    },
    deliveryTarget: 'thread_1',
    groupRoomBatchingEligible: false,
    inputId: `ain_${'2'.repeat(32)}`,
    occurredAt: '2026-08-06T17:00:00.000Z',
    optionalInboxCaptureId: null,
    projectionReady: true,
    receivedAt: '2026-08-06T17:00:00.000Z',
    replyToMessageId: null,
    source: 'hosted-mailbox',
    text: 'trusted image completion',
  }
}

function createGroupRoomSummary(input: {
  sessionId: string | null
}): AssistantAutomationInputSummary {
  const summary = createSummary(input)
  return {
    ...summary,
    conversation: {
      ...summary.conversation,
      threadIsDirect: false,
    },
    groupRoomBatchingEligible: true,
    source: 'linq',
  }
}

function createCodexTarget(): AssistantModelTarget {
  const target = createAssistantModelTarget({
    model: 'gpt-5-codex',
    provider: 'codex-cli',
  })
  if (!target) {
    throw new Error('Expected assistant model target.')
  }

  return target
}
