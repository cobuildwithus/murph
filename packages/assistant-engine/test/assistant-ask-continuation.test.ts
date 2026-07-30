import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'

import {
  ASSISTANT_ASK_CONTINUATION_TURN_PROFILE,
  buildAssistantAskContinuationMessageInput,
  guardAssistantAskContinuationDeliveryCommit,
  readAssistantAskOriginSession,
} from '../src/assistant/ask-continuation.js'
import { resolveAssistantSession } from '../src/assistant/store.js'
import { createAssistantTurnReceipt } from '../src/assistant/turns.js'

const continuationMocks = vi.hoisted(() => ({
  markOutboxIntentTerminal: vi.fn(),
}))

vi.mock('../src/assistant/outbox.js', () => ({
  markAssistantOutboxIntentMirrorTerminalById:
    continuationMocks.markOutboxIntentTerminal,
}))

describe('assistant ask continuation', () => {
  it('builds an isolated turn and preserves reviewed group-delivery proof', () => {
    const routeAuthority = {
      channel: 'telegram' as const,
      containerMemberId: 'member-group',
      threadId: 'thread-group',
    }
    const message = buildAssistantAskContinuationMessageInput({
      answeredMailboxItemIds: ['aask_done_reviewed'],
      expectedConversationScope: 'group',
      instructions: 'Use only the quoted group result.',
      originAssistantInputId: `ain_${'a'.repeat(32)}`,
      outboxExternalThreadRouteAuthority: routeAuthority,
      requestId: 'request-1',
      reviewedAssistantAskCompletionExpiresAt: '2099-01-01T00:00:00.000Z',
      sessionId: 'session-private',
      vault: '/vault',
    })

    expect(ASSISTANT_ASK_CONTINUATION_TURN_PROFILE).toEqual({
      nativeResumePolicy: 'disabled',
      promptProfile: 'assistant-ask-continuation',
      threadScope: 'isolated-thread',
      toolProfile: 'output-only-turn',
    })
    expect(message).toMatchObject({
      answeredMailboxItemIds: ['aask_done_reviewed'],
      approvalPolicy: 'never',
      deliverResponse: true,
      deliveryDispatchMode: 'queue-only',
      outboxExternalThreadRouteAuthority: routeAuthority,
      persistUserPromptOnFailure: false,
      reviewedAssistantAskCompletionExpiresAt:
        '2099-01-01T00:00:00.000Z',
      sandbox: 'read-only',
      sessionId: 'session-private',
      suppressProviderFailureTranscriptAudit: true,
      turnTrigger: 'automation-auto-reply',
      userMessageContent: null,
    })
    expect(message.acceptedTurnInput).toBeUndefined()
    expect(message.codexConfigOverrides).toBeUndefined()
  })

  it('loads the exact propagated origin session despite more than 512 unrelated receipts', async () => {
    const vault = await mkdtemp(
      path.join(os.tmpdir(), 'assistant-ask-origin-session-'),
    )

    try {
      const origin = await createDirectSession({
        actorId: 'actor-first',
        threadId: 'thread-first',
        vault,
      })
      const unrelated = await createDirectSession({
        actorId: 'actor-second',
        threadId: 'thread-second',
        vault,
      })
      for (let index = 0; index < 513; index += 1) {
        await createAssistantTurnReceipt({
          deliveryRequested: true,
          metadata: null,
          prompt: `receipt-${index}`,
          provider: 'codex-cli',
          providerModel: null,
          sessionId: unrelated.session.sessionId,
          vault,
        })
      }

      await expect(readAssistantAskOriginSession({
        sessionId: origin.session.sessionId,
        vault,
      })).resolves.toMatchObject({
        sessionId: origin.session.sessionId,
      })
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })

  it('abandons a queued continuation intent when abort arrives after queueing', async () => {
    const vault = await mkdtemp(
      path.join(os.tmpdir(), 'assistant-ask-abort-after-queue-'),
    )

    try {
      const origin = await createDirectSession({
        actorId: 'actor-abort',
        threadId: 'thread-abort',
        vault,
      })
      const abort = new DOMException('Foreground input arrived.', 'AbortError')
      continuationMocks.markOutboxIntentTerminal.mockReset()
      continuationMocks.markOutboxIntentTerminal.mockResolvedValue(true)

      await expect(guardAssistantAskContinuationDeliveryCommit({
        canCommit: () => {
          throw abort
        },
        deliveryOutcome: {
          error: null,
          intentId: 'intent-continuation',
          kind: 'queued',
          media: [],
          session: origin.session,
        },
        vault,
      })).rejects.toBe(abort)

      expect(continuationMocks.markOutboxIntentTerminal).toHaveBeenCalledWith({
        error: abort,
        intentId: 'intent-continuation',
        onlyCurrentStatuses: ['pending', 'retryable', 'awaiting_approval'],
        status: 'abandoned',
        vault,
      })
    } finally {
      await rm(vault, { force: true, recursive: true })
    }
  })
})

async function createDirectSession(input: {
  actorId: string
  threadId: string
  vault: string
}) {
  return await resolveAssistantSession({
    actorId: input.actorId,
    bindingDeliveryTarget: input.threadId,
    channel: 'telegram',
    target: createDefaultLocalAssistantModelTarget(),
    threadId: input.threadId,
    threadIsDirect: true,
    vault: input.vault,
  })
}
