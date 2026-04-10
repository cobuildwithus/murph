import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type { ConversationRef } from '../src/assistant/conversation-ref.ts'
import { ASSISTANT_CHANNEL_ADAPTERS } from '../src/assistant/channels/descriptors.ts'
import {
  createAssistantBindingDelivery,
  createAssistantChannelAdapter,
  inferFallbackBindingDelivery,
  inferThreadFirstBindingDelivery,
  normalizeOptionalText,
  readDeliveredProviderMessageId,
  readDeliveredProviderThreadId,
  readDeliveredTarget,
  resolveDeliveryCandidates,
  resolveExplicitBindingDelivery,
  resolveRequiredDeliveryCandidate,
} from '../src/assistant/channels/helpers.ts'
import { inferAssistantBindingDelivery } from '../src/assistant/channels/registry.ts'
import type { AssistantChannelActivityHandle } from '../src/assistant/channels/types.ts'

const FIXED_NOW = new Date('2026-04-08T12:34:56.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('channel helper seams', () => {
  it('prefers explicit delivery candidates and throws a typed error when no target exists', () => {
    const bindingDelivery = createAssistantBindingDelivery('thread', 'thread-123')

    expect(
      resolveDeliveryCandidates({
        bindingDelivery,
        explicitTarget: '  chat-456  ',
      }),
    ).toEqual([
      {
        kind: 'explicit',
        target: 'chat-456',
      },
    ])

    expect(
      resolveDeliveryCandidates({
        bindingDelivery,
        explicitTarget: '   ',
      }),
    ).toEqual([
      {
        kind: 'thread',
        target: 'thread-123',
      },
    ])

    try {
      resolveRequiredDeliveryCandidate(
        {
          bindingDelivery: null,
          explicitTarget: '   ',
        },
        'target required',
      )
      throw new Error('expected target resolution to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(VaultCliError)
      if (!(error instanceof VaultCliError)) {
        throw error
      }
      expect(error.code).toBe('ASSISTANT_CHANNEL_TARGET_REQUIRED')
      expect(error.message).toBe('target required')
    }
  })

  it('resolves explicit and inferred binding delivery in thread-first and fallback order', () => {
    const conversation = createConversation({
      directness: 'direct',
      participantId: 'participant-1',
      threadId: 'thread-1',
    })

    expect(
      resolveExplicitBindingDelivery({
        deliveryKind: 'thread',
        deliveryTarget: '  explicit-thread  ',
      }),
    ).toEqual({
      kind: 'thread',
      target: 'explicit-thread',
    })

    expect(
      resolveExplicitBindingDelivery({
        deliveryKind: 'thread',
        deliveryTarget: '   ',
      }),
    ).toBeNull()

    expect(
      inferThreadFirstBindingDelivery(
        {
          conversation,
          deliveryKind: 'participant',
          deliveryTarget: '  explicit-participant  ',
        },
        {
          includeParticipant: true,
        },
      ),
    ).toEqual({
      kind: 'participant',
      target: 'explicit-participant',
    })

    expect(
      inferThreadFirstBindingDelivery(
        {
          conversation,
        },
        {
          includeParticipant: true,
        },
      ),
    ).toEqual({
      kind: 'thread',
      target: 'thread-1',
    })

    expect(
      inferThreadFirstBindingDelivery(
        {
          conversation: createConversation({
            participantId: 'participant-2',
            threadId: null,
          }),
        },
        {
          includeParticipant: true,
        },
      ),
    ).toEqual({
      kind: 'participant',
      target: 'participant-2',
    })

    expect(
      inferThreadFirstBindingDelivery(
        {
          conversation: createConversation({
            participantId: 'participant-2',
            threadId: null,
          }),
        },
        {
          includeParticipant: false,
        },
      ),
    ).toBeNull()

    expect(
      inferFallbackBindingDelivery({
        conversation: createConversation({
          directness: 'group',
          participantId: 'participant-3',
          threadId: 'thread-3',
        }),
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-3',
    })

    expect(
      inferFallbackBindingDelivery({
        conversation: createConversation({
          directness: 'direct',
          participantId: 'participant-4',
          threadId: 'thread-4',
        }),
      }),
    ).toEqual({
      kind: 'participant',
      target: 'participant-4',
    })

    expect(
      inferFallbackBindingDelivery({
        conversation: createConversation({
          directness: 'direct',
          participantId: null,
          threadId: 'thread-5',
        }),
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-5',
    })

    expect(
      inferFallbackBindingDelivery({
        conversation: createConversation({
          directness: 'direct',
          participantId: null,
          threadId: null,
        }),
      }),
    ).toBeNull()
  })

  it('uses channel-specific inference rules and unknown-channel fallback delivery', () => {
    const participantOnlyConversation = createConversation({
      channel: 'telegram',
      participantId: 'participant-9',
      threadId: null,
    })

    expect(
      inferAssistantBindingDelivery({
        channel: 'telegram',
        conversation: participantOnlyConversation,
      }),
    ).toEqual({
      kind: 'participant',
      target: 'participant-9',
    })

    expect(
      inferAssistantBindingDelivery({
        channel: 'linq',
        conversation: participantOnlyConversation,
      }),
    ).toBeNull()

    expect(
      inferAssistantBindingDelivery({
        channel: 'unknown-channel',
        conversation: createConversation({
          channel: null,
          directness: 'group',
          participantId: 'participant-10',
          threadId: 'thread-10',
        }),
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-10',
    })
  })

  it('normalizes optional text and delivered identifiers from adapter responses', () => {
    expect(normalizeOptionalText('  value  ')).toBe('value')
    expect(normalizeOptionalText('   ')).toBeNull()
    expect(normalizeOptionalText(undefined)).toBeNull()

    expect(readDeliveredTarget({ target: '  delivered-target  ' })).toBe(
      'delivered-target',
    )
    expect(readDeliveredTarget({ target: '   ' })).toBeNull()
    expect(readDeliveredTarget()).toBeNull()

    expect(
      readDeliveredProviderMessageId({
        providerMessageId: '  provider-message  ',
      }),
    ).toBe('provider-message')
    expect(readDeliveredProviderMessageId({ providerMessageId: '   ' })).toBeNull()
    expect(readDeliveredProviderMessageId()).toBeNull()

    expect(
      readDeliveredProviderThreadId({
        providerThreadId: '  provider-thread  ',
      }),
    ).toBe('provider-thread')
    expect(readDeliveredProviderThreadId({ providerThreadId: '   ' })).toBeNull()
    expect(readDeliveredProviderThreadId()).toBeNull()
  })

  it('normalizes send inputs and delivered metadata through the generic adapter helper', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      providerMessageId: '  provider-message-7  ',
      providerThreadId: '  provider-thread-7  ',
      target: '   ',
    })
    const adapter = createAssistantChannelAdapter({
      channel: 'telegram',
      canAutoReply() {
        return null
      },
      inferBindingDelivery(input) {
        return inferFallbackBindingDelivery(input)
      },
      isReadyForSetup() {
        return true
      },
      supportsIdempotencyKey: true,
      targetRequiredMessage: 'target required',
      sendMessage,
    })

    const delivery = await adapter.send(
      {
        bindingDelivery: createAssistantBindingDelivery('participant', 'participant-7'),
        explicitTarget: '   ',
        idempotencyKey: '  idem-7  ',
        identityId: '  identity-7  ',
        message: 'hello there',
        replyToMessageId: '  reply-7  ',
      },
      {},
    )

    expect(sendMessage).toHaveBeenCalledWith({
      candidate: {
        kind: 'participant',
        target: 'participant-7',
      },
      dependencies: {},
      idempotencyKey: 'idem-7',
      identityId: 'identity-7',
      message: 'hello there',
      replyToMessageId: 'reply-7',
    })
    expect(delivery).toMatchObject({
      channel: 'telegram',
      idempotencyKey: 'idem-7',
      messageLength: 11,
      providerMessageId: 'provider-message-7',
      providerThreadId: 'provider-thread-7',
      sentAt: FIXED_NOW.toISOString(),
      target: 'participant-7',
      targetKind: 'participant',
    })
  })

  it('returns typing handles only when a delivery candidate exists and the adapter returns a valid handle', async () => {
    const invalidStartTyping = vi.fn().mockResolvedValue({
      stop: 'not-a-function',
    })
    const invalidAdapter = createAssistantChannelAdapter({
      channel: 'telegram',
      canAutoReply() {
        return null
      },
      inferBindingDelivery(input) {
        return inferFallbackBindingDelivery(input)
      },
      isReadyForSetup() {
        return true
      },
      supportsIdempotencyKey: false,
      startTypingIndicator: invalidStartTyping,
      targetRequiredMessage: 'target required',
      async sendMessage() {},
    })

    const noCandidate = invalidAdapter.startTypingIndicator
    expect(noCandidate).toBeDefined()
    if (!noCandidate) {
      throw new Error('expected typing indicator helper')
    }
    expect(
      await noCandidate(
        {
          bindingDelivery: null,
          explicitTarget: '   ',
          identityId: '  ignored  ',
        },
        {},
      ),
    ).toBeNull()
    expect(invalidStartTyping).not.toHaveBeenCalled()

    expect(
      await noCandidate(
        {
          bindingDelivery: createAssistantBindingDelivery(
            'participant',
            'participant-typing',
          ),
          explicitTarget: null,
          identityId: '  identity-typing  ',
        },
        {},
      ),
    ).toBeNull()
    expect(invalidStartTyping).toHaveBeenCalledWith({
      candidate: {
        kind: 'participant',
        target: 'participant-typing',
      },
      dependencies: {},
      identityId: 'identity-typing',
    })

    const typingHandle = createTypingHandle()
    const startLinqTyping = vi.fn().mockResolvedValue(typingHandle)
    const startTyping = ASSISTANT_CHANNEL_ADAPTERS.linq.startTypingIndicator
    expect(startTyping).toBeDefined()
    if (!startTyping) {
      throw new Error('expected Linq typing indicator support')
    }

    expect(
      await startTyping(
        {
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq'),
          explicitTarget: '  explicit-chat  ',
          identityId: null,
        },
        {
          startLinqTyping,
        },
      ),
    ).toBe(typingHandle)
    expect(startLinqTyping).toHaveBeenCalledWith({
      target: 'explicit-chat',
    })
  })

  it('routes descriptor sends through channel-specific helpers and enforces email identity requirements', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({
      providerMessageId: '  telegram-message  ',
      target: '  delivered-chat  ',
    })
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: '  linq-message  ',
    })
    const sendEmail = vi.fn().mockResolvedValue({
      providerMessageId: '  email-message  ',
      providerThreadId: '  email-thread  ',
      target: '  delivered@example.com  ',
    })

    const telegramDelivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
      {
        bindingDelivery: createAssistantBindingDelivery('participant', 'participant-11'),
        explicitTarget: '  telegram-chat  ',
        idempotencyKey: '   ',
        identityId: null,
        message: 'telegram hello',
        replyToMessageId: '  reply-11  ',
      },
      {
        sendTelegram,
      },
    )
    expect(sendTelegram).toHaveBeenCalledWith({
      idempotencyKey: null,
      message: 'telegram hello',
      replyToMessageId: 'reply-11',
      target: 'telegram-chat',
    })
    expect(telegramDelivery).toMatchObject({
      channel: 'telegram',
      idempotencyKey: null,
      messageLength: 14,
      providerMessageId: 'telegram-message',
      providerThreadId: null,
      sentAt: FIXED_NOW.toISOString(),
      target: 'delivered-chat',
      targetKind: 'explicit',
    })

    const linqDelivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-11'),
        explicitTarget: null,
        idempotencyKey: '  idem-linq  ',
        identityId: null,
        message: 'linq hello',
        replyToMessageId: '   ',
      },
      {
        sendLinq,
      },
    )
    expect(sendLinq).toHaveBeenCalledWith({
      idempotencyKey: 'idem-linq',
      message: 'linq hello',
      replyToMessageId: null,
      target: 'thread-linq-11',
    })
    expect(linqDelivery).toMatchObject({
      channel: 'linq',
      idempotencyKey: 'idem-linq',
      messageLength: 10,
      providerMessageId: 'linq-message',
      providerThreadId: null,
      sentAt: FIXED_NOW.toISOString(),
      target: 'thread-linq-11',
      targetKind: 'thread',
    })

    const emailDelivery = await ASSISTANT_CHANNEL_ADAPTERS.email.send(
      {
        bindingDelivery: createAssistantBindingDelivery(
          'participant',
          'friend@example.com',
        ),
        explicitTarget: '  preferred@example.com  ',
        idempotencyKey: '  idem-email  ',
        identityId: '  identity-email  ',
        message: 'email hello',
        replyToMessageId: '  reply-email  ',
      },
      {
        sendEmail,
      },
    )
    expect(sendEmail).toHaveBeenCalledWith({
      idempotencyKey: 'idem-email',
      identityId: 'identity-email',
      message: 'email hello',
      replyToMessageId: 'reply-email',
      target: 'preferred@example.com',
      targetKind: 'explicit',
    })
    expect(emailDelivery).toMatchObject({
      channel: 'email',
      idempotencyKey: 'idem-email',
      messageLength: 11,
      providerMessageId: 'email-message',
      providerThreadId: 'email-thread',
      sentAt: FIXED_NOW.toISOString(),
      target: 'delivered@example.com',
      targetKind: 'explicit',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.send(
        {
          bindingDelivery: createAssistantBindingDelivery(
            'participant',
            'friend@example.com',
          ),
          explicitTarget: null,
          idempotencyKey: null,
          identityId: '   ',
          message: 'email hello',
          replyToMessageId: null,
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
    })
  })
})

function createConversation(
  input: Partial<ConversationRef>,
): ConversationRef {
  return {
    directness: 'direct',
    ...input,
  }
}

function createTypingHandle(): AssistantChannelActivityHandle {
  return {
    stop: vi.fn().mockResolvedValue(undefined),
  }
}
