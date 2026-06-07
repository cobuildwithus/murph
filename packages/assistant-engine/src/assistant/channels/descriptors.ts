import {
  resolveAgentmailApiKey,
} from '@murphai/operator-config/agentmail-runtime'
import {
  parseHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import {
  isLinqChatNotFoundSendMessageError,
  type LinqFetch,
  probeLinqApi,
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '@murphai/operator-config/linq-runtime'
import {
  resolveTelegramBotToken,
} from '@murphai/operator-config/telegram-runtime'
import {
  resolveWhatsAppAccessToken,
  resolveWhatsAppPhoneNumberId,
} from '@murphai/operator-config/whatsapp-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantChannelAdapter,
  readDeliveredCleanupMessages,
  readDeliveredCleanupTargetAliases,
  readDeliveredProviderMessageId,
  readDeliveredProviderMessageIds,
  readDeliveredProviderThreadId,
  readDeliveredTarget,
  readDeliveredTargetKind,
} from './helpers.js'
import { createAssistantDeliveryConfirmationPendingError } from '../outbox/retry-policy.js'
import {
  sendEmailMessage,
  sendLinqMessage,
  sendTelegramMessage,
  sendWhatsAppMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from './runtime.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelDependencies,
  AssistantChannelName,
} from './types.js'

const TELEGRAM_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'telegram',
  canAutoReply(eligibility) {
    return eligibility.threadIsDirect === true
      ? null
      : 'Telegram auto-reply only runs for direct chats'
  },
  isReadyForSetup(env) {
    return resolveTelegramBotToken(env) !== null
  },
  supportsIdempotencyKey: false,
  supportsResponseMedia: false,
  targetRequiredMessage:
    'Telegram delivery requires an explicit target or a stored delivery binding.',
  async startTypingIndicator({ candidate, dependencies }) {
    const startTyping =
      dependencies.startTelegramTyping ?? startTelegramTypingIndicator
    return (await startTyping({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({ candidate, dependencies, idempotencyKey, message, replyToMessageId }) {
    const delivered = dependencies.sendTelegram
      ? await dependencies.sendTelegram({
          idempotencyKey: idempotencyKey ?? null,
          target: candidate.target,
          message,
          replyToMessageId: replyToMessageId ?? null,
          signal: dependencies.signal,
        })
      : await sendTelegramMessage(
          {
            idempotencyKey: idempotencyKey ?? null,
            target: candidate.target,
            message,
            replyToMessageId: replyToMessageId ?? null,
          },
          { signal: dependencies.signal },
        )
    return {
      cleanupMessages: readDeliveredCleanupMessages(delivered),
      cleanupTargetAliases: readDeliveredCleanupTargetAliases(delivered),
      target: readDeliveredTarget(delivered) ?? candidate.target,
      providerMessageId: readDeliveredProviderMessageId(delivered),
      providerMessageIds: readDeliveredProviderMessageIds(delivered),
    }
  },
})

const LINQ_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'linq',
  canAutoReply(eligibility) {
    return eligibility.threadIsDirect === true
      ? null
      : 'iMessage auto-reply only runs for direct chats'
  },
  isReadyForSetup(env) {
    return resolveLinqApiToken(env) !== null && resolveLinqWebhookSecret(env) !== null
  },
  supportsIdempotencyKey: true,
  supportsResponseMedia: true,
  targetRequiredMessage:
    'iMessage delivery requires an explicit chat id or a stored thread binding.',
  async startTypingIndicator({ candidate, dependencies }) {
    const startTyping = dependencies.startLinqTyping ?? startLinqTypingIndicator
    return (await startTyping({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({ actorId, candidate, deliverySource, dependencies, idempotencyKey, media, message, replyToMessageId }) {
    let delivered
    const mediaInput = media.length > 0 ? media : undefined
    const request = {
      fromPhoneNumber: deliverySource?.kind === 'linq' ? deliverySource.fromPhoneNumber : null,
      idempotencyKey: idempotencyKey ?? null,
      target: candidate.target,
      targetKind: candidate.kind,
      message,
      ...(mediaInput ? { media: mediaInput } : {}),
      replyToMessageId: replyToMessageId ?? null,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    }
    try {
      delivered = dependencies.sendLinq
        ? await dependencies.sendLinq({
            ...request,
            directRecipientPhoneNumber: normalizeDirectLinqRecipient(actorId),
            ...(mediaInput ? { media: mediaInput } : {}),
          })
        : await sendLinqMessage(request, dependencies.signal ? { signal: dependencies.signal } : {})
    } catch (error) {
      const recovered = await maybeRecoverMissingLinqDirectThread({
        actorId,
        candidate,
        dependencies,
        error,
        idempotencyKey,
        media,
        message,
        replyToMessageId,
      })
      if (!recovered) {
        throw error
      }
      delivered = recovered
    }

    const deliveredTarget = readDeliveredTarget(delivered)
    const providerThreadId = readDeliveredProviderThreadId(delivered)
    if (candidate.kind === 'participant' && !deliveredTarget && !providerThreadId) {
      throw createAssistantDeliveryConfirmationPendingError(
        new VaultCliError(
          'ASSISTANT_LINQ_CHAT_ID_REQUIRED',
          'Materialized iMessage participant delivery did not return a chat id.',
        ),
      )
    }

    return {
      target: deliveredTarget ?? providerThreadId ?? candidate.target,
      targetKind: inferDeliveredLinqTargetKind(candidate.kind, delivered),
      providerMessageId: readDeliveredProviderMessageId(delivered),
      providerThreadId: providerThreadId ?? deliveredTarget,
    }
  },
})

function inferDeliveredLinqTargetKind(
  requestedKind: string,
  delivered:
    | {
        providerThreadId?: string | null
        target?: string | null
      }
    | void,
): 'explicit' | 'participant' | 'thread' | null {
  if (requestedKind !== 'participant') {
    return null
  }

  const providerThreadId = readDeliveredProviderThreadId(delivered)
  const deliveredTarget = readDeliveredTarget(delivered)
  return providerThreadId || deliveredTarget ? 'thread' : null
}

const EMAIL_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'email',
  canAutoReply(eligibility) {
    return eligibility.threadIsDirect === true
      ? null
      : 'Email auto-reply only runs for direct threads'
  },
  isReadyForSetup(env) {
    return resolveAgentmailApiKey(env) !== null
  },
  supportsIdempotencyKey: false,
  supportsResponseMedia: false,
  targetRequiredMessage:
    'Email delivery requires an explicit recipient or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, idempotencyKey, identityId, message, replyToMessageId, subject }) {
    const send = dependencies.sendEmail ?? sendEmailMessage
    if (!identityId && !dependencies.sendEmail) {
      throw new VaultCliError(
        'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
        'Email delivery requires a configured email sender identity. Pass --identity or resume a session already bound to email.',
      )
    }
    const targetKind =
      candidate.kind === 'explicit' && parseHostedEmailThreadTarget(candidate.target)
        ? 'thread'
        : candidate.kind
    const delivered = await send({
      idempotencyKey: idempotencyKey ?? null,
      identityId: identityId!,
      target: candidate.target,
      targetKind,
      replyToMessageId: replyToMessageId ?? null,
      subject: subject ?? null,
      message,
    })
    const deliveredTarget =
      delivered && typeof delivered === 'object' && 'target' in delivered
        ? readDeliveredTarget(delivered)
        : null
    return {
      target: deliveredTarget ?? candidate.target,
      providerMessageId: readDeliveredProviderMessageId(delivered),
      providerThreadId: readDeliveredProviderThreadId(delivered),
    }
  },
})

const WHATSAPP_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'whatsapp',
  canAutoReply(eligibility) {
    return eligibility.threadIsDirect === true
      ? null
      : 'WhatsApp auto-reply only runs for direct chats'
  },
  isReadyForSetup(env) {
    return resolveWhatsAppAccessToken(env) !== null
      && resolveWhatsAppPhoneNumberId(env) !== null
  },
  supportsIdempotencyKey: false,
  supportsResponseMedia: false,
  targetRequiredMessage:
    'WhatsApp delivery requires an explicit wa_id or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, message, replyToMessageId }) {
    const delivered = dependencies.sendWhatsApp
      ? await dependencies.sendWhatsApp({
          message,
          replyToMessageId: replyToMessageId ?? null,
          signal: dependencies.signal,
          target: candidate.target,
        })
      : await sendWhatsAppMessage(
          {
            message,
            replyToMessageId: replyToMessageId ?? null,
            target: candidate.target,
          },
          { signal: dependencies.signal },
        )

    return {
      target: readDeliveredTarget(delivered) ?? candidate.target,
      targetKind: readDeliveredTargetKind(delivered) ?? candidate.kind,
      providerMessageId: readDeliveredProviderMessageId(delivered),
      providerMessageIds: readDeliveredProviderMessageIds(delivered),
      providerThreadId: readDeliveredProviderThreadId(delivered),
    }
  },
})

