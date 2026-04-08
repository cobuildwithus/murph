import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AgentmailApiClient,
  AgentmailFetch,
} from '@murphai/operator-config/agentmail-runtime'
import type { InboxShowResult } from '@murphai/operator-config/inbox-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const runtimeMocks = vi.hoisted(() => ({
  createAgentmailApiClient: vi.fn(),
  ensureImessageMessagesDbReadable: vi.fn(),
  mapImessageMessagesDbRuntimeError: vi.fn(),
  sendLinqChatMessage: vi.fn(),
  startLinqChatTypingIndicator: vi.fn(),
  stopLinqChatTypingIndicator: vi.fn(),
}))

vi.mock('@murphai/operator-config/agentmail-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@murphai/operator-config/agentmail-runtime')>()
  return {
    ...actual,
    createAgentmailApiClient: runtimeMocks.createAgentmailApiClient,
  }
})

vi.mock('@murphai/operator-config/imessage-readiness', () => ({
  ensureImessageMessagesDbReadable:
    runtimeMocks.ensureImessageMessagesDbReadable,
  mapImessageMessagesDbRuntimeError:
    runtimeMocks.mapImessageMessagesDbRuntimeError,
}))

vi.mock('@murphai/operator-config/linq-runtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@murphai/operator-config/linq-runtime')>()
  return {
    ...actual,
    sendLinqChatMessage: runtimeMocks.sendLinqChatMessage,
    startLinqChatTypingIndicator: runtimeMocks.startLinqChatTypingIndicator,
    stopLinqChatTypingIndicator: runtimeMocks.stopLinqChatTypingIndicator,
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
  resolveImessageDeliveryCandidates,
} from '../src/assistant/channels/registry.ts'
import {
  sendEmailMessage,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from '../src/assistant/channels/runtime.ts'

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  runtimeMocks.createAgentmailApiClient.mockReset()
  runtimeMocks.ensureImessageMessagesDbReadable.mockReset()
  runtimeMocks.mapImessageMessagesDbRuntimeError.mockReset()
  runtimeMocks.sendLinqChatMessage.mockReset()
  runtimeMocks.startLinqChatTypingIndicator.mockReset()
  runtimeMocks.stopLinqChatTypingIndicator.mockReset()
  runtimeMocks.mapImessageMessagesDbRuntimeError.mockReturnValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('assistant channels runtime seam', () => {
  it('lists adapters, resolves fallback bindings, and classifies user-facing channels', () => {
    expect(listAssistantChannelNames()).toEqual([
      'imessage',
      'telegram',
      'linq',
      'email',
    ])
    expect(listAssistantChannelAdapters().map((adapter) => adapter.channel)).toEqual(
      listAssistantChannelNames(),
    )
    expect(getAssistantChannelAdapter(undefined)).toBeNull()
    expect(getAssistantChannelAdapter('unknown')).toBeNull()
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

    expect(
      resolveImessageDeliveryCandidates({
        bindingDelivery: createAssistantBindingDelivery('participant', 'bound-target'),
        explicitTarget: '  explicit-target  ',
      }),
    ).toEqual([
      {
        kind: 'explicit',
        target: 'explicit-target',
      },
    ])

    expect(isAssistantUserFacingChannel(' telegram ')).toBe(true)
    expect(isAssistantUserFacingChannel('LOCAL')).toBe(false)
    expect(isAssistantUserFacingChannel('null')).toBe(false)
    expect(isAssistantUserFacingChannel(null)).toBe(false)
  })

  it('reports channel readiness and auto-reply support from descriptors', () => {
    expect(ASSISTANT_CHANNEL_ADAPTERS.imessage.isReadyForSetup({})).toBe(true)
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
    expect(ASSISTANT_CHANNEL_ADAPTERS.imessage.canAutoReply(directCapture)).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply(directCapture)).toBeNull()
    expect(ASSISTANT_CHANNEL_ADAPTERS.telegram.canAutoReply(groupCapture)).toContain(
      'direct chats',
    )
    expect(ASSISTANT_CHANNEL_ADAPTERS.linq.canAutoReply(groupCapture)).toContain(
      'direct chats',
    )
    expect(ASSISTANT_CHANNEL_ADAPTERS.email.canAutoReply(groupCapture)).toContain(
      'direct threads',
    )
  })

  it('sends iMessage through the sdk and maps runtime readiness failures', async () => {
    const close = vi.fn()
    const send = vi.fn().mockResolvedValue(undefined)

    await sendImessageMessage(
      {
        message: 'hello from murph',
        target: '+15551230000',
      },
      {
        createSdk: () => ({
          close,
          send,
        }),
      },
    )

    expect(runtimeMocks.ensureImessageMessagesDbReadable).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('+15551230000', 'hello from murph')
    expect(close).toHaveBeenCalledOnce()

    runtimeMocks.ensureImessageMessagesDbReadable.mockRejectedValueOnce(
      new Error('disk access denied'),
    )
    runtimeMocks.mapImessageMessagesDbRuntimeError.mockReturnValueOnce(
      new VaultCliError(
        'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
        'blocked by permissions',
      ),
    )

    await expect(
      sendImessageMessage(
        {
          message: 'blocked',
          target: '+15550000000',
        },
        {
          createSdk: () => ({
            send,
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
      message: 'blocked by permissions',
    })

    await expect(
      sendImessageMessage(
        {
          message: 'missing send',
          target: '+15554443333',
        },
        {
          createSdk: () => ({
            close,
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_IMESSAGE_UNAVAILABLE',
    })
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
      providerMessageId: '1002',
      target: '456',
    })

    expect(fetchImplementation).toHaveBeenCalledTimes(4)
    expect(readJsonBody(fetchImplementation.mock.calls[0][1]?.body)).toMatchObject({
      chat_id: '123',
      reply_to_message_id: 42,
      text: 'a'.repeat(4096),
    })
    expect(readJsonBody(fetchImplementation.mock.calls[1][1]?.body)).toMatchObject({
      chat_id: '456',
      reply_to_message_id: 42,
      text: 'a'.repeat(4096),
    })
    expect(readJsonBody(fetchImplementation.mock.calls[3][1]?.body)).toMatchObject({
      chat_id: '456',
      text: 'b',
    })
    expect(readJsonBody(fetchImplementation.mock.calls[3][1]?.body)).not.toHaveProperty(
      'reply_to_message_id',
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

function createQueuedFetch(
  queue: Array<
    | Error
    | {
        json: () => Promise<unknown>
        ok: boolean
        status: number
      }
  >,
) {
  return vi.fn(
    async (
      _input: string,
      _init: {
        body?: string
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

function readJsonBody(body: string | undefined): Record<string, unknown> {
  if (!body) {
    return {}
  }

  const parsed = JSON.parse(body) as unknown
  return parsed && typeof parsed === 'object'
    ? (parsed as Record<string, unknown>)
    : {}
}
