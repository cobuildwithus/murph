import { IMessageSDK } from '@photon-ai/imessage-kit'
import {
  createAgentmailApiClient,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
  type AgentmailFetch,
} from '../agentmail-runtime.ts'
import type { InboxShowResult } from '../inbox-cli-contracts.ts'
import {
  assistantBindingDeliverySchema,
  assistantChannelDeliverySchema,
  type AssistantBindingDelivery,
} from '../assistant-cli-contracts.ts'
import type { ConversationRef } from './conversation-ref.ts'
import {
  ensureImessageMessagesDbReadable,
  mapImessageMessagesDbRuntimeError,
} from '../imessage-readiness.ts'
import {
  formatTelegramSendTarget,
  parseTelegramSendTarget,
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
} from '../telegram-runtime.ts'
import {
  resolveLinqApiToken,
  sendLinqChatMessage,
  type LinqFetch,
} from '../linq-runtime.ts'
import { VaultCliError } from '../vault-cli-errors.ts'

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

interface EmailRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: AgentmailFetch
}

interface LinqRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
}

export interface AssistantChannelDependencies {
  sendImessage?: (input: { message: string; target: string }) => Promise<void>
  sendTelegram?: (input: {
    message: string
    target: string
  }) => Promise<
    | {
        target: string
      }
    | void
  >
  sendLinq?: (input: { message: string; target: string }) => Promise<void>
  sendEmail?: (input: {
    identityId: string | null
    message: string
    target: string
    targetKind: AssistantDeliveryCandidate['kind']
  }) => Promise<
    | {
        target: string
      }
    | void
  >
}

export interface AssistantDeliveryCandidate {
  kind: 'explicit' | 'participant' | 'thread'
  target: string
}

export interface AssistantChannelAdapter {
  channel: 'imessage' | 'telegram' | 'linq' | 'email'
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
    identityId: string | null
    message: string
  }, dependencies: AssistantChannelDependencies) => Promise<
    ReturnType<typeof assistantChannelDeliverySchema.parse>
  >
}

type AssistantChannelName = AssistantChannelAdapter['channel']

interface AssistantChannelAdapterSpec {
  canAutoReply: AssistantChannelAdapter['canAutoReply']
  channel: AssistantChannelName
  inferBindingDelivery: AssistantChannelAdapter['inferBindingDelivery']
  isReadyForSetup: AssistantChannelAdapter['isReadyForSetup']
  sendMessage: (input: {
    candidate: AssistantDeliveryCandidate
    dependencies: AssistantChannelDependencies
    identityId: string | null
    message: string
  }) => Promise<
    | {
        target?: string | null
      }
    | void
  >
  targetRequiredMessage: string
}

type TelegramParsedTarget = ReturnType<typeof parseTelegramSendTarget>

type TelegramSendAttemptResult =
  | {
      failure: VaultCliError
      kind: 'request-error'
    }
  | {
      kind: 'response'
      payload: unknown
      response: FetchLikeResponse
    }

type TelegramSendAttemptOutcome =
  | {
      kind: 'delivered'
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

export function getAssistantChannelAdapter(
  channel: string | null | undefined,
): AssistantChannelAdapter | null {
  if (!channel) {
    return null
  }

  return ASSISTANT_CHANNEL_ADAPTERS[channel as AssistantChannelName] ?? null
}

export function resolveDeliveryCandidates(input: {
  bindingDelivery?: AssistantBindingDelivery | null
  explicitTarget?: string | null
}): AssistantDeliveryCandidate[] {
  const explicitTarget = normalizeOptionalText(input.explicitTarget)
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
  // Compatibility wrapper for older outbound-channel call sites/tests.
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
  await sendTelegramMessageDetailed(input, dependencies)
}

export async function sendLinqMessage(
  input: {
    message: string
    target: string
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound Linq delivery requires LINQ_API_TOKEN.',
    )
  }

  await sendLinqChatMessage(
    {
      chatId: input.target,
      message: input.message,
    },
    {
      env,
      fetchImplementation: dependencies.fetchImplementation,
    },
  )
}