export const ASSISTANT_CHANNEL_ADAPTERS: Readonly<Record<
  AssistantChannelName,
  AssistantChannelAdapter
>> = Object.freeze({
  telegram: TELEGRAM_CHANNEL_ADAPTER,
  linq: LINQ_CHANNEL_ADAPTER,
  email: EMAIL_CHANNEL_ADAPTER,
  whatsapp: WHATSAPP_CHANNEL_ADAPTER,
})

async function maybeRecoverMissingLinqDirectThread(input: {
  actorId: string | null
  candidate: { kind: string; target: string }
  dependencies: AssistantChannelDependencies
  error: unknown
  idempotencyKey?: string | null
  media?: readonly import('@murphai/operator-config/assistant-cli-contracts').AssistantResponseMedia[] | null
  message: string
  replyToMessageId?: string | null
}): Promise<
  | {
      providerMessageId?: string | null
      providerThreadId?: string | null
      target?: string | null
    }
  | null
> {
  if (
    input.dependencies.sendLinq
    ||
    !looksLikeMissingLinqChatError(input.error)
    || (input.candidate.kind !== 'thread' && input.candidate.kind !== 'explicit')
  ) {
    return null
  }

  const recipient = normalizeDirectLinqRecipient(input.actorId)
  if (!recipient) {
    return null
  }

  const senders = await resolveLinqSenderPhoneNumbers({
    env: process.env,
  })
  if (senders.length === 0) {
    return null
  }

  for (const sender of senders) {
    let delivered
    try {
      delivered = await sendLinqMessage({
        fromPhoneNumber: sender,
        idempotencyKey: input.idempotencyKey ?? null,
        target: recipient,
        targetKind: 'participant',
        message: input.message,
        ...(input.media && input.media.length > 0 ? { media: input.media } : {}),
        replyToMessageId: input.replyToMessageId ?? null,
      }, input.dependencies.signal ? { signal: input.dependencies.signal } : {})
    } catch (error) {
      if (shouldContinueLinqDirectThreadRecoveryAfterError(error)) {
        continue
      }
      if (isPotentiallyAcceptedLinqDirectThreadRecoveryError(error)) {
        throw createAssistantDeliveryConfirmationPendingError(error)
      }
      throw error
    }
    if (!delivered || typeof delivered !== 'object') {
      continue
    }

    const target =
      readDeliveredTarget(delivered) ??
      readDeliveredProviderThreadId(delivered)
    if (!target) {
      throw createAssistantDeliveryConfirmationPendingError(
        new VaultCliError(
          'ASSISTANT_LINQ_CHAT_ID_REQUIRED',
          'Recovered iMessage direct delivery did not return a chat id.',
        ),
      )
    }

    return {
      ...delivered,
      providerThreadId: readDeliveredProviderThreadId(delivered) ?? target,
      target,
    }
  }

  return null
}

