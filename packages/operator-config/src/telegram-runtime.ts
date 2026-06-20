import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
  type TelegramThreadTarget,
} from '@murphai/messaging-ingress/telegram-webhook'
import {
  type AssistantMessageReaction,
} from './assistant-cli-contracts.js'

import {
  createLinkedAbortSignal,
  createTimeoutAbortController,
} from './http-retry.js'
import { normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const TELEGRAM_SEND_TIMEOUT_MS = 30_000
const TELEGRAM_TYPING_REFRESH_MS = 4_000
const TELEGRAM_DELETE_BATCH_LIMIT = 100

export type TelegramFetchResponse = {
  arrayBuffer?: () => Promise<ArrayBuffer>
  headers?: unknown
  json(): Promise<unknown>
  ok: boolean
  status: number
  text?: () => Promise<string>
}

export type TelegramFetchImplementation = (
  input: string,
  init: {
    body?: string | Blob | FormData
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<TelegramFetchResponse>

export type TelegramTypingIndicatorHandle = {
  stop(): Promise<void>
}

export type TelegramMessageReactionDelivery = {
  reaction: AssistantMessageReaction
  target: string
  targetMessageId: string
}

export function resolveTelegramBotToken(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.TELEGRAM_BOT_TOKEN)
}

export function resolveTelegramApiBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.TELEGRAM_API_BASE_URL)
}

export function resolveTelegramFileBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.TELEGRAM_FILE_BASE_URL)
}

export async function setTelegramMessageReaction(
  input: {
    reaction: AssistantMessageReaction
    target: TelegramThreadTarget | string
    targetMessageId: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: TelegramFetchImplementation
    signal?: AbortSignal
  } = {},
): Promise<TelegramMessageReactionDelivery> {
  const env = dependencies.env ?? process.env
  const token = resolveTelegramBotToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
      'Outbound Telegram delivery requires TELEGRAM_BOT_TOKEN.',
    )
  }

  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_UNAVAILABLE',
      'Outbound Telegram delivery requires fetch support in the current Node.js runtime.',
    )
  }

  let target =
    typeof input.target === 'string'
      ? parseTelegramTargetOrThrow(input.target)
      : input.target
  assertTelegramReactionTargetSupported(target)
  const targetMessageId = normalizeTelegramReactionMessageId(input.targetMessageId)
  const baseUrl = (resolveTelegramApiBaseUrl(env) ?? 'https://api.telegram.org').replace(
    /\/$/u,
    '',
  )
  const sendReaction = async () =>
    await sendTelegramBotApiRequest({
      baseUrl,
      fetchImplementation,
      method: 'POST',
      operation: 'setMessageReaction',
      payload: {
        chat_id: target.chatId,
        message_id: targetMessageId,
        reaction: [
          {
            type: 'emoji',
            emoji: resolveTelegramReactionEmoji(input.reaction),
          },
        ],
      },
      signal: dependencies.signal,
      token,
    }).catch((error) => {
      throw Object.assign(
        new VaultCliError(
          'ASSISTANT_TELEGRAM_REACTION_FAILED',
          'Telegram reaction delivery failed while calling the Bot API.',
          {
            error: describeUnknownError(error),
            target: redactTelegramTargetForDiagnostics(target),
          },
        ),
        {
          retryable: true as const,
        },
      )
    })

  let response = await sendReaction()
  let payload = await readTelegramResponsePayload(response)
  if (response.ok && isTelegramSuccessResponse(payload)) {
    return {
      reaction: input.reaction,
      target: serializeTelegramThreadTarget(target),
      targetMessageId: String(targetMessageId),
    }
  }

  let errorContext = extractTelegramErrorContext(payload)
  if (
    errorContext.migrateToChatId &&
    errorContext.migrateToChatId !== target.chatId
  ) {
    target = {
      ...target,
      chatId: errorContext.migrateToChatId,
    }
    response = await sendReaction()
    payload = await readTelegramResponsePayload(response)
    if (response.ok && isTelegramSuccessResponse(payload)) {
      return {
        reaction: input.reaction,
        target: serializeTelegramThreadTarget(target),
        targetMessageId: String(targetMessageId),
      }
    }
    errorContext = extractTelegramErrorContext(payload)
  }

  const retryable = shouldRetryTelegramReaction(
    response.status,
    errorContext.errorCode,
  )
  throw Object.assign(
    new VaultCliError(
      'ASSISTANT_TELEGRAM_REACTION_FAILED',
      formatTelegramBotApiFailureMessage({
        errorContext,
        operation: 'setMessageReaction',
        status: response.status,
      }),
      {
        errorCode: errorContext.errorCode,
        description: errorContext.description,
        migrateToChatId: redactTelegramChatIdForDiagnostics(
          errorContext.migrateToChatId,
        ),
        operation: 'setMessageReaction',
        status: response.status,
        target: redactTelegramTargetForDiagnostics(target),
      },
    ),
    retryable ? { retryable: true as const } : {},
  )
}

