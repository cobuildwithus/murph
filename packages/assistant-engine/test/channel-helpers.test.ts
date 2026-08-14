import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  assistantVoiceMemoMusicModelId,
  assistantVoiceMemoMusicOutputFormat,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'

import type { ConversationRef } from '../src/assistant/conversation-ref.ts'
import { ASSISTANT_CHANNEL_ADAPTERS } from '../src/assistant/channels/descriptors.ts'
import { sendLinqMessage } from '../src/assistant/channels/runtime.ts'
import {
  createAssistantBindingDelivery,
  createAssistantChannelAdapter,
  inferBindingDeliveryForChannel,
  normalizeOptionalText,
  readDeliveredProviderMessageId,
  readDeliveredProviderThreadId,
  readDeliveredTarget,
  resolveDeliveryCandidates,
  resolveRequiredDeliveryCandidate,
} from '../src/assistant/channels/helpers.ts'
import { inferAssistantBindingDelivery } from '../src/assistant/channels/registry.ts'
import type {
  AssistantChannelActivityHandle,
  AssistantChannelDependencies,
} from '../src/assistant/channels/types.ts'

const FIXED_NOW = new Date('2026-04-08T12:34:56.000Z')
type ImageMedia = Extract<AssistantResponseMedia, { kind: 'image' }>
type VoiceMemoMedia = Extract<AssistantResponseMedia, { kind: 'voice_memo' }>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  it('resolves explicit and inferred binding delivery through the gateway-owned channel helper', () => {
    const conversation = createConversation({
      directness: 'direct',
      participantId: 'participant-1',
      threadId: 'thread-1',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'telegram',
        conversation,
        deliveryKind: 'thread',
        deliveryTarget: '  explicit-thread  ',
      }),
    ).toEqual({
      kind: 'thread',
      target: 'explicit-thread',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'telegram',
        conversation,
        deliveryKind: 'thread',
        deliveryTarget: '   ',
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-1',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'telegram',
        conversation,
        deliveryKind: 'participant',
        deliveryTarget: '  explicit-participant  ',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'explicit-participant',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'telegram',
        conversation,
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-1',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'telegram',
        conversation: createConversation({
          participantId: 'participant-2',
          threadId: null,
        }),
      }),
    ).toEqual({
      kind: 'participant',
      target: 'participant-2',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'linq',
        conversation: createConversation({
          participantId: 'participant-2',
          threadId: null,
        }),
      }),
    ).toBeNull()

    expect(
      inferBindingDeliveryForChannel({
        channel: 'linq',
        conversation: createConversation({
          participantId: 'participant-2',
          threadId: null,
        }),
        deliveryKind: 'participant',
      }),
    ).toEqual({
      kind: 'participant',
      target: 'participant-2',
    })

    expect(
      inferBindingDeliveryForChannel({
        channel: 'custom-channel',
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
      inferBindingDeliveryForChannel({
        channel: 'custom-channel',
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
      inferBindingDeliveryForChannel({
        channel: 'custom-channel',
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
      inferBindingDeliveryForChannel({
        channel: 'custom-channel',
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
      supportsIdempotencyKey: true,
      supportedResponseMediaKinds: [],
      targetRequiredMessage: 'target required',
      sendMessage,
    })

    const delivery = await adapter.send(
      {
        actorId: null,
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
      actorId: null,
      answeredMailboxItemIds: [],
      bindingDelivery: {
        kind: 'participant',
        target: 'participant-7',
      },
      card: null,
      candidate: {
        kind: 'participant',
        target: 'participant-7',
      },
      deliverySource: null,
      dependencies: {},
      explicitTarget: null,
      idempotencyKey: 'idem-7',
      identityId: 'identity-7',
      media: [],
      message: 'hello there',
      replyToMessageId: 'reply-7',
      subject: null,
      threadIsDirect: null,
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
      supportsIdempotencyKey: false,
      supportedResponseMediaKinds: [],
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
      replyToMessageId: null,
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
      replyToMessageId: null,
      target: 'explicit-chat',
      targetKind: 'explicit',
    })
    await typingHandle.stop({
      providerStop: false,
    })
    expect(typingHandle.stop).toHaveBeenCalledWith({
      providerStop: false,
    })
  })

  it('routes descriptor sends through retained channel helpers and requires an injected email transport', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({
      cleanupMessages: [
        { messageId: '  telegram-message-1  ', target: '  telegram-chat  ' },
        { messageId: 'telegram-message-2', target: ' delivered-chat ' },
      ],
      cleanupTargetAliases: ['  telegram-chat  '],
      providerMessageId: '  telegram-message  ',
      providerMessageIds: ['  telegram-message-1  ', 'telegram-message-2'],
      target: '  delivered-chat  ',
    })
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: '  linq-link-message  ',
      providerMessageIds: [
        '  linq-text-message  ',
        '  linq-link-message  ',
      ],
    })
    const sendEmail = vi.fn().mockResolvedValue({
      providerMessageId: '  email-message  ',
      providerThreadId: '  email-thread  ',
      target: '  delivered@example.com  ',
    })

    const telegramDelivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
      {
        actorId: null,
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
      cleanupMessages: [
        { messageId: 'telegram-message-1', target: 'telegram-chat' },
        { messageId: 'telegram-message-2', target: 'delivered-chat' },
      ],
      cleanupTargetAliases: ['telegram-chat'],
      idempotencyKey: null,
      messageLength: 14,
      providerMessageId: 'telegram-message',
      providerMessageIds: ['telegram-message-1', 'telegram-message-2'],
      providerThreadId: null,
      sentAt: FIXED_NOW.toISOString(),
      target: 'delivered-chat',
      targetKind: 'explicit',
    })

    const telegramVoiceFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            'content-type': 'audio/mpeg',
          },
          status: 200,
        })
      }
      if (url === 'https://telegram.test/botbot-token/sendVoice') {
        return Response.json({
          ok: true,
          result: {
            message_id: 'telegram-voice-message',
          },
        })
      }
      throw new Error(`Unexpected Telegram voice memo request: ${url}`)
    })
    const telegramVoiceDelivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery('thread', 'telegram-chat'),
        explicitTarget: null,
        idempotencyKey: '   ',
        identityId: null,
        media: [
          createVoiceMemoMedia({
            transport: {
              generation: {
                kind: 'elevenlabs_speech',
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'mp3_44100_128',
                text: 'Short memo',
                voiceId: 'voice_murph',
              },
              kind: 'telegram_generation',
            },
          }),
        ],
        message: '',
        replyToMessageId: '  reply-voice  ',
      },
      {
        telegramVoiceMemoRuntime: {
          env: {
            ELEVENLABS_API_KEY: 'elevenlabs-key',
            TELEGRAM_API_BASE_URL: 'https://telegram.test',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: telegramVoiceFetch,
        },
      },
    )
    expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.resolveDeliveryTransportIdempotent({
        media: [
          createVoiceMemoMedia({
            transport: {
              generation: {
                kind: 'elevenlabs_speech',
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'mp3_44100_128',
                text: 'Short memo',
                voiceId: 'voice_murph',
              },
              kind: 'telegram_generation',
            },
          }),
        ],
        message: '',
      }),
    ).toBe(false)
    expect(telegramVoiceFetch).toHaveBeenCalledTimes(2)
    expect(String(telegramVoiceFetch.mock.calls[0]?.[0])).toContain(
      'https://api.elevenlabs.io/v1/text-to-speech/voice_murph',
    )
    expect(String(telegramVoiceFetch.mock.calls[1]?.[0])).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
    expect(telegramVoiceDelivery).toMatchObject({
      channel: 'telegram',
      providerMessageId: 'telegram-voice-message',
      providerThreadId: null,
      target: 'telegram-chat',
      targetKind: 'thread',
    })

    const linqDelivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-11'),
        explicitTarget: null,
        idempotencyKey: '  idem-linq  ',
        identityId: null,
        message: 'linq hello',
        replyToMessageId: '   ',
        threadIsDirect: true,
      },
      {
        sendLinq,
      },
    )
    expect(sendLinq).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
      homeRouteFallbackAllowed: true,
      idempotencyKey: 'idem-linq',
      message: 'linq hello',
      replyToMessageId: null,
      target: 'thread-linq-11',
      targetKind: 'thread',
    })
    expect(linqDelivery).toMatchObject({
      channel: 'linq',
      idempotencyKey: 'idem-linq',
      messageLength: 10,
      providerMessageId: 'linq-link-message',
      providerMessageIds: ['linq-text-message', 'linq-link-message'],
      providerThreadId: null,
      sentAt: FIXED_NOW.toISOString(),
      target: 'thread-linq-11',
      targetKind: 'thread',
    })

    const emailDelivery = await ASSISTANT_CHANNEL_ADAPTERS.email.send(
      {
        actorId: null,
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
      subject: null,
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

    const hostedEmailThreadTarget = serializeHostedEmailThreadTarget({
      lastMessageId: '<message-hosted@example.test>',
      references: [
        '<message-root@example.test>',
        '<message-hosted@example.test>',
      ],
      subject: 'Hosted email thread',
      to: ['friend@example.com'],
    })
    await ASSISTANT_CHANNEL_ADAPTERS.email.send(
      {
        actorId: null,
        bindingDelivery: null,
        explicitTarget: hostedEmailThreadTarget,
        idempotencyKey: null,
        identityId: 'identity-email',
        message: 'hosted thread hello',
        replyToMessageId: '<message-hosted@example.test>',
      },
      {
        sendEmail,
      },
    )
    expect(sendEmail).toHaveBeenLastCalledWith({
      idempotencyKey: null,
      identityId: 'identity-email',
      message: 'hosted thread hello',
      replyToMessageId: '<message-hosted@example.test>',
      subject: null,
      target: hostedEmailThreadTarget,
      targetKind: 'thread',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.send(
        {
          actorId: null,
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
      code: 'ASSISTANT_EMAIL_DELIVERY_UNAVAILABLE',
    })
  })

  it('keeps Telegram voice memo route authority through the descriptor', async () => {
    const telegramFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        })
      }
      if (url === 'https://telegram.test/botbot-token/sendVoice') {
        return Response.json(
          {
            description: 'group chat migrated',
            error_code: 400,
            ok: false,
            parameters: { migrate_to_chat_id: '456' },
          },
          { status: 400 },
        )
      }
      throw new Error(`Unexpected Telegram request: ${url}`)
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', '123'),
          explicitTarget: null,
          idempotencyKey: null,
          identityId: null,
          media: [
            createVoiceMemoMedia({
              transport: {
                generation: {
                  kind: 'elevenlabs_speech',
                  modelId: 'eleven_multilingual_v2',
                  outputFormat: 'mp3_44100_128',
                  text: 'Private group memo.',
                  voiceId: 'voice_murph',
                },
                kind: 'telegram_generation',
              },
            }),
          ],
          message: '',
          replyToMessageId: null,
        },
        {
          telegramVoiceMemoRuntime: {
            authorityBoundTarget: '123',
            env: {
              ELEVENLABS_API_KEY: 'elevenlabs-key',
              TELEGRAM_API_BASE_URL: 'https://telegram.test',
              TELEGRAM_BOT_TOKEN: 'bot-token',
            },
            fetchImplementation: telegramFetch,
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE',
      deliveryMayHaveSucceeded: false,
      retryable: false,
    })
    expect(telegramFetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      failedCount: 1,
      sentCount: 2,
      status: 'partial_failure' as const,
    },
    {
      failedCount: 3,
      sentCount: 0,
      status: 'failed' as const,
    },
  ])('rejects incomplete group email fan-out with $status delivery evidence', async (delivery) => {
    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'hosted-group-thread'),
          explicitTarget: null,
          identityId: 'identity-email',
          message: 'group reply',
        },
        {
          sendEmail: vi.fn().mockResolvedValue({
            delivery: {
              ...delivery,
              skippedCount: 0,
            },
            target: 'hosted-group-thread',
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE',
      context: {
        ...delivery,
        skippedCount: 0,
      },
      deliveryMayHaveSucceeded: true,
    })
  })

  it('classifies a skipped group recipient as a pre-provider authority supersession', async () => {
    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'hosted-group-child'),
          explicitTarget: null,
          identityId: 'identity-email',
          message: 'group reply',
        },
        {
          sendEmail: vi.fn().mockResolvedValue({
            delivery: {
              failedCount: 0,
              sentCount: 0,
              skippedCount: 1,
              status: 'failed',
            },
            target: 'hosted-group-child',
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
      context: {
        failedCount: 0,
        sentCount: 0,
        skippedCount: 1,
        status: 'failed',
      },
      deliveryMayHaveSucceeded: false,
      retryable: false,
    })
  })

  it('routes Telegram image media through the dedicated image sender', async () => {
    const sendTelegram = vi.fn()
    const sendTelegramImage = vi.fn().mockResolvedValue({
      cleanupMessages: [
        { messageId: '  telegram-photo-1  ', target: '  telegram-chat  ' },
      ],
      providerMessageId: '  telegram-photo-1  ',
      target: '  telegram-chat  ',
      targetKind: 'thread',
    })
    const media: ImageMedia[] = [
      {
        alt: 'Example image',
        kind: 'image',
        source: 'test',
        url: 'https://cdn.example.test/example.png',
      },
    ]

    expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.resolveDeliveryTransportIdempotent({
        media,
        message: 'Here is the image.',
      }),
    ).toBe(false)

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery('thread', 'telegram-chat'),
        explicitTarget: null,
        idempotencyKey: '  telegram-image-key  ',
        identityId: null,
        media,
        message: 'Here is the image.',
        replyToMessageId: '  reply-photo  ',
      },
      {
        sendTelegram,
        sendTelegramImage,
      },
    )

    expect(sendTelegram).not.toHaveBeenCalled()
    expect(sendTelegramImage).toHaveBeenCalledWith({
      idempotencyKey: 'telegram-image-key',
      media,
      message: 'Here is the image.',
      replyToMessageId: 'reply-photo',
      target: 'telegram-chat',
    })
    expect(delivery).toMatchObject({
      channel: 'telegram',
      cleanupMessages: [
        { messageId: 'telegram-photo-1', target: 'telegram-chat' },
      ],
      idempotencyKey: 'telegram-image-key',
      messageLength: 18,
      providerMessageId: 'telegram-photo-1',
      providerThreadId: null,
      target: 'telegram-chat',
      targetKind: 'thread',
    })
  })

  it('falls back to the voice transcript when Telegram audio preparation fails', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({
      providerMessageId: 'telegram-fallback-message',
      target: 'telegram-chat',
      targetKind: 'thread',
    })
    const telegramFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response('tts unavailable', { status: 503 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'telegram-chat'),
          explicitTarget: null,
          idempotencyKey: 'telegram-voice-tts-failure',
          identityId: null,
          media: [
            createVoiceMemoMedia({
              transcript: 'Have you had any recent blood tests?',
              transport: {
                generation: {
                  kind: 'elevenlabs_speech',
                  modelId: 'eleven_multilingual_v2',
                  outputFormat: 'mp3_44100_128',
                  text: 'Short memo',
                  voiceId: 'voice_murph',
                },
                kind: 'telegram_generation',
              },
            }),
          ],
          message: 'Text that must not be sent yet.',
          replyToMessageId: null,
        },
        {
          sendTelegram,
          telegramVoiceMemoRuntime: {
            env: {
              ELEVENLABS_API_KEY: 'elevenlabs-key',
              TELEGRAM_API_BASE_URL: 'https://telegram.test',
              TELEGRAM_BOT_TOKEN: 'bot-token',
            },
            fetchImplementation: telegramFetch,
          },
        },
      )
    expect(sendTelegram).toHaveBeenCalledWith({
      idempotencyKey: null,
      message:
        'Text that must not be sent yet.\n\nHave you had any recent blood tests?',
      replyToMessageId: null,
      target: 'telegram-chat',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'telegram-fallback-message',
      providerMessageIds: ['telegram-fallback-message'],
      target: 'telegram-chat',
      targetKind: 'thread',
    })
    expect(telegramFetch).toHaveBeenCalledTimes(1)
    expect(String(telegramFetch.mock.calls[0]?.[0])).toContain(
      'https://api.elevenlabs.io/',
    )
  })

  it('preserves Telegram text when song preparation fails without a transcript', async () => {
    const sendTelegram = vi.fn().mockResolvedValue({
      providerMessageId: 'telegram-text-message',
      target: 'telegram-chat',
      targetKind: 'thread',
    })
    const telegramFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response('music unavailable', { status: 503 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery('thread', 'telegram-chat'),
        explicitTarget: null,
        idempotencyKey: 'telegram-requested-song-failure',
        identityId: null,
        media: [
          createVoiceMemoMedia({
            filename: 'requested-song.mp3',
            transcript: null,
            transport: {
              generation: {
                durationMs: 18_000,
                forceInstrumental: false,
                kind: 'elevenlabs_music',
                modelId: assistantVoiceMemoMusicModelId,
                outputFormat: assistantVoiceMemoMusicOutputFormat,
                prompt: 'A warm original song.',
              },
              kind: 'telegram_generation',
            },
          }),
        ],
        message: 'Here is the note that goes with your song.',
        replyToMessageId: null,
      },
      {
        sendTelegram,
        telegramVoiceMemoRuntime: {
          env: {
            ELEVENLABS_API_KEY: 'elevenlabs-key',
            TELEGRAM_API_BASE_URL: 'https://telegram.test',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: telegramFetch,
        },
      },
    )

    expect(sendTelegram).toHaveBeenCalledOnce()
    expect(sendTelegram).toHaveBeenCalledWith({
      idempotencyKey: 'telegram-requested-song-failure',
      message: 'Here is the note that goes with your song.',
      replyToMessageId: null,
      target: 'telegram-chat',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'telegram-text-message',
      providerMessageIds: ['telegram-text-message'],
      target: 'telegram-chat',
      targetKind: 'thread',
    })
    expect(telegramFetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the voice transcript after Telegram accepts text but rejects audio', async () => {
    const sendTelegram = vi.fn()
      .mockResolvedValueOnce({
        providerMessageId: 'telegram-text-message',
        target: 'telegram-chat',
      })
      .mockResolvedValueOnce({
        providerMessageId: 'telegram-fallback-message',
        target: 'telegram-chat',
      })
    const telegramFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'audio/mpeg' },
          status: 200,
        })
      }
      if (url === 'https://telegram.test/botbot-token/sendVoice') {
        return Response.json(
          {
            description: 'Bad Request: voice rejected',
            error_code: 400,
            ok: false,
          },
          { status: 400 },
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery('thread', 'telegram-chat'),
        explicitTarget: null,
        idempotencyKey: 'telegram-voice-fallback',
        identityId: null,
        media: [
          createVoiceMemoMedia({
            transcript: 'Have you had any recent blood tests?',
            transport: {
              generation: {
                kind: 'elevenlabs_speech',
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'mp3_44100_128',
                text: 'Have you had any recent blood tests?',
                voiceId: 'voice_murph',
              },
              kind: 'telegram_generation',
            },
          }),
        ],
        message: "I've got my best people on it.",
        replyToMessageId: null,
      },
      {
        sendTelegram,
        telegramVoiceMemoRuntime: {
          env: {
            ELEVENLABS_API_KEY: 'elevenlabs-key',
            TELEGRAM_API_BASE_URL: 'https://telegram.test',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: telegramFetch,
        },
      },
    )

    expect(sendTelegram).toHaveBeenNthCalledWith(1, {
      idempotencyKey: 'telegram-voice-fallback',
      message: "I've got my best people on it.",
      replyToMessageId: null,
      target: 'telegram-chat',
    })
    expect(sendTelegram).toHaveBeenNthCalledWith(2, {
      idempotencyKey: null,
      message: 'Have you had any recent blood tests?',
      replyToMessageId: null,
      target: 'telegram-chat',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'telegram-fallback-message',
      providerMessageIds: [
        'telegram-text-message',
        'telegram-fallback-message',
      ],
      target: 'telegram-chat',
      targetKind: 'thread',
    })
  })

  it('sends Linq voice memo media through the dedicated endpoint after optional text', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-text-message',
      providerMessageEffects: [{
        message: 'Listen to this',
        providerMessageId: 'linq-text-message',
      }],
      target: 'thread-linq-voice',
    })
    const sendLinqVoiceMemo = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-voice-message',
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    const media = [
      {
        kind: 'voice_memo' as const,
        filename: 'memo.mp3',
        transcript: 'Have you had any recent blood tests?',
        transport: {
          attachmentId: 'attachment_voice_1',
          kind: 'linq_attachment' as const,
        },
      },
    ]

    expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.resolveDeliveryTransportIdempotent({
        media,
        message: 'Listen to this',
      }),
    ).toBe(false)

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: '  +15550000001  ',
        bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
        deliverySource: {
          kind: 'linq',
          fromPhoneNumber: '+15550000002',
        },
        explicitTarget: null,
        idempotencyKey: 'idem-text-first',
        identityId: null,
        media,
        message: '  Listen to this  ',
        nativeReplyRequested: true,
        replyToMessageId: 'reply-text',
      },
      {
        sendLinq,
        sendLinqVoiceMemo,
      },
    )

    expect(sendLinq).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      directRecipientPhoneNumber: '+15550000001',
      fromPhoneNumber: '+15550000002',
      homeRouteFallbackAllowed: false,
      idempotencyKey: 'idem-text-first',
      message: 'Listen to this',
      nativeReplyRequested: true,
      replyToMessageId: 'reply-text',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(sendLinqVoiceMemo).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      attachmentId: 'attachment_voice_1',
      homeRouteFallbackAllowed: false,
      replyToMessageId: 'reply-text',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'linq-voice-message',
      providerMessageEffects: [
        {
          message: 'Listen to this',
          providerMessageId: 'linq-text-message',
        },
        {
          carriesIntentMedia: true,
          message: null,
          providerMessageId: 'linq-voice-message',
        },
      ],
      providerMessageIds: ['linq-text-message', 'linq-voice-message'],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(sendLinq).toHaveBeenCalledTimes(1)
  })

  it('allows Linq home-route fallback for direct thread voice-memo-only sends', async () => {
    const sendLinq = vi.fn()
    const sendLinqVoiceMemo = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-voice-message',
      providerThreadId: 'stale-home-thread',
      target: 'stale-home-thread',
      targetKind: 'thread',
    })

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: '+15550000001',
        bindingDelivery: createAssistantBindingDelivery('thread', 'stale-home-thread'),
        deliverySource: {
          kind: 'linq',
          fromPhoneNumber: '+15550000002',
        },
        explicitTarget: null,
        idempotencyKey: 'idem-voice-home-fallback',
        identityId: null,
        media: [createVoiceMemoMedia()],
        message: '   ',
        replyToMessageId: null,
        threadIsDirect: true,
      },
      {
        sendLinq,
        sendLinqVoiceMemo,
      },
    )

    expect(sendLinq).not.toHaveBeenCalled()
    expect(sendLinqVoiceMemo).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      attachmentId: 'attachment_voice_1',
      homeRouteFallbackAllowed: true,
      replyToMessageId: null,
      target: 'stale-home-thread',
      targetKind: 'thread',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'linq-voice-message',
      providerMessageIds: ['linq-voice-message'],
      providerThreadId: 'stale-home-thread',
      target: 'stale-home-thread',
      targetKind: 'thread',
    })
  })

  it('rejects a marked Linq voice-memo-only reply before either send effect', async () => {
    const sendLinq = vi.fn()
    const sendLinqVoiceMemo = vi.fn()

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: '+15550000001',
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: 'idem-marked-voice-only',
          identityId: null,
          media: [createVoiceMemoMedia()],
          message: '   ',
          nativeReplyRequested: true,
          replyToMessageId: 'selected-message-1',
          threadIsDirect: true,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_NATIVE_REPLY_TEXT_REQUIRED',
    })

    expect(sendLinq).not.toHaveBeenCalled()
    expect(sendLinqVoiceMemo).not.toHaveBeenCalled()
  })

  it('sends Linq voice memos to the concrete target returned by accepted text', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-text-message',
      providerThreadId: 'thread-linq-materialized',
      target: 'thread-linq-materialized',
    })
    const sendLinqVoiceMemo = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-voice-message',
      providerThreadId: 'thread-linq-materialized',
      target: 'thread-linq-materialized',
      targetKind: 'thread',
    })

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: '+15550000001',
        bindingDelivery: createAssistantBindingDelivery('thread', 'stale-thread-linq'),
        deliverySource: {
          kind: 'linq',
          fromPhoneNumber: '+15550000002',
        },
        explicitTarget: null,
        idempotencyKey: 'idem-materialized-text-first',
        identityId: null,
        media: [createVoiceMemoMedia()],
        message: 'Text first',
        replyToMessageId: 'reply-materialized',
      },
      {
        sendLinq,
        sendLinqVoiceMemo,
      },
    )

    expect(sendLinqVoiceMemo).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      attachmentId: 'attachment_voice_1',
      homeRouteFallbackAllowed: false,
      replyToMessageId: 'reply-materialized',
      target: 'thread-linq-materialized',
      targetKind: 'thread',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'linq-voice-message',
      providerMessageIds: ['linq-text-message', 'linq-voice-message'],
      providerThreadId: 'thread-linq-materialized',
      target: 'thread-linq-materialized',
      targetKind: 'thread',
    })
  })

  it('rejects invalid Linq voice memo media combinations before delivery', async () => {
    const media = [createVoiceMemoMedia()]
    const sendLinq = vi.fn()
    const sendLinqVoiceMemo = vi.fn()

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: null,
          identityId: null,
          media: [
            ...media,
            createVoiceMemoMedia({
              filename: 'memo-2.mp3',
              transport: {
                attachmentId: 'attachment_voice_2',
                kind: 'linq_attachment' as const,
              },
            }),
          ],
          message: '',
          replyToMessageId: null,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_VOICE_MEMO_LIMIT',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: null,
          identityId: null,
          media: [
            ...media,
            {
              kind: 'image' as const,
              url: 'https://cdn.example.test/dead-bug/setup.png',
              alt: 'Dead bug setup',
              source: 'dead-bug-setup',
            },
          ],
          message: '',
          replyToMessageId: null,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_VOICE_MEMO_MEDIA_MIX_UNSUPPORTED',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: null,
          identityId: null,
          media: [
            createVoiceMemoMedia({
              transport: {
                generation: {
                  kind: 'elevenlabs_speech',
                  modelId: 'eleven_multilingual_v2',
                  outputFormat: 'mp3_44100_128',
                  text: 'Short memo',
                  voiceId: 'voice_murph',
                },
                kind: 'telegram_generation',
              },
            }),
          ],
          message: '',
          replyToMessageId: null,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_VOICE_MEMO_ATTACHMENT_REQUIRED',
    })

    expect(sendLinq).not.toHaveBeenCalled()
    expect(sendLinqVoiceMemo).not.toHaveBeenCalled()
  })

  it('falls back to the voice transcript after Linq accepts text but rejects audio', async () => {
    const sendLinq = vi.fn()
      .mockResolvedValueOnce({
        providerMessageId: 'linq-text-message',
        providerMessageEffects: [{
          message: 'Text before memo',
          providerMessageId: 'linq-text-message',
        }],
        providerThreadId: 'thread-linq-voice',
        target: 'thread-linq-voice',
        targetKind: 'thread',
      })
      .mockResolvedValueOnce({
        providerMessageId: 'linq-fallback-message',
        providerMessageEffects: [{
          message: 'Have you had any recent blood tests?',
          providerMessageId: 'linq-fallback-message',
        }],
        providerThreadId: 'thread-linq-voice',
        target: 'thread-linq-voice',
        targetKind: 'thread',
      })
    const sendLinqVoiceMemo = vi.fn().mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq voice memo delivery failed.',
        { retryable: true },
      ),
    )

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: '+15550000001',
          answeredMailboxItemIds: ['mailbox_item_answered_1'],
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          deliverySource: {
            kind: 'linq',
            fromPhoneNumber: '+15550000002',
          },
          explicitTarget: null,
          idempotencyKey: 'idem-partial-voice',
          identityId: null,
          media: [
            createVoiceMemoMedia({
              transcript: 'Have you had any recent blood tests?',
            }),
          ],
          message: 'Text before memo',
          replyToMessageId: 'linq-message-answered-1',
          threadIsDirect: true,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      )
    expect(sendLinq).toHaveBeenNthCalledWith(2, {
      answeredMailboxItemIds: ['mailbox_item_answered_1'],
      directRecipientPhoneNumber: '+15550000001',
      fromPhoneNumber: '+15550000002',
      homeRouteFallbackAllowed: true,
      idempotencyKey: 'linq-voice-memo-transcript:idem-partial-voice',
      message: 'Have you had any recent blood tests?',
      replyToMessageId: 'linq-message-answered-1',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'linq-fallback-message',
      providerMessageEffects: [
        {
          message: 'Text before memo',
          providerMessageId: 'linq-text-message',
        },
        {
          message: 'Have you had any recent blood tests?',
          providerMessageId: 'linq-fallback-message',
        },
      ],
      providerMessageIds: ['linq-text-message', 'linq-fallback-message'],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
  })

  it('records a media-only Linq voice fallback as the visible transcript text', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-fallback-message',
      providerMessageEffects: [{
        message: 'Visible fallback transcript.',
        providerMessageId: 'linq-fallback-message',
      }],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    const sendLinqVoiceMemo = vi.fn().mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq voice memo delivery failed.',
        { retryable: true },
      ),
    )

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery(
          'thread',
          'thread-linq-voice',
        ),
        explicitTarget: null,
        idempotencyKey: 'idem-media-only-fallback',
        identityId: null,
        media: [
          createVoiceMemoMedia({
            transcript: 'Visible fallback transcript.',
          }),
        ],
        message: '',
        replyToMessageId: null,
      },
      {
        sendLinq,
        sendLinqVoiceMemo,
      },
    )

    expect(delivery).toMatchObject({
      messageLength: 0,
      providerMessageEffects: [
        {
          message: 'Visible fallback transcript.',
          providerMessageId: 'linq-fallback-message',
        },
      ],
      providerMessageId: 'linq-fallback-message',
      providerMessageIds: ['linq-fallback-message'],
    })
  })

  it('preserves physical Linq effects when a media-only voice fallback is split into text and a rich link', async () => {
    let requestCount = 0
    const sendLinq = vi.fn<NonNullable<AssistantChannelDependencies['sendLinq']>>(
      async (request) => await sendLinqMessage(request, {
        env: {
          LINQ_API_BASE_URL: 'https://linq.example.test/api/partner/v3',
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: vi.fn(async () => {
          requestCount += 1
          return new Response(JSON.stringify({
            chat_id: 'thread-linq-voice',
            message: {
              id: requestCount === 1
                ? 'linq-fallback-text'
                : 'linq-fallback-link',
            },
          }), {
            headers: { 'Content-Type': 'application/json' },
          })
        }),
      }),
    )
    const sendLinqVoiceMemo = vi.fn().mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq voice memo delivery failed.',
        { retryable: true },
      ),
    )

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery(
          'thread',
          'thread-linq-voice',
        ),
        explicitTarget: null,
        idempotencyKey: 'idem-media-only-split-fallback',
        identityId: null,
        media: [
          createVoiceMemoMedia({
            transcript: [
              'Visible fallback transcript.',
              'https://example.test/follow-up',
            ].join('\n'),
          }),
        ],
        message: '',
        replyToMessageId: null,
      },
      {
        sendLinq,
        sendLinqVoiceMemo,
      },
    )

    expect(requestCount).toBe(2)
    expect(delivery).toMatchObject({
      messageLength: 0,
      providerMessageEffects: [
        {
          message: 'Visible fallback transcript.',
          providerMessageId: 'linq-fallback-text',
        },
        {
          message: null,
          providerMessageId: 'linq-fallback-link',
        },
      ],
      providerMessageId: 'linq-fallback-link',
      providerMessageIds: [
        'linq-fallback-text',
        'linq-fallback-link',
      ],
    })
  })

  it('keeps the existing Linq partial-delivery failure when fallback text also fails', async () => {
    const sendLinq = vi.fn()
      .mockResolvedValueOnce({
        providerMessageId: 'linq-text-message',
        providerThreadId: 'thread-linq-voice',
        target: 'thread-linq-voice',
        targetKind: 'thread',
      })
      .mockRejectedValueOnce(new Error('fallback text failed'))
    const sendLinqVoiceMemo = vi.fn().mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq voice memo delivery failed.',
        { retryable: true },
      ),
    )

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: 'idem-failed-fallback',
          identityId: null,
          media: [
            createVoiceMemoMedia({
              transcript: 'Have you had any recent blood tests?',
            }),
          ],
          message: 'Text before memo',
          replyToMessageId: null,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
      deliveryMayHaveSucceeded: true,
      providerMessageId: 'linq-text-message',
      providerMessageIds: ['linq-text-message'],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(sendLinq).toHaveBeenNthCalledWith(2, expect.objectContaining({
      idempotencyKey: 'linq-voice-memo-transcript:idem-failed-fallback',
      message: 'Have you had any recent blood tests?',
    }))
  })

  it('keeps Linq text-plus-voice memo rate limits retryable after accepted text', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-text-message',
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    const sendLinqVoiceMemo = vi.fn().mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq request POST /chats/thread-linq-voice/voicememo failed with HTTP 429.',
        {
          failureStage: 'http',
          operation: 'send_voice_memo',
          retryable: true,
          status: 429,
        },
      ),
    )

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: 'idem-rate-limited-voice',
          identityId: null,
          media: [createVoiceMemoMedia()],
          message: 'Text before memo',
          replyToMessageId: null,
        },
        {
          sendLinq,
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'LINQ_API_REQUEST_FAILED',
      context: {
        operation: 'send_voice_memo',
        retryable: true,
        status: 429,
      },
    })
  })

  it('marks Linq media-only voice memo transport failures as ambiguous delivery', async () => {
    const sendLinqVoiceMemo = vi.fn().mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq request POST /chats/[chat]/voicememo failed before a response was returned.',
        {
          failureStage: 'transport',
          method: 'POST',
          operation: 'send_voice_memo',
          provider: 'linq',
        },
      ),
    )

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: 'idem-voice-only',
          identityId: null,
          media: [createVoiceMemoMedia()],
          message: '',
          replyToMessageId: null,
        },
        {
          sendLinqVoiceMemo,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
      deliveryMayHaveSucceeded: true,
      providerMessageId: null,
      providerMessageIds: [],
      providerThreadId: null,
      target: 'thread-linq-voice',
      targetKind: 'thread',
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

function createVoiceMemoMedia(
  overrides: Partial<VoiceMemoMedia> = {},
): VoiceMemoMedia {
  return {
    ...createVoiceMemoMediaBase(),
    ...overrides,
  }
}

function createVoiceMemoMediaBase(): VoiceMemoMedia {
  return {
    kind: 'voice_memo' as const,
    filename: 'memo.mp3',
    transcript: null,
    transport: {
      attachmentId: 'attachment_voice_1',
      kind: 'linq_attachment' as const,
    },
  }
}
