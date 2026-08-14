import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import {
  assistantResponseCardSchema,
  buildTelegramRichMessage,
  renderAssistantResponseCardText,
  renderAssistantWorkoutResponseCardText,
  type AssistantResponseCard,
  type CompactTableWorkoutResponseCardV1,
} from '@murphai/operator-config/assistant-response-cards'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { serializeHostedEmailThreadTarget } from '@murphai/runtime-state'

const runtimeMocks = vi.hoisted(() => ({
  checkLinqIMessageCapability: vi.fn(),
  createLinqChat: vi.fn(),
  probeLinqApi: vi.fn(),
  sendLinqChatMessage: vi.fn(),
  sendLinqIMessageAppCard: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
  uploadLinqAttachment: vi.fn(),
}))

const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64])

const NUTRITION_CARD: AssistantResponseCard = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: { target: 220, status: 'on_target' },
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

const NUTRITION_CARD_TEXT = renderAssistantResponseCardText(NUTRITION_CARD)

const EXPANDED_WORKOUT_CARD: CompactTableWorkoutResponseCardV1 = {
  footer: 'Reply with the exercise, set, and result.',
  kind: 'compact_table',
  subtitle: null,
  title: 'Full strength session',
  tracking: {
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    kind: 'workout',
    snapshotAt: '2026-08-11T10:00:00.000Z',
  },
  version: 1,
  workout: {
    exercises: Array.from({ length: 11 }, (_, exerciseIndex) => ({
      name: `Expanded exercise ${exerciseIndex + 1}`,
      sets: Array.from({ length: 3 }, (_, setIndex) => ({
        actual: null,
        status: 'pending',
        target: `Set ${setIndex + 1}`,
      })),
    })),
    state: 'active',
    version: 1,
  },
}

const OVERSIZED_WORKOUT_CARD: CompactTableWorkoutResponseCardV1 = {
  ...EXPANDED_WORKOUT_CARD,
  workout: {
    ...EXPANDED_WORKOUT_CARD.workout,
    exercises: Array.from({ length: 16 }, (_, exerciseIndex) => ({
      name: `Capacity exercise ${exerciseIndex + 1}`,
      sets: Array.from({ length: 16 }, (_, setIndex) => ({
        actual: null,
        status: 'pending',
        target: `Exercise ${exerciseIndex + 1} set ${setIndex + 1} target ${'x'.repeat(12)}`,
      })),
    })),
  },
}

const OVERSIZED_WORKOUT_TEXT =
  renderAssistantWorkoutResponseCardText(OVERSIZED_WORKOUT_CARD)

const ROUTINE_CARD: AssistantResponseCard = {
  exercises: [{
    dose: '8 repetitions',
    estimatedSeconds: 45,
    images: [],
    instructions: ['Move slowly.'],
    name: 'Shoulder circles',
  }],
  footer: null,
  intensity: 'Easy',
  kind: 'exercise_routine',
  labels: {
    dose: 'Dose',
    exercise: 'Exercise',
    time: 'Time',
    visualGuide: 'Visual guide',
  },
  safety: 'Stop if pain increases.',
  subtitle: null,
  title: 'Short reset',
  totalSeconds: 60,
  transitionSeconds: 15,
  version: 1,
}

const ROUTINE_CARD_TEXT = renderAssistantResponseCardText(ROUTINE_CARD)

const TELEGRAM_RICH_CONTENT_CARD: AssistantResponseCard = {
  kind: 'telegram_rich_content',
  version: 1,
  html: '<h2>Travel prep</h2><ol><li>Pack the charger.</li></ol><blockquote>Keep the passport with you.</blockquote>',
}

const TELEGRAM_RICH_CONTENT_CARD_TEXT = renderAssistantResponseCardText(
  TELEGRAM_RICH_CONTENT_CARD,
)

const LONG_ROUTINE_CARD = assistantResponseCardSchema.parse({
  ...ROUTINE_CARD,
  exercises: Array.from({ length: 8 }, (_, index) => ({
    dose: `Eight controlled repetitions ${'d'.repeat(50)}`,
    estimatedSeconds: 45,
    images: [],
    instructions: [
      `Keep the movement controlled ${'a'.repeat(50)}`,
      `Stop before the range becomes forced ${'b'.repeat(50)}`,
    ],
    name: `Exercise ${index + 1} ${'n'.repeat(60)}`,
  })),
  footer: `Keep breathing normally ${'f'.repeat(130)}`,
  intensity: `Easy and controlled ${'i'.repeat(130)}`,
  safety: `Stop if pain or dizziness increases ${'s'.repeat(120)}`,
  subtitle: `Complete movement guide ${'u'.repeat(130)}`,
  title: `Long routine ${'t'.repeat(140)}`,
  totalSeconds: 360,
  transitionSeconds: 0,
})

const LONG_ROUTINE_CARD_TEXT = renderAssistantResponseCardText(LONG_ROUTINE_CARD)

const CHALLENGE_CARD: AssistantResponseCard = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: 'Day 4 of 7',
  objective: { kind: 'ranking' },
  entries: [{
    label: 'Maya',
    points: 120,
    coverage: 'complete',
    detail: null,
  }],
  footer: null,
}

const CHALLENGE_CARD_TEXT = renderAssistantResponseCardText(CHALLENGE_CARD)