export async function startTelegramTypingSession(
  input: {
    target: TelegramThreadTarget | string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: TelegramFetchImplementation
    refreshMs?: number
    signal?: AbortSignal
  } = {},
): Promise<TelegramTypingIndicatorHandle> {
  const env = dependencies.env ?? process.env
  const token = resolveTelegramBotToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
      'Outbound Telegram delivery requires TELEGRAM_BOT_TOKEN.',
    )
  }

  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_UNAVAILABLE',
      'Outbound Telegram delivery requires fetch support in the current Node.js runtime.',
    )
  }

  const baseUrl = (resolveTelegramApiBaseUrl(env) ?? 'https://api.telegram.org').replace(
    /\/$/u,
    '',
  )
  let target =
    typeof input.target === 'string'
      ? parseTelegramTargetOrThrow(input.target)
      : input.target
  const linkedStopSignal = createLinkedAbortSignal(dependencies.signal)

  try {
    target = await sendTelegramTypingIndicatorOnce({
      baseUrl,
      fetchImplementation,
      signal: linkedStopSignal.signal,
      target,
      targetLabel: redactTelegramTargetForDiagnostics(target),
      token,
    })
  } catch (error) {
    linkedStopSignal.cleanup()
    throw error
  }

  let failure: unknown = null
  const running = keepTelegramTypingIndicatorAlive({
    baseUrl,
    fetchImplementation,
    refreshMs: dependencies.refreshMs ?? TELEGRAM_TYPING_REFRESH_MS,
    signal: linkedStopSignal.signal,
    target,
    token,
  }).catch((error) => {
    if (!linkedStopSignal.signal.aborted) {
      failure = error
    }
  })

  return {
    async stop() {
      linkedStopSignal.controller.abort()
      linkedStopSignal.cleanup()
      await running
      if (failure) {
        throw failure
      }
    },
  }
}

export async function deleteTelegramMessages(
  input: {
    messageIds: readonly string[]
    target: TelegramThreadTarget | string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: TelegramFetchImplementation
    signal?: AbortSignal
  } = {},
): Promise<void> {
  const env = dependencies.env ?? process.env
  const token = resolveTelegramBotToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
      'Outbound Telegram delivery requires TELEGRAM_BOT_TOKEN.',
    )
  }

  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_UNAVAILABLE',
      'Outbound Telegram delivery requires fetch support in the current Node.js runtime.',
    )
  }

  const target =
    typeof input.target === 'string'
      ? parseTelegramTargetOrThrow(input.target)
      : input.target
  const messageIds = normalizeTelegramMessageIds(input.messageIds)
  const baseUrl = (resolveTelegramApiBaseUrl(env) ?? 'https://api.telegram.org').replace(
    /\/$/u,
    '',
  )

  for (let index = 0; index < messageIds.length; index += TELEGRAM_DELETE_BATCH_LIMIT) {
    const batch = messageIds.slice(index, index + TELEGRAM_DELETE_BATCH_LIMIT)
    const request = buildTelegramDeleteRequest(target, batch)
    const response = await sendTelegramBotApiRequest({
      baseUrl,
      fetchImplementation,
      method: 'POST',
      operation: request.operation,
      payload: request.payload,
      signal: dependencies.signal,
      token,
    })
    const payload = await readTelegramResponsePayload(response)
    if (response.ok && isTelegramSuccessResponse(payload)) {
      continue
    }

    const errorContext = extractTelegramErrorContext(payload)
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_DELETE_FAILED',
      errorContext.description ??
        `Telegram Bot API ${request.operation} failed with HTTP ${response.status}.`,
      {
        errorCode: errorContext.errorCode,
        migrateToChatId: redactTelegramChatIdForDiagnostics(
          errorContext.migrateToChatId,
        ),
        messageIdCount: batch.length,
        operation: request.operation,
        status: response.status,
        target: redactTelegramTargetForDiagnostics(target),
      },
    )
  }
}

