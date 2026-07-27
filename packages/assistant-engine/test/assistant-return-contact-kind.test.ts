import { describe, expect, it, vi } from 'vitest'

import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import {
  createAssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import {
  resolveAssistantHostedReturnContactKind,
} from '../src/assistant/return-contact-kind.ts'
import type {
  AssistantMessageInput,
} from '../src/assistant/service-contracts.ts'

describe('assistant return contact kind', () => {
  it.each([
    ['linq', 'text'],
    [' telegram ', 'telegram'],
    ['EMAIL', 'email'],
    ['signal', null],
    [null, null],
    [undefined, null],
  ] as const)('maps %s to %s', (channel, expected) => {
    expect(resolveAssistantHostedReturnContactKind(channel)).toBe(expected)
  })

  it('does not create hosted delivery context from a source channel alone', () => {
    const hostedToolContext = createAssistantHostedToolContext({
      messageInput: createMessageInput({
        channel: 'telegram',
        hostedDeliveryIdempotency: null,
      }),
      session: createAssistantSession(),
    })

    expect(hostedToolContext.currentHostedDeliveryContext()).toBeNull()
  })

  it('keeps the return contact kind when durable delivery authority exists', () => {
    const hostedToolContext = createAssistantHostedToolContext({
      messageInput: createMessageInput({
        channel: 'telegram',
        hostedDeliveryIdempotency: {
          assistantTurnOrdinal: 1,
          conversationId: 'conversation-123',
          inboundMailboxItemIds: ['mailbox_item_123'],
          recipientKey: null,
        },
      }),
      session: createAssistantSession(),
    })

    expect(hostedToolContext.currentHostedDeliveryContext()).toEqual({
      conversationId: '["telegram","conversation-123"]',
      recipientKey: null,
      returnContactKind: 'telegram',
    })
  })

  it('lets one subscription action claim only the terminal eligible input', () => {
    const firstInputId = `ain_${'a'.repeat(32)}`
    const currentInputId = `ain_${'b'.repeat(32)}`
    let acceptedInputIds = [firstInputId, currentInputId]
    const hostedToolContext = createAssistantHostedToolContext({
      executionContext: {
        currentAssistantInputId: () => currentInputId,
        memberId: 'member-subscription-claim',
        userEnvKeys: [],
      },
      getUserActionAcceptedInputIds: () => acceptedInputIds,
      messageInput: createMessageInput({
        channel: 'linq',
        hostedDeliveryIdempotency: null,
      }),
      session: createAssistantSession(),
    })

    expect(hostedToolContext.claimSubscriptionAssistantInputId?.())
      .toBe(currentInputId)
    expect(hostedToolContext.claimSubscriptionAssistantInputId?.()).toBeNull()

    acceptedInputIds = [currentInputId, firstInputId]
    expect(hostedToolContext.currentAssistantInputId?.()).toBe(currentInputId)
    const nextHostedToolContext = createAssistantHostedToolContext({
      executionContext: {
        currentAssistantInputId: () => currentInputId,
        memberId: 'member-subscription-claim',
        userEnvKeys: [],
      },
      getUserActionAcceptedInputIds: () => acceptedInputIds,
      messageInput: createMessageInput({
        channel: 'linq',
        hostedDeliveryIdempotency: null,
      }),
      session: createAssistantSession(),
    })
    expect(nextHostedToolContext.claimSubscriptionAssistantInputId?.())
      .toBeNull()
  })

  it('reuses one Clinical Records connect intent within a hosted tool context', async () => {
    const createConnectLink = vi.fn(async () => ({
      connectUrl:
        `https://app.example.test/records/connect#clinicalRecordsIntent=cr_${'a'.repeat(32)}`,
      expiresAt: '2026-07-16T12:15:00.000Z',
      ok: true as const,
    }))
    const hostedToolContext = createAssistantHostedToolContext({
      executionContext: {
        clinicalRecordsConnectLinkTool: { createConnectLink },
        memberId: 'member-clinical-records-link',
        userEnvKeys: [],
      },
      messageInput: createMessageInput({
        channel: 'linq',
        hostedDeliveryIdempotency: null,
      }),
      session: createAssistantSession(),
    })
    const tool = hostedToolContext.clinicalRecordsConnectLinkTool
    if (!tool) {
      throw new Error('Expected a hosted Clinical Records connect-link tool.')
    }

    const first = tool.createConnectLink()
    const second = tool.createConnectLink()

    await expect(first).resolves.toEqual(await second)
    expect(createConnectLink).toHaveBeenCalledOnce()
  })

  it('records detached tool usage through the existing hosted recorder', async () => {
    const recordUsage = vi.fn(async () => undefined)
    const hostedToolContext = createAssistantHostedToolContext({
      executionContext: {
        memberId: 'member-detached-usage',
        usageRecorder: { recordUsage },
        userEnvKeys: [],
      },
      getUserActionAcceptedInputIds: () => ['assistant_input_1'],
      messageInput: createMessageInput({
        channel: 'linq',
        hostedDeliveryIdempotency: null,
      }),
      session: createAssistantSession(),
    })

    await hostedToolContext.recordDetachedUsage?.({
      effectiveEnv: { OPENAI_API_KEY: 'platform-key' },
      operationId: 'image-operation-1',
      usageDraft: {
        provider: 'openai-images',
        providerRequestOrdinal: 2,
        providerRequestOutcome: 'succeeded',
        usage: {
          apiKeyEnv: 'OPENAI_API_KEY',
          baseUrl: 'https://api.openai.com/v1',
          cacheWriteTokens: null,
          cachedInputTokens: null,
          inputTokens: 12,
          outputTokens: 34,
          providerMetadataJson: null,
          providerName: 'OpenAI Images',
          providerRequestId: 'image-request-1',
          rawUsageJson: null,
          reasoningTokens: null,
          requestedModel: 'gpt-image-2',
          servedModel: 'gpt-image-2',
          totalTokens: 46,
        },
      },
    })

    expect(recordUsage).toHaveBeenCalledOnce()
    expect(recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-images',
        providerRequestOrdinal: 2,
        turnId: 'image-operation-1',
      }),
      ['assistant_input_1'],
    )
  })
})

