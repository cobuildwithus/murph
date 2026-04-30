import {
  resolveAgentmailApiKey,
} from '@murphai/operator-config/agentmail-runtime'
import {
  parseHostedEmailThreadTarget,
} from '@murphai/runtime-state'
import {
  type LinqFetch,
  probeLinqApi,
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '@murphai/operator-config/linq-runtime'
import {
  resolveTelegramBotToken,
} from '@murphai/operator-config/telegram-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantChannelAdapter,
  readDeliveredCleanupMessages,
  readDeliveredCleanupTargetAliases,
  readDeliveredProviderMessageId,
  readDeliveredProviderMessageIds,
  readDeliveredProviderThreadId,
  readDeliveredTarget,
} from './helpers.js'
import { createAssistantDeliveryConfirmationPendingError } from '../outbox/retry-policy.js'
import {
  sendEmailMessage,
  sendLinqMessage,
  sendTelegramMessage,
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
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'Telegram auto-reply only runs for direct chats'
  },
  isReadyForSetup(env) {
    return resolveTelegramBotToken(env) !== null
  },
  supportsIdempotencyKey: false,
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
    const send = dependencies.sendTelegram ?? sendTelegramMessage
    const delivered = await send({
      idempotencyKey: idempotencyKey ?? null,
      target: candidate.target,
      message,
      replyToMessageId: replyToMessageId ?? null,
    })
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
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'iMessage auto-reply only runs for direct chats'
  },
  isReadyForSetup(env) {
    return resolveLinqApiToken(env) !== null && resolveLinqWebhookSecret(env) !== null
  },
  supportsIdempotencyKey: true,
  targetRequiredMessage:
    'iMessage delivery requires an explicit chat id or a stored thread binding.',
  async startTypingIndicator({ candidate, dependencies }) {
    const startTyping = dependencies.startLinqTyping ?? startLinqTypingIndicator
    return (await startTyping({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({ actorId, candidate, deliverySource, dependencies, idempotencyKey, message, replyToMessageId }) {
    const send = dependencies.sendLinq ?? sendLinqMessage
    let delivered
    try {
      delivered = await send({
        fromPhoneNumber: deliverySource?.kind === 'linq' ? deliverySource.fromPhoneNumber : null,
        idempotencyKey: idempotencyKey ?? null,
        target: candidate.target,
        targetKind: candidate.kind,
        message,
        replyToMessageId: replyToMessageId ?? null,
      })
    } catch (error) {
      const recovered = await maybeRecoverMissingLinqDirectThread({
        actorId,
        candidate,
        dependencies,
        error,
        idempotencyKey,
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
  canAutoReply(capture) {
    return capture.threadIsDirect === true
      ? null
      : 'Email auto-reply only runs for direct threads'
  },
  isReadyForSetup(env) {
    return resolveAgentmailApiKey(env) !== null
  },
  supportsIdempotencyKey: false,
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

export const ASSISTANT_CHANNEL_ADAPTERS: Readonly<Record<
  AssistantChannelName,
  AssistantChannelAdapter
>> = Object.freeze({
  telegram: TELEGRAM_CHANNEL_ADAPTER,
  linq: LINQ_CHANNEL_ADAPTER,
  email: EMAIL_CHANNEL_ADAPTER,
})

async function maybeRecoverMissingLinqDirectThread(input: {
  actorId: string | null
  candidate: { kind: string; target: string }
  dependencies: AssistantChannelDependencies
  error: unknown
  idempotencyKey?: string | null
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

  const send = input.dependencies.sendLinq ?? sendLinqMessage
  for (const sender of senders) {
    let delivered
    try {
      delivered = await send({
        fromPhoneNumber: sender,
        idempotencyKey: input.idempotencyKey ?? null,
        target: recipient,
        targetKind: 'participant',
        message: input.message,
        replyToMessageId: input.replyToMessageId ?? null,
      })
    } catch {
      continue
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
  return error instanceof VaultCliError
    && error.code === 'LINQ_API_REQUEST_FAILED'
    && error.context?.provider === 'linq'
    && error.context?.status === 404
    && typeof error.message === 'string'
    && error.message.includes('Chat not found')
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
    return probed.phoneNumbers
      .map((phoneNumber) => phoneNumber?.trim() ?? '')
      .filter((phoneNumber) => phoneNumber.startsWith('+'))
  } catch {
    return []
  }
}
