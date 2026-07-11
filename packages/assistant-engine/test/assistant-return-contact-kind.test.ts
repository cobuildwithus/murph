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
    ['whatsapp', null],
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

  it('binds group-tool requests to the current hosted mailbox inputs', async () => {
    const request = vi.fn(async () => ({
      action: 'leave_current' as const,
      result: { status: 'already_left' as const },
    }))
    let currentMessageInput = createMessageInput({
      channel: 'linq',
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: 1,
        conversationId: 'conversation-123',
        inboundMailboxItemIds: ['mailbox_bob'],
        recipientKey: null,
      },
    })
    const session = createAssistantSession()
    const hostedToolContext = createAssistantHostedToolContext({
      getDeliveryContext: () => ({ messageInput: currentMessageInput, session }),
      groupTool: { request },
      messageInput: currentMessageInput,
      session,
    })

    await hostedToolContext.groupTool?.request({ action: 'leave_current' })
    expect(request).toHaveBeenLastCalledWith(
      { action: 'leave_current' },
      { currentHostedMailboxItemIds: ['mailbox_bob'] },
    )

    currentMessageInput = createMessageInput({
      channel: 'linq',
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: 2,
        conversationId: 'conversation-123',
        inboundMailboxItemIds: ['mailbox_bob', 'mailbox_alice'],
        recipientKey: null,
      },
    })
    await hostedToolContext.groupTool?.request({ action: 'leave_current' })
    expect(request).toHaveBeenLastCalledWith(
      { action: 'leave_current' },
      { currentHostedMailboxItemIds: ['mailbox_bob', 'mailbox_alice'] },
    )
  })

  it('binds group-tool requests to the mailbox inputs introduced by the captured ordinal', async () => {
    const request = vi.fn(async () => ({
      action: 'leave_current' as const,
      result: { status: 'already_left' as const },
    }))
    const messageInput = createMessageInput({
      channel: 'linq',
      hostedDeliveryIdempotency: {
        assistantTurnOrdinal: 2,
        conversationId: 'conversation-123',
        inboundMailboxItemIds: ['mailbox_bob', 'mailbox_alice'],
        recipientKey: null,
      },
    })
    const hostedToolContext = createAssistantHostedToolContext({
      getGroupToolMailboxItemIdsForDeliveryContextOrdinal: (ordinal) => {
        if (ordinal === 0) return ['mailbox_bob']
        if (ordinal === 1) return ['mailbox_alice']
        return null
      },
      groupTool: { request },
      messageInput,
      session: createAssistantSession(),
    })

    await hostedToolContext.groupTool?.request(
      { action: 'leave_current' },
      { deliveryContextOrdinal: 1 },
    )
    expect(request).toHaveBeenLastCalledWith(
      { action: 'leave_current' },
      { currentHostedMailboxItemIds: ['mailbox_alice'] },
    )

    await hostedToolContext.groupTool?.request(
      { action: 'leave_current' },
      { deliveryContextOrdinal: 99 },
    )
    expect(request).toHaveBeenLastCalledWith(
      { action: 'leave_current' },
      { currentHostedMailboxItemIds: [] },
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
    model: 'gpt-5.5',
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
