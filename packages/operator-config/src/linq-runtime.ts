import { isIP } from 'node:net'

import {
  containsHttpUrlText,
  splitTrailingHttpsLink,
} from '@murphai/contracts'
import type {
  AttachmentCreateParams,
  ChatCreateParams,
  ChatCreateResponse,
  ChatSendVoicememoParams,
  ChatSendVoicememoResponse,
  MediaPart,
  MessageContent,
  PhoneNumberListResponse,
  SupportedContentType,
  TextPart,
  WebhookEventType,
  WebhookSubscriptionCreateParams,
  WebhookSubscriptionCreateResponse,
} from '@linqapp/sdk/resources'
import type {
  MessageSendParams,
  MessageSendResponse,
} from '@linqapp/sdk/resources/chats'
import type {
  MessageAddReactionParams,
  MessageAddReactionResponse,
} from '@linqapp/sdk/resources/messages'
import {
  createTimeoutAbortController,
  waitForRetryDelay,
  type ResponseHeadersLike,
} from './http-retry.js'
import {
  fetchJsonResponse,
  readJsonErrorResponse,
  requestJsonWithRetry,
} from './http-json-retry.js'
import {
  errorMessage,
  normalizeNullableString,
} from './text/shared.js'
import { normalizeAssistantResponseMediaUrl } from './assistant-cli-contracts.js'
import {
  renderMarkdownMessageText,
  sanitizeUserFacingMessageLinks,
} from './message-formatting.js'
import { VaultCliError } from './vault-cli-errors.js'
import {
  createAssistantDeliveryBlockedError,
} from './assistant/delivery-failure.js'
import {
  LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
  buildLinqIMessageAppCardUrl,
  buildLinqIMessageAppLayout,
  type AssistantResponseCard,
  type LinqIMessageAppLayout,
} from './assistant-response-cards.js'
import type {
  AssistantMessageReaction,
  AssistantProviderMessageEffect,
} from './assistant-cli-contracts.js'

const DEFAULT_LINQ_API_BASE_URL = 'https://api.linqapp.com/api/partner/v3'
const LINQ_HTTP_TIMEOUT_MS = 30_000
const LINQ_IMESSAGE_CAPABILITY_TIMEOUT_MS = 2_500
const LINQ_HTTP_MAX_ATTEMPTS = 3
const LINQ_HTTP_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000])
const LINQ_CHAT_NOT_FOUND_CODES = new Set(['CHAT_NOT_FOUND', 'chat_not_found'])
const LINQ_CHAT_NOT_FOUND_MESSAGES = new Set(['Chat not found'])
const LINQ_MAX_MESSAGE_PARTS = 100
const LINQ_MAX_MEDIA_PARTS = 40
const LINQ_SUPPORTED_ATTACHMENT_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',
  'image/webp',
  'image/x-icon',
  'video/mp4',
  'video/quicktime',
  'video/mpeg',
  'video/mpeg2',
  'video/x-m4v',
  'video/x-msvideo',
  'video/3gpp',
  'audio/mpeg',
  'audio/mp3',
  'audio/x-m4a',
  'audio/mp4',
  'audio/x-caf',
  'audio/x-wav',
  'audio/x-aiff',
  'audio/aiff',
  'audio/aac',
  'audio/midi',
  'audio/amr',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/vcard',
  'text/rtf',
  'text/csv',
  'text/html',
  'text/calendar',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/x-iwork-pages-sffpages',
  'application/x-iwork-numbers-sffnumbers',
  'application/x-iwork-keynote-sffkey',
  'application/epub+zip',
  'text/xml',
  'application/json',
  'application/zip',
  'application/x-gzip',
] as const satisfies readonly SupportedContentType[]
const LINQ_SUPPORTED_ATTACHMENT_CONTENT_TYPE_SET: ReadonlySet<string> =
  new Set(LINQ_SUPPORTED_ATTACHMENT_CONTENT_TYPES)
const LINQ_WEBHOOK_EVENT_TYPES = [
  'message.sent',
  'message.received',
  'message.read',
  'message.delivered',
  'message.failed',
  'message.edited',
  'reaction.added',
  'reaction.removed',
  'participant.added',
  'participant.removed',
  'chat.created',
  'chat.group_name_updated',
  'chat.group_icon_updated',
  'chat.group_name_update_failed',
  'chat.group_icon_update_failed',
  'chat.typing_indicator.started',
  'chat.typing_indicator.stopped',
  'phone_number.status_updated',
  'call.initiated',
  'call.ringing',
  'call.answered',
  'call.ended',
  'call.failed',
  'call.declined',
  'call.no_answer',
  'location.sharing.started',
  'location.sharing.stopped',
] as const satisfies readonly WebhookEventType[]
const LINQ_WEBHOOK_EVENT_TYPE_SET: ReadonlySet<string> =
  new Set(LINQ_WEBHOOK_EVENT_TYPES)
const LINQ_SAFE_RESPONSE_BODY_KEYS = new Set([
  'code',
  'detail',
  'details',
  'error',
  'errors',
  'message',
  'request_id',
  'status',
  'statusCode',
  'trace_id',
  'type',
])

type LinqOperation =
  | 'create_attachment_upload'
  | 'create_chat'
  | 'check_imessage_capability'
  | 'create_webhook_subscription'
  | 'delete_message'
  | 'list_phone_numbers'
  | 'mark_read'
  | 'send_imessage_app_card'
  | 'send_message'
  | 'send_voice_memo'
  | 'set_message_reaction'
  | 'typing_start'
  | 'typing_stop'

type LinqFailureKind = 'chat_not_found'

type LinqIMessageCapabilityCheckRequest = {
  address: string
  from?: string
}

type LinqIMessageAppCardRequest = {
  message: {
    preferred_service: 'iMessage'
    idempotency_key: string
    parts: [{
      type: 'imessage_app'
      app: {
        name: 'Murph'
        team_id: 'G9DJH2XUMK'
        bundle_id: 'ai.withmurph.app.messages'
        app_store_id: 6786145859
      }
      interactive: true
      url: string
      fallback_text: typeof LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT
      layout: LinqIMessageAppLayout
    }]
  }
}

type LinqJsonRequestBody =
  | LinqIMessageCapabilityCheckRequest
  | LinqIMessageAppCardRequest
  | AttachmentCreateParams
  | ChatCreateParams
  | ChatSendVoicememoParams
  | MessageAddReactionParams
  | MessageSendParams
  | WebhookSubscriptionCreateParams

type LinqSafeRequestDetails = {
  failureStage?: 'configuration' | 'http' | 'transport'
  hasIdempotencyKey?: boolean
  hasReplyToMessageId?: boolean
  linqFailureKind?: LinqFailureKind
  method?: LinqHttpMethod
  operation: LinqOperation
  path?: string
  phoneNumberCount?: number
  provider: 'linq'
  recipientCount?: number
  requestAttachmentBytes?: number
  requestAttachmentContentType?: string
  requestAttachmentHeaderCount?: number
  requestBodyShape?: string
  requestMessageLength?: number
  requestMessagePartCount?: number
  responseBodyKeyCount?: number
  responseBodyKind?: string
  responseBodyKeys?: string[]
  responseBodyStringFields?: string[]
  responseBodyStringFieldCount?: number
  responseBodyTextLength?: number
  retryable?: boolean
  status?: number
  subscribedEventCount?: number
  transportErrorCauseCount?: number
  transportErrorName?: string
  transportErrorPresent?: boolean
  transportErrorTextLength?: number
  timedOut?: boolean
  timeoutMs?: number
}

export interface LinqFetchResponse {
  arrayBuffer(): Promise<ArrayBuffer>
  headers?: ResponseHeadersLike | null
  json(): Promise<unknown>
  ok: boolean
  status: number
  text(): Promise<string>
}

export type LinqFetch = (
  input: string,
  init: {
    body?: string | Blob
    headers?: Record<string, string>
    method: string
    redirect?: RequestRedirect
    signal?: AbortSignal
  },
) => Promise<LinqFetchResponse>

