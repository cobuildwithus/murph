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

  let response: FetchLikeResponse
  try {
    response = await fetchImplementation(`${baseUrl}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: target.chatId,
        message_thread_id: target.messageThreadId ?? undefined,
        text: input.message,
      }),
    })
  } catch (error) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
      'Outbound Telegram delivery failed while calling the Bot API.',
      {
        error: describeUnknownError(error),
      },
    )
  }

  const payload = await readTelegramResponsePayload(response)
  if (response.ok && isTelegramSuccessResponse(payload)) {
    return
  }

  const errorContext = extractTelegramErrorContext(payload)
  throw new VaultCliError(
    'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
    errorContext.description ??
      `Telegram Bot API sendMessage failed with HTTP ${response.status}.`,
    {
      errorCode: errorContext.errorCode,
      status: response.status,
      target: input.target,
    },
  )
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
} {
  if (!value || typeof value !== 'object') {
    return {
      description: null,
      errorCode: null,
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
  }
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
