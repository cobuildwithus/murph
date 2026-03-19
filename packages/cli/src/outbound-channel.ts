import { IMessageSDK } from '@photon-ai/imessage-kit'
import {
  assistantChannelDeliverySchema,
  assistantDeliverResultSchema,
  type AssistantBindingDelivery,
} from './assistant-cli-contracts.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './assistant/store.js'
import { normalizeRequiredText } from './assistant/shared.js'
import {
  ensureImessageMessagesDbReadable,
  mapImessageMessagesDbRuntimeError,
} from './imessage-readiness.js'
import {
  parseTelegramSendTarget,
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
} from './telegram-runtime.js'
import { VaultCliError } from './vault-cli-errors.js'

const TELEGRAM_MAX_TEXT_LENGTH = 4096
const TELEGRAM_MAX_DELIVERY_ATTEMPTS = 3
const TELEGRAM_SEND_TIMEOUT_MS = 30_000

interface ImessageSdkLike {
  close?: () => Promise<void> | void
  send?: (target: string, content: string) => Promise<unknown>
}

interface ImessageRuntimeDependencies {
  createSdk?: () => ImessageSdkLike
  homeDirectory?: string | null
  platform?: NodeJS.Platform
  probeMessagesDb?: (targetPath: string) => Promise<void>
}

interface FetchLikeResponse {
  json: () => Promise<unknown>
  ok: boolean
  status: number
}

type FetchLike = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<FetchLikeResponse>

interface TelegramRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: FetchLike
}

export interface DeliverAssistantMessageInput {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  identityId?: string | null
  message: string
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  target?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantChannelDependencies {
  sendImessage?: (input: { message: string; target: string }) => Promise<void>
  sendTelegram?: (input: { message: string; target: string }) => Promise<void>
}

export interface AssistantDeliveryCandidate {
  kind: 'explicit' | 'participant' | 'thread'
  target: string
}

export async function deliverAssistantMessage(
  input: DeliverAssistantMessageInput,
  dependencies: AssistantChannelDependencies = {},
): Promise<ReturnType<typeof assistantDeliverResultSchema.parse>> {
  const normalizedMessage = normalizeRequiredText(input.message, 'message')
  const explicitTarget = input.target?.trim() ? input.target.trim() : null
  const resolved = await resolveAssistantSession({
    vault: input.vault,
    sessionId: input.sessionId,
    alias: input.alias,
    channel: input.channel,
    identityId: input.identityId,
    actorId: input.actorId ?? input.participantId,
    threadId: input.threadId ?? input.sourceThreadId,
    threadIsDirect: input.threadIsDirect,
  })

  const channel = input.channel?.trim() || resolved.session.binding.channel
  if (!channel) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_REQUIRED',
      'Outbound delivery requires a mapped channel. Pass --channel or resume a session with channel metadata.',
    )
  }

  const delivery = await deliverOverChannel(
    {
      bindingDelivery: resolved.session.binding.delivery,
      channel,
      explicitTarget,
      message: normalizedMessage,
    },
    dependencies,
  )

  const updatedSession = await saveAssistantSession(input.vault, {
    ...resolved.session,
    binding: {
      ...resolved.session.binding,
      channel,
    },
    updatedAt: delivery.sentAt,
    lastTurnAt: delivery.sentAt,
  })

  return assistantDeliverResultSchema.parse({
    vault: redactAssistantDisplayPath(input.vault),
    message: normalizedMessage,
    session: updatedSession,
    delivery,
  })
}

export function resolveDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  const explicitTarget = input.explicitTarget?.trim() ? input.explicitTarget.trim() : null
  if (explicitTarget) {
    return [
      {
        kind: 'explicit',
        target: explicitTarget,
      },
    ]
  }

  if (!input.bindingDelivery) {
    return []
  }

  return [
    {
      kind: input.bindingDelivery.kind,
      target: input.bindingDelivery.target,
    },
  ]
}

export function resolveImessageDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  return resolveDeliveryCandidates(input)
}

async function deliverOverChannel(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    channel: string
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  switch (input.channel) {
    case 'imessage':
      return deliverImessage(input, dependencies)
    case 'telegram':
      return deliverTelegram(input, dependencies)
    default:
      throw new VaultCliError(
        'ASSISTANT_CHANNEL_UNSUPPORTED',
        `Outbound delivery for channel "${input.channel}" is not supported in this build.`,
      )
  }
}

