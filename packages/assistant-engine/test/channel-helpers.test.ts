import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'

import type { ConversationRef } from '../src/assistant/conversation-ref.ts'
import { ASSISTANT_CHANNEL_ADAPTERS } from '../src/assistant/channels/descriptors.ts'
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
import type { AssistantChannelActivityHandle } from '../src/assistant/channels/types.ts'

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
        channel: 'whatsapp',
        conversation: createConversation({
          channel: 'whatsapp',
          participantId: 'wa-participant-1',
          threadId: 'wa-thread-1',
        }),
      }),
    ).toEqual({
      kind: 'thread',
      target: 'wa-thread-1',
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
      isReadyForSetup() {
        return true
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
      candidate: {
        kind: 'participant',
        target: 'participant-7',
      },
      deliverySource: null,
      dependencies: {},
      idempotencyKey: 'idem-7',
      identityId: 'identity-7',
      media: [],
      message: 'hello there',
      replyToMessageId: 'reply-7',
      subject: null,
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

  it('registers WhatsApp as a direct-chat outbound adapter', async () => {
    const sendWhatsApp = vi.fn().mockResolvedValue({
      providerMessageId: 'wamid.MESSAGE_1',
      providerThreadId: '15550100001',
      target: '15550100001',
      targetKind: 'thread',
    })

    expect(ASSISTANT_CHANNEL_ADAPTERS.whatsapp.canAutoReply({
      source: null,
      threadIsDirect: true,
    })).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.whatsapp.canAutoReply({
      source: null,
      threadIsDirect: false,
    })).toBe('WhatsApp auto-reply only runs for direct chats')
    expect(ASSISTANT_CHANNEL_ADAPTERS.whatsapp.isReadyForSetup({
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-number-id',
    })).toBe(true)

    const delivery = await ASSISTANT_CHANNEL_ADAPTERS.whatsapp.send(
      {
        actorId: null,
        bindingDelivery: createAssistantBindingDelivery('thread', '15550100001'),
        explicitTarget: null,
        identityId: null,
        message: 'hello over WhatsApp',
        replyToMessageId: 'wamid.REPLY_1',
      },
      {
        sendWhatsApp,
      },
    )

    expect(sendWhatsApp).toHaveBeenCalledWith({
      message: 'hello over WhatsApp',
      replyToMessageId: 'wamid.REPLY_1',
      signal: undefined,
      target: '15550100001',
    })
    expect(delivery).toMatchObject({
      channel: 'whatsapp',
      messageLength: 19,
      providerMessageId: 'wamid.MESSAGE_1',
      providerThreadId: '15550100001',
      target: '15550100001',
      targetKind: 'thread',
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
      isReadyForSetup() {
        return true
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
      providerMessageId: '  linq-message  ',
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
      },
      {
        sendLinq,
      },
    )
    expect(sendLinq).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
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
      providerMessageId: 'linq-message',
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
      code: 'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
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

  it('prepares Telegram voice memo audio before sending accompanying text', async () => {
    const sendTelegram = vi.fn(async () => {
      throw new Error('Telegram text should not be sent before audio is prepared.')
    })
    const telegramFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input)
      if (url.startsWith('https://api.elevenlabs.io/')) {
        return new Response('tts unavailable', { status: 503 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'telegram-chat'),
          explicitTarget: null,
          idempotencyKey: 'telegram-voice-tts-failure',
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
      ),
    ).rejects.toMatchObject({
      code: 'ELEVENLABS_API_REQUEST_FAILED',
    })
    expect(sendTelegram).not.toHaveBeenCalled()
    expect(telegramFetch).toHaveBeenCalledTimes(1)
    expect(String(telegramFetch.mock.calls[0]?.[0])).toContain(
      'https://api.elevenlabs.io/',
    )
  })

  it('sends Linq voice memo media through the dedicated endpoint after optional text', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-text-message',
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
        transcript: null,
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
      idempotencyKey: 'idem-text-first',
      message: 'Listen to this',
      replyToMessageId: 'reply-text',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(sendLinqVoiceMemo).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      attachmentId: 'attachment_voice_1',
      replyToMessageId: 'reply-text',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
    expect(delivery).toMatchObject({
      providerMessageId: 'linq-voice-message',
      providerMessageIds: ['linq-text-message', 'linq-voice-message'],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
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

  it('marks Linq text-plus-voice memo failures as partial delivery after accepted text', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'linq-text-message',
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

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: createAssistantBindingDelivery('thread', 'thread-linq-voice'),
          explicitTarget: null,
          idempotencyKey: 'idem-partial-voice',
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
      code: 'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
      deliveryMayHaveSucceeded: true,
      providerMessageId: 'linq-text-message',
      providerMessageIds: ['linq-text-message'],
      providerThreadId: 'thread-linq-voice',
      target: 'thread-linq-voice',
      targetKind: 'thread',
    })
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
