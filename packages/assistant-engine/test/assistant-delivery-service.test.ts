import { expect, test } from 'vitest'

import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  resolveAssistantCurrentAudienceDeliveryFields,
} from '../src/assistant/delivery-service.ts'
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
    schema: 'murph.assistant-conversation.v2',
    sessionId: 'session-delivery-service-test',
    target,
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
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
    requestedWorkingDirectory: '/tmp/assistant-delivery-service-test',
  }
}
