import { isIP } from 'node:net'

import type {
  LinqCreateChatResponse,
  LinqCreateWebhookSubscriptionResponse,
  LinqListPhoneNumbersResponse,
  LinqSendMessageResponse,
} from '@murphai/messaging-ingress/linq-webhook'
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
  type MessageTextDecoration,
} from './message-formatting.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_LINQ_API_BASE_URL = 'https://api.linqapp.com/api/partner/v3'
const LINQ_HTTP_TIMEOUT_MS = 30_000
const LINQ_HTTP_MAX_ATTEMPTS = 3
const LINQ_HTTP_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000])
const LINQ_CHAT_NOT_FOUND_CODES = new Set(['CHAT_NOT_FOUND', 'chat_not_found'])
const LINQ_CHAT_NOT_FOUND_MESSAGES = new Set(['Chat not found'])
const LINQ_MAX_MESSAGE_PARTS = 100
const LINQ_MAX_URL_MEDIA_PARTS = 40
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
  | 'create_webhook_subscription'
  | 'delete_message'
  | 'list_phone_numbers'
  | 'mark_read'
  | 'send_message'
  | 'send_voice_memo'
  | 'typing_start'
  | 'typing_stop'

type LinqFailureKind = 'chat_not_found'

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

export function resolveLinqApiToken(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.LINQ_API_TOKEN)
}

export function resolveLinqApiBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.LINQ_API_BASE_URL)
}

export function resolveLinqWebhookSecret(env: NodeJS.ProcessEnv): string | null {
  return normalizeNullableString(env.LINQ_WEBHOOK_SECRET)
}