export interface ProbeLinqApiResult {
  ok: boolean
  phoneNumbers: string[]
}

export interface CreateLinqChatResult {
  chatId: string | null
  messageId: string | null
  providerMessageEffects?: AssistantProviderMessageEffect[]
  providerMessageIds?: string[]
}

export type LinqMessageSendResponse = MessageSendResponse & {
  providerMessageEffects?: AssistantProviderMessageEffect[]
  providerMessageIds?: string[]
}

export interface CreateLinqWebhookSubscriptionResult {
  createdAt: string | null
  id: string | null
  isActive: boolean | null
  phoneNumbers: string[]
  signingSecret: string | null
  subscribedEvents: string[]
  targetUrl: string | null
  updatedAt: string | null
}

export interface CreateLinqAttachmentUploadResult {
  attachmentId: string
  downloadUrl: string | null
  expiresAt: string
  requiredHeaders: Record<string, string>
  uploadUrl: string
}

export interface SendLinqVoiceMemoResult {
  providerMessageId: string | null
  providerThreadId: string | null
  target: string
  voiceMemoAttachmentId: string | null
  voiceMemoUrl: string | null
}

export interface LinqMessageReactionDelivery {
  reaction: AssistantMessageReaction
  targetMessageId: string
}

export function resolveLinqApiToken(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.LINQ_API_TOKEN)
}

export function resolveLinqApiBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.LINQ_API_BASE_URL)
}

export function resolveLinqWebhookSecret(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.LINQ_WEBHOOK_SECRET)
}

export type LinqMessageMediaInput =
  | {
      attachmentId: string
    }
  | {
      url: string
    }