function looksLikeMissingLinqChatError(error: unknown): error is VaultCliError {
  return isLinqChatNotFoundSendMessageError(error)
}

function shouldContinueLinqDirectThreadRecoveryAfterError(error: unknown): boolean {
  if (
    !(error instanceof VaultCliError)
    || error.code !== 'LINQ_API_REQUEST_FAILED'
    || error.context?.failureStage !== 'http'
    || error.context?.retryable === true
  ) {
    return false
  }

  const status = error.context?.status
  return typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
}

function isPotentiallyAcceptedLinqDirectThreadRecoveryError(
  error: unknown,
): boolean {
  if (!(error instanceof VaultCliError) || error.code !== 'LINQ_API_REQUEST_FAILED') {
    return false
  }

  if (error.context?.retryable === true || error.context?.failureStage === 'transport') {
    return true
  }

  const status = error.context?.status
  return typeof status === 'number' && (status === 408 || status >= 500)
}

function normalizeDirectLinqRecipient(value: string | null): string | null {
  const recipient = value?.trim() ?? ''
  return recipient.startsWith('+') ? recipient : null
}

async function resolveLinqSenderPhoneNumbers(input: {
  env: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
}): Promise<string[]> {
  try {
    const probed = await probeLinqApi({
      env: input.env,
      fetchImplementation: input.fetchImplementation,
    })
    return normalizeLinqSenderPhoneNumbers(probed.phoneNumbers)
  } catch {
    return []
  }
}

function normalizeLinqSenderPhoneNumbers(phoneNumbers: readonly unknown[]): string[] {
  return phoneNumbers
    .map((phoneNumber) => typeof phoneNumber === 'string' ? phoneNumber.trim() : '')
    .filter((phoneNumber) => phoneNumber.startsWith('+'))
}