async function deliverImessage(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  const sendImessage = dependencies.sendImessage ?? sendImessageMessage
  const candidates = resolveDeliveryCandidates({
    explicitTarget: input.explicitTarget,
    bindingDelivery: input.bindingDelivery,
  })

  if (candidates.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires an explicit target or a stored delivery binding.',
    )
  }

  const candidate = candidates[0]
  await sendImessage({
    target: candidate.target,
    message: input.message,
  })

  return assistantChannelDeliverySchema.parse({
    channel: 'imessage',
    target: candidate.target,
    targetKind: candidate.kind,
    sentAt: new Date().toISOString(),
    messageLength: input.message.length,
  })
}

async function deliverTelegram(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
    message: string
  },
  dependencies: AssistantChannelDependencies,
) {
  const sendTelegram = dependencies.sendTelegram ?? sendTelegramMessage
  const candidates = resolveDeliveryCandidates({
    explicitTarget: input.explicitTarget,
    bindingDelivery: input.bindingDelivery,
  })

  if (candidates.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'Telegram delivery requires an explicit target or a stored delivery binding.',
    )
  }

  const candidate = candidates[0]
  await sendTelegram({
    target: candidate.target,
    message: input.message,
  })

  return assistantChannelDeliverySchema.parse({
    channel: 'telegram',
    target: candidate.target,
    targetKind: candidate.kind,
    sentAt: new Date().toISOString(),
    messageLength: input.message.length,
  })
}

export async function sendImessageMessage(
  input: {
    message: string
    target: string
  },
  dependencies: ImessageRuntimeDependencies = {},
): Promise<void> {
  await ensureImessageRuntimeReady(dependencies)
  let sdk: ImessageSdkLike

  try {
    sdk = (dependencies.createSdk ?? (() => new IMessageSDK()))()
  } catch (error) {
    throw mapImessageRuntimeError(error)
  }

  if (typeof sdk.send !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_IMESSAGE_UNAVAILABLE',
      '@photon-ai/imessage-kit did not expose the expected send() method on IMessageSDK.',
    )
  }

  try {
    await sdk.send(input.target, input.message)
  } catch (error) {
    throw mapImessageRuntimeError(error)
  } finally {
    try {
      await sdk.close?.()
    } catch {}
  }
}