export async function probeLinqApi(
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<ProbeLinqApiResult> {
  const env = dependencies.env ?? process.env
  const response = await requestLinqJson<PhoneNumberListResponse>({
    details: {
      operation: 'list_phone_numbers',
      provider: 'linq',
    },
    env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'GET',
    path: '/phone_numbers',
    signal: dependencies.signal,
  })

  return {
    ok: true,
    phoneNumbers: (response.phone_numbers ?? [])
      .map((entry) => normalizeNullableString(entry.phone_number ?? null))
      .filter((value): value is string => value !== null),
  }
}

export function isLinqChatNotFoundSendMessageError(
  error: unknown,
): error is VaultCliError {
  return error instanceof VaultCliError
    && error.code === 'LINQ_API_REQUEST_FAILED'
    && error.context?.provider === 'linq'
    && error.context?.operation === 'send_message'
    && error.context?.method === 'POST'
    && error.context?.path === '/chats/[chat]/messages'
    && error.context?.status === 404
    && error.context?.failureStage === 'http'
    && error.context?.linqFailureKind === 'chat_not_found'
}

export function isDefinitiveLinqIMessageAppCardRejection(
  error: unknown,
): error is VaultCliError {
  const status = error instanceof VaultCliError ? error.context?.status : null
  return error instanceof VaultCliError
    && error.code === 'LINQ_API_REQUEST_FAILED'
    && error.context?.provider === 'linq'
    && error.context?.operation === 'send_imessage_app_card'
    && error.context?.method === 'POST'
    && error.context?.path === '/chats/[chat]/messages'
    && error.context?.failureStage === 'http'
    && error.context?.retryable === false
    && (
      status === 400
      || status === 415
      || status === 422
      || (
        status === 404
        && error.context?.linqFailureKind === 'chat_not_found'
      )
    )
}

export async function sendLinqChatMessage(
  input: {
    chatId: string
    idempotencyKey?: string | null
    media?: readonly LinqMessageMediaInput[] | null
    message: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<LinqMessageSendResponse> {
  const split = splitTrailingHttpsLink(
    sanitizeUserFacingMessageLinks(input.message),
  )
  if (!split.linkUrl) {
    return sendLinqChatMessageParts(input, dependencies)
  }

  const hasPrimaryMessage =
    split.message.trim().length > 0 || (input.media?.length ?? 0) > 0
  if (!hasPrimaryMessage) {
    if (input.nativeReplyRequested === true) {
      return sendLinqChatMessageParts(
        {
          ...input,
          message: split.linkUrl,
        },
        dependencies,
      )
    }
    return sendLinqChatRichLinkWithTextFallback(
      {
        chatId: input.chatId,
        idempotencyKey: input.idempotencyKey,
        linkUrl: split.linkUrl,
      },
      dependencies,
    )
  }

  const primaryResponse = await sendLinqChatMessageParts(
    {
      ...input,
      message: split.message,
    },
    dependencies,
  )
  const primaryMessageId = requireLinqPrimaryMessageIdForRichLink({
    messageId: primaryResponse.message?.id,
    operation: 'send_message',
  })
  let linkResponse: LinqMessageSendResponse
  try {
    linkResponse = await sendLinqChatRichLinkWithTextFallback(
      {
        chatId: input.chatId,
        idempotencyKey: buildLinqRichLinkIdempotencyKey(input.idempotencyKey),
        linkUrl: split.linkUrl,
      },
      dependencies,
    )
  } catch (error) {
    throw createLinqRichLinkPartialDeliveryFailure({
      error,
      idempotencyKey: input.idempotencyKey ?? null,
      providerMessageIds: collectLinqProviderMessageIds(
        primaryMessageId,
      ),
      providerThreadId: input.chatId,
      target: input.chatId,
      targetKind: 'thread',
    })
  }
  const providerMessageIds = collectLinqProviderMessageIds(
    primaryMessageId,
    linkResponse.message?.id,
  )
  const providerMessageEffects = [
    ...(primaryResponse.providerMessageEffects ?? []),
    ...(linkResponse.providerMessageEffects ?? []),
  ]
  if (providerMessageIds.length !== 2) {
    throw createLinqRichLinkPartialDeliveryFailure({
      error: new Error(
        'Linq did not return an identity for every accepted rich-link message.',
      ),
      idempotencyKey: input.idempotencyKey ?? null,
      providerMessageIds,
      providerThreadId: input.chatId,
      target: input.chatId,
      targetKind: 'thread',
    })
  }
  return {
    ...linkResponse,
    ...(providerMessageEffects.length > 0 ? { providerMessageEffects } : {}),
    providerMessageIds,
  }
}

async function sendLinqChatMessageParts(
  input: {
    chatId: string
    idempotencyKey?: string | null
    media?: readonly LinqMessageMediaInput[] | null
    message: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  },
): Promise<LinqMessageSendResponse> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')
  const message = normalizeNullableString(input.message) ?? ''
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const replyToMessageId = normalizeNullableString(input.replyToMessageId)
  const body = buildLinqMessageBody({
    idempotencyKey: input.idempotencyKey,
    media: input.media ?? [],
    message,
    ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
    replyToMessageId,
  })

  const response = await sendLinqChatMessageBody({
    body,
    chatId,
    idempotencyKey,
    replyToMessageId:
      input.nativeReplyRequested === true ? replyToMessageId : null,
  }, dependencies)
  const providerMessageEffects = buildLinqProviderMessageEffects({
    body,
    providerMessageId: response.message?.id,
  })
  return {
    ...response,
    ...(providerMessageEffects.length > 0 ? { providerMessageEffects } : {}),
  }
}

async function sendLinqChatRichLink(
  input: {
    chatId: string
    idempotencyKey?: string | null
    linkUrl: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  },
): Promise<LinqMessageSendResponse> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const replyToMessageId = input.nativeReplyRequested === true
    ? normalizeRequiredString(input.replyToMessageId, 'native reply target message id')
    : null

  const body = buildLinqRichLinkMessageBody({
    idempotencyKey,
    linkUrl: input.linkUrl,
    replyToMessageId,
  })
  const response = await sendLinqChatMessageBody({
    body,
    chatId,
    idempotencyKey,
    replyToMessageId,
  }, dependencies)
  const providerMessageEffects = buildLinqProviderMessageEffects({
    body,
    providerMessageId: response.message?.id,
  })
  return {
    ...response,
    ...(providerMessageEffects.length > 0 ? { providerMessageEffects } : {}),
  }
}

async function sendLinqChatRichLinkWithTextFallback(
  input: {
    chatId: string
    idempotencyKey?: string | null
    linkUrl: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  },
): Promise<LinqMessageSendResponse> {
  try {
    return await sendLinqChatRichLink(input, dependencies)
  } catch (error) {
    if (!isDefinitiveLinqRichLinkRejection(error)) {
      throw error
    }
  }

  return sendLinqChatMessageParts(
    {
      chatId: input.chatId,
      idempotencyKey: buildLinqRichLinkFallbackIdempotencyKey(input.idempotencyKey),
      message: input.linkUrl,
    },
    dependencies,
  )
}

function isDefinitiveLinqRichLinkRejection(error: unknown): boolean {
  const status = error instanceof VaultCliError ? error.context?.status : null
  return error instanceof VaultCliError
    && error.code === 'LINQ_API_REQUEST_FAILED'
    && error.context?.failureStage === 'http'
    && error.context?.retryable === false
    && (status === 400 || status === 415 || status === 422)
}

async function sendLinqChatMessageBody(
  input: {
    body: MessageSendParams
    chatId: string
    idempotencyKey: string | null
    replyToMessageId: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  },
): Promise<LinqMessageSendResponse> {
  return requestLinqJson<MessageSendResponse>({
    details: {
      hasIdempotencyKey: input.idempotencyKey !== null,
      hasReplyToMessageId: input.replyToMessageId !== null,
      operation: 'send_message',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(input.chatId)}/messages`,
    body: input.body,
    signal: dependencies.signal,
  })
}

export async function checkLinqIMessageCapability(
  input: {
    address: string
    from?: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<boolean> {
  const address = normalizeRequiredString(input.address, 'capability address')
  const from = normalizeNullableString(input.from)
  const body: LinqIMessageCapabilityCheckRequest = {
    address,
    ...(from ? { from } : {}),
  }
  const response = await requestLinqJson<unknown>({
    allowRateLimitRetries: false,
    details: {
      operation: 'check_imessage_capability',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: '/capability/check_imessage',
    body,
    signal: dependencies.signal,
    singleAttemptTimeoutMs: LINQ_IMESSAGE_CAPABILITY_TIMEOUT_MS,
  })
  return readRecord(response)?.available === true
}

export async function sendLinqIMessageAppCard(
  input: {
    card: AssistantResponseCard
    chatId: string
    idempotencyKey: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<MessageSendResponse> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')
  const idempotencyKey = normalizeRequiredString(
    input.idempotencyKey,
    'iMessage app card idempotency key',
  )
  const body: LinqIMessageAppCardRequest = {
    message: {
      preferred_service: 'iMessage',
      idempotency_key: idempotencyKey,
      parts: [{
        type: 'imessage_app',
        app: {
          name: 'Murph',
          team_id: 'G9DJH2XUMK',
          bundle_id: 'ai.withmurph.app.messages',
          app_store_id: 6786145859,
        },
        interactive: true,
        url: buildLinqIMessageAppCardUrl(input.card),
        fallback_text: LINQ_IMESSAGE_APP_CARD_FALLBACK_TEXT,
        layout: buildLinqIMessageAppLayout(input.card),
      }],
    },
  }

  return requestLinqJson<MessageSendResponse>({
    details: {
      hasIdempotencyKey: true,
      operation: 'send_imessage_app_card',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/messages`,
    body,
    signal: dependencies.signal,
  })
}

async function createLinqAttachmentUpload(
  input: {
    contentType: string
    filename: string
    sizeBytes: number
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<CreateLinqAttachmentUploadResult> {
  const contentType = normalizeRequiredString(input.contentType, 'attachment content type')
  const filename = normalizeRequiredString(input.filename, 'attachment filename')
  const sizeBytes = normalizeLinqAttachmentSizeBytes(input.sizeBytes)
  const body: AttachmentCreateParams = {
    content_type: normalizeLinqSupportedContentType(contentType),
    filename,
    size_bytes: sizeBytes,
  }
  return requestLinq<CreateLinqAttachmentUploadResult>({
    allowRateLimitRetries: false,
    details: {
      operation: 'create_attachment_upload',
      provider: 'linq',
      requestAttachmentBytes: sizeBytes,
      requestAttachmentContentType: contentType,
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: '/attachments',
    body,
    parseResponse: async (response) => {
      let payload: unknown
      try {
        payload = await response.json()
      } catch {
        throw createLinqAttachmentReservationResponseError({
          message: 'Linq attachment upload response was not valid JSON.',
          responseBodyKind: 'invalid_json',
          status: response.status,
        })
      }
      return parseLinqAttachmentUploadResponse(payload, response.status)
    },
    signal: dependencies.signal,
  })
}

async function uploadLinqAttachmentBytes(
  input: {
    bytes: Uint8Array
    requiredHeaders: Record<string, string>
    uploadUrl: string
  },
  dependencies: Pick<
    {
      fetchImplementation?: LinqFetch
      signal?: AbortSignal
    },
    'fetchImplementation' | 'signal'
  > = {},
): Promise<void> {
  const bytes = normalizeLinqAttachmentBytes(input.bytes)
  const uploadUrl = normalizeLinqAttachmentUploadUrl(input.uploadUrl)
  const headers = normalizeLinqRequiredHeaders(input.requiredHeaders)
  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw createLinqConfigurationError(
      'LINQ_UNAVAILABLE',
      'Linq access requires fetch support in the current Node.js runtime.',
      {
        operation: 'create_attachment_upload',
        provider: 'linq',
      },
    )
  }

  const details: LinqSafeRequestDetails = {
    operation: 'create_attachment_upload',
    provider: 'linq',
    requestAttachmentBytes: bytes.byteLength,
    requestAttachmentHeaderCount: Object.keys(headers).length,
  }
  const body = new Blob([copyUint8ArrayToArrayBuffer(bytes)], {
    type: headers['content-type'] ?? 'application/octet-stream',
  })
  const timeout = createTimeoutAbortController(
    dependencies.signal,
    LINQ_HTTP_TIMEOUT_MS,
  )
  let lastRetryableFailure: VaultCliError | null = null

  try {
    await requestJsonWithRetry<void, LinqFetchResponse>({
      createHttpError: async (response) => {
        const failure = await createLinqHttpError(
          response,
          details,
          'PUT',
          '[presigned-upload]',
          false,
          true,
        )
        if (isRetryableLinqRequestError(failure)) {
          lastRetryableFailure = failure
        }
        return failure
      },
      fetchResponse: async () => {
        if (timeout.signal.aborted) {
          if (dependencies.signal?.aborted) {
            dependencies.signal.throwIfAborted()
          }
          if (lastRetryableFailure) {
            throw lastRetryableFailure
          }
          timeout.signal.throwIfAborted()
        }
        try {
          return await fetchImplementation(uploadUrl, {
            body,
            headers,
            method: 'PUT',
            redirect: 'error',
            signal: timeout.signal,
          })
        } catch (error) {
          if (dependencies.signal?.aborted) {
            throw error
          }
          const failure = createLinqRequestError({
            details,
            error,
            method: 'PUT',
            path: '[presigned-upload]',
            requestOrigin: readRequestOrigin(uploadUrl),
            retryable: true,
            timedOut: timeout.timedOut(),
            timeoutMs: LINQ_HTTP_TIMEOUT_MS,
          })
          lastRetryableFailure = failure
          throw failure
        }
      },
      isRetryableError: isRetryableLinqRequestError,
      maxAttempts: LINQ_HTTP_MAX_ATTEMPTS,
      parseResponse: () => undefined,
      signal: timeout.signal,
      waitForRetryDelay: async (attempt, signal, responseHeaders) => {
        try {
          await waitForLinqRetryDelay(attempt, signal, responseHeaders)
        } catch (error) {
          if (dependencies.signal?.aborted) {
            throw error
          }
          if (timeout.timedOut() && lastRetryableFailure) {
            throw lastRetryableFailure
          }
          throw error
        }
      },
    })
  } catch (error) {
    if (!isRetryableLinqRequestError(error)) {
      throw error
    }
    throw new VaultCliError(error.code, error.message, {
      ...error.context,
      retryable: false,
    })
  } finally {
    timeout.cleanup()
  }
}

export async function uploadLinqAttachment(
  input: {
    bytes: Uint8Array
    contentType: string
    filename: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    publicFetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<{ attachmentId: string }> {
  const bytes = normalizeLinqAttachmentBytes(input.bytes)
  const upload = await createLinqAttachmentUpload(
    {
      contentType: input.contentType,
      filename: input.filename,
      sizeBytes: bytes.byteLength,
    },
    {
      env: dependencies.env,
      fetchImplementation: dependencies.fetchImplementation,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    },
  )
  await uploadLinqAttachmentBytes(
    {
      bytes,
      requiredHeaders: upload.requiredHeaders,
      uploadUrl: upload.uploadUrl,
    },
    {
      fetchImplementation:
        dependencies.publicFetchImplementation
        ?? dependencies.fetchImplementation,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    },
  )

  return { attachmentId: upload.attachmentId }
}

export async function sendLinqVoiceMemo(
  input: {
    attachmentId: string
    chatId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<SendLinqVoiceMemoResult> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')
  const attachmentId = normalizeRequiredString(input.attachmentId, 'attachment id')
  const body: ChatSendVoicememoParams = {
    attachment_id: attachmentId,
  }
  const response = await requestLinqJson<ChatSendVoicememoResponse>({
    details: {
      hasIdempotencyKey: false,
      operation: 'send_voice_memo',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/voicememo`,
    body,
    signal: dependencies.signal,
  })

  return parseLinqVoiceMemoResponse({
    attachmentId,
    chatId,
    response,
  })
}

export async function deleteLinqMessage(
  input: {
    messageId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const messageId = normalizeRequiredString(input.messageId, 'message id')

  try {
    await requestLinqNoContent({
      allowDeleteRetries: true,
      details: {
        operation: 'delete_message',
        provider: 'linq',
      },
      env: dependencies.env ?? process.env,
      fetchImplementation: dependencies.fetchImplementation,
      method: 'DELETE',
      path: `/messages/${encodeURIComponent(messageId)}`,
      signal: dependencies.signal,
    })
  } catch (error) {
    if (isLinqNotFoundError(error)) {
      return
    }

    throw error
  }
}

export async function setLinqMessageReaction(
  input: {
    reaction: AssistantMessageReaction
    targetMessageId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<LinqMessageReactionDelivery> {
  const targetMessageId = normalizeRequiredString(
    input.targetMessageId,
    'message id',
  )
  const body: MessageAddReactionParams = {
    operation: 'add',
    type: resolveLinqReactionType(input.reaction),
  }

  await requestLinqJson<MessageAddReactionResponse>({
    details: {
      hasIdempotencyKey: false,
      operation: 'set_message_reaction',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/messages/${encodeURIComponent(targetMessageId)}/reactions`,
    body,
    signal: dependencies.signal,
  })

  return {
    reaction: input.reaction,
    targetMessageId,
  }
}

export async function startLinqChatTypingIndicator(
  input: {
    chatId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')

  await requestLinqNoContent({
    details: {
      operation: 'typing_start',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/typing`,
    signal: dependencies.signal,
  })
}

export async function stopLinqChatTypingIndicator(
  input: {
    chatId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')

  await requestLinqNoContent({
    details: {
      operation: 'typing_stop',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'DELETE',
    path: `/chats/${encodeURIComponent(chatId)}/typing`,
    signal: dependencies.signal,
  })
}

export async function markLinqChatRead(
  input: {
    chatId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')

  await requestLinqNoContent({
    details: {
      operation: 'mark_read',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/read`,
    signal: dependencies.signal,
  })
}

export async function createLinqChat(
  input: {
    from: string
    idempotencyKey?: string | null
    media?: readonly LinqMessageMediaInput[] | null
    message: string
    to: readonly string[]
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<CreateLinqChatResult> {
  const split = splitTrailingHttpsLink(
    sanitizeUserFacingMessageLinks(input.message),
  )
  if (!split.linkUrl) {
    if (containsHttpUrlText(input.message)) {
      throw new VaultCliError(
        'LINQ_INVALID_INPUT',
        'A new Linq chat cannot include URL text in its first message.',
      )
    }
    return createLinqChatWithPrimaryMessage(input, dependencies)
  }

  if (split.message.trim().length === 0 && (input.media?.length ?? 0) === 0) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'A new Linq chat with a rich link must include caller-supplied text or media.',
    )
  }
  if (containsHttpUrlText(split.message)) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'A new Linq chat cannot include URL text in its first message.',
    )
  }

  const result = await createLinqChatWithPrimaryMessage(
    {
      ...input,
      message: split.message,
    },
    dependencies,
  )
  const chatId = requireLinqCreatedChatIdForRichLink(result)
  const primaryMessageId = requireLinqPrimaryMessageIdForRichLink({
    messageId: result.messageId,
    operation: 'create_chat',
  })
  let linkResponse: LinqMessageSendResponse
  try {
    linkResponse = await sendLinqChatRichLinkWithTextFallback(
      {
        chatId,
        idempotencyKey: buildLinqRichLinkIdempotencyKey(input.idempotencyKey),
        linkUrl: split.linkUrl,
      },
      dependencies,
    )
  } catch (error) {
    throw createLinqRichLinkPartialDeliveryFailure({
      error,
      idempotencyKey: input.idempotencyKey ?? null,
      providerMessageIds: collectLinqProviderMessageIds(primaryMessageId),
      providerThreadId: chatId,
      target: chatId,
      targetKind: 'thread',
    })
  }
  const linkMessageId = normalizeNullableString(linkResponse.message?.id ?? null)
  const providerMessageIds = collectLinqProviderMessageIds(
    primaryMessageId,
    linkMessageId,
  )
  const providerMessageEffects = [
    ...(result.providerMessageEffects ?? []),
    ...(linkResponse.providerMessageEffects ?? []),
  ]
  if (providerMessageIds.length !== 2) {
    throw createLinqRichLinkPartialDeliveryFailure({
      error: new Error(
        'Linq did not return an identity for every accepted rich-link message.',
      ),
      idempotencyKey: input.idempotencyKey ?? null,
      providerMessageIds,
      providerThreadId: chatId,
      target: chatId,
      targetKind: 'thread',
    })
  }
  return {
    ...result,
    messageId: linkMessageId,
    ...(providerMessageEffects.length > 0 ? { providerMessageEffects } : {}),
    providerMessageIds,
  }
}

async function createLinqChatWithPrimaryMessage(
  input: {
    from: string
    idempotencyKey?: string | null
    media?: readonly LinqMessageMediaInput[] | null
    message: string
    to: readonly string[]
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  },
): Promise<CreateLinqChatResult> {
  const from = normalizeRequiredString(input.from, 'from')
  const recipients = normalizeLinqStringList(input.to, 'recipient')
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const messageBody = buildLinqMessageBody({
    idempotencyKey: input.idempotencyKey,
    media: input.media ?? [],
    message: input.message,
  })
  const body: ChatCreateParams = {
    from,
    message: messageBody.message,
    to: recipients,
  }
  const response = await requestLinqJson<ChatCreateResponse>({
    details: {
      hasIdempotencyKey: idempotencyKey !== null,
      operation: 'create_chat',
      provider: 'linq',
      recipientCount: recipients.length,
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: '/chats',
    body,
    signal: dependencies.signal,
  })

  const messageId = normalizeNullableString(response.chat?.message?.id ?? null)
  const providerMessageEffects = buildLinqProviderMessageEffects({
    body: messageBody,
    providerMessageId: messageId,
  })
  return {
    chatId: normalizeNullableString(response.chat?.id ?? null),
    messageId,
    ...(providerMessageEffects.length > 0 ? { providerMessageEffects } : {}),
  }
}

function requireLinqCreatedChatIdForRichLink(result: CreateLinqChatResult): string {
  const chatId = normalizeNullableString(result.chatId)
  if (chatId) {
    return chatId
  }

  throw new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    'Linq chat create response was missing a chat id for the rich-link follow-up.',
    {
      failureStage: 'http',
      method: 'POST',
      operation: 'create_chat',
      path: '/chats',
      provider: 'linq',
      retryable: true,
    },
  )
}

function requireLinqPrimaryMessageIdForRichLink(input: {
  messageId: unknown
  operation: 'create_chat' | 'send_message'
}): string {
  const messageId = normalizeNullableString(
    typeof input.messageId === 'string' ? input.messageId : null,
  )
  if (messageId) {
    return messageId
  }

  throw Object.assign(
    new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq response was missing the primary message identity for a rich-link follow-up.',
      {
        failureStage: 'http',
        operation: input.operation,
        provider: 'linq',
        retryable: true,
      },
    ),
    { deliveryMayHaveSucceeded: true as const },
  )
}

function collectLinqProviderMessageIds(
  ...values: readonly unknown[]
): string[] {
  const output: string[] = []
  for (const value of values) {
    const messageId = normalizeNullableString(
      typeof value === 'string' ? value : null,
    )
    if (messageId && !output.includes(messageId)) {
      output.push(messageId)
    }
  }
  return output
}

function buildLinqProviderMessageEffects(input: {
  body: MessageSendParams
  providerMessageId: unknown
}): AssistantProviderMessageEffect[] {
  const providerMessageId = normalizeNullableString(
    typeof input.providerMessageId === 'string'
      ? input.providerMessageId
      : null,
  )
  if (!providerMessageId) {
    return []
  }

  const textParts = (input.body.message.parts ?? []).filter(
    (part): part is TextPart => part.type === 'text',
  )
  const text = textParts.length === 1 ? textParts[0]!.value : null
  return [{
    message: typeof text === 'string' && text.length > 0 ? text : null,
    providerMessageId,
  }]
}

function createLinqRichLinkPartialDeliveryFailure(input: {
  error: unknown
  idempotencyKey: string | null
  providerMessageIds: readonly string[]
  providerThreadId: string
  target: string
  targetKind: 'thread'
}): VaultCliError & {
  deliveryMayHaveSucceeded: true
  providerMessageId: string | null
  providerMessageIds: string[]
  providerThreadId: string
  target: string
  targetKind: 'thread'
} {
  const providerMessageIds = [...input.providerMessageIds]
  const failure = new VaultCliError(
    'ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY',
    'iMessage rich-link delivery could not confirm both provider messages after the primary request was accepted; deterministic recovery must reuse the same provider keys.',
    {
      idempotencyKey: input.idempotencyKey,
      providerMessageIds,
      providerThreadId: input.providerThreadId,
      target: input.target,
      targetKind: input.targetKind,
    },
  )

  return Object.assign(failure, {
    cause: input.error,
    deliveryMayHaveSucceeded: true as const,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    providerThreadId: input.providerThreadId,
    target: input.target,
    targetKind: input.targetKind,
  })
}

export async function createLinqWebhookSubscription(
  input: {
    phoneNumbers?: readonly string[] | null
    subscribedEvents: readonly string[]
    targetUrl: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<CreateLinqWebhookSubscriptionResult> {
  const phoneNumbers = input.phoneNumbers && input.phoneNumbers.length > 0
    ? normalizeLinqStringList(input.phoneNumbers, 'phone number')
    : null
  const subscribedEvents = normalizeLinqWebhookEventTypeList(input.subscribedEvents)
  const body: WebhookSubscriptionCreateParams = {
    subscribed_events: subscribedEvents,
    target_url: normalizeRequiredString(input.targetUrl, 'target url'),
  }
  if (phoneNumbers) {
    body.phone_numbers = phoneNumbers
  }
  const response = await requestLinqJson<WebhookSubscriptionCreateResponse>({
    details: {
      operation: 'create_webhook_subscription',
      phoneNumberCount: phoneNumbers?.length ?? 0,
      provider: 'linq',
      subscribedEventCount: subscribedEvents.length,
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: '/webhook-subscriptions',
    body,
    signal: dependencies.signal,
  })

  return {
    createdAt: normalizeNullableString(response.created_at ?? null),
    id: normalizeNullableString(response.id ?? null),
    isActive: typeof response.is_active === 'boolean' ? response.is_active : null,
    phoneNumbers: normalizeLinqOptionalStringList(response.phone_numbers),
    signingSecret: normalizeNullableString(response.signing_secret ?? null),
    subscribedEvents: normalizeLinqOptionalStringList(response.subscribed_events),
    targetUrl: normalizeNullableString(response.target_url ?? null),
    updatedAt: normalizeNullableString(response.updated_at ?? null),
  }
}

async function requestLinqJson<T>(input: {
  allowRateLimitRetries?: boolean
  details: LinqSafeRequestDetails
  env: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  method: LinqHttpMethod
  path: string
  body?: LinqJsonRequestBody
  signal?: AbortSignal
  singleAttemptTimeoutMs?: number
}): Promise<T> {
  return requestLinq<T>({
    ...input,
    parseResponse: async (response) => (await response.json()) as T,
  })
}

async function requestLinqNoContent(input: {
  allowDeleteRetries?: boolean
  allowRateLimitRetries?: boolean
  details: LinqSafeRequestDetails
  env: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  method: LinqHttpMethod
  path: string
  signal?: AbortSignal
}): Promise<void> {
  await requestLinq<void>({
    ...input,
    parseResponse: async () => undefined,
  })
}

type LinqHttpMethod = 'DELETE' | 'GET' | 'POST' | 'PUT'

async function requestLinq<T>(input: {
  allowDeleteRetries?: boolean
  allowRateLimitRetries?: boolean
  details: LinqSafeRequestDetails
  env: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  method: LinqHttpMethod
  path: string
  body?: LinqJsonRequestBody
  parseResponse(response: LinqFetchResponse): Promise<T>
  signal?: AbortSignal
  singleAttemptTimeoutMs?: number
}): Promise<T> {
  const request = resolveLinqRequest(input)
  const diagnosticPath = sanitizeLinqPathForDiagnostics(input.path)
  const details: LinqSafeRequestDetails = {
    ...input.details,
    ...buildLinqRequestBodyDiagnostics(input.body, request.body),
    path: diagnosticPath,
  }
  const fetchInput = {
    allowDeleteRetries: input.allowDeleteRetries === true,
    allowRateLimitRetries: input.allowRateLimitRetries !== false,
    body: request.body,
    details,
    fetchImplementation: request.fetchImplementation,
    headers: request.headers,
    method: input.method,
    path: diagnosticPath,
    signal: input.signal,
    url: request.url,
  }

  if (input.singleAttemptTimeoutMs !== undefined) {
    return fetchCompleteLinqAttempt({
      ...fetchInput,
      parseResponse: input.parseResponse,
      timeoutMs: input.singleAttemptTimeoutMs,
    })
  }

  return requestJsonWithRetry<T, LinqFetchResponse>({
    createHttpError: (response) =>
      createLinqHttpError(
        response,
        details,
        input.method,
        diagnosticPath,
        input.allowDeleteRetries === true,
        input.allowRateLimitRetries !== false,
      ),
    fetchResponse: () => fetchLinqResponse({
      ...fetchInput,
      timeoutMs: LINQ_HTTP_TIMEOUT_MS,
    }),
    isRetryableError: isRetryableLinqRequestError,
    maxAttempts: LINQ_HTTP_MAX_ATTEMPTS,
    parseResponse: input.parseResponse,
    signal: input.signal,
    waitForRetryDelay: waitForLinqRetryDelay,
  })
}

function resolveLinqRequest(input: {
  details: LinqSafeRequestDetails
  env: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  path: string
  body?: LinqJsonRequestBody
}): {
  body?: string
  fetchImplementation: LinqFetch
  headers: Record<string, string>
  url: string
} {
  const token = resolveLinqApiToken(input.env)
  if (!token) {
    throw createLinqConfigurationError(
      'LINQ_API_TOKEN_REQUIRED',
      'Linq access requires LINQ_API_TOKEN.',
      input.details,
    )
  }

  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw createLinqConfigurationError(
      'LINQ_UNAVAILABLE',
      'Linq access requires fetch support in the current Node.js runtime.',
      input.details,
    )
  }

  const baseUrl = normalizeLinqBaseUrl(
    resolveLinqApiBaseUrl(input.env) ?? DEFAULT_LINQ_API_BASE_URL,
  )
  const body = input.body ? JSON.stringify(input.body) : undefined

  return {
    body,
    fetchImplementation,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    url: buildLinqRequestUrl(baseUrl, input.path),
  }
}

function createLinqConfigurationError(
  code: 'LINQ_API_TOKEN_REQUIRED' | 'LINQ_UNAVAILABLE',
  message: string,
  details: LinqSafeRequestDetails,
): VaultCliError & { retryable: false } {
  return createAssistantDeliveryBlockedError(code, message, {
    blockKind: 'linq_configuration',
    details: {
      ...details,
      failureStage: 'configuration',
    },
    resume: 'deploy_or_config_change',
  })
}

type LinqFetchInput = {
  allowDeleteRetries: boolean
  allowRateLimitRetries: boolean
  details: LinqSafeRequestDetails
  fetchImplementation: LinqFetch
  url: string
  method: LinqHttpMethod
  path: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  timeoutMs: number
}

async function fetchLinqResponse(input: LinqFetchInput): Promise<LinqFetchResponse> {
  return fetchJsonResponse({
    body: input.body,
    createTransportError: ({ error, timedOut }) =>
      createLinqTransportError(input, error, timedOut),
    fetchImplementation: input.fetchImplementation,
    headers: input.headers,
    method: input.method,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    url: input.url,
  })
}

async function fetchCompleteLinqAttempt<T>(
  input: LinqFetchInput & {
    parseResponse(response: LinqFetchResponse): Promise<T>
  },
): Promise<T> {
  return fetchJsonResponse({
    body: input.body,
    consumeResponse: async (response) => {
      if (!response.ok) {
        throw await createLinqHttpError(
          response,
          input.details,
          input.method,
          input.path,
          input.allowDeleteRetries,
          input.allowRateLimitRetries,
        )
      }
      return input.parseResponse(response)
    },
    createTransportError: ({ error, timedOut }) =>
      createLinqTransportError(input, error, timedOut),
    fetchImplementation: input.fetchImplementation,
    headers: input.headers,
    method: input.method,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    url: input.url,
  })
}

function createLinqTransportError(
  input: LinqFetchInput,
  error: unknown,
  timedOut: boolean,
): Error {
  return readPreProviderLinqRequestError(error)
    ?? createLinqRequestError({
      details: input.details,
      error,
      requestOrigin: readRequestOrigin(input.url),
      method: input.method,
      path: input.path,
      timedOut,
      timeoutMs: input.timeoutMs,
      retryable: shouldRetryLinqTransportFailure(
        input.method,
        input.allowDeleteRetries,
        input.details.hasIdempotencyKey === true,
      ),
    })
}

async function createLinqHttpError(
  response: LinqFetchResponse,
  details: LinqSafeRequestDetails,
  method: LinqHttpMethod,
  path: string,
  allowDeleteRetries: boolean,
  allowRateLimitRetries: boolean,
): Promise<VaultCliError> {
  const { payload, rawText } = await readJsonErrorResponse(response)
  const responseDiagnostics = buildLinqErrorResponseDiagnostics(payload, rawText)
  const linqFailureKind = classifyLinqFailureKind(payload)

  return new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    `Linq request ${method} ${path} failed with HTTP ${response.status}.`,
    {
      ...details,
      ...responseDiagnostics,
      failureStage: 'http',
      ...(linqFailureKind ? { linqFailureKind } : {}),
      method,
      path,
      retryable: shouldRetryLinqHttpStatus(
        method,
        response.status,
        allowDeleteRetries,
        details.hasIdempotencyKey === true,
        allowRateLimitRetries,
      ),
      status: response.status,
    },
  )
}

function buildLinqRequestBodyDiagnostics(
  body: LinqJsonRequestBody | undefined,
  serializedBody: string | undefined,
): Partial<LinqSafeRequestDetails> {
  if (!body || !serializedBody) {
    return {}
  }

  const record = readRecord(body)
  if (!record) {
    return {}
  }

  const message = readRecord(record.message)
  const parts = Array.isArray(message?.parts) ? message.parts : []
  const requestMessageLength = parts.reduce((total, part) => {
    const record = readRecord(part)
    return total + (typeof record?.value === 'string' ? record.value.length : 0)
  }, 0)

  return {
    requestBodyShape: summarizeLinqJsonObjectShape(record),
    requestMessageLength,
    requestMessagePartCount: parts.length,
  }
}

function buildLinqErrorResponseDiagnostics(
  payload: unknown,
  rawText: string | null,
): Partial<LinqSafeRequestDetails> {
  if (rawText !== null) {
    return {
      responseBodyKind: 'text',
      responseBodyTextLength: rawText.length,
    }
  }

  if (payload === null || payload === undefined) {
    return {
      responseBodyKind: 'empty',
    }
  }

  const serialized = JSON.stringify(payload)

  if (Array.isArray(payload)) {
    return {
      responseBodyKind: 'json_array',
      responseBodyTextLength: serialized.length,
    }
  }

  if (typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const safeKeys = keys.filter(isSafeLinqResponseBodyKey)
    return {
      responseBodyKind: 'json_object',
      responseBodyKeyCount: keys.length,
      responseBodyKeys: safeKeys,
      responseBodyStringFieldCount:
        keys.filter((key) => typeof record[key] === 'string').length,
      responseBodyStringFields:
        safeKeys.filter((key) => typeof record[key] === 'string'),
      responseBodyTextLength: serialized.length,
    }
  }

  return {
    responseBodyKind: `json_${typeof payload}`,
    responseBodyTextLength: serialized.length,
  }
}

function resolveLinqReactionType(
  reaction: AssistantMessageReaction,
): MessageAddReactionParams['type'] {
  switch (reaction) {
    case 'heart':
      return 'love'
    case 'thumbs_up':
      return 'like'
    case 'laugh':
      return 'laugh'
  }
}

function createLinqRequestError(input: {
  details: LinqSafeRequestDetails
  error: unknown
  requestOrigin: string | null
  method: LinqHttpMethod
  path: string
  timedOut: boolean
  timeoutMs: number
  retryable: boolean
}): VaultCliError {
  const transportErrorDiagnostics = buildLinqTransportErrorDiagnostics(input.error)
  const attachmentReservationMayHaveSucceeded =
    readRecord(input.error)?.linqAttachmentReservationMayHaveSucceeded === true
  const retryable = attachmentReservationMayHaveSucceeded
    ? false
    : input.retryable
  const baseMessage = input.timedOut
    ? `Linq request ${input.method} ${input.path} timed out after ${input.timeoutMs}ms.`
    : `Linq request ${input.method} ${input.path} failed before a response was returned.`

  const error = new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    baseMessage,
    {
      ...input.details,
      ...transportErrorDiagnostics,
      failureStage: 'transport',
      method: input.method,
      path: input.path,
      ...(input.requestOrigin ? { requestOrigin: input.requestOrigin } : {}),
      retryable,
      timeoutMs: input.timeoutMs,
      timedOut: input.timedOut,
    },
  )

  return attachmentReservationMayHaveSucceeded
    ? Object.assign(error, {
        linqAttachmentReservationMayHaveSucceeded: true as const,
      })
    : error
}

function readPreProviderLinqRequestError(error: unknown): Error | null {
  return error instanceof Error
    && 'deliveryMayHaveSucceeded' in error
    && error.deliveryMayHaveSucceeded === false
    ? error
    : null
}

function buildLinqTransportErrorDiagnostics(
  error: unknown,
): Partial<LinqSafeRequestDetails> {
  const messages = readTransportErrorMessages(error)
  const joinedMessages = messages.join(' <- ')
  const errorName = readSafeLinqTransportErrorName(error)
  return {
    ...(messages.length > 0
      ? {
          transportErrorCauseCount: messages.length,
          transportErrorPresent: true,
          transportErrorTextLength: joinedMessages.length,
        }
      : {
          transportErrorPresent: true,
        }),
    ...(errorName ? { transportErrorName: errorName } : {}),
  }
}

function isSafeLinqResponseBodyKey(key: string): boolean {
  return LINQ_SAFE_RESPONSE_BODY_KEYS.has(key)
}

function classifyLinqFailureKind(payload: unknown): LinqFailureKind | null {
  const record = readRecord(payload)
  if (!record) {
    return null
  }

  const code = readLinqResponseStringField(record, 'code')
  if (code && LINQ_CHAT_NOT_FOUND_CODES.has(code)) {
    return 'chat_not_found'
  }

  const message =
    readLinqResponseStringField(record, 'message') ??
    readLinqResponseStringField(record, 'error') ??
    readLinqResponseStringField(record, 'detail')
  return message && LINQ_CHAT_NOT_FOUND_MESSAGES.has(message)
    ? 'chat_not_found'
    : null
}

function readLinqResponseStringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function isRetryableLinqRequestError(error: unknown): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === 'LINQ_API_REQUEST_FAILED' &&
    error.context?.retryable === true
  )
}

function isLinqNotFoundError(error: unknown): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === 'LINQ_API_REQUEST_FAILED' &&
    error.context?.status === 404
  )
}

function shouldRetryLinqHttpStatus(
  method: LinqHttpMethod,
  status: number,
  allowDeleteRetries = false,
  hasIdempotencyKey = false,
  allowRateLimitRetries = true,
): boolean {
  if (status === 429) {
    return allowRateLimitRetries && (method !== 'DELETE' || allowDeleteRetries)
  }

  return (
    (
      method === 'GET' ||
      method === 'PUT' ||
      (method === 'POST' && hasIdempotencyKey) ||
      (method === 'DELETE' && allowDeleteRetries)
    ) &&
    (status === 408 || status >= 500)
  )
}

function parseLinqAttachmentUploadResponse(
  value: unknown,
  status: number,
): CreateLinqAttachmentUploadResult {
  const record = readRecord(value)
  const attachmentId = normalizeNullableString(readStringField(record, 'attachment_id'))
  const rawUploadUrl = normalizeNullableString(readStringField(record, 'upload_url'))
  const expiresAt = normalizeNullableString(readStringField(record, 'expires_at'))
  const downloadUrl = normalizeNullableString(readStringField(record, 'download_url'))
  const httpMethod = normalizeNullableString(readStringField(record, 'http_method'))
  const rawRequiredHeaders = readStringRecord(record?.required_headers)

  if (!attachmentId || !rawUploadUrl || !expiresAt || !rawRequiredHeaders) {
    throw createLinqAttachmentReservationResponseError({
      message: 'Linq attachment upload response was missing required fields.',
      payload: value,
      status,
    })
  }
  if (httpMethod && httpMethod.toUpperCase() !== 'PUT') {
    throw createLinqAttachmentReservationResponseError({
      message: 'Linq attachment upload response returned an unsupported upload method.',
      payload: value,
      status,
    })
  }

  let requiredHeaders: Record<string, string>
  try {
    requiredHeaders = normalizeLinqRequiredHeaders(rawRequiredHeaders)
  } catch (error) {
    throw createLinqAttachmentReservationResponseError({
      message: error instanceof VaultCliError
        ? error.message
        : 'Linq attachment upload response returned invalid upload headers.',
      payload: value,
      status,
    })
  }

  let uploadUrl: string
  try {
    uploadUrl = normalizeLinqAttachmentUploadUrl(rawUploadUrl)
  } catch (error) {
    throw createLinqAttachmentReservationResponseError({
      message: error instanceof VaultCliError
        ? error.message
        : 'Linq attachment upload response returned an invalid upload URL.',
      payload: value,
      status,
    })
  }

  return {
    attachmentId,
    downloadUrl,
    expiresAt,
    requiredHeaders,
    uploadUrl,
  }
}

function createLinqAttachmentReservationResponseError(input: {
  message: string
  payload?: unknown
  responseBodyKind?: string
  status: number
}): VaultCliError & {
  deliveryMayHaveSucceeded: true
  retryable: false
} {
  return Object.assign(new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    input.message,
    {
      ...(input.responseBodyKind
        ? { responseBodyKind: input.responseBodyKind }
        : buildLinqErrorResponseDiagnostics(input.payload, null)),
      failureStage: 'http',
      method: 'POST',
      operation: 'create_attachment_upload',
      path: '/attachments',
      provider: 'linq',
      retryable: false,
      status: input.status,
    },
  ), {
    deliveryMayHaveSucceeded: true as const,
    retryable: false as const,
  })
}

function normalizeLinqAttachmentUploadUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(normalizeRequiredString(value, 'attachment upload url'))
  } catch {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment upload URL must be a valid HTTPS URL.',
    )
  }

  if (parsed.protocol !== 'https:') {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment upload URL must use HTTPS.',
    )
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment upload URL must not include credentials or fragments.',
    )
  }
  if (!isPublicLinqAttachmentUploadHost(parsed.hostname)) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment upload URL must use a public host.',
    )
  }

  return parsed.toString()
}

function isPublicLinqAttachmentUploadHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  if (
    !normalized ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return false
  }

  const ipLiteral = normalized.startsWith('[') && normalized.endsWith(']')
    ? normalized.slice(1, -1)
    : normalized
  return isIP(ipLiteral) === 0
}

function parseLinqVoiceMemoResponse(input: {
  attachmentId: string
  chatId: string
  response: ChatSendVoicememoResponse
}): SendLinqVoiceMemoResult {
  const record = readRecord(input.response)
  const voiceMemoRecord = readRecord(record?.voice_memo)
  const nestedVoiceMemo = readRecord(voiceMemoRecord?.voice_memo)
  const chatRecord = readRecord(voiceMemoRecord?.chat)
  return {
    providerMessageId: normalizeNullableString(readStringField(voiceMemoRecord, 'id')),
    providerThreadId:
      normalizeNullableString(readStringField(chatRecord, 'id')) ?? input.chatId,
    target: input.chatId,
    voiceMemoAttachmentId:
      normalizeNullableString(readStringField(nestedVoiceMemo, 'id')) ??
      input.attachmentId,
    voiceMemoUrl: normalizeNullableString(readStringField(nestedVoiceMemo, 'url')),
  }
}

function normalizeLinqAttachmentSizeBytes(value: number): number {
  const normalized = Math.trunc(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > 100 * 1024 * 1024) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment size must be a positive integer no larger than 100MB.',
    )
  }

  return normalized
}

function normalizeLinqAttachmentBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment upload bytes must be a non-empty Uint8Array.',
    )
  }

  return value
}

function copyUint8ArrayToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength)
  new Uint8Array(buffer).set(value)
  return buffer
}

function normalizeLinqRequiredHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = normalizeNullableString(key)
    const normalizedValue = normalizeNullableString(value)
    if (!normalizedKey || normalizedValue === null) {
      continue
    }
    normalized[normalizedKey] = normalizedValue
  }

  if (Object.keys(normalized).length === 0) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq attachment upload requires presigned upload headers.',
    )
  }

  return normalized
}

function shouldRetryLinqTransportFailure(
  method: LinqHttpMethod,
  allowDeleteRetries = false,
  hasIdempotencyKey = false,
): boolean {
  return method === 'GET' ||
    method === 'PUT' ||
    (method === 'POST' && hasIdempotencyKey) ||
    (method === 'DELETE' && allowDeleteRetries)
}

async function waitForLinqRetryDelay(
  attempt: number,
  signal?: AbortSignal,
  headers?: ResponseHeadersLike | null,
): Promise<void> {
  await waitForRetryDelay({
    attempt,
    headers,
    retryDelaysMs: LINQ_HTTP_RETRY_DELAYS_MS,
    signal,
  })
}