async function sendTelegramMessageDetailed(
  input: {
    message: string
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{
  target: string
}> {
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
  let target = parseTelegramSendTarget(input.target)
  let targetLabel = formatTelegramSendTarget(target)

  const chunks = splitTelegramMessageText(input.message)
  for (const chunk of chunks) {
    const delivered = await sendTelegramTextChunk({
      baseUrl,
      fetchImplementation,
      target,
      targetLabel,
      text: chunk,
      token,
    })
    target = delivered.target
    targetLabel = delivered.targetLabel
  }

  return {
    target: targetLabel,
  }
}

export async function sendEmailMessage(
  input: {
    identityId: string
    message: string
    target: string
    targetKind: AssistantDeliveryCandidate['kind']
    subject?: string | null
  },
  dependencies: EmailRuntimeDependencies = {},
): Promise<void> {
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

    await client.replyToMessage({
      inboxId: identityId,
      messageId,
      text: input.message,
      replyAll: true,
    })
    return
  }

  await client.sendMessage({
    inboxId: identityId,
    to: target,
    subject: input.subject?.trim() ? input.subject.trim() : 'Murph update',
    text: input.message,
  })
}

const IMESSAGE_CHANNEL_ADAPTER = createAssistantChannelAdapter({
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
  targetRequiredMessage:
    'iMessage delivery requires an explicit target or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, message }) {
    const send = dependencies.sendImessage ?? sendImessageMessage
    await send({
      target: candidate.target,
      message,
    })
  },
})

const TELEGRAM_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'telegram',
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'Telegram auto-reply only runs for direct chats'
  },
  inferBindingDelivery(input) {
    return inferThreadFirstBindingDelivery(input, {
      includeParticipant: true,
    })
  },
  isReadyForSetup(env) {
    return resolveTelegramBotToken(env) !== null
  },
  targetRequiredMessage:
    'Telegram delivery requires an explicit target or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, message }) {
    const send = dependencies.sendTelegram ?? sendTelegramMessage
    const delivered = await send({
      target: candidate.target,
      message,
    })
    return {
      target: readDeliveredTarget(delivered) ?? candidate.target,
    }
  },
})

const LINQ_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'linq',
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'Linq auto-reply only runs for direct chats'
  },
  inferBindingDelivery(input) {
    return inferThreadFirstBindingDelivery(input, {
      includeParticipant: false,
    })
  },
  isReadyForSetup(env) {
    return resolveLinqApiToken(env) !== null
  },
  targetRequiredMessage:
    'Linq delivery requires an explicit chat id or a stored thread binding.',
  async sendMessage({ candidate, dependencies, message }) {
    const send = dependencies.sendLinq ?? sendLinqMessage
    await send({
      target: candidate.target,
      message,
    })
  },
})

const EMAIL_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'email',
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'Email auto-reply only runs for direct threads'
  },
  inferBindingDelivery(input) {
    return inferThreadFirstBindingDelivery(input, {
      includeParticipant: true,
    })
  },
  isReadyForSetup(env) {
    return resolveAgentmailApiKey(env) !== null
  },
  targetRequiredMessage:
    'Email delivery requires an explicit recipient or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, identityId, message }) {
    const send = dependencies.sendEmail ?? sendEmailMessage
    if (!identityId && !dependencies.sendEmail) {
      throw new VaultCliError(
        'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
        'Email delivery requires a configured email sender identity. Pass --identity or resume a session already bound to email.',
      )
    }
    const delivered = await send({
      identityId: identityId!,
      target: candidate.target,
      targetKind: candidate.kind,
      message,
    })
    return {
      target: readDeliveredTarget(delivered) ?? candidate.target,
    }
  },
})

const ASSISTANT_CHANNEL_ADAPTERS: Record<
  AssistantChannelName,
  AssistantChannelAdapter
