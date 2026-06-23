import { expect, test, vi } from 'vitest'

import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  deliverAssistantReaction,
  resolveAssistantCurrentAudienceDeliveryFields,
} from '../src/assistant/delivery-service.ts'
import {
  startAssistantChannelTypingIndicator,
} from '../src/assistant/channel-typing.ts'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../src/assistant/service-contracts.ts'

test('current audience delivery fields fall back to explicit Telegram notification route', () => {
  const session = createAssistantSession()
  const input: AssistantMessageInput = {
    bindingDeliveryTarget: '123456789',
    channel: 'telegram',
    deliveryKind: 'thread',
    prompt: 'Send the reminder.',
    threadId: '123456789',
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields).toMatchObject({
    actorId: null,
    bindingDelivery: {
      kind: 'thread',
      target: '123456789',
    },
    channel: 'telegram',
    explicitTarget: null,
    identityId: null,
    threadId: '123456789',
    threadIsDirect: null,
  })
})

test('current audience delivery fields keep saved session binding before input fallback', () => {
  const session = createAssistantSession({
    binding: {
      actorId: 'linq-participant',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'linq-thread',
      },
      identityId: null,
      threadId: 'linq-thread',
      threadIsDirect: true,
    },
  })
  const input: AssistantMessageInput = {
    bindingDeliveryTarget: 'telegram-thread',
    channel: 'telegram',
    deliveryKind: 'thread',
    prompt: 'Send the reminder.',
    threadId: 'telegram-thread',
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields).toMatchObject({
    actorId: 'linq-participant',
    bindingDelivery: {
      kind: 'thread',
      target: 'linq-thread',
    },
    channel: 'linq',
    threadId: 'linq-thread',
    threadIsDirect: true,
  })
})

test('current audience delivery fields do not mix saved route fields with input binding target', () => {
  const session = createAssistantSession({
    binding: {
      actorId: 'linq-participant',
      channel: 'linq',
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: 'linq-thread',
      threadIsDirect: true,
    },
  })
  const input: AssistantMessageInput = {
    bindingDeliveryTarget: 'telegram-thread',
    channel: 'telegram',
    deliveryKind: 'thread',
    prompt: 'Send the reminder.',
    threadId: 'telegram-thread',
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields).toMatchObject({
    actorId: 'linq-participant',
    bindingDelivery: null,
    channel: 'linq',
    threadId: 'linq-thread',
    threadIsDirect: true,
  })
})

test('current audience delivery fields prefer route-matched input binding hint before audience binding', () => {
  const session = createAssistantSession()
  const input: AssistantMessageInput = {
    bindingDeliveryTarget: 'linq-participant',
    channel: 'linq',
    deliveryKind: 'participant',
    participantId: 'linq-participant',
    prompt: 'Send the reminder.',
    threadId: 'linq-thread',
    threadIsDirect: true,
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan({
      audience: {
        actorId: 'linq-participant',
        bindingDelivery: {
          kind: 'thread',
          target: 'linq-thread',
        },
        channel: 'linq',
        threadId: 'linq-thread',
        threadIsDirect: true,
      },
    }),
  })

  expect(fields).toMatchObject({
    actorId: 'linq-participant',
    bindingDelivery: {
      kind: 'participant',
      target: 'linq-participant',
    },
    channel: 'linq',
    threadId: 'linq-thread',
    threadIsDirect: true,
  })
})

test('current audience delivery fields require identity match before using input binding target', () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'email',
      conversationKey: null,
      delivery: null,
      identityId: 'saved-sender',
      threadId: 'thread-1',
      threadIsDirect: true,
    },
  })
  const input: AssistantMessageInput = {
    bindingDeliveryTarget: 'thread-1',
    channel: 'email',
    deliveryKind: 'thread',
    identityId: 'input-sender',
    prompt: 'Send the reminder.',
    threadId: 'thread-1',
    threadIsDirect: true,
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields).toMatchObject({
    bindingDelivery: null,
    channel: 'email',
    identityId: 'saved-sender',
    threadId: 'thread-1',
    threadIsDirect: true,
  })
})

test('current audience delivery fields allow missing input directness for same route binding target', () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: 'telegram-thread',
      threadIsDirect: true,
    },
  })
  const input: AssistantMessageInput = {
    bindingDeliveryTarget: 'telegram-thread',
    channel: 'telegram',
    deliveryKind: 'thread',
    prompt: 'Send the reminder.',
    threadId: 'telegram-thread',
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields.bindingDelivery).toEqual({
    kind: 'thread',
    target: 'telegram-thread',
  })
})

test('current audience delivery fields infer fallback binding from final audience route', () => {
  const session = createAssistantSession()
  const input: AssistantMessageInput = {
    prompt: 'Send the reminder.',
    vault: '/vaults/test',
  }
  const sharedPlan = createSharedPlan({
    audience: {
      actorId: 'telegram-user',
      channel: 'telegram',
      threadId: 'telegram-thread',
      threadIsDirect: false,
    },
  })

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan,
  })

  expect(fields).toMatchObject({
    actorId: 'telegram-user',
    bindingDelivery: {
      kind: 'thread',
      target: 'telegram-thread',
    },
    channel: 'telegram',
    threadId: 'telegram-thread',
    threadIsDirect: false,
  })
})

