import {
  createDefaultLocalAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import { describe, expect, it, vi } from 'vitest'

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

const ORIGIN_SESSION_ID = `asst_${'a'.repeat(32)}`

describe('exact asynchronous image session continuation', () => {
  it('keeps a runtime-authored actor separate from the exact session binding', () => {
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
      sessionId: ORIGIN_SESSION_ID,
      threadId: 'thread_1',
    })
    expect(conversation).not.toHaveProperty('participantId')

    const ordinaryConversation = conversationRefFromAssistantInputConversation({
      accountId: 'identity_1',
      actorId: 'actor_1',
      actorIsSelf: false,
      source: 'linq',
      threadId: 'thread_1',
      threadIsDirect: true,
    })
    expect(ordinaryConversation.participantId).toBe('actor_1')
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
      channel: 'linq',
      identityId: 'identity_1',
      sessionId: ORIGIN_SESSION_ID,
      threadId: 'thread_1',
      threadIsDirect: true,
    })
    expect(resolution).not.toHaveProperty('actorId')
  })

  it('does not coalesce completion inputs from different session owners', () => {
    const first = createSummary(ORIGIN_SESSION_ID)

    expect(
      shouldGroupAdjacentConversationInput(first, createSummary(null)),
    ).toBe(false)
    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createSummary(`asst_${'b'.repeat(32)}`),
      ),
    ).toBe(false)
    expect(
      shouldGroupAdjacentConversationInput(
        first,
        createSummary(ORIGIN_SESSION_ID),
      ),
    ).toBe(true)
  })

  it('binds image launches while preserving the launcher status API', () => {
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
      scopeId: ORIGIN_SESSION_ID,
    }))
    expect(
      context.imageGenerationLauncher?.readStatus?.('caller_selected_scope'),
    ).toBe('pending')
    expect(readStatus).toHaveBeenCalledOnce()
    expect(readStatus).toHaveBeenCalledWith('caller_selected_scope')
  })
})

function createSummary(sessionId: string | null): AssistantAutomationInputSummary {
  return {
    actorIsSelf: false,
    attachmentCount: 0,
    conversation: {
      accountId: 'identity_1',
      actorId: null,
      actorIsSelf: false,
      ...(sessionId ? { sessionId } : {}),
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