function parseTelegramTargetOrThrow(target: string): TelegramThreadTarget {
  const parsed = parseTelegramThreadTarget(target)
  if (parsed) {
    return parsed
  }

  const normalizedTarget = normalizeNullableString(target)
  if (!normalizedTarget) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
    )
  }

  throw new VaultCliError(
    'ASSISTANT_TELEGRAM_TARGET_INVALID',
    'Telegram targets must use "<chatId>", "<chatId>:topic:<messageThreadId>", "<chatId>:dm-topic:<directMessagesTopicId>", and optional ":business:<businessConnectionId>" routing segments.',
    {
      target: redactTelegramTargetForDiagnostics(normalizedTarget),
    },
  )
}

function buildTelegramTargetPayload(target: TelegramThreadTarget): Record<string, unknown> {
  return {
    business_connection_id: target.businessConnectionId ?? undefined,
    chat_id: target.chatId,
    direct_messages_topic_id: target.directMessagesTopicId ?? undefined,
    message_thread_id: target.messageThreadId ?? undefined,
  }
}

async function keepTelegramTypingIndicatorAlive(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  refreshMs: number
  signal: AbortSignal
  target: TelegramThreadTarget
  token: string
}): Promise<void> {
  let target = input.target

  while (!input.signal.aborted) {
    await waitForTelegramActivityRefresh(input.refreshMs, input.signal)
    if (input.signal.aborted) {
      return
    }

    target = await sendTelegramTypingIndicatorOnce({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      ignoreAbortedSignal: true,
      signal: input.signal,
      target,
      targetLabel: redactTelegramTargetForDiagnostics(target),
      token: input.token,
    })
  }
}

async function sendTelegramTypingIndicatorOnce(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  ignoreAbortedSignal?: boolean
  signal?: AbortSignal
  target: TelegramThreadTarget
  targetLabel: string
  token: string
}): Promise<TelegramThreadTarget> {
  let response: TelegramFetchResponse

  try {
    response = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      method: 'POST',
      operation: 'sendChatAction',
      payload: {
        ...buildTelegramTargetPayload(input.target),
        action: 'typing',
      },
      signal: input.signal,
      token: input.token,
    })
  } catch (error) {
    if (input.ignoreAbortedSignal && input.signal?.aborted) {
      return input.target
    }
    if (input.signal?.aborted) {
      throw error
    }

    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_ACTIVITY_FAILED',
      'Telegram typing indicator failed while calling the Bot API.',
      {
        error: describeUnknownError(error),
        target: input.targetLabel,
      },
    )
  }

  const payload = await readTelegramResponsePayload(response)
  if (response.ok && isTelegramSuccessResponse(payload)) {
    return input.target
  }

  const errorContext = extractTelegramErrorContext(payload)
  if (
    errorContext.migrateToChatId &&
    errorContext.migrateToChatId !== input.target.chatId
  ) {
    return {
      ...input.target,
      chatId: errorContext.migrateToChatId,
    }
  }

  throw new VaultCliError(
    'ASSISTANT_TELEGRAM_ACTIVITY_FAILED',
    errorContext.description ??
      `Telegram Bot API sendChatAction failed with HTTP ${response.status}.`,
    {
      errorCode: errorContext.errorCode,
      migrateToChatId: redactTelegramChatIdForDiagnostics(
        errorContext.migrateToChatId,
      ),
      status: response.status,
      target: input.targetLabel,
    },
  )
}

