import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
  type TelegramThreadTarget,
} from '@murphai/messaging-ingress/telegram-webhook'
import {
  createAgentmailApiClient,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
} from '@murphai/operator-config/agentmail-runtime'
import {
  resolveLinqApiToken,
  sendLinqChatMessage,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
} from '@murphai/operator-config/linq-runtime'
import {
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  type TelegramFetchImplementation,
  type TelegramFetchResponse,
  startTelegramTypingSession,
} from '@murphai/operator-config/telegram-runtime'
import { createTimeoutAbortController } from '@murphai/operator-config/http-retry'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  AssistantChannelActivityHandle,
  AssistantDeliveryCandidate,
  EmailRuntimeDependencies,
  LinqRuntimeDependencies,
  TelegramRuntimeDependencies,
} from './types.js'
import { normalizeOptionalText } from './helpers.js'

const TELEGRAM_MAX_TEXT_LENGTH = 4096
const TELEGRAM_MAX_DELIVERY_ATTEMPTS = 3
const TELEGRAM_SEND_TIMEOUT_MS = 30_000

type TelegramParsedTarget = TelegramThreadTarget

type TelegramSendAttemptResult =
  | {
      failure: VaultCliError
      kind: 'request-error'
    }
  | {
      kind: 'response'
      payload: unknown
      response: TelegramFetchResponse
    }

type TelegramSendAttemptOutcome =
  | {
      kind: 'delivered'
      providerMessageId: string | null
    }
  | {
      failure: VaultCliError
      kind: 'failed'
    }
  | {
      kind: 'migrated'
      target: TelegramParsedTarget
      targetLabel: string
    }
  | {
      failure: VaultCliError
      kind: 'retry'
      retryAfterSeconds: number | null
    }

export async function sendTelegramMessage(
  input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{ providerMessageId: string | null; target: string }> {
  return sendTelegramMessageDetailed(input, dependencies)
}

export async function sendLinqMessage(
  input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<{ providerMessageId: string | null }> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound Linq delivery requires LINQ_API_TOKEN.',
    )
  }

  const delivered = await sendLinqChatMessage(
    {
      chatId: input.target,
      idempotencyKey: input.idempotencyKey ?? null,
      message: input.message,
      replyToMessageId: input.replyToMessageId ?? null,
    },
    {
      env,
      fetchImplementation: dependencies.fetchImplementation,
    },
  )
  return {
    providerMessageId: normalizeOptionalText(delivered.message?.id ?? null),
  }
}

export async function startTelegramTypingIndicator(
  input: {
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<AssistantChannelActivityHandle> {
  return startTelegramTypingSession(
    {
      target: input.target,
    },
    {
      env: dependencies.env,
      fetchImplementation: dependencies.fetchImplementation,
    },
  )
}

export async function startLinqTypingIndicator(
  input: {
    target: string
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<AssistantChannelActivityHandle> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound Linq delivery requires LINQ_API_TOKEN.',
    )
  }

  const chatId = input.target.trim()
  if (chatId.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'Linq delivery requires an explicit chat id or a stored thread binding.',
    )
  }

  await startLinqChatTypingIndicator(
    {
      chatId,
    },
    {
      env,
      fetchImplementation: dependencies.fetchImplementation,
    },
  )

  let stopped = false
  return {
    async stop() {
      if (stopped) {
        return
      }

      stopped = true
      await stopLinqChatTypingIndicator(
        {
          chatId,
        },
        {
          env,
          fetchImplementation: dependencies.fetchImplementation,
        },
      )
    },
  }
}

export async function sendEmailMessage(
  input: {
    idempotencyKey?: string | null
    identityId: string
    message: string
    replyToMessageId?: string | null
    target: string
    targetKind: AssistantDeliveryCandidate['kind']
    subject?: string | null
  },
  dependencies: EmailRuntimeDependencies = {},
): Promise<{ providerMessageId: string | null; providerThreadId: string | null }> {
  const identityId = input.identityId.trim()
  if (identityId.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
      'Default email delivery requires an AgentMail inbox identity.',
    )
  }

  const target = input.target.trim()
  if (target.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'Email delivery requires a non-empty recipient or thread target.',
    )
  }

  const env = dependencies.env ?? process.env
  const apiKey = resolveAgentmailApiKey(env)
  if (!apiKey) {
    throw new VaultCliError(
      'ASSISTANT_EMAIL_API_KEY_REQUIRED',
      'Outbound email delivery requires AGENTMAIL_API_KEY.',
    )
  }

  const client = createAgentmailApiClient(apiKey, {
    baseUrl: resolveAgentmailBaseUrl(env) ?? undefined,
    fetchImplementation: dependencies.fetchImplementation,
  })

  if (input.targetKind === 'thread') {
    const thread = await client.getThread(target)
    const messageId = resolveAgentmailThreadReplyMessageId(thread)
    if (!messageId) {
      throw new VaultCliError(
        'ASSISTANT_EMAIL_THREAD_REPLY_UNAVAILABLE',
        'Email thread delivery requires a resolvable parent AgentMail message.',
        { threadId: target },
      )
    }

    const delivered = await client.replyToMessage({
      inboxId: identityId,
      messageId: normalizeOptionalText(input.replyToMessageId) ?? messageId,
      text: input.message,
      replyAll: true,
    })
    return {
      providerMessageId: normalizeOptionalText(delivered.message_id),
      providerThreadId: normalizeOptionalText(delivered.thread_id),
    }
  }

  const delivered = await client.sendMessage({
    inboxId: identityId,
    to: target,
    subject: input.subject?.trim() ? input.subject.trim() : 'Murph update',
    text: input.message,
  })

  return {
    providerMessageId: normalizeOptionalText(delivered.message_id),
    providerThreadId: normalizeOptionalText(delivered.thread_id),
  }
}

