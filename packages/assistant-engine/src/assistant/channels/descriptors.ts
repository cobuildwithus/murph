import {
  resolveAgentmailApiKey,
} from '@murphai/operator-config/agentmail-runtime'
import {
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '@murphai/operator-config/linq-runtime'
import {
  resolveTelegramBotToken,
} from '@murphai/operator-config/telegram-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantChannelAdapter,
  inferThreadFirstBindingDelivery,
  readDeliveredProviderMessageId,
  readDeliveredProviderThreadId,
  readDeliveredTarget,
} from './helpers.js'
import {
  sendEmailMessage,
  sendLinqMessage,
  sendTelegramMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from './runtime.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelName,
} from './types.js'

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
      target: readDeliveredTarget(delivered) ?? candidate.target,
      providerMessageId: readDeliveredProviderMessageId(delivered),
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
    return resolveLinqApiToken(env) !== null && resolveLinqWebhookSecret(env) !== null
  },
  supportsIdempotencyKey: false,
  targetRequiredMessage:
    'Linq delivery requires an explicit chat id or a stored thread binding.',
  async startTypingIndicator({ candidate, dependencies }) {
    const startTyping = dependencies.startLinqTyping ?? startLinqTypingIndicator
    return (await startTyping({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({ candidate, dependencies, idempotencyKey, message, replyToMessageId }) {
    const send = dependencies.sendLinq ?? sendLinqMessage
    const delivered = await send({
      idempotencyKey: idempotencyKey ?? null,
      target: candidate.target,
      message,
      replyToMessageId: replyToMessageId ?? null,
    })

    return {
      providerMessageId: readDeliveredProviderMessageId(delivered),
    }
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
  supportsIdempotencyKey: false,
  targetRequiredMessage:
    'Email delivery requires an explicit recipient or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, idempotencyKey, identityId, message, replyToMessageId }) {
    const send = dependencies.sendEmail ?? sendEmailMessage
    if (!identityId && !dependencies.sendEmail) {
      throw new VaultCliError(
        'ASSISTANT_EMAIL_IDENTITY_REQUIRED',
        'Email delivery requires a configured email sender identity. Pass --identity or resume a session already bound to email.',
      )
    }
    const delivered = await send({
      idempotencyKey: idempotencyKey ?? null,
      identityId: identityId!,
      target: candidate.target,
      targetKind: candidate.kind,
      replyToMessageId: replyToMessageId ?? null,
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