function redactTelegramTargetForDiagnostics(
  target: TelegramThreadTarget | string,
): string {
  if (typeof target !== 'string') {
    return formatRedactedTelegramTarget({
      businessConnectionId: target.businessConnectionId ?? null,
      directMessagesTopicId: target.directMessagesTopicId ?? null,
      messageThreadId: target.messageThreadId ?? null,
      valid: true,
    })
  }

  const normalized = normalizeNullableString(target)
  if (!normalized) {
    return '[redacted-telegram-target]'
  }

  const parsed = parseTelegramThreadTarget(normalized)
  if (parsed) {
    return formatRedactedTelegramTarget({
      businessConnectionId: parsed.businessConnectionId ?? null,
      directMessagesTopicId: parsed.directMessagesTopicId ?? null,
      messageThreadId: parsed.messageThreadId ?? null,
      valid: true,
    })
  }

  return formatRedactedTelegramTarget({
    businessConnectionId:
      normalized.includes(':business:') ? 'present' : null,
    directMessagesTopicId: normalized.includes(':dm-topic:') ? 1 : null,
    messageThreadId: normalized.includes(':topic:') ? 1 : null,
    valid: false,
  })
}

function formatRedactedTelegramTarget(input: {
  businessConnectionId: string | null
  directMessagesTopicId: number | null
  messageThreadId: number | null
  valid: boolean
}): string {
  const parts = [input.valid ? 'chat' : 'invalid']
  if (input.businessConnectionId) {
    parts.push('business')
  }
  if (input.messageThreadId !== null) {
    parts.push('topic')
  }
  if (input.directMessagesTopicId !== null) {
    parts.push('dm-topic')
  }
  return `[redacted-telegram-target:${parts.join('+')}]`
}

function redactTelegramChatIdForDiagnostics(value: string | null): string | null {
  return normalizeNullableString(value)
    ? '[redacted-telegram-chat-id]'
    : null
}

function buildTelegramDeleteRequest(
  target: TelegramThreadTarget,
  messageIds: readonly number[],
): {
  operation: 'deleteBusinessMessages' | 'deleteMessages'
  payload: Record<string, unknown>
} {
  if (target.businessConnectionId) {
    return {
      operation: 'deleteBusinessMessages',
      payload: {
        business_connection_id: target.businessConnectionId,
        message_ids: messageIds,
      },
    }
  }

  return {
    operation: 'deleteMessages',
    payload: {
      chat_id: target.chatId,
      message_ids: messageIds,
    },
  }
}

async function sendTelegramBotApiRequest(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  method: 'POST'
  operation:
    | 'deleteBusinessMessages'
    | 'deleteMessages'
    | 'sendChatAction'
    | 'setMessageReaction'
  payload: Record<string, unknown>
  signal?: AbortSignal
  token: string
}): Promise<TelegramFetchResponse> {
  const timeout = createTimeoutAbortController(
    input.signal,
    TELEGRAM_SEND_TIMEOUT_MS,
  )

  try {
    return await input.fetchImplementation(
      `${input.baseUrl}/bot${input.token}/${input.operation}`,
      {
        method: input.method,
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(input.payload),
        signal: timeout.signal,
      },
    )
  } finally {
    timeout.cleanup()
  }
}

async function readTelegramResponsePayload(
  response: TelegramFetchResponse,
): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function isTelegramSuccessResponse(
  value: unknown,
): value is {
  ok: true
} {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'ok' in value &&
      (value as { ok?: unknown }).ok === true,
  )
}