function sanitizeLinqPathForDiagnostics(path: string): string {
  return normalizeRequiredString(path, 'path')
    .replace(/\/chats\/[^/]+/gu, '/chats/[chat]')
    .replace(/\/messages\/[^/]+/gu, '/messages/[message]')
}

function readRequestOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function readTransportErrorMessages(error: unknown): string[] {
  const seenMessages = new Set<string>()
  const messages: string[] = []
  let current: unknown = error
  let depth = 0

  while (current !== null && current !== undefined && depth < 4) {
    const message = normalizeNullableString(errorMessage(current))
    if (message && !seenMessages.has(message)) {
      seenMessages.add(message)
      messages.push(message)
    }

    if (typeof current !== 'object' || current === null || !('cause' in current)) {
      break
    }

    current = (current as { cause?: unknown }).cause
    depth += 1
  }

  return messages
}

function readSafeLinqTransportErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name) ? error.name : null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readStringRecord(value: unknown): Record<string, string> | null {
  const record = readRecord(value)
  if (!record) {
    return null
  }

  const strings: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(record)) {
    if (typeof rawValue !== 'string') {
      return null
    }
    strings[key] = rawValue
  }
  return strings
}

function readStringField(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function summarizeLinqJsonObjectShape(value: Record<string, unknown>): string {
  const topLevelKeys = Object.keys(value).sort()
  const message = readRecord(value.message)
  if (!message) {
    return `object:${topLevelKeys.join(',')}`
  }

  return [
    `object:${topLevelKeys.join(',')}`,
    `message:${Object.keys(message).sort().join(',')}`,
  ].join('|')
}

function normalizeLinqBaseUrl(value: string): string {
  return normalizeRequiredString(value, 'base url').replace(/\/+$/u, '')
}

function buildLinqRequestUrl(baseUrl: string, path: string): string {
  const url = new URL(normalizeLinqBaseUrl(baseUrl))
  const basePathname = url.pathname.replace(/\/+$/u, '')
  const requestPathname = normalizeRequiredString(path, 'path').replace(/^\/+/u, '')

  url.pathname = `${basePathname}/${requestPathname}`
  url.search = ''
  url.hash = ''

  return url.toString()
}

function normalizeRequiredString(value: string | null | undefined, label: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError('LINQ_INVALID_INPUT', `Linq ${label} must be a non-empty string.`)
  }

  return normalized
}