> = {
  imessage: IMESSAGE_CHANNEL_ADAPTER,
  telegram: TELEGRAM_CHANNEL_ADAPTER,
  linq: LINQ_CHANNEL_ADAPTER,
  email: EMAIL_CHANNEL_ADAPTER,
}

function inferFallbackBindingDelivery(input: {
  conversation: ConversationRef
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const explicitDelivery = resolveExplicitBindingDelivery(input)
  if (explicitDelivery) {
    return explicitDelivery
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
  target: TelegramParsedTarget
  targetLabel: string
  text: string
  token: string
}): Promise<{
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

function readDeliveredTarget(
  delivered: { target?: string | null } | void,
): string | null {
  return delivered && typeof delivered === 'object'
    ? normalizeOptionalText(delivered.target)
    : null
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}

function createAssistantChannelAdapter(
  spec: AssistantChannelAdapterSpec,
): AssistantChannelAdapter {
  return {
    channel: spec.channel,
    canAutoReply: spec.canAutoReply,
    inferBindingDelivery: spec.inferBindingDelivery,
    isReadyForSetup: spec.isReadyForSetup,
    async send(input, dependencies) {
      const candidate = resolveRequiredDeliveryCandidate(
        input,
        spec.targetRequiredMessage,
      )
      const delivered = await spec.sendMessage({
        candidate,
        dependencies,
        identityId: normalizeOptionalText(input.identityId),
        message: input.message,
      })

      return assistantChannelDeliverySchema.parse({
        channel: spec.channel,
        target: readDeliveredTarget(delivered) ?? candidate.target,
        targetKind: candidate.kind,
        sentAt: new Date().toISOString(),
        messageLength: input.message.length,
      })
    },
  }
}

function resolveRequiredDeliveryCandidate(
  input: {
    bindingDelivery: AssistantBindingDelivery | null
    explicitTarget: string | null
  },
  message: string,
): AssistantDeliveryCandidate {
  const candidate = resolveDeliveryCandidates(input)[0] ?? null
  if (candidate) {
    return candidate
  }

  throw new VaultCliError(
    'ASSISTANT_CHANNEL_TARGET_REQUIRED',
    message,
  )
}

function createAssistantBindingDelivery(
  kind: AssistantBindingDelivery['kind'],
  target: string,
): AssistantBindingDelivery {
  return assistantBindingDeliverySchema.parse({
    kind,
    target,
  })
}

function resolveExplicitBindingDelivery(input: {
  deliveryKind?: 'participant' | 'thread' | null
  deliveryTarget?: string | null
}): AssistantBindingDelivery | null {
  const explicitKind = input.deliveryKind ?? null
  const explicitTarget = normalizeOptionalText(input.deliveryTarget)
  if (!explicitKind || !explicitTarget) {
    return null
  }

  return createAssistantBindingDelivery(explicitKind, explicitTarget)
}

function inferThreadFirstBindingDelivery(
  input: {
    conversation: ConversationRef
    deliveryKind?: 'participant' | 'thread' | null
    deliveryTarget?: string | null
  },
  options: {
    includeParticipant: boolean
  },
): AssistantBindingDelivery | null {
  const explicitDelivery = resolveExplicitBindingDelivery(input)
  if (explicitDelivery) {
    return explicitDelivery
  }

  if (input.conversation.threadId) {
    return createAssistantBindingDelivery('thread', input.conversation.threadId)
  }

  if (options.includeParticipant && input.conversation.participantId) {
    return createAssistantBindingDelivery(
      'participant',
      input.conversation.participantId,
    )
  }

  return null
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() ? value.trim() : null
}

async function sendTelegramTextChunkOnce(input: {
  baseUrl: string
  fetchImplementation: FetchLike
  target: TelegramParsedTarget
  targetLabel: string
  text: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const response = await sendTelegramBotApiRequest({
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
      targetLabel: formatTelegramSendTarget(migratedTarget),
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