async function sendTelegramMessageDetailed(
  input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{ providerMessageId: string | null; target: string }> {
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
  let target = parseTelegramTargetOrThrow(input.target)
  let targetLabel = serializeTelegramThreadTarget(target)
  let lastProviderMessageId: string | null = null
  let replyToMessageId = normalizeTelegramReplyToMessageId(input.replyToMessageId)

  const chunks = splitTelegramMessageText(input.message)
  for (const chunk of chunks) {
    const delivered = await sendTelegramTextChunk({
      baseUrl,
      fetchImplementation,
      replyToMessageId,
      target,
      targetLabel,
      text: chunk,
      token,
    })
    target = delivered.target
    targetLabel = delivered.targetLabel
    lastProviderMessageId = delivered.providerMessageId
    replyToMessageId = null
  }

  return {
    providerMessageId: lastProviderMessageId,
    target: targetLabel,
  }
}

function resolveAgentmailThreadReplyMessageId(input: {
  last_message_id?: string | null
  messages?: Array<{ message_id?: string | null }> | null
}): string | null {
  const direct = input.last_message_id?.trim() ? input.last_message_id.trim() : null
  if (direct) {
    return direct
  }

  const messages = Array.isArray(input.messages) ? input.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]?.message_id?.trim()
      ? messages[index]!.message_id!.trim()
      : null
    if (candidate) {
      return candidate
    }
  }

  return null
}