vi.mock('@murphai/operator-config/linq-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@murphai/operator-config/linq-runtime')>()
  return {
    ...actual,
    checkLinqIMessageCapability: runtimeMocks.checkLinqIMessageCapability,
    createLinqChat: runtimeMocks.createLinqChat,
    probeLinqApi: runtimeMocks.probeLinqApi,
    sendLinqChatMessage: runtimeMocks.sendLinqChatMessage,
    sendLinqIMessageAppCard: runtimeMocks.sendLinqIMessageAppCard,
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
  sendLinqMessage,
  sendTelegramImageMessage,
  sendTelegramMessage,
  sendTelegramRichMessage,
  sendTelegramVoiceMemoMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from '../src/assistant/channels/runtime.ts'

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  runtimeMocks.checkLinqIMessageCapability.mockReset()
  runtimeMocks.createLinqChat.mockReset()
  runtimeMocks.probeLinqApi.mockReset()
  runtimeMocks.sendLinqChatMessage.mockReset()
  runtimeMocks.sendLinqIMessageAppCard.mockReset()
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

  it('never recovers a missing Linq group-card fallback into a private chat', async () => {
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
    runtimeMocks.sendLinqIMessageAppCard.mockRejectedValueOnce(
      new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq rejected the iMessage app card.',
        {
          failureStage: 'http',
          method: 'POST',
          operation: 'send_imessage_app_card',
          path: '/chats/[chat]/messages',
          provider: 'linq',
          retryable: false,
          status: 400,
        },
      ),
    )
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    const persistLinqAppCardTextFallback = vi.fn().mockResolvedValue(undefined)

    await expect(ASSISTANT_CHANNEL_ADAPTERS.linq.send({
      actorId: '+15550001',
      bindingDelivery: createAssistantBindingDelivery('thread', 'group-card-chat'),
      card: CHALLENGE_CARD,
      deliverySource: {
        kind: 'linq',
        fromPhoneNumber: '+15550000',
      },
      explicitTarget: null,
      idempotencyKey: 'group-card-fallback',
      identityId: null,
      message: CHALLENGE_CARD_TEXT,
      replyToMessageId: null,
      threadIsDirect: false,
    }, {
      persistLinqAppCardTextFallback,
    })).rejects.toBe(missingChatError)

    expect(persistLinqAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: 'group-card-fallback:fallback',
    })
    expect(runtimeMocks.probeLinqApi).not.toHaveBeenCalled()
    expect(runtimeMocks.createLinqChat).not.toHaveBeenCalled()
  })

  it('reports retained auto-reply support from descriptors', () => {
    const directCapture = createInboxCapture(true)
    const groupCapture = createInboxCapture(false)
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply(directCapture)).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply(groupCapture)).toContain(
      'validated hosted group routes',
    )
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply({
      ...groupCapture,
      externalThreadRouteAuthorityPresent: true,
    })).toBeNull()
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
    expect(ASSISTANT_CHANNEL_ADAPTERS.email.canAutoReply({
      ...groupCapture,
      replyTargetThreadId: serializeHostedEmailThreadTarget({
        groupId: 'hgrp_AAAAAAAAAAAAAAAA',
        targetKind: 'group',
      }),
    })).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.email.canAutoReply({
      ...groupCapture,
      replyTargetThreadId: 'hostedmail:not-valid',
    })).toContain('validated hosted group routes')
  })

  it('sends Telegram chunks across migrate and retry branches', async () => {
    vi.useFakeTimers()
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        ok: false,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
      createTelegramResponse(429, {
        description: 'retry later',
        error_code: 429,
        ok: false,
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

  it('uploads private Telegram images as multipart bytes instead of a URL', async () => {
    const imageBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46])
    const loadVaultImage = vi.fn().mockResolvedValue(imageBytes)
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: { message_id: 3002 },
      }),
    ])

    await expect(sendTelegramImageMessage({
      media: [{
        alt: 'Private generated image',
        contentType: 'image/webp',
        filename: 'generated.webp',
        kind: 'vault_image',
        ref: 'raw/captures/generated.webp',
        sha256: 'a'.repeat(64),
        sizeBytes: imageBytes.byteLength,
        source: 'gpt-image-2',
      }],
      message: 'Private image',
      replyToMessageId: '42',
      target: '123:topic:9',
    }, {
      env: {
        TELEGRAM_API_BASE_URL: 'https://telegram.test/',
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      fetchImplementation,
      loadVaultImage,
    })).resolves.toMatchObject({
      providerMessageId: '3002',
      target: '123:topic:9',
    })

    expect(loadVaultImage).toHaveBeenCalledTimes(1)
    const body = fetchImplementation.mock.calls[0]?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    const entries = Object.fromEntries((body as FormData).entries())
    expect(entries).toMatchObject({
      caption: 'Private image\n\nPrivate generated image',
      chat_id: '123',
      message_thread_id: '9',
      reply_to_message_id: '42',
    })
    expect(entries).not.toHaveProperty('url')
    expect(entries.photo).toBeInstanceOf(File)
    expect((entries.photo as File).name).toBe('generated.webp')
    expect((entries.photo as File).type).toBe('image/webp')
    expect(new Uint8Array(await (entries.photo as File).arrayBuffer())).toEqual(imageBytes)
  })

  it('blocks an authority-bound Telegram text redirect before the migrated request', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        ok: false,
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
    ])

    await expect(
      sendTelegramMessage(
        {
          message: 'private group update',
          target: '123',
        },
        {
          authorityBoundTarget: '123',
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE',
      deliveryMayHaveSucceeded: false,
      retryable: false,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toMatchObject({
      chat_id: '123',
      text: 'private group update',
    })
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

  it('preserves all V2 nutrition targets and statuses in Telegram text delivery', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: { message_id: 124 },
      }),
    ])

    await sendTelegramMessage(
      { message: NUTRITION_CARD_TEXT, target: '123' },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )

    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body))
      .toMatchObject({ chat_id: '123', text: NUTRITION_CARD_TEXT })
    for (const target of [
      '2,100 calories (under target)',
      '100g protein (on target)',
      '220g carbs (on target)',
      '40g fat (on target)',
      '30g fiber (under target)',
    ]) {
      expect(NUTRITION_CARD_TEXT).toContain(target)
    }
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
        ok: false,
      }),
      createTelegramResponse(502, {
        description: 'rollback failed',
        error_code: 502,
        ok: false,
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

  it('preserves a Telegram failure proven to occur before provider entry', async () => {
    const preProviderFailure = Object.assign(
      new VaultCliError(
        'ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_STALE',
        'Private Assistant Ask route changed before provider entry.',
        { retryable: false },
      ),
      { deliveryMayHaveSucceeded: false as const },
    )
    const fetchImplementation = vi.fn(async () => {
      throw preProviderFailure
    })

    await expect(
      sendTelegramMessage(
        {
          message: 'Reviewed private answer.',
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
    ).rejects.toBe(preProviderFailure)

    expect(fetchImplementation).toHaveBeenCalledOnce()
  })

  it('keeps the Telegram provider deadline active through response body consumption', async () => {
    vi.useFakeTimers()
    const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
      if (fetchImplementation.mock.calls.length > 1) {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          result: {
            message_id: 1001,
          },
        }), {
          headers: {
            'content-type': 'application/json',
          },
          status: 200,
        }))
      }
      const signal = init?.signal
      if (!signal) {
        throw new Error('expected Telegram request abort signal')
      }

      return new Promise((resolve) => {
        setTimeout(() => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              const bodyTimer = setTimeout(() => {
                controller.enqueue(new TextEncoder().encode(JSON.stringify({
                  description: 'retry later',
                  error_code: 429,
                  ok: false,
                  parameters: {
                    retry_after: 0,
                  },
                })))
                controller.close()
              }, 2_000)
              signal.addEventListener('abort', () => {
                clearTimeout(bodyTimer)
                controller.error(new Error('Telegram response body aborted'))
              }, { once: true })
            },
          })
          resolve(new Response(body, {
            headers: {
              'content-type': 'application/json',
            },
            status: 429,
          }))
        }, 29_000)
      })
    })

    const delivery = sendTelegramMessage(
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
    )
    const outcome = delivery.then(
      (value) => ({ status: 'resolved' as const, value }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    )

    await vi.advanceTimersByTimeAsync(31_010)
    await expect(outcome).resolves.toMatchObject({
      error: {
        code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
        deliveryMayHaveSucceeded: true,
        providerMessageId: null,
        providerMessageIds: [],
        target: '123',
      },
      status: 'rejected',
    })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('rolls back Telegram partial sends against the migrated target when a later chunk fails', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        ok: false,
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
        ok: false,
      }),
      createTelegramResponse(502, {
        description: 'rollback failed',
        error_code: 502,
        ok: false,
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
        ok: false,
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

  it('sends one Telegram rich message with native structured content', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: { message_id: 2501 },
      }),
    ])

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'Fallback routine',
        replyToMessageId: '42',
        richMessage: {
          html: '<h2>Routine</h2><table><tr><td>Squat</td></tr></table>',
        },
        target: '123:topic:9',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).resolves.toEqual({
      cleanupMessages: [{ messageId: '2501', target: '123:topic:9' }],
      providerMessageId: '2501',
      target: '123:topic:9',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      'https://telegram.test/botbot-token/sendRichMessage',
    )
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toEqual({
      chat_id: '123',
      message_thread_id: 9,
      reply_parameters: { message_id: 42 },
      rich_message: {
        html: '<h2>Routine</h2><table><tr><td>Squat</td></tr></table>',
      },
    })
  })

  it('forwards disabled automatic entities for generic Telegram rich content', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: { message_id: 2502 },
      }),
    ])

    await sendTelegramRichMessage({
      fallbackMessage: TELEGRAM_RICH_CONTENT_CARD_TEXT,
      idempotencyKey: 'generic-rich-content',
      replyToMessageId: null,
      richMessage: buildTelegramRichMessage(TELEGRAM_RICH_CONTENT_CARD),
      target: '123',
    }, {
      env: {
        TELEGRAM_API_BASE_URL: 'https://telegram.test/',
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      fetchImplementation,
    })

    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toEqual({
      chat_id: '123',
      rich_message: {
        html: TELEGRAM_RICH_CONTENT_CARD.html,
        skip_entity_detection: true,
      },
    })
  })

  it('falls back to text only after a definitive rich-message rejection', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'Bad Request: rich messages are not supported',
        error_code: 400,
        ok: false,
      }),
      createTelegramResponse(200, {
        ok: true,
        result: { message_id: 2502 },
      }),
    ])

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: LONG_ROUTINE_CARD_TEXT,
        richMessage: { html: '<h2>Routine</h2>' },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).resolves.toMatchObject({
      providerMessageId: '2502',
      target: '123',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(fetchImplementation.mock.calls[0]?.[0]).toContain('/sendRichMessage')
    expect(fetchImplementation.mock.calls[1]?.[0]).toContain('/sendMessage')
    expect(readJsonBody(fetchImplementation.mock.calls[1]?.[1]?.body)).toMatchObject({
      chat_id: '123',
      text: LONG_ROUTINE_CARD_TEXT,
    })
    expect(LONG_ROUTINE_CARD_TEXT.length).toBeGreaterThan(3_000)
    expect(LONG_ROUTINE_CARD_TEXT.length).toBeLessThanOrEqual(4_096)
  })

  it('keeps automatic entities disabled in the generic rich-content fallback', async () => {
    const fallbackMessage = [
      'https://example.test example.test help@example.test',
      '@helper #topic /start +48 123 456 789',
      '[support](https://support.example.test)',
      'call(**kwargs, **options)',
    ].join('\n')
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'Bad Request: rich messages are not supported',
        error_code: 400,
        ok: false,
      }),
      createTelegramResponse(200, {
        ok: true,
        result: { message_id: 2503 },
      }),
    ])

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage,
        replyToMessageId: '42',
        richMessage: {
          html: '<h2>Contact options</h2>',
          skip_entity_detection: true,
        },
        target: '123:topic:9',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).resolves.toMatchObject({
      providerMessageId: '2503',
      target: '123:topic:9',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    const fallbackPayload = readJsonBody(
      fetchImplementation.mock.calls[1]?.[1]?.body,
    )
    if (typeof fallbackPayload.text !== 'string') {
      throw new Error('Expected the Telegram fallback payload to contain text.')
    }
    expect(fallbackPayload).toEqual({
      chat_id: '123',
      entities: [{
        length: fallbackPayload.text.length,
        offset: 0,
        type: 'pre',
      }],
      message_thread_id: 9,
      reply_to_message_id: 42,
      text: fallbackMessage,
    })
  })

  it('keeps an ambiguous definitive-rejection fallback terminal and single-attempt', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'Bad Request: rich messages are not supported',
        error_code: 400,
        ok: false,
      }),
      createTelegramResponse(500, {
        message: 'upstream response without a Bot API envelope',
      }),
    ])

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'Contact https://example.test or @helper',
        richMessage: {
          html: '<h2>Contact options</h2>',
          skip_entity_detection: true,
        },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(readJsonBody(fetchImplementation.mock.calls[1]?.[1]?.body)).toMatchObject({
      entities: [{
        offset: 0,
        type: 'pre',
      }],
    })
  })

  it('rejects a multi-message rich fallback before provider entry', async () => {
    const fetchImplementation = vi.fn()

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'x'.repeat(4_097),
        richMessage: { html: '<h2>Routine</h2>' },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_RICH_FALLBACK_TOO_LONG',
      deliveryMayHaveSucceeded: false,
    })

    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it('does not send a text fallback when rich-message acceptance is ambiguous', async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error('socket closed')
    })

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'Do not duplicate this',
        richMessage: { html: '<h2>Routine</h2>' },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it.each([408, 409, 425, 429, 500])(
    'preserves proven Bot API rejection for existing retry ownership after HTTP %s',
    async (status) => {
      const fetchImplementation = createQueuedFetch([
        createTelegramResponse(status, {
          description: `Telegram returned ${status}`,
          error_code: status,
          ok: false,
        }),
      ])

      await expect(sendTelegramRichMessage(
        {
          fallbackMessage: 'Do not duplicate this',
          richMessage: { html: '<h2>Routine</h2>' },
          target: '123',
        },
        {
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      )).rejects.toMatchObject({
        code: 'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
        deliveryMayHaveSucceeded: false,
      })

      expect(fetchImplementation).toHaveBeenCalledTimes(1)
    },
  )

  it('treats an HTTP response without a Bot API rejection envelope as ambiguous', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(500, {
        message: 'upstream gateway failure',
      }),
    ])

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'Do not duplicate this',
        richMessage: { html: '<h2>Routine</h2>' },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('keeps invalid Bot API response envelopes terminal across existing Telegram sends', async () => {
    const textFetch = createQueuedFetch([
      createTelegramResponse(502, { message: 'upstream text gateway failure' }),
    ])
    await expect(sendTelegramMessage(
      { message: 'One text reply', target: '123' },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation: textFetch,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })
    expect(textFetch).toHaveBeenCalledTimes(1)

    const photoFetch = createQueuedFetch([
      createTelegramResponse(502, { message: 'upstream photo gateway failure' }),
    ])
    await expect(sendTelegramImageMessage(
      {
        media: [{
          alt: 'A chart',
          kind: 'image',
          source: 'test',
          url: 'https://cdn.example.test/chart.png',
        }],
        message: 'One image reply',
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation: photoFetch,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })
    expect(photoFetch).toHaveBeenCalledTimes(1)

    const voiceFetch = createQueuedFetch([
      createAudioResponse(mp3Bytes),
      createTelegramResponse(502, { message: 'upstream voice gateway failure' }),
    ])
    await expect(sendTelegramVoiceMemoMessage(
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
        fetchImplementation: voiceFetch,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })
    expect(voiceFetch).toHaveBeenCalledTimes(2)
    expect(voiceFetch.mock.calls[1]?.[0]).toContain('/sendVoice')
  })

  it('keeps an old Worker rich-route rejection terminal without text fallback', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(403, {
        code: 'ASSISTANT_PROVIDER_OPERATION_NOT_ALLOWED',
        message: 'sendRichMessage is not allowed by this Worker release',
      }),
    ])

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'Do not start fallback after an unknown provider result',
        richMessage: { html: '<h2>Routine</h2>' },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).rejects.toMatchObject({
      code: 'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
      deliveryMayHaveSucceeded: true,
      retryable: false,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('preserves a proven pre-provider rich-message rejection', async () => {
    const providerEntryError = Object.assign(
      new Error('provider entry rejected'),
      { deliveryMayHaveSucceeded: false as const },
    )
    const fetchImplementation = vi.fn(async () => {
      throw providerEntryError
    })

    await expect(sendTelegramRichMessage(
      {
        fallbackMessage: 'Provider was not called',
        richMessage: { html: '<h2>Routine</h2>' },
        target: '123',
      },
      {
        env: {
          TELEGRAM_API_BASE_URL: 'https://telegram.test/',
          TELEGRAM_BOT_TOKEN: 'bot-token',
        },
        fetchImplementation,
      },
    )).rejects.toBe(providerEntryError)

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })

  it('projects a frozen Telegram response card into the rich-message path', async () => {
    const sendTelegramRich = vi.fn().mockResolvedValue({
      providerMessageId: 'rich-card-1',
      target: '123',
    })
    const sendTelegram = vi.fn()

    await expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.send({
      actorId: null,
      bindingDelivery: createAssistantBindingDelivery('thread', '123'),
      card: TELEGRAM_RICH_CONTENT_CARD,
      explicitTarget: null,
      idempotencyKey: 'rich-card-idempotency',
      identityId: null,
      media: [],
      message: TELEGRAM_RICH_CONTENT_CARD_TEXT,
      replyToMessageId: '42',
      threadIsDirect: true,
    }, {
      sendTelegram,
      sendTelegramRich,
    })).resolves.toMatchObject({
      channel: 'telegram',
      providerMessageId: 'rich-card-1',
      target: '123',
    })

    expect(sendTelegramRich).toHaveBeenCalledWith(expect.objectContaining({
      fallbackMessage: TELEGRAM_RICH_CONTENT_CARD_TEXT,
      idempotencyKey: 'rich-card-idempotency',
      replyToMessageId: '42',
      richMessage: expect.objectContaining({
        html: TELEGRAM_RICH_CONTENT_CARD.html,
        skip_entity_detection: true,
      }),
      target: '123',
    }))
    expect(sendTelegram).not.toHaveBeenCalled()
  })

  it('projects every exercise in an expanded workout through Telegram rich messages', async () => {
    const sendTelegramRich = vi.fn().mockResolvedValue({
      providerMessageId: 'expanded-workout-1',
      target: '123',
    })
    const sendTelegram = vi.fn()

    await expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.send({
      actorId: null,
      bindingDelivery: createAssistantBindingDelivery('thread', '123'),
      card: EXPANDED_WORKOUT_CARD,
      explicitTarget: null,
      idempotencyKey: 'expanded-workout-idempotency',
      identityId: null,
      media: [],
      message: renderAssistantResponseCardText(EXPANDED_WORKOUT_CARD),
      replyToMessageId: '42',
      threadIsDirect: true,
    }, {
      sendTelegram,
      sendTelegramRich,
    })).resolves.toMatchObject({
      channel: 'telegram',
      providerMessageId: 'expanded-workout-1',
      target: '123',
    })

    expect(sendTelegramRich).toHaveBeenCalledTimes(1)
    const richMessage = sendTelegramRich.mock.calls[0]?.[0]?.richMessage
    expect(richMessage?.html).toContain('Expanded exercise 1')
    expect(richMessage?.html).toContain('Expanded exercise 11')
    expect(richMessage?.html).toContain('Set 3')
    expect(sendTelegram).not.toHaveBeenCalled()
  })

  it('uses complete chunkable text for a Telegram workout envelope overflow', async () => {
    const sendTelegramRich = vi.fn()
    const sendTelegram = vi.fn().mockResolvedValue({
      providerMessageId: 'oversized-workout-1',
      target: '123',
    })

    expect(
      assistantResponseCardSchema.safeParse(OVERSIZED_WORKOUT_CARD).success,
    ).toBe(false)

    await expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.send({
      actorId: null,
      bindingDelivery: createAssistantBindingDelivery('thread', '123'),
      card: null,
      explicitTarget: null,
      idempotencyKey: 'oversized-workout-idempotency',
      identityId: null,
      media: [],
      message: OVERSIZED_WORKOUT_TEXT,
      replyToMessageId: '42',
      threadIsDirect: true,
    }, {
      sendTelegram,
      sendTelegramRich,
    })).resolves.toMatchObject({
      channel: 'telegram',
      providerMessageId: 'oversized-workout-1',
      target: '123',
    })

    expect(OVERSIZED_WORKOUT_TEXT).toContain('Capacity exercise 1:')
    expect(OVERSIZED_WORKOUT_TEXT).toContain('Capacity exercise 16:')
    expect(OVERSIZED_WORKOUT_TEXT).toContain(
      `set 16: pending; target Exercise 16 set 16 target ${'x'.repeat(12)}`,
    )
    expect(OVERSIZED_WORKOUT_TEXT).not.toContain('evt_')
    expect(sendTelegram).toHaveBeenCalledTimes(1)
    expect(sendTelegram).toHaveBeenCalledWith(expect.objectContaining({
      message: OVERSIZED_WORKOUT_TEXT,
    }))
    expect(sendTelegramRich).not.toHaveBeenCalled()
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
      caption: 'Here is an example image.\n\nExample image',
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

  it('preserves the image description through the existing Telegram caption overflow path', async () => {
    const alternative = 'Direction context unavailable · mover sentiment is neutral.'
    const message = 'x'.repeat(1_000)
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 3001,
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 3002,
        },
      }),
    ])

    await expect(
      sendTelegramImageMessage(
        {
          media: [
            {
              alt: alternative,
              kind: 'image',
              source: 'test',
              url: 'https://cdn.example.test/progress-card.png',
            },
          ],
          message,
          replyToMessageId: '42',
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
    ).resolves.toMatchObject({
      providerMessageId: '3002',
      providerMessageIds: ['3001', '3002'],
      target: '123',
    })

    const textRequest = readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)
    expect(textRequest).toMatchObject({
      chat_id: '123',
      reply_to_message_id: 42,
      text: `${message}\n\n${alternative}`,
    })
    expect(String(textRequest.text).match(
      /Direction context unavailable · mover sentiment is neutral\./gu,
    )).toHaveLength(1)
    expect(readJsonBody(fetchImplementation.mock.calls[1]?.[1]?.body)).toMatchObject({
      chat_id: '123',
      photo: 'https://cdn.example.test/progress-card.png',
    })
  })

  it('blocks an authority-bound Telegram photo redirect before the migrated request', async () => {
    const fetchImplementation = createQueuedFetch([
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        ok: false,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
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
              alt: 'Private chart',
              kind: 'image',
              source: 'test',
              url: 'https://cdn.example.test/private.png',
            },
          ],
          message: 'Private chart',
          target: '123',
        },
        {
          authorityBoundTarget: '123',
          env: {
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE',
      deliveryMayHaveSucceeded: false,
      retryable: false,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(1)
    expect(readJsonBody(fetchImplementation.mock.calls[0]?.[1]?.body)).toMatchObject({
      chat_id: '123',
      photo: 'https://cdn.example.test/private.png',
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
        ok: false,
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

  it('blocks an authority-bound Telegram voice redirect before the migrated request', async () => {
    const fetchImplementation = createQueuedFetch([
      createAudioResponse(mp3Bytes),
      createTelegramResponse(400, {
        description: 'group chat migrated',
        error_code: 400,
        ok: false,
        parameters: {
          migrate_to_chat_id: '456',
        },
      }),
      createTelegramResponse(200, {
        ok: true,
        result: {
          message_id: 2002,
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
            text: 'Private group memo.',
            voiceId: 'voice_murph',
          },
          target: '123',
        },
        {
          authorityBoundTarget: '123',
          env: {
            ELEVENLABS_API_KEY: 'elevenlabs-key',
            TELEGRAM_API_BASE_URL: 'https://telegram.test/',
            TELEGRAM_BOT_TOKEN: 'bot-token',
          },
          fetchImplementation,
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE',
      deliveryMayHaveSucceeded: false,
      retryable: false,
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(2)
    expect(fetchImplementation.mock.calls[0]?.[0]).toContain('api.elevenlabs.io')
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
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
        ok: false,
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
        ok: false,
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
          message: 'selected reply',
          nativeReplyRequested: true,
          replyToMessageId: 'selected-message-1',
          target: 'chat-1',
          targetKind: 'thread',
        },
        {
          env: {
            LINQ_API_TOKEN: 'linq-token',
          },
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'linq-message-id',
      target: 'chat-1',
    })
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenLastCalledWith(
      {
        chatId: 'chat-1',
        idempotencyKey: null,
        message: 'selected reply',
        nativeReplyRequested: true,
        replyToMessageId: 'selected-message-1',
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
          fromPhoneNumber: '+15550000',
          message: 'cannot recreate this reply',
          nativeReplyRequested: true,
          replyToMessageId: 'selected-message-1',
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
      code: 'ASSISTANT_LINQ_NATIVE_REPLY_CHAT_REQUIRED',
    })
    expect(runtimeMocks.createLinqChat).toHaveBeenCalledTimes(1)
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
    expect(runtimeMocks.checkLinqIMessageCapability).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqIMessageAppCard).not.toHaveBeenCalled()
  })

  it('sends eligible Linq response cards natively after capability confirmation', async () => {
    runtimeMocks.checkLinqIMessageCapability.mockResolvedValue(true)
    runtimeMocks.sendLinqIMessageAppCard.mockResolvedValue({
      message: { id: 'native-card-message-1' },
    })

    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: '+15550001',
      fromPhoneNumber: '+15550000',
      idempotencyKey: 'card-delivery-1',
      message: NUTRITION_CARD_TEXT,
      target: 'private-thread-1',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
    })).resolves.toEqual({
      providerMessageId: 'native-card-message-1',
      providerMessageEffects: [{
        message: null,
        providerMessageId: 'native-card-message-1',
      }],
      providerThreadId: null,
      target: 'private-thread-1',
    })

    expect(runtimeMocks.checkLinqIMessageCapability).toHaveBeenCalledWith({
      address: '+15550001',
      from: '+15550000',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: undefined,
    })
    expect(runtimeMocks.sendLinqIMessageAppCard).toHaveBeenCalledWith({
      card: NUTRITION_CARD,
      chatId: 'private-thread-1',
      idempotencyKey: 'card-delivery-1',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: undefined,
    })
    expect(runtimeMocks.sendLinqChatMessage).not.toHaveBeenCalled()
    expect(runtimeMocks.createLinqChat).not.toHaveBeenCalled()
  })

  it('uses deterministic text for Linq exercise routine cards', async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'routine-text-message-1' },
    })

    await expect(sendLinqMessage({
      card: ROUTINE_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'routine-card-delivery-1',
      message: ROUTINE_CARD_TEXT,
      target: 'private-thread-routine',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      providerMessageId: 'routine-text-message-1',
      target: 'private-thread-routine',
    })

    expect(runtimeMocks.checkLinqIMessageCapability).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqIMessageAppCard).not.toHaveBeenCalled()
    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: 'routine-card-delivery-1',
    })
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith({
      chatId: 'private-thread-routine',
      idempotencyKey: 'routine-card-delivery-1',
      message: ROUTINE_CARD_TEXT,
      replyToMessageId: null,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: undefined,
    })
  })

  it('uses deterministic text if Telegram-only rich content reaches Linq', async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'telegram-rich-text-message-1' },
    })

    await expect(sendLinqMessage({
      card: TELEGRAM_RICH_CONTENT_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'telegram-rich-card-delivery-1',
      message: TELEGRAM_RICH_CONTENT_CARD_TEXT,
      target: 'private-thread-telegram-rich',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      providerMessageId: 'telegram-rich-text-message-1',
      target: 'private-thread-telegram-rich',
    })

    expect(runtimeMocks.checkLinqIMessageCapability).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqIMessageAppCard).not.toHaveBeenCalled()
    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: 'telegram-rich-card-delivery-1',
    })
  })

  it('falls back to deterministic ordinary text when Linq card capability is unavailable', async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'fallback-message-1' },
    })

    runtimeMocks.checkLinqIMessageCapability.mockResolvedValueOnce(false)
    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'card-fallback-false',
      message: NUTRITION_CARD_TEXT,
      target: 'private-thread-false',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({ providerMessageId: 'fallback-message-1' })

    runtimeMocks.checkLinqIMessageCapability.mockRejectedValueOnce(
      new Error('capability unavailable'),
    )
    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'card-fallback-error',
      message: NUTRITION_CARD_TEXT,
      target: 'private-thread-error',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({ providerMessageId: 'fallback-message-1' })

    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: null,
      idempotencyKey: 'card-fallback-no-handle',
      message: NUTRITION_CARD_TEXT,
      target: 'private-thread-no-handle',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({ providerMessageId: 'fallback-message-1' })

    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'card-fallback-group',
      message: NUTRITION_CARD_TEXT,
      target: 'group-thread-1',
      targetKind: 'thread',
      threadIsDirect: false,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({ providerMessageId: 'fallback-message-1' })

    expect(runtimeMocks.checkLinqIMessageCapability).toHaveBeenCalledTimes(2)
    expect(runtimeMocks.sendLinqIMessageAppCard).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledTimes(4)
    expect(persistAppCardTextFallback).toHaveBeenCalledTimes(4)
    for (const call of runtimeMocks.sendLinqChatMessage.mock.calls) {
      expect(call[0]).toMatchObject({
        message: NUTRITION_CARD_TEXT,
      })
      expect(call[0]).not.toHaveProperty('media')
    }
  })

  it('falls back once with a distinct key after a definitive Linq app-card rejection', async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    runtimeMocks.checkLinqIMessageCapability.mockResolvedValue(true)
    runtimeMocks.sendLinqIMessageAppCard.mockRejectedValue(new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq rejected the iMessage app card.',
      {
        failureStage: 'http',
        method: 'POST',
        operation: 'send_imessage_app_card',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 400,
      },
    ))
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'card-text-fallback-1' },
    })

    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'card-definitive-rejection',
      message: NUTRITION_CARD_TEXT,
      target: 'private-thread-rejected-card',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toEqual({
      idempotencyKey: 'card-definitive-rejection:fallback',
      providerMessageId: 'card-text-fallback-1',
      providerThreadId: null,
      target: 'private-thread-rejected-card',
    })

    expect(runtimeMocks.sendLinqIMessageAppCard).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledTimes(1)
    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: 'card-definitive-rejection:fallback',
    })
    expect(persistAppCardTextFallback.mock.invocationCallOrder[0]).toBeLessThan(
      runtimeMocks.sendLinqChatMessage.mock.invocationCallOrder[0]!,
    )
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith({
      chatId: 'private-thread-rejected-card',
      idempotencyKey: 'card-definitive-rejection:fallback',
      message: NUTRITION_CARD_TEXT,
      replyToMessageId: null,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: undefined,
    })
  })

  it('falls back once after a definitive scheduled group-card rejection', async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    runtimeMocks.sendLinqIMessageAppCard.mockRejectedValue(new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq rejected the iMessage app card.',
      {
        failureStage: 'http',
        method: 'POST',
        operation: 'send_imessage_app_card',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 400,
      },
    ))
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'scheduled-group-card-fallback-1' },
    })

    await expect(sendLinqMessage({
      card: CHALLENGE_CARD,
      idempotencyKey: 'scheduled-group-card',
      message: CHALLENGE_CARD_TEXT,
      target: 'scheduled-group-thread',
      targetKind: 'explicit',
      threadIsDirect: false,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).resolves.toMatchObject({
      idempotencyKey: 'scheduled-group-card:fallback',
      providerMessageId: 'scheduled-group-card-fallback-1',
    })

    expect(runtimeMocks.checkLinqIMessageCapability).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqIMessageAppCard).toHaveBeenCalledWith({
      card: CHALLENGE_CARD,
      chatId: 'scheduled-group-thread',
      idempotencyKey: 'scheduled-group-card',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      fetchImplementation: undefined,
    })
    expect(persistAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: 'scheduled-group-card:fallback',
    })
    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledOnce()
  })

  it('preserves a scheduled group card after an ambiguous native result', async () => {
    const persistAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    const error = new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq app-card delivery was not confirmed.',
      {
        failureStage: 'transport',
        method: 'POST',
        operation: 'send_imessage_app_card',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: true,
      },
    )
    runtimeMocks.sendLinqIMessageAppCard.mockRejectedValue(error)

    await expect(sendLinqMessage({
      card: CHALLENGE_CARD,
      idempotencyKey: 'scheduled-group-card-ambiguous',
      message: CHALLENGE_CARD_TEXT,
      target: 'scheduled-group-thread',
      targetKind: 'explicit',
      threadIsDirect: false,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback,
    })).rejects.toBe(error)

    expect(runtimeMocks.checkLinqIMessageCapability).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqIMessageAppCard).toHaveBeenCalledOnce()
    expect(persistAppCardTextFallback).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqChatMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['rate limit', { failureStage: 'http', retryable: true, status: 429 }],
    ['server failure', { failureStage: 'http', retryable: true, status: 500 }],
    ['transport ambiguity', { failureStage: 'transport', retryable: true }],
  ] as const)(
    'does not text-fallback after an ambiguous Linq app-card %s',
    async (_label, failure) => {
      runtimeMocks.checkLinqIMessageCapability.mockResolvedValue(true)
      const error = new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq app-card delivery was not confirmed.',
        {
          ...failure,
          method: 'POST',
          operation: 'send_imessage_app_card',
          path: '/chats/[chat]/messages',
          provider: 'linq',
        },
      )
      runtimeMocks.sendLinqIMessageAppCard.mockRejectedValue(error)

      await expect(sendLinqMessage({
        card: NUTRITION_CARD,
        directRecipientPhoneNumber: '+15550001',
        idempotencyKey: 'card-ambiguous-outcome',
        message: NUTRITION_CARD_TEXT,
        target: 'private-thread-ambiguous-card',
        targetKind: 'thread',
        threadIsDirect: true,
      }, {
        env: { LINQ_API_TOKEN: 'linq-token' },
      })).rejects.toBe(error)

      expect(runtimeMocks.sendLinqIMessageAppCard).toHaveBeenCalledTimes(1)
      expect(runtimeMocks.sendLinqChatMessage).not.toHaveBeenCalled()
    },
  )

  it('does not send app-card fallback text before durable promotion succeeds', async () => {
    runtimeMocks.checkLinqIMessageCapability.mockResolvedValue(true)
    runtimeMocks.sendLinqIMessageAppCard.mockRejectedValue(new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq rejected the iMessage app card.',
      {
        failureStage: 'http',
        method: 'POST',
        operation: 'send_imessage_app_card',
        path: '/chats/[chat]/messages',
        provider: 'linq',
        retryable: false,
        status: 400,
      },
    ))
    const persistenceError = new VaultCliError(
      'ASSISTANT_RUNTIME_WRITE_LOCKED',
      'The outbox is temporarily unavailable.',
      { retryable: true },
    )

    await expect(sendLinqMessage({
      card: NUTRITION_CARD,
      directRecipientPhoneNumber: '+15550001',
      idempotencyKey: 'card-persistence-failure',
      message: NUTRITION_CARD_TEXT,
      target: 'private-thread-persistence-failure',
      targetKind: 'thread',
      threadIsDirect: true,
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      persistAppCardTextFallback: async () => {
        throw persistenceError
      },
    })).rejects.toBe(persistenceError)

    expect(runtimeMocks.sendLinqIMessageAppCard).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.sendLinqChatMessage).not.toHaveBeenCalled()
  })

  it.each([
    {
      capabilityAvailable: false,
      expectedIdempotencyKey: 'card-stale-thread',
      name: 'capability fallback',
    },
    {
      capabilityAvailable: true,
      expectedIdempotencyKey: 'card-stale-thread:fallback',
      name: 'definitive app-card rejection',
    },
  ])('recovers a stale Linq thread after $name using the persisted text identity', async ({
    capabilityAvailable,
    expectedIdempotencyKey,
  }) => {
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
    const persistLinqAppCardTextFallback = vi.fn().mockResolvedValue(undefined)
    runtimeMocks.checkLinqIMessageCapability.mockResolvedValue(capabilityAvailable)
    if (capabilityAvailable) {
      runtimeMocks.sendLinqIMessageAppCard.mockRejectedValue(new VaultCliError(
        'LINQ_API_REQUEST_FAILED',
        'Linq rejected the iMessage app card.',
        {
          failureStage: 'http',
          method: 'POST',
          operation: 'send_imessage_app_card',
          path: '/chats/[chat]/messages',
          provider: 'linq',
          retryable: false,
          status: 400,
        },
      ))
    }
    runtimeMocks.sendLinqChatMessage.mockRejectedValueOnce(missingChatError)
    runtimeMocks.createLinqChat.mockResolvedValueOnce({
      chatId: 'recovered-card-chat',
      messageId: 'recovered-card-message',
    })

    await expect(ASSISTANT_CHANNEL_ADAPTERS.linq.send({
      actorId: '+15550001',
      bindingDelivery: createAssistantBindingDelivery('thread', 'stale-card-chat'),
      card: NUTRITION_CARD,
      deliverySource: {
        kind: 'linq',
        fromPhoneNumber: '+15550000',
      },
      explicitTarget: null,
      idempotencyKey: 'card-stale-thread',
      identityId: null,
      message: NUTRITION_CARD_TEXT,
      replyToMessageId: null,
      threadIsDirect: true,
    }, {
      persistLinqAppCardTextFallback,
    })).resolves.toMatchObject({
      idempotencyKey: expectedIdempotencyKey,
      providerMessageId: 'recovered-card-message',
      providerThreadId: 'recovered-card-chat',
      target: 'recovered-card-chat',
    })

    expect(persistLinqAppCardTextFallback).toHaveBeenCalledWith({
      idempotencyKey: expectedIdempotencyKey,
    })
    expect(runtimeMocks.createLinqChat).toHaveBeenCalledWith({
      from: '+15550000',
      idempotencyKey: expectedIdempotencyKey,
      message: NUTRITION_CARD_TEXT,
      to: ['+15550001'],
    }, {
      env: process.env,
      fetchImplementation: undefined,
    })
    expect(runtimeMocks.createLinqChat.mock.invocationCallOrder[0]).toBeGreaterThan(
      persistLinqAppCardTextFallback.mock.invocationCallOrder[0]!,
    )
  })

  it('uploads private Linq image bytes and sends only the provider attachment id', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const fallbackDescription =
      'Morning light experiment progress. Direction context unavailable · mover sentiment is neutral.'
    const loadVaultImage = vi.fn().mockResolvedValue(bytes)
    runtimeMocks.uploadLinqAttachment.mockResolvedValue({
      attachmentId: 'attachment_private_image',
    })
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'message_private_image' },
    })

    await expect(sendLinqMessage({
      media: [{
        alt: fallbackDescription,
        contentType: 'image/png',
        filename: 'generated-chart.png',
        kind: 'vault_image',
        ref: 'raw/captures/generated-chart.png',
        sha256: 'a'.repeat(64),
        sizeBytes: bytes.byteLength,
        source: 'gpt-image-2',
      }],
      message: 'Your progress card.',
      target: 'chat_private_image',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      loadVaultImage,
    })).resolves.toMatchObject({
      providerMessageId: 'message_private_image',
      target: 'chat_private_image',
    })

    expect(loadVaultImage).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.uploadLinqAttachment).toHaveBeenCalledWith({
      bytes,
      contentType: 'image/png',
      filename: 'generated-chart.png',
    }, expect.objectContaining({
      env: { LINQ_API_TOKEN: 'linq-token' },
    }))
    const request = runtimeMocks.sendLinqChatMessage.mock.calls.at(-1)?.[0]
    expect(request).toMatchObject({
      chatId: 'chat_private_image',
      idempotencyKey: null,
      media: [{ attachmentId: 'attachment_private_image' }],
      message: `Your progress card.\n\n${fallbackDescription}`,
      replyToMessageId: null,
    })
    expect(request?.message.match(
      /Direction context unavailable · mover sentiment is neutral\./gu,
    )).toHaveLength(1)
  })

  it.each([
    {
      input: {
        message: 'm',
        target: 'chat_oversized_private_image',
        targetKind: 'thread' as const,
      },
      operation: 'send_message',
    },
    {
      input: {
        fromPhoneNumber: '+15550000',
        message: 'm',
        target: '+15550001',
        targetKind: 'participant' as const,
      },
      operation: 'create_chat',
    },
  ])('rejects oversized final Linq text before private media work for $operation', async ({
    input,
    operation,
  }) => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const loadVaultImage = vi.fn().mockResolvedValue(bytes)

    await expect(sendLinqMessage({
      ...input,
      media: [{
        alt: 'x'.repeat(9_998),
        contentType: 'image/png',
        filename: 'oversized.png',
        kind: 'vault_image',
        ref: 'raw/captures/oversized.png',
        sha256: 'a'.repeat(64),
        sizeBytes: bytes.byteLength,
        source: 'gpt-image-2',
      }],
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      loadVaultImage,
    })).rejects.toMatchObject({
      code: 'LINQ_INVALID_INPUT',
      context: {
        operation,
        requestAttachmentMediaPartCount: 1,
        requestMediaPartCount: 1,
        requestMessageLength: 10_001,
        requestPublicUrlMediaPartCount: 0,
        retryable: false,
      },
      deliveryMayHaveSucceeded: false,
      retryable: false,
    })

    expect(loadVaultImage).not.toHaveBeenCalled()
    expect(runtimeMocks.uploadLinqAttachment).not.toHaveBeenCalled()
    expect(runtimeMocks.sendLinqChatMessage).not.toHaveBeenCalled()
    expect(runtimeMocks.createLinqChat).not.toHaveBeenCalled()
  })

  it('allows exactly 10,000 rendered Linq characters before private media work', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const loadVaultImage = vi.fn().mockResolvedValue(bytes)
    runtimeMocks.uploadLinqAttachment.mockResolvedValue({
      attachmentId: 'attachment_exact_text_limit',
    })
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'message_exact_text_limit' },
    })

    await expect(sendLinqMessage({
      media: [{
        alt: 'x'.repeat(9_997),
        contentType: 'image/png',
        filename: 'exact-limit.png',
        kind: 'vault_image',
        ref: 'raw/captures/exact-limit.png',
        sha256: 'b'.repeat(64),
        sizeBytes: bytes.byteLength,
        source: 'gpt-image-2',
      }],
      message: 'm',
      target: 'chat_exact_text_limit',
      targetKind: 'thread',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
      loadVaultImage,
    })).resolves.toMatchObject({
      providerMessageId: 'message_exact_text_limit',
    })

    expect(loadVaultImage).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.uploadLinqAttachment).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.sendLinqChatMessage.mock.calls.at(-1)?.[0]?.message)
      .toHaveLength(10_000)
  })

  it('keeps an image description exactly once when the message already contains it', async () => {
    const alternative = 'Direction context unavailable · mover sentiment is neutral.'
    runtimeMocks.sendLinqChatMessage.mockResolvedValue({
      message: { id: 'message_accessible_image' },
    })

    await sendLinqMessage({
      media: [{
        alt: alternative,
        kind: 'image',
        source: 'test',
        url: 'https://cdn.example.test/progress-card.png',
      }],
      message: `Your progress card.\n\n${alternative}`,
      target: 'chat_accessible_image',
    }, {
      env: { LINQ_API_TOKEN: 'linq-token' },
    })

    const request = runtimeMocks.sendLinqChatMessage.mock.calls.at(-1)?.[0]
    expect(request).toMatchObject({
      chatId: 'chat_accessible_image',
      media: [{ url: 'https://cdn.example.test/progress-card.png' }],
      message: `Your progress card.\n\n${alternative}`,
    })
    expect(request?.message.match(
      /Direction context unavailable · mover sentiment is neutral\./gu,
    )).toHaveLength(1)
  })

  it('uploads trusted vault-file bytes and sends the attachment without a caption', async () => {
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
      message: '',
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

  it('restarts Linq typing after the provider message settle window', async () => {
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

    await handle.refreshAfterMessage?.()
    await vi.advanceTimersByTimeAsync(999)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(44_999)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(3)
    await handle.stop()
  })

  it('cancels a pending post-message Linq typing restart on stop', async () => {
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

    await handle.refreshAfterMessage?.()
    await vi.advanceTimersByTimeAsync(500)
    await handle.stop()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
    expect(runtimeMocks.stopLinqChatTypingIndicator).toHaveBeenCalledTimes(1)
  })

  it('coalesces overlapping post-message Linq typing restarts', async () => {
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

    await handle.refreshAfterMessage?.()
    await vi.advanceTimersByTimeAsync(500)
    await handle.refreshAfterMessage?.()
    await vi.advanceTimersByTimeAsync(999)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(runtimeMocks.startLinqChatTypingIndicator).toHaveBeenCalledTimes(2)
    await handle.stop()
  })

  it('preserves a post-message Linq restart across an older in-flight refresh', async () => {
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

    await handle.refreshAfterMessage?.()
    await vi.advanceTimersByTimeAsync(500)
    resolveInFlightRefresh()
    await Promise.resolve()
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(499)
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
          threadIsDirect: true,
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

  it('does not recreate a missing Linq chat for a marked native reply', async () => {
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

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: '+15550001',
          bindingDelivery: createAssistantBindingDelivery('thread', 'missing-chat'),
          explicitTarget: null,
          idempotencyKey: 'selected-reply',
          identityId: null,
          message: 'reply to the selected message',
          nativeReplyRequested: true,
          replyToMessageId: 'selected-message-1',
        },
        {},
      ),
    ).rejects.toBe(missingChatError)

    expect(runtimeMocks.sendLinqChatMessage).toHaveBeenCalledWith(
      {
        chatId: 'missing-chat',
        idempotencyKey: 'selected-reply',
        message: 'reply to the selected message',
        nativeReplyRequested: true,
        replyToMessageId: 'selected-message-1',
      },
      {
        env: process.env,
        fetchImplementation: undefined,
      },
    )
    expect(runtimeMocks.probeLinqApi).not.toHaveBeenCalled()
    expect(runtimeMocks.createLinqChat).not.toHaveBeenCalled()
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
          threadIsDirect: true,
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
          threadIsDirect: true,
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
      homeRouteFallbackAllowed: false,
      idempotencyKey: 'idem-stale-thread',
      message: 'hello again',
      replyToMessageId: null,
      target: 'stale-chat',
      targetKind: 'thread',
    })
  })

  it('keeps an explicit direct Linq target out of current-home fallback', async () => {
    const sendLinq = vi.fn().mockResolvedValue({
      providerMessageId: 'sent-message',
      providerThreadId: 'source-chat-a',
      target: 'source-chat-a',
      targetKind: 'explicit',
    })

    await expect(
      ASSISTANT_CHANNEL_ADAPTERS.linq.send(
        {
          actorId: null,
          bindingDelivery: null,
          explicitTarget: 'source-chat-a',
          idempotencyKey: 'usage-referral-reward:referral-1',
          identityId: null,
          message: 'Mission complete.',
          replyToMessageId: null,
          threadIsDirect: true,
        },
        {
          sendLinq,
        },
      ),
    ).resolves.toMatchObject({
      providerMessageId: 'sent-message',
      providerThreadId: 'source-chat-a',
      target: 'source-chat-a',
    })

    expect(sendLinq).toHaveBeenCalledWith({
      answeredMailboxItemIds: [],
      directRecipientPhoneNumber: null,
      fromPhoneNumber: null,
      homeRouteFallbackAllowed: false,
      idempotencyKey: 'usage-referral-reward:referral-1',
      message: 'Mission complete.',
      replyToMessageId: null,
      target: 'source-chat-a',
      targetKind: 'explicit',
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
        threadIsDirect: true,
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
          threadIsDirect: true,
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
    sourceDirectory: 'raw/inbox/telegram/capture-1',
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