export async function sendTelegramMessage(
  input: {
    message: string
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env
  const token = resolveTelegramBotToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
      'Outbound Telegram delivery requires HEALTHYBOB_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN.',
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
  const target = parseTelegramSendTarget(input.target)

  const chunks = splitTelegramMessageText(input.message)
  for (const chunk of chunks) {
    await sendTelegramTextChunk({
      baseUrl,
      fetchImplementation,
      target,
      targetLabel: input.target,
      text: chunk,
      token,
    })
  }
}

async function sendTelegramTextChunk(input: {
  baseUrl: string
  fetchImplementation: FetchLike
  target: ReturnType<typeof parseTelegramSendTarget>
  targetLabel: string
  text: string
  token: string
}): Promise<void> {
  let lastFailure: VaultCliError | null = null

  for (let attempt = 0; attempt < TELEGRAM_MAX_DELIVERY_ATTEMPTS; attempt += 1) {
    let response: FetchLikeResponse
    let payload: unknown = null

    try {
      response = await sendTelegramBotApiRequest({
        baseUrl: input.baseUrl,
        fetchImplementation: input.fetchImplementation,
        payload: {
          business_connection_id: input.target.businessConnectionId ?? undefined,
          chat_id: input.target.chatId,
          direct_messages_topic_id: input.target.directMessagesTopicId ?? undefined,
          message_thread_id: input.target.messageThreadId ?? undefined,
          text: input.text,
        },
        token: input.token,
      })
      payload = await readTelegramResponsePayload(response)
    } catch (error) {
      const failure = new VaultCliError(
        'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
        'Outbound Telegram delivery failed while calling the Bot API.',
        {
          error: describeUnknownError(error),
          target: input.targetLabel,
        },
      )
      if (attempt >= TELEGRAM_MAX_DELIVERY_ATTEMPTS - 1) {
        throw failure
      }

      lastFailure = failure
      await waitForTelegramRetryDelay(attempt, null)
      continue
    }

    if (response.ok && isTelegramSuccessResponse(payload)) {
      return
    }

    const errorContext = extractTelegramErrorContext(payload)
    const failure = new VaultCliError(
      'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
      errorContext.description ??
        `Telegram Bot API sendMessage failed with HTTP ${response.status}.`,
      {
        errorCode: errorContext.errorCode,
        status: response.status,
        target: input.targetLabel,
      },
    )

    if (
      attempt >= TELEGRAM_MAX_DELIVERY_ATTEMPTS - 1 ||
      !shouldRetryTelegramSend(response.status, errorContext.errorCode)
    ) {
      throw failure
    }

    lastFailure = failure
    await waitForTelegramRetryDelay(attempt, errorContext.retryAfterSeconds)
  }

  if (lastFailure) {
    throw lastFailure
  }
}

async function readTelegramResponsePayload(
  response: FetchLikeResponse,
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
  retryAfterSeconds: number | null
} {
  if (!value || typeof value !== 'object') {
    return {
      description: null,
      errorCode: null,
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
  const retryAfterSeconds = extractTelegramRetryAfter(value)

  return {
    description,
    errorCode,
    retryAfterSeconds,
  }
}

async function sendTelegramBotApiRequest(input: {
  baseUrl: string
  fetchImplementation: FetchLike
  payload: Record<string, unknown>
  token: string
}): Promise<FetchLikeResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_SEND_TIMEOUT_MS)

  try {
    return await input.fetchImplementation(
      `${input.baseUrl}/bot${input.token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(input.payload),
        signal: controller.signal,
      },
    )
  } finally {
    clearTimeout(timeout)
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

    const slice = codePoints.slice(startIndex, endIndex)
    const breakIndex = findTelegramChunkBreakIndex(slice)
    chunks.push(slice.slice(0, breakIndex).join('').trimEnd())
    startIndex += breakIndex

    while (
      startIndex < codePoints.length &&
      /\s/u.test(codePoints[startIndex] ?? '')
    ) {
      startIndex += 1
    }
  }

  return chunks.filter((chunk) => chunk.length > 0)
}

function findTelegramChunkBreakIndex(slice: string[]): number {
  const joined = slice.join('')
  const candidates = ['\n\n', '\n', ' ']

  for (const candidate of candidates) {
    const index = joined.lastIndexOf(candidate)
    if (index >= 2048) {
      return Array.from(joined.slice(0, index + candidate.length)).length
    }
  }

  return slice.length
}

function shouldRetryTelegramSend(
  status: number,
  errorCode: number | null,
): boolean {
  return status === 429 || status >= 500 || errorCode === 429
}

async function waitForTelegramRetryDelay(
  attempt: number,
  retryAfterSeconds: number | null,
): Promise<void> {
  const milliseconds =
    retryAfterSeconds !== null
      ? retryAfterSeconds * 1000
      : Math.min((attempt + 1) * 1000, 5000)

  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function extractTelegramRetryAfter(value: unknown): number | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const parameters =
    'parameters' in value &&
    value.parameters &&
    typeof value.parameters === 'object'
      ? (value.parameters as Record<string, unknown>)
      : null

  if (!parameters) {
    return null
  }

  return typeof parameters.retry_after === 'number' &&
    Number.isFinite(parameters.retry_after) &&
    parameters.retry_after > 0
    ? parameters.retry_after
    : null
}

async function ensureImessageRuntimeReady(
  dependencies: ImessageRuntimeDependencies,
): Promise<void> {
  await ensureImessageMessagesDbReadable(dependencies, {
    unavailableCode: 'ASSISTANT_IMESSAGE_UNAVAILABLE',
    unavailableMessage: 'Outbound iMessage delivery requires macOS.',
    permissionCode: 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
    permissionMessage:
      'Outbound iMessage delivery requires read access to ~/Library/Messages/chat.db. Grant Full Disk Access to the terminal or app running Healthy Bob, fully restart it, and retry.',
  })
}

function mapImessageRuntimeError(error: unknown): VaultCliError {
  return mapImessageMessagesDbRuntimeError(error, {
    permissionCode: 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
    permissionMessage:
      'Outbound iMessage delivery requires read access to ~/Library/Messages/chat.db. Grant Full Disk Access to the terminal or app running Healthy Bob, fully restart it, and retry.',
    fallbackCode: 'ASSISTANT_IMESSAGE_DELIVERY_FAILED',
    fallbackMessage:
      'Outbound iMessage delivery failed inside @photon-ai/imessage-kit.',
  })
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}
