import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentmailApiClient,
  AgentmailFetch,
} from '@murphai/operator-config/agentmail-runtime'
import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const runtimeMocks = vi.hoisted(() => ({
  createAgentmailApiClient: vi.fn(),
  createLinqChat: vi.fn(),
  probeLinqApi: vi.fn(),
  sendLinqChatMessage: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
  uploadLinqAttachment: vi.fn(),
}))

const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64])

vi.mock('@murphai/operator-config/agentmail-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@murphai/operator-config/agentmail-runtime')>()
  return {
    ...actual,
    createAgentmailApiClient: runtimeMocks.createAgentmailApiClient,
  }
})

vi.mock('@murphai/operator-config/linq-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@murphai/operator-config/linq-runtime')>()
  return {
    ...actual,
    createLinqChat: runtimeMocks.createLinqChat,
    probeLinqApi: runtimeMocks.probeLinqApi,
    sendLinqChatMessage: runtimeMocks.sendLinqChatMessage,
    startLinqChatTypingIndicator: runtimeMocks.startLinqChatTypingIndicator,
    stopLinqChatTypingIndicator: runtimeMocks.stopLinqChatTypingIndicator,
    uploadLinqAttachment: runtimeMocks.uploadLinqAttachment,
  }
})

import { isAssistantUserFacingChannel } from '../src/assistant/channel-presentation.ts'
import { createAssistantBindingDelivery } from '../src/assistant/channels/helpers.ts'
import { ASSISTANT_CHANNEL_ADAPTERS } from '../src/assistant/channels/descriptors.ts'
import {
  getAssistantChannelAdapter,
  inferAssistantBindingDelivery,
  listAssistantChannelAdapters,
  listAssistantChannelNames,
} from '../src/assistant/channels/registry.ts'
import {
  sendEmailMessage,
  sendLinqMessage,
  sendTelegramImageMessage,
  sendTelegramMessage,
  sendTelegramVoiceMemoMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from '../src/assistant/channels/runtime.ts'

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  runtimeMocks.createAgentmailApiClient.mockReset()
  runtimeMocks.createLinqChat.mockReset()
  runtimeMocks.probeLinqApi.mockReset()
  runtimeMocks.sendLinqChatMessage.mockReset()
  runtimeMocks.startLinqChatTypingIndicator.mockReset()
  runtimeMocks.stopLinqChatTypingIndicator.mockReset()
  runtimeMocks.uploadLinqAttachment.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('assistant channels runtime seam', () => {
  it('lists adapters, resolves fallback bindings, and classifies user-facing channels', () => {
    expect(listAssistantChannelNames()).toEqual([
      'telegram',
      'linq',
      'email',
      'whatsapp',
    ])
    expect(listAssistantChannelAdapters().map((adapter) => adapter.channel)).toEqual(
      listAssistantChannelNames(),
    )
    expect(getAssistantChannelAdapter(undefined)).toBeNull()
    expect(getAssistantChannelAdapter('unknown')).toBeNull()
    expect(getAssistantChannelAdapter('constructor')).toBeNull()
    expect(getAssistantChannelAdapter('__proto__')).toBeNull()
    expect(getAssistantChannelAdapter('email')).toBe(ASSISTANT_CHANNEL_ADAPTERS.email)

    expect(
      inferAssistantBindingDelivery({
        channel: 'unknown',
        conversation: {
          directness: 'group',
          participantId: 'participant-1',
          threadId: 'thread-1',
        },
      }),
    ).toEqual({
      kind: 'thread',
      target: 'thread-1',
    })

    expect(isAssistantUserFacingChannel(' telegram ')).toBe(true)
    expect(isAssistantUserFacingChannel('LOCAL')).toBe(false)
    expect(isAssistantUserFacingChannel('null')).toBe(false)
    expect(isAssistantUserFacingChannel(null)).toBe(false)
  })

  it('reports channel readiness and auto-reply support from descriptors', () => {
    expect(
      ASSISTANT_CHANNEL_ADAPTERS.telegram.isReadyForSetup({
        TELEGRAM_BOT_TOKEN: 'bot-token',
      }),
    ).toBe(true)
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.isReadyForSetup({})).toBe(false)
    expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.isReadyForSetup({
        LINQ_API_TOKEN: 'linq-token',
        LINQ_WEBHOOK_SECRET: 'linq-secret',
      }),
    ).toBe(true)
    expect(
      ASSISTANT_CHANNEL_ADAPTERS.email.isReadyForSetup({
        AGENTMAIL_API_KEY: 'agentmail-key',
      }),
    ).toBe(true)
    expect(ASSISTANT_CHANNEL_ADAPTERS.email.isReadyForSetup({})).toBe(false)

    const directCapture = createInboxCapture(true)
    const groupCapture = createInboxCapture(false)
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply(directCapture)).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply(groupCapture)).toContain(
      'direct chats',
    )
    expect(ASSISTANT_CHANNEL_ADAPTERS.linq.supportsIdempotencyKey).toBe(true)
    expect(ASSISTANT_CHANNEL_ADAPTERS.linq.canAutoReply(groupCapture)).toBe(
      'iMessage auto-reply only runs for direct chats',
    )
    expect(ASSISTANT_CHANNEL_ADAPTERS.linq.canAutoReply({
      ...groupCapture,
      externalThreadRouteAuthorityPresent: true,
    })).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.email.canAutoReply(groupCapture)).toContain(
      'direct threads',
    )
  })

  it('sends Telegram chunks across migrate and retry branches', async () => {
    vi.useFakeTimers()
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
      createTelegramResponse(429, {
        description: 'retry later',
        error_code: 429,
        parameters: {
          retry_after: 0.001,
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 1001,
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: '1002',
        },
      }),
    ])

    const deliveryPromise = sendTelegramMessage(
      {
        message: `${'a'.repeat(4096)}b`,
        replyToMessageId: ' 42 ',
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    await vi.runAllTimersAsync()
    await expect(deliveryPromise).resolves.toEqual({
      cleanupMessages: [
        { messageId: '1001', target: '456' },
        { messageId: '1002', target: '456' },
      ],
      cleanupTargetAliases: ['123'],
      providerMessageId: '1002',
      providerMessageIds: ['1001', '1002'],
      target: '456',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(4)
    expect(readJsonBody(fetchImplementation.mock.calls[0][1]?.body)).toMatchObject({
      chat_id: '123',
      reply_to_message_id: 42,
      text: 'a'.repeat(4096),
    })
    expect(readJsonBody(fetchImplementation.mock.calls[0][1]?.body)).not.toHaveProperty(
      'entities',
    )
    expect(readJsonBody(fetchImplementation.mock.calls[1][1]?.body)).toMatchObject({
      chat_id: '456',
      reply_to_message_id: 42,
      text: 'a'.repeat(4096),
    })
    expect(readJsonBody(fetchImplementation.mock.calls[1][1]?.body)).not.toHaveProperty(
      'entities',
    )
    expect(readJsonBody(fetchImplementation.mock.calls[3][1]?.body)).toMatchObject({
      chat_id: '456',
      text: 'b',
    })
    expect(readJsonBody(fetchImplementation.mock.calls[3][1]?.body)).not.toHaveProperty(
      'entities',
    )
    expect(readJsonBody(fetchImplementation.mock.calls[3][1]?.body)).not.toHaveProperty(
      'reply_to_message_id',
    )
  })

  it('converts markdown emphasis to Telegram message entities', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 123,
        },
      }),
    ])

    await sendTelegramMessage(
      {
        message: 'This is **bold** and _short aside_. ~~gone~~',
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toMatchObject({
      chat_id: '123',
      entities: [
        { offset: 8, length: 4, type: 'bold' },
        { offset: 17, length: 11, type: 'italic' },
        { offset: 30, length: 4, type: 'strikethrough' },
      ],
      text: 'This is bold and short aside. gone',
    })
  })

  it('preserves exact underscore-delimited Telegram text without entities', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 123,
        },
      }),
    ])
    const message = 'Open https://example.test/download?filename=_report_.pdf and keep token _ABC_ plus 变量_名称_值.'

    await sendTelegramMessage(
      {
        message,
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toEqual({
      chat_id: '123',
      text: message,
    })
  })

  it('splits decorated Telegram chunks with marker-free text and UTF-16 entity ranges', async () => {
    const smile = '\u{1F600}'
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 123,
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 124,
        },
      }),
    ])

    await sendTelegramMessage(
      {
        message: `${'a'.repeat(4094)} **b${smile}c** d`,
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toEqual({
      chat_id: '123',
      entities: [
        { offset: 4095, length: 1, type: 'bold' },
      ],
      text: `${'a'.repeat(4094)} b`,
    })
    expect(readJsonBody(fetchImplementation.mock.calls[1]?.[1]?.body)).toEqual({
      chat_id: '123',
      entities: [
        { offset: 0, length: 3, type: 'bold' },
      ],
      text: `${smile}c d`,
    })
  })

  it('preserves sent Telegram chunk ids when a later chunk fails and rollback cannot be confirmed', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 1001,
        },
      }),
      createTelegramResponse(400, {
        description: 'later chunk failed',
        error_code: 400,
      }),
      createTelegramResponse(502, {
        description: 'rollback failed',
        error_code: 502,
      }),
    ])

    await expect(
      sendTelegramMessage(
        {
          message: `${'a'.repeat(4096)}b`,
          target: '123',
        },
        {
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      cleanupMessages: [{ messageId: '1001', target: '123' }],
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      providerMessageId: '1001',
      providerMessageIds: ['1001'],
      target: '123',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(fetchImplementation.mock.calls[2]?.[0]).toContain('/deleteMessages')
    expect(readJsonBody(fetchImplementation.mock.calls[2]?.[1]?.body)).toMatchObject({
      chat_id: '123',
      message_ids: [1001],
    })
  })

  it('does not retry ambiguous Telegram transport failures', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('socket closed after request')
    })

    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          target: '123',
        },
        {
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      providerMessageId: null,
      providerMessageIds: [],
      target: '123',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('rolls back Telegram partial sends against the migrated target when a later chunk fails', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 1001,
        },
      }),
      createTelegramResponse(400, {
        description: 'later chunk failed',
        error_code: 400,
      }),
      createTelegramResponse(502, {
        description: 'rollback failed',
        error_code: 502,
      }),
    ])

    await expect(
      sendTelegramMessage(
        {
          message: `${'a'.repeat(4096)}b`,
          target: '123',
        },
        {
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      cleanupMessages: [{ messageId: '1001', target: '456' }],
      cleanupTargetAliases: ['123'],
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      providerMessageId: '1001',
      providerMessageIds: ['1001'],
      target: '456',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(4)
    expect(readJsonBody(fetchImplementation.mock.calls[1]?.[1]?.body)).toMatchObject({
      chat_id: '456',
      text: 'a'.repeat(4096),
    })
    expect(readJsonBody(fetchImplementation.mock.calls[2]?.[1]?.body)).toMatchObject({
      chat_id: '456',
      text: 'b',
    })
    expect(fetchImplementation.mock.calls[3]?.[0]).toContain('/deleteMessages')
    expect(readJsonBody(fetchImplementation.mock.calls[3]?.[1]?.body)).toMatchObject({
      chat_id: '456',
      message_ids: [1001],
    })
  })

  it('preserves per-target cleanup message ids when a later chunk migrates the chat', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 1001,
        },
      }),
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: '1002',
        },
      }),
    ])

    await expect(
      sendTelegramMessage(
        {
          message: `${'a'.repeat(4096)}b`,
          target: '123',
        },
        {
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).resolves.toEqual({
      cleanupMessages: [
        { messageId: '1001', target: '123' },
        { messageId: '1002', target: '456' },
      ],
      cleanupTargetAliases: ['123'],
      providerMessageId: '1002',
      providerMessageIds: ['1001', '1002'],
      target: '456',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(readJsonBody(fetchImplementation.mock.calls[0][1]?.body)).toMatchObject({
      chat_id: '123',
      text: 'a'.repeat(4096),
    })
    expect(readJsonBody(fetchImplementation.mock.calls[1][1]?.body)).toMatchObject({
      chat_id: '123',
      text: 'b',
    })
    expect(readJsonBody(fetchImplementation.mock.calls[2][1]?.body)).toMatchObject({
      chat_id: '456',
      text: 'b',
    })
  })

  it('sends Telegram image response media through sendPhoto with a caption', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 3001,
        },
      }),
    ])

    await expect(
      sendTelegramImageMessage(
        {
          media: [
            {
              alt: 'Example image',
              kind: 'image',
              source: 'test',
              url: 'https://cdn.example.test/example.png',
            },
          ],
          message: 'Here is an **example** image.',
          replyToMessageId: ' 42 ',
          target: '123:topic:9',
        },
        {
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).resolves.toEqual({
      cleanupMessages: [
        { messageId: '3001', target: '123:topic:9' },
      ],
      providerMessageId: '3001',
      target: '123:topic:9',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendPhoto',
    )
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toMatchObject({
      caption: 'Here is an example image.',
      caption_entities: [
        {
          length: 7,
          offset: 11,
          type: 'bold',
        },
      ],
      chat_id: '123',
      message_thread_id: 9,
      photo: 'https://cdn.example.test/example.png',
      reply_to_message_id: 42,
    })
  })

  it('generates and sends Telegram voice memos with multipart sendVoice', async () => {
    const fetchImplementation = createQueuedFetch([
      createAudioResponse(mp3Bytes),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 2001,
        },
      }),
    ])

    await expect(
      sendTelegramVoiceMemoMessage(
        {
          filename: 'memo',
          generation: {
            kind: 'elevenlabs_speech',
            modelId: 'eleven_multilingual_v2',
            outputFormat: 'mp3_44100_128',
            text: 'Short memo.',
            voiceId: 'voice_murph',
          },
          replyToMessageId: ' 42 ',
          target: '123:topic:9',
        },
        {
          env: {
            ELEVENLABS_API_KEY: 'elevenlabs-key',
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).resolves.toEqual({
      providerMessageId: '2001',
      target: '123:topic:9',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice_murph?output_format=mp3_44100_128',
    )
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toMatchObject({
      model_id: 'eleven_multilingual_v2',
      text: 'Short memo.',
    })
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
    const form = fetchImplementation.mock.calls[1]?.[1]?.body
    expect(form).toBeInstanceOf(FormData)
    const entries = Object.fromEntries((form as FormData).entries())
    expect(entries).toMatchObject({
      chat_id: '123',
      message_thread_id: '9',
      reply_to_message_id: '42',
    })
    expect(entries.voice).toBeInstanceOf(File)
    expect((entries.voice as File).name).toBe('memo.mp3')
    expect((entries.voice as File).type).toBe('audio/mpeg')
    expect(new Uint8Array(await (entries.voice as File).arrayBuffer())).toEqual(mp3Bytes)
  })

  it('retries Telegram voice memo sends on explicit provider retry outcomes', async () => {
    vi.useFakeTimers()
    const fetchImplementation = createQueuedFetch([
      createAudioResponse(mp3Bytes),
      createTelegramResponse(429, {
        description: 'retry later',
        error_code: 429,
        parameters: {
          retry_after: 0.001,
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 2002,
        },
      }),
    ])

    const deliveryPromise = sendTelegramVoiceMemoMessage(
      {
        filename: 'memo',
        generation: {
          kind: 'elevenlabs_speech',
          modelId: 'eleven_multilingual_v2',
          outputFormat: 'mp3_44100_128',
          text: 'Short memo.',
          voiceId: 'voice_murph',
        },
        replyToMessageId: null,
        target: '123',
      },
      {
        env: {
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    await vi.runAllTimersAsync()
    await expect(deliveryPromise).resolves.toEqual({
      providerMessageId: '2002',
      target: '123',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
    expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
  })

  it('does not retry ambiguous Telegram voice memo transport failures', async () => {
    const fetchImplementation = createQueuedFetch([
      createAudioResponse(mp3Bytes),
      new Error('socket closed after sendVoice request'),
    ])

    await expect(
      sendTelegramVoiceMemoMessage(
        {
          filename: 'memo',
          generation: {
            kind: 'elevenlabs_speech',
            modelId: 'eleven_multilingual_v2',
            outputFormat: 'mp3_44100_128',
            text: 'Short memo.',
            voiceId: 'voice_murph',
          },
          replyToMessageId: null,
          target: '123',
        },
        {
          env: {
            ELEVENLABS_API_KEY: 'elevenlabs-key',
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_VOICE_MEMO_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      providerMessageId: null,
      providerMessageIds: [],
      target: '123',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
  })

  it('retries Telegram voice memo 5xx responses with the prepared audio', async () => {
    vi.useFakeTimers()
    const fetchImplementation = createQueuedFetch([
      createAudioResponse(mp3Bytes),
      createTelegramResponse(502, {
        description: 'bad gateway',
        error_code: 502,
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 2003,
        },
      }),
    ])

    const deliveryPromise = sendTelegramVoiceMemoMessage(
      {
        filename: 'memo',
        generation: {
          kind: 'elevenlabs_speech',
          modelId: 'eleven_multilingual_v2',
          outputFormat: 'mp3_44100_128',
          text: 'Short memo.',
          voiceId: 'voice_murph',
        },
        replyToMessageId: null,
        target: '123',
      },
      {
        env: {
          ELEVENLABS_API_KEY: 'elevenlabs-key',
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    await vi.runAllTimersAsync()
    await expect(deliveryPromise).resolves.toEqual({
      providerMessageId: '2003',
      target: '123',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice_murph?output_format=mp3_44100_128',
    )
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
    expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendVoice',
    )
  })

  it('rejects Telegram sends without runtime support or with invalid targets', async () => {
    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          target: '123',
        },
        {
          env: {},
          fetchImplementation: createQueuedFetch([]),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
    })

    vi.stubGlobal('fetch', undefined)
    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          target: '123',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_UNAVAILABLE',
    })

    await expect(
      sendTelegramMessage(
        {
          message: 'hello',
          target: '  ',
        },
        {
          env: {
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation: createQueuedFetch([]),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_TARGET_INVALID',
    })
  })

  it('keeps the Telegram typing indicator alive and surfaces background failures on stop', async () => {
    vi.useFakeTimers()
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'migrated',
        error_code: 400,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
      createTelegramResponse(200, {
        ok: true,
      }),
      new Error('typing request failed'),
    ])

    const handle = await startTelegramTypingIndicator(
      {
        target: '123',
      },
      {
        env: {
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    await vi.advanceTimersByTimeAsync(4000)
    await vi.advanceTimersByTimeAsync(4000)

    await expect(handle.stop()).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_ACTIVITY_FAILED',
      message: 'Telegram typing indicator failed while calling the Bot API.',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(3)
    expect(readJsonBody(fetchImplementation.mock.calls[0][1]?.body)).toMatchObject({
      action: 'typing',
      chat_id: '123',
    })
    expect(readJsonBody(fetchImplementation.mock.calls[1][1]?.body)).toMatchObject({
      action: 'typing',
      chat_id: '456',
    })
  })

  it('sends Linq messages and only stops the typing indicator once', async () => {
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: {
        id: '  linq-message-id  ',
      },
    })
    runtimeMocks.createLinqChat.mockResolvedValue({
      chatId: '  linq-chat-id  ',
      messageId: '  linq-created-message-id  ',
    })
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    await expect(
      sendLinqMessage(
        {
          message: 'hello',
          target: 'chat-1',
        },
        {
          env: {},
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      message: 'Outbound iMessage delivery requires LINQ_API_TOKEN.',
    })

    await expect(
      startLinqTypingIndicator(
        {
          target: 'chat-1',
        },
        {
          env: {},
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      message: 'Outbound iMessage delivery requires LINQ_API_TOKEN.',
    })

    await expect(
      startLinqTypingIndicator(
        {
          target: '   ',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      message: 'iMessage delivery requires an explicit chat id or a stored thread binding.',
    })

    await expect(
      sendLinqMessage(
        {
          idempotencyKey: 'idem-1',
          message: 'hello',
          replyToMessageId: 'reply-1',
          target: 'chat-1',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
        },
      ),
    ).resolves.toEqual({
      providerMessageId: 'linq-message-id',
      providerThreadId: null,
      target: 'chat-1',
    })

    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith(
      {
        chatId: 'chat-1',
        idempotencyKey: 'idem-1',
        message: 'hello',
        replyToMessageId: 'reply-1',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
      },
    )
    await expect(
      sendLinqMessage(
        {
          fromPhoneNumber: '+15550000',
          idempotencyKey: 'idem-created',
          message: 'welcome',
          target: '+15550001',
          targetKind: 'participant',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
        },
      ),
    ).resolves.toEqual({
      providerMessageId: 'linq-created-message-id',
      providerThreadId: 'linq-chat-id',
      target: 'linq-chat-id',
    })
    expect(runtimeMocks.createLinqChat).toHaveBeenCalledWith(
      {
        from: '+15550000',
        idempotencyKey: 'idem-created',
        message: 'welcome',
        to: ['+15550001'],
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
      },
    )
    await expect(
      sendLinqMessage(
        {
          message: 'welcome',
          target: '+15550001',
          targetKind: 'participant',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_LINQ_FROM_PHONE_REQUIRED',
      message: 'Materializing an iMessage direct chat requires a sender phone number.',
    })

    const handle = await startLinqTypingIndicator(
      {
        target: '  chat-typing  ',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
      },
    )

    await handle.stop()
    await handle.stop()

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
        signal: expect.any(AbortSignal),
      },
    )
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
      },
    )
  })

  it('uploads trusted vault-file bytes and sends the resulting Linq attachment id', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const loadVaultFile = vi.fn().mockResolvedValue(bytes)
    const providerFetch = vi.fn()
    const publicFetch = vi.fn()
    runtimeMocks.uploadLinqAttachment.mockResolvedValue({
      attachmentId: 'attachment_123',
    })
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'message_123' },
    })

    await expect(sendLinqMessage({
      idempotencyKey: 'delivery_123',
      media: [{
        approvalGeneration: null,
        approvalId: null,
        contentType: 'application/pdf',
        filename: 'report.pdf',
        kind: 'vault_file',
        ref: 'documents/report.pdf',
        sha256: 'a'.repeat(64),
        sizeBytes: bytes.byteLength,
      }],
      message: 'Attached: report.pdf',
      target: 'chat_123',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: providerFetch,
      loadVaultFile,
      publicFetchImplementation: publicFetch,
    })).resolves.toMatchObject({
      providerMessageId: 'message_123',
      target: 'chat_123',
    })

    expect(loadVaultFile).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.uploadLinqAttachment).toHaveBeenCalledWith({
      bytes,
      contentType: 'application/pdf',
      filename: 'report.pdf',
    }, expect.objectContaining({
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: providerFetch,
      publicFetchImplementation: publicFetch,
    }))
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith({
      chatId: 'chat_123',
      idempotencyKey: 'delivery_123',
      media: [{ attachmentId: 'attachment_123' }],
      message: 'Attached: report.pdf',
      replyToMessageId: null,
    }, expect.any(Object))
    expect(loadVaultFile.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeMocks.uploadLinqAttachment.mock.invocationCallOrder[0]!,
    )
  })

  it('fails Linq delivery atomically when a later vault-file upload fails', async () => {
    const firstBytes = new Uint8Array([1, 2, 3, 4])
    const secondBytes = new Uint8Array([5, 6, 7, 8])
    const loadVaultFile = vi.fn()
      .mockResolvedValueOnce(firstBytes)
      .mockResolvedValueOnce(secondBytes)
    runtimeMocks.uploadLinqAttachment
      .mockResolvedValueOnce({ attachmentId: 'attachment_first' })
      .mockRejectedValueOnce(new Error('presigned upload failed'))

    await expect(sendLinqMessage({
      idempotencyKey: 'delivery_two_files',
      media: [
        {
          approvalGeneration: null,
          approvalId: null,
          contentType: 'application/pdf',
          filename: 'first.pdf',
          kind: 'vault_file',
          ref: 'documents/first.pdf',
          sha256: 'a'.repeat(64),
          sizeBytes: firstBytes.byteLength,
        },
        {
          approvalGeneration: null,
          approvalId: null,
          contentType: 'application/pdf',
          filename: 'second.pdf',
          kind: 'vault_file',
          ref: 'documents/second.pdf',
          sha256: 'b'.repeat(64),
          sizeBytes: secondBytes.byteLength,
        },
      ],
      message: 'Attached files',
      target: 'chat_123',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      loadVaultFile,
    })).rejects.toThrow('presigned upload failed')

    expect(loadVaultFile).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.uploadLinqAttachment).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.sendLinqChatMessage).not.toHaveBeenCalled()
  })

  it('passes the dependency abort signal to Linq typing and removes the listener after stop', async () => {
    const dependencyController = new AbortController()
    const addEventListenerSpy = vi.spyOn(dependencyController.signal, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(dependencyController.signal, 'removeEventListener')

    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        signal: dependencyController.signal,
      },
    )

    await handle.stop()

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledWith(
      {
        chatId: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
        signal: expect.any(AbortSignal),
      },
    )
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1)
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('passes the dependency abort signal to Linq send and direct chat creation', async () => {
    const dependencyController = new AbortController()
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: {
        id: 'linq-message-id',
      },
    })
    runtimeMocks.createLinqChat.mockResolvedValue({
      chatId: 'linq-chat-id',
      messageId: 'linq-created-message-id',
    })

    await expect(
      sendLinqMessage(
        {
          message: 'hello',
          target: 'chat-1',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
          signal: dependencyController.signal,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'linq-message-id',
      target: 'chat-1',
    })
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith(
      {
        chatId: 'chat-1',
        idempotencyKey: null,
        message: 'hello',
        replyToMessageId: null,
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
        signal: dependencyController.signal,
      },
    )

    await expect(
      sendLinqMessage(
        {
          fromPhoneNumber: '+15550000',
          message: 'welcome',
          target: '+15550001',
          targetKind: 'participant',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
          signal: dependencyController.signal,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'linq-created-message-id',
      providerThreadId: 'linq-chat-id',
      target: 'linq-chat-id',
    })
    expect(runtimeMocks.createLinqChat).toHaveBeenCalledWith(
      {
        from: '+15550000',
        idempotencyKey: null,
        message: 'welcome',
        to: ['+15550001'],
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        fetchImplementation: undefined,
        signal: dependencyController.signal,
      },
    )
  })

  it('refreshes the Linq typing indicator until stop', async () => {
    vi.useFakeTimers()
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        refreshMs: 5,
      },
    )

    await vi.advanceTimersByTimeAsync(16)
    await handle.stop()

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(4)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('can release a Linq typing session locally without provider stop', async () => {
    vi.useFakeTimers()
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
        refreshMs: 5,
      },
    )

    await vi.advanceTimersByTimeAsync(6)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    await handle.stop({
      providerStop: false,
    })
    await vi.advanceTimersByTimeAsync(20)

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.stopLinqChatTypingIndicator).not.toHaveBeenCalled()
  })

  it('refreshes the Linq typing indicator at the low-volume default cadence', async () => {
    vi.useFakeTimers()
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
      },
    )

    await vi.advanceTimersByTimeAsync(44_999)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(45_000)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(3)

    await handle.stop()
    await vi.advanceTimersByTimeAsync(45_000)

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(3)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('restarts the Linq typing refresh timer after an explicit activity refresh', async () => {
    vi.useFakeTimers()
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
      },
    )

    await vi.advanceTimersByTimeAsync(40_000)
    await handle.refreshNow?.()
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(44_999)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(3)
    await handle.stop()
  })

  it('serializes explicit Linq typing refreshes after an in-flight refresh', async () => {
    vi.useFakeTimers()
    let resolveInFlightRefresh: () => void = () => {
      throw new Error('in-flight refresh was not started')
    }
    runtimeMocks.startLinqChatTypingIndicator
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          resolveInFlightRefresh = resolve
        })
      })
      .mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
      },
    )

    vi.advanceTimersByTime(45_000)
    await Promise.resolve()
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    const explicitRefresh = handle.refreshNow?.()
    const secondExplicitRefresh = handle.refreshNow?.()
    await Promise.resolve()
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    resolveInFlightRefresh()
    await explicitRefresh
    await secondExplicitRefresh

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(4)
    await handle.stop()
  })

  it('stops the Linq typing indicator after the max session cap', async () => {
    vi.useFakeTimers()
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator.mockResolvedValue(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
      },
    )

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1)
    expect(runtimeMocks.stopLinqChatTypingIndicator).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)

    await handle.stop()
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('retries Linq typing stop on explicit cleanup after a failed max session stop', async () => {
    vi.useFakeTimers()
    runtimeMocks.startLinqChatTypingIndicator.mockResolvedValue(undefined)
    runtimeMocks.stopLinqChatTypingIndicator
      .mockRejectedValueOnce(new Error('temporary Linq stop failure'))
      .mockResolvedValueOnce(undefined)

    const handle = await startLinqTypingIndicator(
      {
        target: 'chat-typing',
      },
      {
        env: {
          LINQ_API_TOKEN: 'linq-token',
        },
      },
    )

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)

    await handle.stop()
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(2)
  })

  it('recovers Linq thread sends when the stored chat id is stale', async () => {
    vi.stubEnv('LINQ_API_TOKEN', 'linq-token')
    const missingChatError = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq request POST /chats/[chat]/messages failed with HTTP 404.',
      {
        failureStage: 'http',
        linqFailureKind: 'chat_not_found',
        method: 'POST',
        operation: 'send_message',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 404,
      },
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    runtimeMocks.createLinqChat
      .mockRejectedValueOnce(
        new VaultCliError(
          'LINQ_API_REQUEST_FAILED',
          'Forbidden',
          {
            failureStage: 'http',
            operation: 'create_chat',
            path: '/chats',
            provider: 'linq',
            retryable: false,
            status: 403,
          },
        ),
      )
      .mockResolvedValueOnce({
        chatId: '  recovered-chat  ',
        messageId: '  recovered-message  ',
      })
    runtimeMocks.probeLinqApi.mockResolvedValue({
      ok: true,
      phoneNumbers: ['+15550000', '+15550002'],
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: ' +15550001 ',
          bindingDelivery: createAssistantBindingDelivery('thread', ' stale-chat '),
          explicitTarget: null,
          idempotencyKey: ' idem-stale-thread ',
          identityId: null,
          message: 'hello again',
          replyToMessageId: ' reply-9 ',
        },
        {},
      ),
    ).resolves.toMatchObject({
      channel: 'linq',
      idempotencyKey: 'idem-stale-thread',
      providerMessageId: 'recovered-message',
      providerThreadId: 'recovered-chat',
      target: 'recovered-chat',
      targetKind: 'thread',
    })

    expect(runtimeMocks.probeLinqApi).toHaveBeenCalledWith({
      env: process.env,
      fetchImplementation: undefined,
    })
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith(
      {
        chatId: 'stale-chat',
        idempotencyKey: 'idem-stale-thread',
        message: 'hello again',
        replyToMessageId: 'reply-9',
      },
      {
        env: process.env,
        fetchImplementation: undefined,
      },
    )
    expect(runtimeMocks.createLinqChat).toHaveBeenNthCalledWith(1, {
      from: '+15550000',
      idempotencyKey: 'idem-stale-thread',
      message: 'hello again',
      to: ['+15550001'],
    }, {
      env: process.env,
      fetchImplementation: undefined,
    })
    expect(runtimeMocks.createLinqChat).toHaveBeenNthCalledWith(2, {
      from: '+15550002',
      idempotencyKey: 'idem-stale-thread',
      message: 'hello again',
      to: ['+15550001'],
    }, {
      env: process.env,
      fetchImplementation: undefined,
    })
  })

  it('recovers stale Linq thread sends with the selected sender identity', async () => {
    vi.stubEnv('LINQ_API_TOKEN', 'linq-token')
    const missingChatError = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq request POST /chats/[chat]/messages failed with HTTP 404.',
      {
        failureStage: 'http',
        linqFailureKind: 'chat_not_found',
        method: 'POST',
        operation: 'send_message',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 404,
      },
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    runtimeMocks.createLinqChat.mockResolvedValueOnce({
      chatId: 'recovered-chat',
      messageId: 'recovered-message',
    })
    runtimeMocks.probeLinqApi.mockResolvedValue({
      ok: true,
      phoneNumbers: ['+15550000', '+15550002'],
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: '+15550001',
          bindingDelivery: createAssistantBindingDelivery('thread', 'stale-chat'),
          deliverySource: {
            kind: 'linq',
            fromPhoneNumber: '+15550002',
          },
          explicitTarget: null,
          idempotencyKey: 'idem-stale-thread',
          identityId: null,
          message: 'hello again',
          replyToMessageId: null,
        },
        {},
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'recovered-message',
      providerThreadId: 'recovered-chat',
      target: 'recovered-chat',
      targetKind: 'thread',
    })

    expect(runtimeMocks.probeLinqApi).not.toHaveBeenCalled()
    expect(runtimeMocks.createLinqChat).toHaveBeenCalledWith({
      from: '+15550002',
      idempotencyKey: 'idem-stale-thread',
      message: 'hello again',
      to: ['+15550001'],
    }, {
      env: process.env,
      fetchImplementation: undefined,
    })
  })

  it('does not try another Linq recovery sender after an ambiguous create-chat response', async () => {
    vi.stubEnv('LINQ_API_TOKEN', 'linq-token')
    const missingChatError = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq request POST /chats/[chat]/messages failed with HTTP 404.',
      {
        failureStage: 'http',
        linqFailureKind: 'chat_not_found',
        method: 'POST',
        operation: 'send_message',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 404,
      },
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    runtimeMocks.createLinqChat
      .mockRejectedValueOnce(
        new VaultCliError(
          'LINQ_API_REQUEST_FAILED',
          'Linq request POST /chats failed with HTTP 408.',
          {
            failureStage: 'http',
            method: 'POST',
            operation: 'create_chat',
            path: '/chats',
            provider: 'linq',
            retryable: false,
            status: 408,
          },
        ),
      )
      .mockResolvedValueOnce({
        chatId: 'should-not-send',
        messageId: 'should-not-send',
      })
    runtimeMocks.probeLinqApi.mockResolvedValue({
      ok: true,
      phoneNumbers: ['+15550000', '+15550002'],
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: '+15550001',
          bindingDelivery: createAssistantBindingDelivery('thread', 'stale-chat'),
          explicitTarget: null,
          idempotencyKey: null,
          identityId: null,
          message: 'hello again',
          replyToMessageId: null,
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
    })

    expect(runtimeMocks.createLinqChat).toHaveBeenCalledOnce()
  })

  it('passes direct recipient context to injected Linq sends', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'sent-message',
      providerThreadId: 'stale-chat',
      target: 'stale-chat',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: '+15550001',
          bindingDelivery: createAssistantBindingDelivery('thread', 'stale-chat'),
          explicitTarget: null,
          idempotencyKey: 'idem-stale-thread',
          identityId: null,
          message: 'hello again',
          replyToMessageId: null,
        },
        {
          sendLinq,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'sent-message',
      providerThreadId: 'stale-chat',
      target: 'stale-chat',
    })

    expect(runtimeMocks.probeLinqApi).not.toHaveBeenCalled()
    expect(sendLinq).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      directRecipientPhoneNumber: '+15550001',
      fromPhoneNumber: null,
      idempotencyKey: 'idem-stale-thread',
      message: 'hello again',
      replyToMessageId: null,
      target: 'stale-chat',
      targetKind: 'thread',
    })
  })

  it('does not recover unclassified Linq send 404 errors as stale chats', async () => {
    vi.stubEnv('LINQ_API_TOKEN', 'linq-token')
    const unclassifiedNotFoundError = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq request POST /chats/[chat]/messages failed with HTTP 404.',
      {
        failureStage: 'http',
        method: 'POST',
        operation: 'send_message',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 404,
      },
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(unclassifiedNotFoundError)

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: ' +15550001 ',
          bindingDelivery: createAssistantBindingDelivery('thread', ' stale-chat '),
          explicitTarget: null,
          idempotencyKey: ' idem-stale-thread ',
          identityId: null,
          message: 'hello again',
          replyToMessageId: ' reply-9 ',
        },
        {},
      ),
    ).rejects.toBe(unclassifiedNotFoundError)

    expect(runtimeMocks.probeLinqApi).not.toHaveBeenCalled()
    expect(runtimeMocks.createLinqChat).not.toHaveBeenCalled()
  })

  it('keeps stale Linq thread recovery confirmation-pending when no new chat id is returned', async () => {
    vi.stubEnv('LINQ_API_TOKEN', 'linq-token')
    const missingChatError = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq request POST /chats/[chat]/messages failed with HTTP 404.',
      {
        failureStage: 'http',
        linqFailureKind: 'chat_not_found',
        method: 'POST',
        operation: 'send_message',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 404,
      },
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    runtimeMocks.createLinqChat.mockResolvedValue({
      messageId: '  recovered-message  ',
    })
    runtimeMocks.probeLinqApi.mockResolvedValue({
      ok: true,
      phoneNumbers: ['+15550000'],
    })

    const staleRecovery = await ASSISTANT_CHANNEL_ADAPTERS.linq.send(
      {
        actorId: ' +15550001 ',
        bindingDelivery: createAssistantBindingDelivery('thread', ' stale-chat '),
        explicitTarget: null,
        idempotencyKey: ' idem-stale-thread ',
        identityId: null,
        message: 'hello again',
        replyToMessageId: ' reply-9 ',
      },
      {},
    ).then(
      () => null,
      (error: unknown) => error,
    )

    expect(staleRecovery).toMatchObject({
      code: 'ASSISTANT_DELIVERY_CONFIRMATION_PENDING',
      message: expect.stringContaining(
        'Recovered iMessage direct delivery did not return a chat id.',
      ),
    })
    expect(staleRecovery).toMatchObject({
      message: expect.not.stringContaining('Recovered Linq'),
    })
  })

  it('falls back to the original stale-chat error when Linq sender probing or recovery fails', async () => {
    vi.stubEnv('LINQ_API_TOKEN', 'linq-token')
    const missingChatError = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq request POST /chats/[chat]/messages failed with HTTP 404.',
      {
        failureStage: 'http',
        linqFailureKind: 'chat_not_found',
        method: 'POST',
        operation: 'send_message',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 404,
      },
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    runtimeMocks.probeLinqApi.mockRejectedValue(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Phone number lookup failed',
        {
          operation: 'probe_phone_numbers',
          path: '/phone_numbers',
          provider: 'linq',
          retryable: true,
          status: 503,
        },
      ),
    )

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: ' +15550001 ',
          bindingDelivery: null,
          explicitTarget: ' stale-chat ',
          idempotencyKey: ' idem-stale-thread ',
          identityId: null,
          message: 'hello again',
          replyToMessageId: ' reply-9 ',
        },
        {},
      ),
    ).rejects.toBe(missingChatError)

    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith({
      chatId: 'stale-chat',
      idempotencyKey: 'idem-stale-thread',
      message: 'hello again',
      replyToMessageId: 'reply-9',
    }, {
      env: process.env,
      fetchImplementation: undefined,
    })
  })

  it('sends email to recipients and threads, with typed failures for missing configuration', async () => {
    await expect(
      sendEmailMessage(
        {
          identityId: '   ',
          message: 'hello',
          target: 'friend@example.com',
          targetKind: 'explicit',
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
    })

    await expect(
      sendEmailMessage(
        {
          identityId: 'identity-1',
          message: 'hello',
          target: 'friend@example.com',
          targetKind: 'explicit',
        },
        {
          env: {},
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EMAIL_API_KEY_REQUIRED',
    })

    const directClient = createAgentmailClient({
      sendMessage: vi.fn().mockResolvedValue({
        message_id: '  message-1  ',
        thread_id: '  thread-1  ',
      }),
    })
    runtimeMocks.createAgentmailApiClient.mockReturnValueOnce(directClient)

    await expect(
      sendEmailMessage(
        {
          identityId: ' identity-1 ',
          message: 'direct hello',
          subject: '   ',
          target: ' friend@example.com ',
          targetKind: 'explicit',
        },
        {
          env: {
            AGENTMAIL_API_KEY: 'agentmail-key',
            AGENTMAIL_BASE_URL: 'https://agentmail.test',
          },
        },
      ),
    ).resolves.toEqual({
      providerMessageId: 'message-1',
      providerThreadId: 'thread-1',
    })

    expect(runtimeMocks.createAgentmailApiClient).toHaveBeenCalledWith(
      'agentmail-key',
      {
        baseUrl: 'https://agentmail.test',
        fetchImplementation: undefined,
      },
    )
    expect(directClient.sendMessage).toHaveBeenCalledWith({
      inboxId: 'identity-1',
      subject: 'Murph update',
      text: 'direct hello',
      to: 'friend@example.com',
    })

    const threadClient = createAgentmailClient({
      getThread: vi.fn().mockResolvedValue({
        inbox_id: 'identity-1',
        thread_id: 'thread-123',
        last_message_id: '   ',
        messages: [
          {
            inbox_id: 'identity-1',
            message_id: '   ',
            thread_id: 'thread-123',
          },
          {
            inbox_id: 'identity-1',
            message_id: ' parent-9 ',
            thread_id: 'thread-123',
          },
        ],
      }),
      replyToMessage: vi.fn().mockResolvedValue({
        message_id: '  reply-1  ',
        thread_id: '  thread-123  ',
      }),
    })
    runtimeMocks.createAgentmailApiClient.mockReturnValueOnce(threadClient)

    await expect(
      sendEmailMessage(
        {
          identityId: 'identity-1',
          message: 'thread hello',
          replyToMessageId: '  override-message  ',
          target: 'thread-123',
          targetKind: 'thread',
        },
        {
          env: {
            AGENTMAIL_API_KEY: 'agentmail-key',
          },
        },
      ),
    ).resolves.toEqual({
      providerMessageId: 'reply-1',
      providerThreadId: 'thread-123',
    })

    expect(threadClient.replyToMessage).toHaveBeenCalledWith({
      inboxId: 'identity-1',
      messageId: 'override-message',
      replyAll: true,
      text: 'thread hello',
    })

    const missingParentClient = createAgentmailClient({
      getThread: vi.fn().mockResolvedValue({
        inbox_id: 'identity-1',
        thread_id: 'thread-empty',
        last_message_id: '   ',
        messages: [],
      }),
    })
    runtimeMocks.createAgentmailApiClient.mockReturnValueOnce(missingParentClient)

    await expect(
      sendEmailMessage(
        {
          identityId: 'identity-1',
          message: 'thread hello',
          target: 'thread-empty',
          targetKind: 'thread',
        },
        {
          env: {
            AGENTMAIL_API_KEY: 'agentmail-key',
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EMAIL_THREAD_REPLY_UNAVAILABLE',
    })
  })
})

function createInboxCapture(
  threadIsDirect: boolean,
): InboxShowResult['capture'] {
  return {
    accountId: null,
    actorId: null,
    actorIsSelf: false,
    actorName: null,
    attachmentCount: 0,
    attachments: [],
    captureId: 'capture-1',
    createdAt: '2026-04-08T00:00:00.000Z',
    envelopePath: 'vault/inbox/envelope.json',
    eventId: 'event-1',
    externalId: 'external-1',
    occurredAt: '2026-04-08T00:00:00.000Z',
    promotions: [],
    receivedAt: null,
    source: 'telegram',
    text: null,
    threadId: 'thread-1',
    threadIsDirect,
    threadTitle: null,
  }
}

function createAgentmailClient(
  overrides: Partial<
    Pick<AgentmailApiClient, 'getThread' | 'replyToMessage' | 'sendMessage'>
  > = {},
): AgentmailApiClient {
  const listInboxes: AgentmailApiClient['listInboxes'] = async () => ({
    count: 0,
    inboxes: [],
  })
  const getInbox: AgentmailApiClient['getInbox'] = async () => ({
    email: 'sender@example.com',
    inbox_id: 'identity-1',
  })
  const createInbox: AgentmailApiClient['createInbox'] = async () => ({
    email: 'sender@example.com',
    inbox_id: 'identity-1',
  })
  const sendMessage =
    overrides.sendMessage ??
    (async () => ({
      message_id: 'message-id',
      thread_id: 'thread-id',
    }))
  const replyToMessage =
    overrides.replyToMessage ??
    (async () => ({
      message_id: 'reply-id',
      thread_id: 'thread-id',
    }))
  const getThread =
    overrides.getThread ??
    (async () => ({
      inbox_id: 'identity-1',
      thread_id: 'thread-id',
    }))
  const listMessages: AgentmailApiClient['listMessages'] = async () => ({
    count: 0,
    messages: [],
  })
  const getMessage: AgentmailApiClient['getMessage'] = async () => ({
    inbox_id: 'identity-1',
    message_id: 'message-id',
    thread_id: 'thread-id',
  })
  const updateMessage: AgentmailApiClient['updateMessage'] = async () => ({
    inbox_id: 'identity-1',
    message_id: 'message-id',
    thread_id: 'thread-id',
  })
  const getAttachment: AgentmailApiClient['getAttachment'] = async () => ({
    attachment_id: 'attachment-1',
    download_url: 'https://agentmail.test/file',
  })
  const downloadUrl: AgentmailApiClient['downloadUrl'] = async () =>
    new Uint8Array()

  return {
    apiKey: 'agentmail-key',
    baseUrl: 'https://agentmail.test',
    createInbox,
    downloadUrl,
    getAttachment,
    getInbox,
    getMessage,
    getThread,
    listInboxes,
    listMessages,
    replyToMessage,
    sendMessage,
    updateMessage,
  }
}

function createTelegramResponse(
  status: number,
  payload: unknown,
): {
  json: () => Promise<unknown>
  ok: boolean
  status: number
} {
  return {
    json: async () => payload,
    ok: status >= 200 && status < 300,
    status,
  }
}

function createAudioResponse(bytes: Uint8Array): {
  arrayBuffer: () => Promise<ArrayBuffer>
  json: () => Promise<unknown>
  ok: boolean
  status: number
  text: () => Promise<string>
} {
  return {
    arrayBuffer: async () => {
      const copy = new Uint8Array(bytes.byteLength)
      copy.set(bytes)
      return copy.buffer
    },
    json: async () => null,
    ok: true,
    status: 200,
    text: async () => '',
  }
}

function createQueuedFetch(
  queue: Array<
    | Error
    | {
        arrayBuffer?: () => Promise<ArrayBuffer>
        json: () => Promise<unknown>
        ok: boolean
        status: number
        text?: () => Promise<string>
      }
  >,
) {
  return vi.fn(
    async (
      _input: string,
      _init: {
        body?: string | Blob | FormData
        headers?: Record<string, string>
        method: string
        signal?: AbortSignal
      },
    ) => {
      const next = queue.shift()
      if (!next) {
        throw new Error('missing queued fetch response')
      }
      if (next instanceof Error) {
        throw next
      }
      return next
    },
  )
}

function readJsonBody(body: string | Blob | FormData | undefined): Record<string, unknown> {
  if (typeof body !== 'string') {
    return {}
  }

  const parsed = JSON.parse(body)
  return isRecord(parsed) ? parsed : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