export interface LinqMessageMediaInput {
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
  const response = await requestLinqJson<LinqListPhoneNumbersResponse>({
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

export async function sendLinqChatMessage(
  input: {
    chatId: string
    idempotencyKey?: string | null
    media?: readonly LinqMessageMediaInput[] | null
    message: string
    replyToMessageId?: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<LinqSendMessageResponse> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')
  const message = normalizeRequiredString(input.message, 'message')
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const replyToMessageId = normalizeNullableString(input.replyToMessageId)

  return requestLinqJson<LinqSendMessageResponse>({
    details: {
      hasIdempotencyKey: idempotencyKey !== null,
      hasReplyToMessageId: replyToMessageId !== null,
      operation: 'send_message',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/messages`,
    body: buildLinqMessageBody({
      idempotencyKey: input.idempotencyKey,
      media: input.media ?? [],
      message,
      replyToMessageId,
    }),
    signal: dependencies.signal,
  })
}

export async function createLinqAttachmentUpload(
  input: {
    contentType: 'audio/mpeg'
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
  const response = await requestLinqJson<unknown>({
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
    body: {
      content_type: contentType,
      filename,
      size_bytes: sizeBytes,
    },
    signal: dependencies.signal,
  })

  return parseLinqAttachmentUploadResponse(response)
}

export async function uploadLinqAttachmentBytes(
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

  const timeout = createTimeoutAbortController(
    dependencies.signal,
    LINQ_HTTP_TIMEOUT_MS,
  )
  let response: LinqFetchResponse
  try {
    response = await fetchImplementation(uploadUrl, {
      body: new Blob([copyUint8ArrayToArrayBuffer(bytes)], {
        type: headers['content-type'] ?? 'application/octet-stream',
      }),
      headers,
      method: 'PUT',
      signal: timeout.signal,
    })
  } catch (error) {
    if (dependencies.signal?.aborted) {
      throw error
    }
    throw createLinqRequestError({
      details: {
        operation: 'create_attachment_upload',
        provider: 'linq',
        requestAttachmentBytes: bytes.byteLength,
        requestAttachmentHeaderCount: Object.keys(headers).length,
      },
      error,
      method: 'PUT',
      path: '[presigned-upload]',
      requestOrigin: readRequestOrigin(uploadUrl),
      retryable: false,
      timedOut: timeout.timedOut(),
    })
  } finally {
    timeout.cleanup()
  }

  if (!response.ok) {
    throw await createLinqHttpError(
      response,
      {
        operation: 'create_attachment_upload',
        provider: 'linq',
        requestAttachmentBytes: bytes.byteLength,
        requestAttachmentHeaderCount: Object.keys(headers).length,
      },
      'PUT',
      '[presigned-upload]',
      false,
      false,
    )
  }
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
  const response = await requestLinqJson<unknown>({
    details: {
      hasIdempotencyKey: false,
      operation: 'send_voice_memo',
      provider: 'linq',
    },
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/voicememo`,
    body: {
      attachment_id: attachmentId,
    },
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
  const from = normalizeRequiredString(input.from, 'from')
  const recipients = normalizeLinqStringList(input.to, 'recipient')
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const response = await requestLinqJson<LinqCreateChatResponse>({
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
    body: {
      from,
      message: buildLinqMessageBody({
        idempotencyKey: input.idempotencyKey,
        media: input.media ?? [],
        message: input.message,
      }).message,
      to: recipients,
    },
    signal: dependencies.signal,
  })

  return {
    chatId: normalizeNullableString(response.chat?.id ?? null),
    messageId: normalizeNullableString(response.chat?.message?.id ?? null),
  }
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
  const subscribedEvents = normalizeLinqStringList(input.subscribedEvents, 'subscribed event')
  const response = await requestLinqJson<LinqCreateWebhookSubscriptionResponse>({
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
    body: {
      ...(phoneNumbers
        ? {
            phone_numbers: phoneNumbers,
          }
        : {}),
      subscribed_events: subscribedEvents,
      target_url: normalizeRequiredString(input.targetUrl, 'target url'),
    },
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
  body?: Record<string, unknown>
  signal?: AbortSignal
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
  body?: Record<string, unknown>
  parseResponse(response: LinqFetchResponse): Promise<T>
  signal?: AbortSignal
}): Promise<T> {
  const request = resolveLinqRequest(input)
  const diagnosticPath = sanitizeLinqPathForDiagnostics(input.path)
  const details: LinqSafeRequestDetails = {
    ...input.details,
    ...buildLinqRequestBodyDiagnostics(input.body, request.body),
    path: diagnosticPath,
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
    fetchResponse: () =>
      fetchLinqResponse({
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
  body?: Record<string, unknown>
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
): VaultCliError {
  return new VaultCliError(code, message, {
    ...details,
    failureStage: 'configuration',
  })
}

async function fetchLinqResponse(input: {
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
}): Promise<LinqFetchResponse> {
  return fetchJsonResponse({
    body: input.body,
    createTransportError: ({ error, timedOut }) =>
      createLinqRequestError({
        details: input.details,
        error,
        requestOrigin: readRequestOrigin(input.url),
        method: input.method,
        path: input.path,
        timedOut,
        retryable: shouldRetryLinqTransportFailure(
          input.method,
          input.allowDeleteRetries,
          input.details.hasIdempotencyKey === true,
        ),
      }),
    fetchImplementation: input.fetchImplementation,
    headers: input.headers,
    method: input.method,
    signal: input.signal,
    timeoutMs: LINQ_HTTP_TIMEOUT_MS,
    url: input.url,
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
  body: Record<string, unknown> | undefined,
  serializedBody: string | undefined,
): Partial<LinqSafeRequestDetails> {
  if (!body || !serializedBody) {
    return {}
  }

  const message = readRecord(body.message)
  const parts = Array.isArray(message?.parts) ? message.parts : []
  const requestMessageLength = parts.reduce((total, part) => {
    const record = readRecord(part)
    return total + (typeof record?.value === 'string' ? record.value.length : 0)
  }, 0)

  return {
    requestBodyShape: summarizeLinqJsonObjectShape(body),
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

function createLinqRequestError(input: {
  details: LinqSafeRequestDetails
  error: unknown
  requestOrigin: string | null
  method: LinqHttpMethod
  path: string
  timedOut: boolean
  retryable: boolean
}): VaultCliError {
  const transportErrorDiagnostics = buildLinqTransportErrorDiagnostics(input.error)
  const baseMessage = input.timedOut
    ? `Linq request ${input.method} ${input.path} timed out after ${LINQ_HTTP_TIMEOUT_MS}ms.`
    : `Linq request ${input.method} ${input.path} failed before a response was returned.`

  return new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    baseMessage,
    {
      ...input.details,
      ...transportErrorDiagnostics,
      failureStage: 'transport',
      method: input.method,
      path: input.path,
      ...(input.requestOrigin ? { requestOrigin: input.requestOrigin } : {}),
      retryable: input.retryable,
      timeoutMs: LINQ_HTTP_TIMEOUT_MS,
      timedOut: input.timedOut,
    },
  )
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
      (method === 'POST' && hasIdempotencyKey) ||
      (method === 'DELETE' && allowDeleteRetries)
    ) &&
    (status === 408 || status >= 500)
  )
}

function parseLinqAttachmentUploadResponse(
  value: unknown,
): CreateLinqAttachmentUploadResult {
  const record = readRecord(value)
  const attachmentId = normalizeNullableString(readStringField(record, 'attachment_id'))
  const rawUploadUrl = normalizeNullableString(readStringField(record, 'upload_url'))
  const expiresAt = normalizeNullableString(readStringField(record, 'expires_at'))
  const downloadUrl = normalizeNullableString(readStringField(record, 'download_url'))
  const httpMethod = normalizeNullableString(readStringField(record, 'http_method'))
  const requiredHeaders = readStringRecord(record?.required_headers)

  if (!attachmentId || !rawUploadUrl || !expiresAt || !requiredHeaders) {
    throw new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq attachment upload response was missing required fields.',
      {
        failureStage: 'http',
        operation: 'create_attachment_upload',
        provider: 'linq',
        responseBodyKind: record ? 'json_object' : 'unknown',
        responseBodyKeys: record ? Object.keys(record).sort() : [],
        retryable: false,
      },
    )
  }
  if (httpMethod && httpMethod.toUpperCase() !== 'PUT') {
    throw new VaultCliError(
      'LINQ_API_REQUEST_FAILED',
      'Linq attachment upload response returned an unsupported upload method.',
      {
        failureStage: 'http',
        operation: 'create_attachment_upload',
        provider: 'linq',
        retryable: false,
      },
    )
  }

  const uploadUrl = normalizeLinqAttachmentUploadUrl(rawUploadUrl)

  return {
    attachmentId,
    downloadUrl,
    expiresAt,
    requiredHeaders,
    uploadUrl,
  }
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
  response: unknown
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

function buildLinqMessageBody(input: {
  idempotencyKey?: string | null
  media?: readonly LinqMessageMediaInput[] | null
  message: string
  replyToMessageId?: string | null
}): {
  message: {
    idempotency_key?: string
    parts: Array<
      | {
          text_decorations?: MessageTextDecoration[]
          type: 'text'
          value: string
        }
      | {
          type: 'media'
          url: string
        }
    >
    reply_to?: {
      message_id: string
    }
  }
} {
  const idempotencyKey = normalizeNullableString(input.idempotencyKey)
  const replyToMessageId = normalizeNullableString(input.replyToMessageId)
  const media = normalizeLinqMediaList(input.media ?? [])
  const renderedText = renderMarkdownMessageText(
    normalizeRequiredString(input.message, 'message'),
  )
  const textPart: {
    text_decorations?: MessageTextDecoration[]
    type: 'text'
    value: string
  } = {
    ...(renderedText.decorations.length > 0
      ? {
          text_decorations: renderedText.decorations,
        }
      : {}),
    type: 'text' as const,
    value: renderedText.text,
  }
  const parts = [textPart, ...media]
  if (parts.length > LINQ_MAX_MESSAGE_PARTS) {
    throw new VaultCliError('LINQ_INVALID_INPUT', `Linq message must contain at most ${LINQ_MAX_MESSAGE_PARTS} parts.`)
  }

  return {
    message: {
      parts,
      ...(idempotencyKey
        ? {
            idempotency_key: idempotencyKey,
          }
        : {}),
      ...(replyToMessageId
        ? {
            reply_to: {
              message_id: replyToMessageId,
            },
          }
        : {}),
    },
  }
}

function normalizeLinqMediaList(values: readonly LinqMessageMediaInput[]): Array<{
  type: 'media'
  url: string
}> {
  const parts = values
    .map((value) => ({
      type: 'media' as const,
      url: normalizeLinqHttpsUrl(value.url),
    }))
    .filter((value, index, array) =>
      array.findIndex((candidate) => candidate.url === value.url) === index,
    )

  if (parts.length > LINQ_MAX_URL_MEDIA_PARTS) {
    throw new VaultCliError(
      'LINQ_INVALID_INPUT',
      `Linq messages may contain at most ${LINQ_MAX_URL_MEDIA_PARTS} URL media parts.`,
    )
  }

  return parts
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