async function sendTelegramTextChunk(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  replyToMessageId: string | null
  target: TelegramParsedTarget
  targetLabel: string
  text: string
  token: string
}): Promise<{
  providerMessageId: string | null
  target: TelegramParsedTarget
  targetLabel: string
}> {
  let retryCount = 0
  let target = input.target
  let targetLabel = input.targetLabel

  while (true) {
    const outcome = resolveTelegramSendAttemptOutcome({
      result: await sendTelegramTextChunkOnce({
        baseUrl: input.baseUrl,
        fetchImplementation: input.fetchImplementation,
        replyToMessageId: input.replyToMessageId,
        target,
        targetLabel,
        text: input.text,
        token: input.token,
      }),
      target,
      targetLabel,
    })

    if (outcome.kind === 'delivered') {
      return {
        providerMessageId: outcome.providerMessageId,
        target,
        targetLabel,
      }
    }

    if (outcome.kind === 'migrated') {
      target = outcome.target
      targetLabel = outcome.targetLabel
      continue
    }

    if (
      outcome.kind === 'failed' ||
      retryCount >= TELEGRAM_MAX_DELIVERY_ATTEMPTS - 1
    ) {
      throw outcome.failure
    }

    await waitForTelegramRetryDelay(retryCount, outcome.retryAfterSeconds)
    retryCount += 1
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
  retryAfterSeconds: number | null
} {
  if (!value || typeof value !== 'object') {
    return {
      description: null,
      errorCode: null,
      migrateToChatId: null,
      retryAfterSeconds: null,
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
  const migrateToChatId = extractTelegramMigrateToChatId(
    value as Record<string, unknown>,
  )
  const retryAfterSeconds = extractTelegramRetryAfter(
    value as Record<string, unknown>,
  )

  return {
    description,
    errorCode,
    migrateToChatId,
    retryAfterSeconds,
  }
}

async function sendTelegramBotApiRequest(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  method: 'POST'
  operation: 'sendChatAction' | 'sendMessage'
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

function buildTelegramTargetPayload(target: TelegramParsedTarget): Record<string, unknown> {
  return {
    business_connection_id: target.businessConnectionId ?? undefined,
    chat_id: target.chatId,
    direct_messages_topic_id: target.directMessagesTopicId ?? undefined,
    message_thread_id: target.messageThreadId ?? undefined,
  }
}

function splitTelegramMessageText(message: string): string[] {
  const codePoints = Array.from(message)
  if (codePoints.length <= TELEGRAM_MAX_TEXT_LENGTH) {
    return [message]
  }

  const chunks: string[] = []
  let startIndex = 0

  while (startIndex < codePoints.length) {
    const endIndex = Math.min(
      startIndex + TELEGRAM_MAX_TEXT_LENGTH,
      codePoints.length,
    )

    if (endIndex === codePoints.length) {
      chunks.push(codePoints.slice(startIndex).join(''))
      break
    }

    chunks.push(codePoints.slice(startIndex, endIndex).join(''))
    startIndex = endIndex
  }

  return chunks
}

function shouldRetryTelegramSend(
  status: number,
  errorCode: number | null,
): boolean {
  return status >= 500 || status === 429 || errorCode === 429
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

function extractTelegramRetryAfter(value: Record<string, unknown>): number | null {
  if (!('parameters' in value) || typeof value.parameters !== 'object' || value.parameters === null) {
    return null
  }

  const retryAfter =
    'retry_after' in value.parameters
      ? (value.parameters as { retry_after?: unknown }).retry_after
      : null
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter)
    ? retryAfter
    : null
}

async function waitForTelegramRetryDelay(
  attempt: number,
  retryAfterSeconds: number | null,
): Promise<void> {
  const retryAfterMs =
    typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
      ? Math.max(retryAfterSeconds * 1000, 1)
      : Math.min(250 * 2 ** attempt, 2000)

  await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
}

function parseTelegramTargetOrThrow(target: string): TelegramParsedTarget {
  const parsed = parseTelegramThreadTarget(target)
  if (parsed) {
    return parsed
  }

  const normalizedTarget = normalizeOptionalText(target)
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

async function sendTelegramTextChunkOnce(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  replyToMessageId: string | null
  target: TelegramParsedTarget
  targetLabel: string
  text: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const response = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      method: 'POST',
      operation: 'sendMessage',
      payload: {
        ...buildTelegramTargetPayload(input.target),
        reply_to_message_id: input.replyToMessageId ? Number.parseInt(input.replyToMessageId, 10) : undefined,
        text: input.text,
      },
      token: input.token,
    })

    return {
      kind: 'response',
      payload: await readTelegramResponsePayload(response),
      response,
    }
  } catch (error) {
    return {
      kind: 'request-error',
      failure: new VaultCliError(
        'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
        'Outbound Telegram delivery failed while calling the Bot API.',
        {
          error: describeUnknownError(error),
          target: input.targetLabel,
        },
      ),
    }
  }
}

function resolveTelegramSendAttemptOutcome(input: {
  result: TelegramSendAttemptResult
  target: TelegramParsedTarget
  targetLabel: string
}): TelegramSendAttemptOutcome {
  if (input.result.kind === 'request-error') {
    return {
      kind: 'retry',
      failure: input.result.failure,
      retryAfterSeconds: null,
    }
  }

  if (
    input.result.response.ok &&
    isTelegramSuccessResponse(input.result.payload)
  ) {
    return {
      kind: 'delivered',
      providerMessageId: extractTelegramProviderMessageId(input.result.payload),
    }
  }

  const errorContext = extractTelegramErrorContext(input.result.payload)
  if (
    errorContext.migrateToChatId &&
    errorContext.migrateToChatId !== input.target.chatId
  ) {
    const migratedTarget = {
      ...input.target,
      chatId: errorContext.migrateToChatId,
    }

    return {
      kind: 'migrated',
      target: migratedTarget,
      targetLabel: serializeTelegramThreadTarget(migratedTarget),
    }
  }

  const failure = new VaultCliError(
    'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
    errorContext.description ??
      `Telegram Bot API sendMessage failed with HTTP ${input.result.response.status}.`,
    {
      errorCode: errorContext.errorCode,
      migrateToChatId: errorContext.migrateToChatId,
      status: input.result.response.status,
      target: input.targetLabel,
    },
  )

  if (
    shouldRetryTelegramSend(
      input.result.response.status,
      errorContext.errorCode,
    )
  ) {
    return {
      kind: 'retry',
      failure,
      retryAfterSeconds: errorContext.retryAfterSeconds,
    }
  }

  return {
    kind: 'failed',
    failure,
  }
}

function normalizeTelegramReplyToMessageId(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return null
  }

  return /^\d+$/u.test(normalized) ? normalized : null
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}

function extractTelegramProviderMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = 'result' in value ? (value as { result?: unknown }).result : null
  if (!result || typeof result !== 'object') {
    return null
  }

  const messageId = (result as { message_id?: unknown }).message_id
  if (typeof messageId === 'number' || typeof messageId === 'string') {
    return String(messageId)
  }

  return null
}