function buildLinqRichLinkMessageBody(input: {
  idempotencyKey?: string | null
  linkUrl: string
  replyToMessageId?: string | null
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const replyToMessageId = normalizeNullableString(input.replyToMessageId)
  const message: MessageSendParams['message'] = {
    parts: [{
      type: 'link',
      value: normalizeRequiredString(input.linkUrl, 'rich link url'),
    }],
  }
  if (idempotencyKey) {
    message.idempotency_key = idempotencyKey
  }
  if (replyToMessageId) {
    message.reply_to = { message_id: replyToMessageId }
  }
  return { message }
}

function buildLinqRichLinkIdempotencyKey(value: string | null | undefined): string | null {
  const idempotencyKey = normalizeNullableString(value)
  return idempotencyKey ? `${idempotencyKey}:link` : null
}

function buildLinqRichLinkFallbackIdempotencyKey(
  value: string | null | undefined,
): string | null {
  const idempotencyKey = normalizeNullableString(value)
  return idempotencyKey ? `${idempotencyKey}:fallback` : null
}

function buildLinqMessageBody(input: {
  idempotencyKey?: string | null
  media?: readonly LinqMessageMediaInput[] | null
  message: string
  nativeReplyRequested?: true
  replyToMessageId?: string | null
}): MessageSendParams {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const replyToMessageId = input.nativeReplyRequested === true
    ? normalizeRequiredString(input.replyToMessageId, 'native reply target message id')
    : null
  const media = normalizeLinqMediaList(input.media ?? [])
  const normalizedMessage = normalizeNullableString(input.message)
  let textPart: TextPart | null = null
  if (normalizedMessage !== null) {
    const renderedText = renderMarkdownMessageText(normalizedMessage)
    textPart = {
      type: 'text',
      value: renderedText.text,
    }
    if (renderedText.decorations.length > 0) {
      textPart.text_decorations = renderedText.decorations
    }
  }
  const parts: MessageContent['parts'] = textPart ? [textPart, ...media] : media
  if (parts.length === 0) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq messages must include text or media.',
    )
  }
  if (parts.length > LINQ_MAX_MESSAGE_PARTS) {
    throw new VaultCliError('LINQ_INVALID_INPUT', `Linq message must contain at most ${LINQ_MAX_MESSAGE_PARTS} parts.`)
  }

  const message: MessageSendParams['message'] = {
    parts,
  }
  if (idempotencyKey) {
    message.idempotency_key = idempotencyKey
  }
  if (replyToMessageId) {
    message.reply_to = { message_id: replyToMessageId }
  }
  return { message }
}

