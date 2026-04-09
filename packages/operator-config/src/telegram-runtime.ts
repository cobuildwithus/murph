import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
  type TelegramThreadTarget,
} from '@murphai/messaging-ingress/telegram-webhook'

import { createTimeoutAbortController } from './http-retry.js'
import { normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const TELEGRAM_SEND_TIMEOUT_MS = 30_000
const TELEGRAM_TYPING_REFRESH_MS = 4_000

export type TelegramFetchResponse = {
  json(): Promise<unknown>
  ok: boolean
  status: number
}

export type TelegramFetchImplementation = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: 'POST'
    signal?: AbortSignal
  },
) => Promise<TelegramFetchResponse>

export type TelegramTypingIndicatorHandle = {
  stop(): Promise<void>
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

export async function startTelegramTypingSession(
  input: {
    target: TelegramThreadTarget | string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: TelegramFetchImplementation
    refreshMs?: number
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
  const stopController = new AbortController()

  target = await sendTelegramTypingIndicatorOnce({
    baseUrl,
    fetchImplementation,
    target,
    targetLabel: serializeTelegramThreadTarget(target),
    token,
  })

  let failure: unknown = null
  const running = keepTelegramTypingIndicatorAlive({
    baseUrl,
    fetchImplementation,
    refreshMs: dependencies.refreshMs ?? TELEGRAM_TYPING_REFRESH_MS,
    signal: stopController.signal,
    target,
    token,
  }).catch((error) => {
    if (!stopController.signal.aborted) {
      failure = error
    }
  })

  return {
    async stop() {
      stopController.abort()
      await running
      if (failure) {
        throw failure
      }
    },
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
      target: normalizedTarget,
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
      signal: input.signal,
      target,
      targetLabel: serializeTelegramThreadTarget(target),
      token: input.token,
    })
  }
}

async function sendTelegramTypingIndicatorOnce(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
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
    if (input.signal?.aborted) {
      return input.target
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
      migrateToChatId: errorContext.migrateToChatId,
      status: response.status,
      target: input.targetLabel,
    },
  )
}

async function sendTelegramBotApiRequest(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  method: 'POST'
  operation: 'sendChatAction'
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