function createMessageInput(input: {
  channel: string | null
  hostedDeliveryIdempotency: AssistantMessageInput['hostedDeliveryIdempotency']
}): AssistantMessageInput {
  return {
    channel: input.channel,
    hostedDeliveryIdempotency: input.hostedDeliveryIdempotency,
    prompt: 'Hello',
    vault: '/tmp/murph-test-vault',
  }
}

function createAssistantSession(): AssistantSession {
  const providerOptions = serializeAssistantProviderSessionOptions({
    approvalPolicy: 'never',
    codexHome: null,
    model: 'gpt-5.6-terra',
    modelProvider: null,
    oss: false,
    profile: 'default',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
  const target = createAssistantModelTarget({
    approvalPolicy: providerOptions.approvalPolicy,
    codexHome: providerOptions.codexHome ?? null,
    model: providerOptions.model,
    modelProvider: providerOptions.modelProvider ?? null,
    oss: providerOptions.oss,
    profile: providerOptions.profile,
    provider: 'codex-cli',
    reasoningEffort: providerOptions.reasoningEffort ?? null,
    sandbox: providerOptions.sandbox,
  })

  if (!target) {
    throw new Error('Expected assistant session target.')
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
    conversationId: 'session-test',
    createdAt: '2026-04-08T00:00:00.000Z',
    lastTurnAt: null,
    provider: 'codex-cli',
    providerOptions,
    resumeState: null,
    schema: 'murph.assistant-conversation.v2',
    sessionId: 'session-test',
    target,
    turnCount: 0,
    updatedAt: '2026-04-08T00:00:00.000Z',
  }
}