test('current audience delivery fields apply partial delivery kind hints to selected route', () => {
  const session = createAssistantSession({
    binding: {
      actorId: null,
      channel: 'telegram',
      conversationKey: null,
      delivery: null,
      identityId: null,
      threadId: 'telegram-thread',
      threadIsDirect: true,
    },
  })
  const input: AssistantMessageInput = {
    deliveryKind: 'thread',
    prompt: 'Send the reminder.',
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields).toMatchObject({
    bindingDelivery: {
      kind: 'thread',
      target: 'telegram-thread',
    },
    channel: 'telegram',
    threadId: 'telegram-thread',
    threadIsDirect: true,
  })
})

test('current audience delivery fields prefer actor id over legacy participant id in input fallback', () => {
  const session = createAssistantSession()
  const input: AssistantMessageInput = {
    actorId: 'linq-actor-current',
    channel: 'linq',
    deliveryKind: 'participant',
    participantId: 'linq-participant-legacy',
    prompt: 'Send the reminder.',
    vault: '/vaults/test',
  }

  const fields = resolveAssistantCurrentAudienceDeliveryFields({
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan(),
  })

  expect(fields).toMatchObject({
    actorId: 'linq-actor-current',
    bindingDelivery: {
      kind: 'participant',
      target: 'linq-actor-current',
    },
    channel: 'linq',
  })
})

test('typing indicators use the current audience route', async () => {
  const session = createAssistantSession({
    binding: {
      actorId: 'linq-participant',
      channel: 'linq',
      conversationKey: null,
      delivery: {
        kind: 'thread',
        target: 'linq-thread',
      },
      identityId: null,
      threadId: 'linq-thread',
      threadIsDirect: false,
    },
  })
  const input: AssistantMessageInput = {
    channel: 'linq',
    deliverResponse: true,
    participantId: 'linq-participant',
    prompt: 'Send the reminder.',
    threadId: 'linq-thread',
    vault: '/vaults/test',
  }
  const startLinqTyping = vi.fn(async () => ({
    stop: async () => undefined,
  }))

  const indicator = startAssistantChannelTypingIndicator({
    channelDependencies: {
      startLinqTyping,
    },
    input,
    precedence: 'audience-first',
    session,
    sharedPlan: createSharedPlan({
      audience: {
        actorId: 'linq-participant',
        channel: 'linq',
        threadId: 'linq-thread',
        threadIsDirect: false,
      },
    }),
  })

  expect(indicator).not.toBeNull()
  await vi.waitFor(() => {
    expect(startLinqTyping).toHaveBeenCalledWith({
      target: 'linq-thread',
    })
  })
  await indicator?.stop()
})

test('Linq reactions fail closed when the current message is not reaction-capable', async () => {
  const session = createAssistantSession()
  const result = await deliverAssistantReaction({
    deliveryContextOrdinal: 1,
    input: {
      channel: 'linq',
      deliverResponse: true,
      deliveryMessageReactionsAvailable: false,
      deliveryReplyToMessageId: 'linq-sms-message',
      deliveryTarget: 'linq-chat',
      prompt: 'React to this.',
      threadId: 'linq-chat',
      vault: '/vaults/test',
    },
    reaction: 'heart',
    session,
    sharedPlan: createSharedPlan({
      audience: {
        channel: 'linq',
        explicitTarget: 'linq-chat',
        replyToMessageId: 'linq-sms-message',
        threadId: 'linq-chat',
        threadIsDirect: true,
      },
    }),
    turnId: 'turn-linq-reaction-ineligible',
  })

  expect(result).toMatchObject({
    kind: 'failed',
    intentId: null,
    error: {
      code: 'ASSISTANT_REACTION_TARGET_UNAVAILABLE',
    },
  })
})

function createAssistantSession(input?: {
  binding?: AssistantSession['binding']
}): AssistantSession {
  const providerOptions = serializeAssistantProviderSessionOptions({
    approvalPolicy: 'never',
    model: 'gpt-5.5',
    modelProvider: 'vercel-ai-gateway',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
  const target = createAssistantModelTarget({
    provider: 'codex-cli',
    approvalPolicy: providerOptions.approvalPolicy,
    codexHome: providerOptions.codexHome ?? null,
    model: providerOptions.model,
    modelProvider: providerOptions.modelProvider ?? null,
    oss: providerOptions.oss,
    profile: providerOptions.profile,
    reasoningEffort: providerOptions.reasoningEffort ?? null,
    sandbox: providerOptions.sandbox,
  })

  if (!target) {
    throw new Error('Expected assistant session target.')
  }

  return {
    alias: null,
    binding:
      input?.binding ??
      {
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
    conversationId: 'session-delivery-service-test',
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions,
    resumeState: null,
    pendingComputerResume: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: 'session-delivery-service-test',
    target,
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}

function createSharedPlan(input?: {
  audience?: Partial<AssistantTurnSharedPlan['conversationPolicy']['audience']>
}): AssistantTurnSharedPlan {
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
        ...input?.audience,
      },
      operatorAuthority: 'direct-operator',
    },
    firstContactStateDocIds: [],
    onboardingGuidanceOpen: false,
    operatorAuthority: 'direct-operator',
    persistUserPromptOnFailure: false,
    requestedWorkingDirectory: '/tmp/assistant-delivery-service-test',
  }
}
