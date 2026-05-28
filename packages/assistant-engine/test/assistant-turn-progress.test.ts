import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  createDefaultLocalAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  normalizeAssistantProviderConfig,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { describe, expect, it, vi } from 'vitest'

import {
  buildAssistantProgressDeliveryIdempotencyKey,
} from '../src/assistant/delivery-service.js'
import type {
  deliverAssistantProgressUpdate,
} from '../src/assistant/delivery-service.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.js'
import {
  MAX_PROGRESS_CHARS,
} from '../src/assistant/progress-constants.js'
import {
  createAssistantProgressDelivery,
  normalizeAssistantProgressText,
} from '../src/assistant/turn-progress.js'

type DeliverProgressInput = Parameters<typeof deliverAssistantProgressUpdate>[0]

describe('assistant turn progress', () => {
  it('normalizes user-facing progress text before delivery', () => {
    expect(
      normalizeAssistantProgressText(
        '  Reading [the report](https://example.test/report)\n\nand checking context.  ',
      ),
    ).toBe('Reading the report and checking context.')

    const longText = 'x'.repeat(MAX_PROGRESS_CHARS + 20)
    expect(normalizeAssistantProgressText(longText)).toHaveLength(MAX_PROGRESS_CHARS)
    expect(normalizeAssistantProgressText(longText)?.endsWith('...')).toBe(true)
  })

  it('dedupes and limits progress updates inside one turn', async () => {
    const delivered: DeliverProgressInput[] = []
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<void> => {
      delivered.push(input)
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await progress.send('Extracting the PDF and checking relevant results.')
    await progress.send('Extracting the PDF and checking relevant results.')
    await progress.send('Checking the saved context now.')

    await progress.send('Checking the saved context now.')

    await progress.send('Preparing a concise final reply.')

    expect(deliver).toHaveBeenCalledTimes(1)
    expect(delivered.map((input) => [input.ordinal, input.text])).toEqual([
      [0, 'Extracting the PDF and checking relevant results.'],
    ])
  })

  it('keeps progress delivery best-effort', async () => {
    const deliver = vi.fn(async () => {
      throw new Error('outbox unavailable')
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await expect(progress.send('Still working on the file.')).resolves.toBeUndefined()
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('resolves the current delivery context when sending progress', async () => {
    const initialInput = createMessageInput({
      deliveryIdempotencyKey: 'initial-reply-key',
      deliveryReplyToMessageId: 'initial-message',
    })
    const currentInput = createMessageInput({
      deliveryIdempotencyKey: 'current-reply-key',
      deliveryReplyToMessageId: 'current-message',
    })
    const session = createSession()
    const delivered: DeliverProgressInput[] = []
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<void> => {
      delivered.push(input)
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      getDeliveryContext: () => ({
        messageInput: currentInput,
        session,
      }),
      messageInput: initialInput,
      session,
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await progress.send('Checking the latest message now.')

    expect(deliver).toHaveBeenCalledTimes(1)
    expect(delivered[0]?.input.deliveryIdempotencyKey).toBe('current-reply-key')
    expect(delivered[0]?.input.deliveryReplyToMessageId).toBe('current-message')
  })

  it('builds progress idempotency keys distinct from final reply keys', () => {
    expect(
      buildAssistantProgressDeliveryIdempotencyKey({
        deliveryIdempotencyKey: 'reply-key',
        ordinal: 0,
        turnId: 'turn-1',
      }),
    ).toBe('reply-key:progress:0')
    expect(
      buildAssistantProgressDeliveryIdempotencyKey({
        deliveryIdempotencyKey: null,
        ordinal: 1,
        turnId: 'turn-1',
      }),
    ).toBe('assistant-progress:turn-1:1')
  })
})

function createMessageInput(
  overrides: Partial<AssistantMessageInput> = {},
): AssistantMessageInput {
  return {
    deliverResponse: true,
    deliveryIdempotencyKey: 'reply-key',
    prompt: 'process this report',
    vault: '/vault',
    ...overrides,
  }
}

function createSharedPlan(): AssistantTurnSharedPlan {
  return {
    allowSensitiveHealthContext: false,
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
      allowSensitiveHealthContext: false,
      audience: {
        actorId: null,
        bindingDelivery: null,
        channel: null,
        deliveryPolicy: 'not-requested',
        effectiveThreadIsDirect: null,
        explicitTarget: null,
        identityId: null,
        replyToMessageId: null,
        threadId: null,
        threadIsDirect: null,
      },
      operatorAuthority: 'direct-operator',
    },
    firstContactStateDocIds: [],
    onboardingGuidanceOpen: false,
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/work',
  }
}

function createSession(): AssistantSession {
  const target = createDefaultLocalAssistantModelTarget()
  if (!target) {
    throw new Error('Expected a default assistant model target.')
  }

  return {
    alias: null,
    binding: {
      actorId: null,
      channel: null,
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: null,
      threadIsDirect: null,
    },
    codexResume: null,
    codexTarget: target,
    conversationId: 'session-progress',
    createdAt: '2026-05-27T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions: serializeAssistantProviderSessionOptions(
      normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
    ),
    resumeState: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: 'session-progress',
    target,
    turnCount: 0,
    updatedAt: '2026-05-27T00:00:00.000Z',
  }
}
