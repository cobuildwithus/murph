import { IMessageSDK } from '@photon-ai/imessage-kit'
import type { InboxShowResult } from '../inbox-cli-contracts.js'
import {
  assistantBindingDeliverySchema,
  assistantChannelDeliverySchema,
  type AssistantBindingDelivery,
} from '../assistant-cli-contracts.js'
import type { ConversationRef } from './conversation-ref.js'
import {
  ensureImessageMessagesDbReadable,
  mapImessageMessagesDbRuntimeError,
} from '../imessage-readiness.js'
import {
  parseTelegramSendTarget,
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
} from '../telegram-runtime.js'
import { VaultCliError } from '../vault-cli-errors.js'

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

export interface AssistantChannelDependencies {
  sendImessage?: (input: { message: string; target: string }) => Promise<void>
  sendTelegram?: (input: { message: string; target: string }) => Promise<void>
}

export interface AssistantDeliveryCandidate {
  kind: 'explicit' | 'participant' | 'thread'
  target: string
}

export interface AssistantChannelAdapter {
  channel: 'imessage' | 'telegram'
  canAutoReply: (capture: InboxShowResult['capture']) => string | null
  inferBindingDelivery: (input: {
    conversation: ConversationRef
    deliveryKind?: 'participant' | 'thread' | null
    deliveryTarget?: string | null
  }) => AssistantBindingDelivery | null
  isReadyForSetup: (env: NodeJS.ProcessEnv) => boolean
  send: (input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
    message: string
  }, dependencies: AssistantChannelDependencies) => Promise<
    ReturnType<typeof assistantChannelDeliverySchema.parse>
  >
}

export function getAssistantChannelAdapter(
  channel: string | null | undefined,
): AssistantChannelAdapter | null {
  switch (channel) {
    case 'imessage':
      return IMESSAGE_CHANNEL_ADAPTER
    case 'telegram':
      return TELEGRAM_CHANNEL_ADAPTER
    default:
      return null
  }
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

export function inferAssistantBindingDelivery(input: {
  channel?: string | null
  conversation?: ConversationRef | null
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const adapter = getAssistantChannelAdapter(input.channel ?? input.conversation?.channel)
  if (!adapter) {
    return inferFallbackBindingDelivery({
      conversation: input.conversation ?? {},
      deliveryKind: input.deliveryKind ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
    })
  }

  return adapter.inferBindingDelivery({
    conversation: input.conversation ?? {},
    deliveryKind: input.deliveryKind ?? null,
    deliveryTarget: input.deliveryTarget ?? null,
  })
}

export function resolveImessageDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  return resolveDeliveryCandidates(input)
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

const IMESSAGE_CHANNEL_ADAPTER: AssistantChannelAdapter = {
  channel: 'imessage',
  canAutoReply() {
    return null
  },
  inferBindingDelivery(input) {
    return inferFallbackBindingDelivery(input)
  },
  isReadyForSetup() {
    return true
  },
  async send(input, dependencies) {
    const send = dependencies.sendImessage ?? sendImessageMessage
    const candidates = resolveDeliveryCandidates(input)

    if (candidates.length === 0) {
      throw new VaultCliError(
        'ASSISTANT_CHANNEL_TARGET_REQUIRED',
        'iMessage delivery requires an explicit target or a stored delivery binding.',
      )
    }

    const candidate = candidates[0]!
    await send({
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
  },
}

const TELEGRAM_CHANNEL_ADAPTER: AssistantChannelAdapter = {
  channel: 'telegram',
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'Telegram auto-reply only runs for direct chats'
  },
  inferBindingDelivery(input) {
    const explicitKind = input.deliveryKind ?? null
    const explicitTarget = input.deliveryTarget?.trim()
      ? input.deliveryTarget.trim()
      : null
    if (explicitKind && explicitTarget) {
      return assistantBindingDeliverySchema.parse({
        kind: explicitKind,
        target: explicitTarget,
      })
    }

    if (input.conversation.threadId) {
      return assistantBindingDeliverySchema.parse({
        kind: 'thread',
        target: input.conversation.threadId,
      })
    }

    if (input.conversation.participantId) {
      return assistantBindingDeliverySchema.parse({
        kind: 'participant',
        target: input.conversation.participantId,
      })
    }

    return null
  },
  isReadyForSetup(env) {
    return resolveTelegramBotToken(env) !== null
  },
  async send(input, dependencies) {
    const send = dependencies.sendTelegram ?? sendTelegramMessage
    const candidates = resolveDeliveryCandidates(input)

    if (candidates.length === 0) {
      throw new VaultCliError(
        'ASSISTANT_CHANNEL_TARGET_REQUIRED',
        'Telegram delivery requires an explicit target or a stored delivery binding.',
      )
    }

    const candidate = candidates[0]!
    await send({
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
  },
}

function inferFallbackBindingDelivery(input: {
  conversation: ConversationRef
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const explicitKind = input.deliveryKind ?? null
  const explicitTarget = input.deliveryTarget?.trim() ? input.deliveryTarget.trim() : null
  if (explicitKind && explicitTarget) {
    return assistantBindingDeliverySchema.parse({
      kind: explicitKind,
      target: explicitTarget,
    })
  }

  if (input.conversation.directness === 'group' && input.conversation.threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: input.conversation.threadId,
    })
  }

  if (input.conversation.participantId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'participant',
      target: input.conversation.participantId,
    })
  }

  if (input.conversation.threadId) {
    return assistantBindingDeliverySchema.parse({
      kind: 'thread',
      target: input.conversation.threadId,
    })
  }

  return null
}

async function ensureImessageRuntimeReady(
  dependencies: ImessageRuntimeDependencies,
): Promise<void> {
  try {
    await ensureImessageMessagesDbReadable(dependencies, {
      unavailableCode: 'ASSISTANT_IMESSAGE_UNAVAILABLE',
      unavailableMessage: 'Outbound iMessage delivery requires macOS.',
      permissionCode: 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
      permissionMessage:
        'Outbound iMessage delivery requires Full Disk Access or read access to ~/Library/Messages/chat.db. Grant access, restart it, and retry.',
    })
  } catch (error) {
    throw mapImessageRuntimeError(error)
  }
}

function mapImessageRuntimeError(error: unknown): VaultCliError {
  if (error instanceof VaultCliError) {
    return error
  }

  const mapped = mapImessageMessagesDbRuntimeError(error, {
    permissionCode: 'ASSISTANT_IMESSAGE_PERMISSION_REQUIRED',
    permissionMessage:
      'Outbound iMessage delivery requires Full Disk Access or read access to ~/Library/Messages/chat.db. Grant access, restart it, and retry.',
    fallbackCode: 'ASSISTANT_IMESSAGE_DELIVERY_FAILED',
    fallbackMessage: 'Outbound iMessage delivery failed.',
  })
  if (mapped) {
    return mapped
  }

  return new VaultCliError(
    'ASSISTANT_IMESSAGE_DELIVERY_FAILED',
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : 'Outbound iMessage delivery failed.',
  )
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
  const retryAfterSeconds = extractTelegramRetryAfter(
    value as Record<string, unknown>,
  )

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

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}
