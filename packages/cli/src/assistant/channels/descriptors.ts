import {
  resolveAgentmailApiKey,
} from '../../agentmail-runtime.js'
import {
  resolveLinqApiToken,
  resolveLinqWebhookSecret,
} from '../../linq-runtime.js'
import {
  resolveTelegramBotToken,
} from '../../telegram-runtime.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import {
  createAssistantChannelAdapter,
  inferFallbackBindingDelivery,
  inferThreadFirstBindingDelivery,
  readDeliveredTarget,
} from './helpers.js'
import {
  sendEmailMessage,
  sendImessageMessage,
  sendLinqMessage,
  sendTelegramMessage,
} from './runtime.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelName,
} from './types.js'

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
  supportsIdempotencyKey: false,
  targetRequiredMessage:
    'iMessage delivery requires an explicit target or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, idempotencyKey, message }) {
    const send = dependencies.sendImessage ?? sendImessageMessage
    await send({
      idempotencyKey: idempotencyKey ?? null,
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
  supportsIdempotencyKey: false,
  targetRequiredMessage:
    'Telegram delivery requires an explicit target or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, idempotencyKey, message }) {
    const send = dependencies.sendTelegram ?? sendTelegramMessage
    const delivered = await send({
      idempotencyKey: idempotencyKey ?? null,
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
    return resolveLinqApiToken(env) !== null && resolveLinqWebhookSecret(env) !== null
  },
  supportsIdempotencyKey: false,
  targetRequiredMessage:
    'Linq delivery requires an explicit chat id or a stored thread binding.',
  async sendMessage({ candidate, dependencies, idempotencyKey, message, replyToMessageId }) {
    const send = dependencies.sendLinq ?? sendLinqMessage
    await send({
      idempotencyKey: idempotencyKey ?? null,
      target: candidate.target,
      message,
      replyToMessageId: replyToMessageId ?? null,
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
  supportsIdempotencyKey: false,
  targetRequiredMessage:
    'Email delivery requires an explicit recipient or a stored delivery binding.',
  async sendMessage({ candidate, dependencies, idempotencyKey, identityId, message }) {
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
      message,
    })
    return {
      target: readDeliveredTarget(delivered) ?? candidate.target,
    }
  },
})

export const ASSISTANT_CHANNEL_ADAPTERS: Readonly<Record<
  AssistantChannelName,
  AssistantChannelAdapter
>> = Object.freeze({
  imessage: IMESSAGE_CHANNEL_ADAPTER,
  telegram: TELEGRAM_CHANNEL_ADAPTER,
  linq: LINQ_CHANNEL_ADAPTER,
  email: EMAIL_CHANNEL_ADAPTER,
})