function extractTelegramErrorContext(value: unknown): {
  description: string | null
  errorCode: number | null
  migrateToChatId: string | null
} {
  if (!value || typeof value !== 'object') {
    return {
      description: null,
      errorCode: null,
      migrateToChatId: null,
    }
  }

  const description =
    'description' in value && typeof (value as { description?: unknown }).description === 'string'
      ? (value as { description: string }).description
      : null
  const errorCode =
    'error_code' in value && typeof (value as { error_code?: unknown }).error_code === 'number'
      ? (value as { error_code: number }).error_code
      : null

  return {
    description,
    errorCode,
    migrateToChatId: extractTelegramMigrateToChatId(value as Record<string, unknown>),
  }
}

function formatTelegramBotApiFailureMessage(input: {
  errorContext: {
    description: string | null
    errorCode: number | null
  }
  operation: string
  status: number
}): string {
  const parts = [
    `Telegram Bot API ${input.operation} failed with HTTP ${input.status}`,
  ]
  if (input.errorContext.errorCode !== null) {
    parts.push(`Telegram error_code ${input.errorContext.errorCode}`)
  }
  if (input.errorContext.description) {
    parts.push(`description: ${input.errorContext.description}`)
  }
  return `${parts.join('; ')}.`
}

function extractTelegramMigrateToChatId(
  value: Record<string, unknown>,
): string | null {
  if (!('parameters' in value) || typeof value.parameters !== 'object' || value.parameters === null) {
    return null
  }

  const migrateToChatId =
    'migrate_to_chat_id' in value.parameters
      ? (value.parameters as { migrate_to_chat_id?: unknown }).migrate_to_chat_id
      : null

  if (typeof migrateToChatId === 'string' && migrateToChatId.trim().length > 0) {
    return migrateToChatId.trim()
  }

  return typeof migrateToChatId === 'number' && Number.isSafeInteger(migrateToChatId)
    ? String(migrateToChatId)
    : null
}

function normalizeTelegramReactionMessageId(value: string): number {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_REACTION_MESSAGE_ID_INVALID',
      'Telegram reaction delivery requires a positive target message id.',
    )
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== normalized) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_REACTION_MESSAGE_ID_INVALID',
      'Telegram reaction delivery requires a positive target message id.',
    )
  }

  return parsed
}

function assertTelegramReactionTargetSupported(target: TelegramThreadTarget): void {
  if (!target.businessConnectionId) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_TELEGRAM_REACTION_TARGET_UNSUPPORTED',
    'Telegram reactions are not supported for business connection targets.',
    {
      target: redactTelegramTargetForDiagnostics(target),
    },
  )
}

function resolveTelegramReactionEmoji(reaction: AssistantMessageReaction): string {
  switch (reaction) {
    case 'heart':
      return '\u2764'
    case 'thumbs_up':
      return '\u{1F44D}'
    case 'laugh':
      return '\u{1F601}'
  }
}

function shouldRetryTelegramReaction(
  status: number,
  errorCode: number | null,
): boolean {
  return status === 429 || errorCode === 429 || status >= 500
}

async function waitForTelegramActivityRefresh(
  refreshMs: number,
  signal?: AbortSignal,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = () => {
      cleanup()
      resolve()
    }
    const timeout = setTimeout(finish, refreshMs)
    const onAbort = () => {
      clearTimeout(timeout)
      finish()
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
  })
}

function describeUnknownError(error: unknown): {
  message: string
  name: string
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: 'Error',
  }
}

function normalizeTelegramMessageIds(messageIds: readonly string[]): number[] {
  const normalized = [...new Set(messageIds.map((value) => normalizeTelegramMessageId(value)))]

  if (normalized.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_MESSAGE_ID_REQUIRED',
      'Telegram deletion requires at least one message id.',
    )
  }

  return normalized
}

function normalizeTelegramMessageId(value: string): number {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_MESSAGE_ID_INVALID',
      'Telegram message ids must be non-empty integers.',
    )
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || String(parsed) !== normalized) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_MESSAGE_ID_INVALID',
      'Telegram message ids must be non-empty integers.',
      {
        messageId: normalized,
      },
    )
  }

  return parsed
}
