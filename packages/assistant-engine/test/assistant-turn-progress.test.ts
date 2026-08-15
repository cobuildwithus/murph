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
import { afterEach, describe, expect, it, vi } from 'vitest'

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
  MAX_PROGRESS_UPDATES_PER_TURN,
} from '../src/assistant/progress-constants.js'
import {
  createAssistantProgressDelivery,
  normalizeAssistantProgressText,
  shouldCreateAssistantProgressDelivery,
} from '../src/assistant/turn-progress.js'

type DeliverProgressInput = Parameters<typeof deliverAssistantProgressUpdate>[0]

describe('assistant turn progress', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes user-facing progress text before delivery', () => {
    expect(
      normalizeAssistantProgressText(
        '  Reading [the report](https://example.test/report)\n\nand checking context.  ',
      ),
    ).toBe('Reading the report and checking context.')

    const longText = 'x'.repeat(300)
    expect(normalizeAssistantProgressText(longText)).toBe(longText)
  })

  it('dedupes and limits progress updates inside one turn', async () => {
    const delivered: DeliverProgressInput[] = []
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await expect(
      progress.send('Extracting the PDF and checking relevant results.'),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(
      progress.send('Extracting the PDF and checking relevant results.'),
    ).resolves.toEqual({
      kind: 'skipped',
      reason: 'duplicate',
      source: 'model',
    })
    await expect(
      progress.send('Checking the saved context now.'),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(
      progress.send('Reviewing the tool output now.'),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(
      progress.send('Preparing a concise final reply.'),
    ).resolves.toEqual({
      kind: 'skipped',
      reason: 'limit',
      source: 'model',
    })

    expect(deliver).toHaveBeenCalledTimes(MAX_PROGRESS_UPDATES_PER_TURN)
    expect(delivered.map((input) => [input.ordinal, input.text])).toEqual([
      [0, 'Extracting the PDF and checking relevant results.'],
      [1, 'Checking the saved context now.'],
      [2, 'Reviewing the tool output now.'],
    ])
  })

  it('tracks one shared progress budget across system and model updates', async () => {
    const delivered: DeliverProgressInput[] = []
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await expect(
      progress.send('Hang on, refreshing my memory real quick.', {
        source: 'system',
      }),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'system',
    })
    await expect(
      progress.send('Checking the saved context now.', { source: 'model' }),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(
      progress.send('Preparing a concise final reply.', { source: 'model' }),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(
      progress.send('Writing the final answer now.', { source: 'model' }),
    ).resolves.toEqual({
      kind: 'skipped',
      reason: 'limit',
      source: 'model',
    })

    expect(delivered.map((input) => [input.ordinal, input.text])).toEqual([
      [0, 'Hang on, refreshing my memory real quick.'],
      [1, 'Checking the saved context now.'],
      [2, 'Preparing a concise final reply.'],
    ])
  })

  it('lets required system progress bypass the optional budget', async () => {
    const delivered: DeliverProgressInput[] = []
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await expect(progress.send('Checking the saved context now.')).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(progress.send('Preparing the next step now.')).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    await expect(
      progress.send('Hang on, refreshing my memory real quick.', {
        required: true,
        source: 'system',
      }),
    ).resolves.toEqual({
      kind: 'sent',
      source: 'system',
    })

    expect(delivered.map((input) => [input.ordinal, input.text])).toEqual([
      [0, 'Checking the saved context now.'],
      [1, 'Preparing the next step now.'],
      [2, 'Hang on, refreshing my memory real quick.'],
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

    await expect(progress.send('Still working on the file.')).resolves.toEqual({
      kind: 'failed',
      source: 'model',
    })
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('can be closed so later progress sends fail without delivery', async () => {
    const delivered: DeliverProgressInput[] = []
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await expect(progress.send('Checking the latest message now.')).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })
    expect(delivered[0]?.signal?.aborted).toBe(false)

    progress.close?.()
    expect(delivered[0]?.signal?.aborted).toBe(true)
    await expect(progress.send('Preparing a concise final reply.')).resolves.toEqual({
      kind: 'failed',
      source: 'model',
    })
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
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
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

  it('carries an exact accepted-message target to progress delivery', async () => {
    const delivered: Array<DeliverProgressInput & { targetInputId?: string }> = []
    const deliver = vi.fn(async (
      input: DeliverProgressInput & { targetInputId?: string },
    ): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      messageInput: createMessageInput(),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await progress.send('Sharing after a private read.', {
      deliveryContextOrdinal: 0,
      required: true,
      source: 'system',
      targetInputId: 'ain_11111111111111111111111111111111',
    })

    expect(delivered[0]?.targetInputId).toBe(
      'ain_11111111111111111111111111111111',
    )
  })

  it('skips progress when the current delivery context becomes queue-only', async () => {
    const delivered: DeliverProgressInput[] = []
    let currentInput = createMessageInput({
      deliveryDispatchMode: 'queue-only',
    })
    const deliver = vi.fn(async (input: DeliverProgressInput): Promise<AssistantSession> => {
      delivered.push(input)
      return input.session
    })
    const progress = createAssistantProgressDelivery({
      deliver,
      getDeliveryContext: () => ({
        messageInput: currentInput,
        session: createSession(),
      }),
      messageInput: createMessageInput({
        deliveryDispatchMode: 'immediate',
      }),
      session: createSession(),
      sharedPlan: createSharedPlan(),
      turnId: 'turn-progress',
    })

    await expect(progress.send('Checking the latest message now.')).resolves.toEqual({
      kind: 'skipped',
      reason: 'unavailable',
      source: 'model',
    })
    expect(deliver).not.toHaveBeenCalled()

    currentInput = createMessageInput({
      deliveryDispatchMode: 'immediate',
    })
    await expect(progress.send('Checking the latest message now.')).resolves.toEqual({
      kind: 'sent',
      source: 'model',
    })

    expect(delivered.map((input) => [input.ordinal, input.text])).toEqual([
      [0, 'Checking the latest message now.'],
    ])
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

  it('creates progress delivery for auto-reply turns', () => {
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({
          turnTrigger: 'automation-auto-reply',
        }),
      ),
    ).toBe(true)
    expect(shouldCreateAssistantProgressDelivery(createMessageInput())).toBe(true)
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({
          deliveryDispatchMode: 'queue-only',
        }),
      ),
    ).toBe(false)
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({ channel: 'email' }),
      ),
    ).toBe(false)
  })

  it('keeps queue-only auto-reply turns progress-eligible', () => {
    // Hosted-runner turns always dispatch final replies queue-only through the
    // outbox, including interactive auto-replies where a user is waiting.
    // Progress updates are ephemeral direct sends and must stay available
    // there, while queue-only background turns (cron and similar) stay
    // suppressed because no current audience is waiting.
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({
          deliveryDispatchMode: 'queue-only',
          turnTrigger: 'automation-auto-reply',
        }),
      ),
    ).toBe(true)
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({
          deliveryDispatchMode: 'queue-only',
          turnTrigger: 'automation-cron',
        }),
      ),
    ).toBe(false)
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({
          channel: 'email',
          deliveryDispatchMode: 'queue-only',
          turnTrigger: 'automation-auto-reply',
        }),
      ),
    ).toBe(false)
    expect(
      shouldCreateAssistantProgressDelivery(
        createMessageInput({
          deliverResponse: false,
          deliveryDispatchMode: 'queue-only',
          turnTrigger: 'automation-auto-reply',
        }),
      ),
    ).toBe(false)
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
    cliAccess: {
      env: {},
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationPolicy: {
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