function normalizeLinqMediaList(
  values: readonly LinqMessageMediaInput[],
): MediaPart[] {
  const parts = values
    .map((value) => {
      if ('attachmentId' in value) {
        return {
          attachment_id: normalizeRequiredString(value.attachmentId, 'attachment id'),
          type: 'media' as const,
        }
      }

      return {
        type: 'media' as const,
        url: normalizeLinqHttpsUrl(value.url),
      }
    })
    .filter((value, index, array) => {
      const identity = 'attachment_id' in value
        ? `attachment:${value.attachment_id}`
        : `url:${value.url}`
      return array.findIndex((candidate) => (
        'attachment_id' in candidate
          ? `attachment:${candidate.attachment_id}`
          : `url:${candidate.url}`
      ) === identity) === index
    })

  if (parts.length > LINQ_MAX_MEDIA_PARTS) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      `Linq messages may contain at most ${LINQ_MAX_MEDIA_PARTS} media parts.`,
    )
  }

  return parts
}

function normalizeLinqSupportedContentType(value: string): SupportedContentType {
  const normalized = normalizeRequiredString(value, 'attachment content type').toLowerCase()
  if (isLinqSupportedContentType(normalized)) {
    return normalized
  }

  throw new VaultCliError(
    'LINQ_INVALID_INPUT',
    'Linq attachment content type is not supported by the Linq SDK contract.',
  )
}

function isLinqSupportedContentType(value: string): value is SupportedContentType {
  return LINQ_SUPPORTED_ATTACHMENT_CONTENT_TYPE_SET.has(value)
}

function normalizeLinqWebhookEventTypeList(values: readonly string[]): WebhookEventType[] {
  return normalizeLinqStringList(values, 'subscribed event').map((value) => {
    if (isLinqWebhookEventType(value)) {
      return value
    }

    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      'Linq subscribed event is not supported by the Linq SDK contract.',
    )
  })
}

function isLinqWebhookEventType(value: string): value is WebhookEventType {
  return LINQ_WEBHOOK_EVENT_TYPE_SET.has(value)
}

function normalizeLinqHttpsUrl(value: string): string {
  const normalized = normalizeRequiredString(value, 'media url')
  try {
    return normalizeAssistantResponseMediaUrl(normalized)
  } catch (error) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      error instanceof Error ? error.message.replace(/^Assistant response media/u, 'Linq media') : 'Linq media URLs must be valid public image URLs.',
    )
  }
}

function normalizeLinqStringList(
  values: readonly string[],
  label: string,
): string[] {
  const normalizedValues = values
    .map((value) => normalizeRequiredString(value, label))
    .filter((value, index, array) => array.indexOf(value) === index)

  if (normalizedValues.length === 0) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      `Linq ${label} list must contain at least one non-empty value.`,
    )
  }

  return normalizedValues
}

function normalizeLinqOptionalStringList(values: readonly unknown[] | null | undefined): string[] {
  return (values ?? [])
    .map((value) => normalizeNullableString(typeof value === 'string' ? value : null))
    .filter((value): value is string => value !== null)
}
