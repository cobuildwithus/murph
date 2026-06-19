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
  type AssistantDeliverySource,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
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
  sendLinqVoiceMemoMessage,
  prepareTelegramVoiceMemoMessage,
  sendPreparedTelegramVoiceMemoMessage,
  sendTelegramMessage,
  sendWhatsAppMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from './runtime.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelDependencies,
  AssistantChannelName,
  AssistantDeliveryCandidate,
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
  resolveDeliveryTransportIdempotent() {
    return false
  },
  supportedResponseMediaKinds: ['voice_memo'],
  targetRequiredMessage:
    'Telegram delivery requires an explicit target or a stored delivery binding.',
  async startTypingIndicator({ candidate, dependencies }) {
    const startTyping =
      dependencies.startTelegramTyping ?? startTelegramTypingIndicator
    return (await startTyping({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({ candidate, dependencies, idempotencyKey, media, message, replyToMessageId }) {
    if (hasVoiceMemoMedia(media)) {
      return await sendTelegramVoiceMemoDelivery({
        candidate,
        dependencies,
        idempotencyKey,
        media,
        message,
        replyToMessageId,
      })
    }

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

async function sendTelegramVoiceMemoDelivery(input: {
  candidate: AssistantDeliveryCandidate
  dependencies: AssistantChannelDependencies
  idempotencyKey?: string | null
  media: readonly AssistantResponseMedia[]
  message: string
  replyToMessageId?: string | null
}): Promise<{
  cleanupTargetAliases?: string[] | null
  providerMessageId?: string | null
  providerMessageIds?: string[] | null
  target?: string | null
  targetKind?: 'explicit' | 'participant' | 'thread' | null
}> {
  const voiceMemos = input.media.filter(isVoiceMemoMedia)
  if (voiceMemos.length !== 1) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_LIMIT',
      'Telegram delivery supports one voice memo per assistant response.',
    )
  }
  if (input.media.length !== voiceMemos.length) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_MEDIA_MIX_UNSUPPORTED',
      'Telegram voice memo delivery cannot mix voice memo media with other media.',
    )
  }

  const voiceMemo = voiceMemos[0]!
  if (voiceMemo.transportRefs.telegram?.sendMode !== 'generate_at_delivery') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_TRANSPORT_REQUIRED',
      'Telegram voice memo delivery requires a Telegram generation transport reference.',
    )
  }

  const voiceMemoRuntimeDependencies = {
    ...(input.dependencies.telegramVoiceMemoRuntime ?? {}),
    ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
  }
  const preparedVoiceMemo = await prepareTelegramVoiceMemoMessage(
    {
      filename: voiceMemo.filename,
      idempotencyKey: input.idempotencyKey ?? null,
      modelId: voiceMemo.modelId,
      target: input.candidate.target,
      transcript: voiceMemo.transcript,
      voiceId: voiceMemo.voiceId,
    },
    voiceMemoRuntimeDependencies,
  )

  const providerMessageIds: string[] = []
  const cleanupTargetAliases = new Set<string>()
  const text = messageTextOrNull(input.message)
  let deliveredText:
    | {
        cleanupTargetAliases?: string[] | null
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        target?: string | null
      }
    | void
    = undefined
  if (text) {
    deliveredText = input.dependencies.sendTelegram
      ? await input.dependencies.sendTelegram({
          idempotencyKey: input.idempotencyKey ?? null,
          target: input.candidate.target,
          message: text,
          replyToMessageId: input.replyToMessageId ?? null,
          ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
        })
      : await sendTelegramMessage(
          {
            idempotencyKey: input.idempotencyKey ?? null,
            target: input.candidate.target,
            message: text,
            replyToMessageId: input.replyToMessageId ?? null,
          },
          input.dependencies.signal ? { signal: input.dependencies.signal } : {},
        )
    appendDeliveredProviderMessageIds(providerMessageIds, deliveredText)
    for (const alias of readDeliveredCleanupTargetAliases(deliveredText) ?? []) {
      cleanupTargetAliases.add(alias)
    }
  }

  const voiceMemoTarget = readDeliveredTarget(deliveredText) ?? input.candidate.target
  let deliveredVoiceMemo:
    | {
        cleanupTargetAliases?: string[] | null
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        target?: string | null
        targetKind?: 'explicit' | 'participant' | 'thread' | null
      }
    | void
  try {
    deliveredVoiceMemo = await sendPreparedTelegramVoiceMemoMessage(
      {
        ...preparedVoiceMemo,
        replyToMessageId: input.replyToMessageId ?? null,
        targetOverride: voiceMemoTarget,
      },
      input.dependencies.signal ? { signal: input.dependencies.signal } : {},
    )
  } catch (error) {
    if (!text) {
      throw error
    }
    throw createTelegramVoiceMemoPartialDeliveryFailure({
      cleanupTargetAliases: [...cleanupTargetAliases],
      error,
      idempotencyKey: input.idempotencyKey ?? null,
      providerMessageIds,
      target: voiceMemoTarget,
      targetKind: input.candidate.kind,
    })
  }

  appendDeliveredProviderMessageIds(providerMessageIds, deliveredVoiceMemo)
  for (const alias of readDeliveredCleanupTargetAliases(deliveredVoiceMemo) ?? []) {
    cleanupTargetAliases.add(alias)
  }

  return {
    ...(cleanupTargetAliases.size > 0
      ? { cleanupTargetAliases: [...cleanupTargetAliases] }
      : {}),
    target: readDeliveredTarget(deliveredVoiceMemo) ?? voiceMemoTarget,
    targetKind: readDeliveredTargetKind(deliveredVoiceMemo) ?? input.candidate.kind,
    providerMessageId: readDeliveredProviderMessageId(deliveredVoiceMemo),
    providerMessageIds: providerMessageIds.length > 0 ? providerMessageIds : null,
  }
}

function createTelegramVoiceMemoPartialDeliveryFailure(input: {
  cleanupTargetAliases: readonly string[]
  error: unknown
  idempotencyKey: string | null
  providerMessageIds: readonly string[]
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
}): VaultCliError & {
  cleanupTargetAliases?: string[]
  deliveryMayHaveSucceeded: true
  providerMessageId: string | null
  providerMessageIds: string[]
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
} {
  const providerMessageIds = [...input.providerMessageIds]
  const cleanupTargetAliases = [...new Set(input.cleanupTargetAliases)]
  const error = new VaultCliError(
    'ASSISTANT_TELEGRAM_VOICE_MEMO_PARTIAL_DELIVERY',
    'Telegram voice memo delivery failed after the text message was accepted; automatic retry is disabled to avoid duplicate text.',
    {
      ...(cleanupTargetAliases.length > 0 ? { cleanupTargetAliases } : {}),
      idempotencyKey: input.idempotencyKey,
      providerMessageIds,
      target: input.target,
      targetKind: input.targetKind,
      voiceMemoFailure: normalizeDeliveryFailureCode(input.error),
    },
  )

  return Object.assign(error, {
    ...(cleanupTargetAliases.length > 0 ? { cleanupTargetAliases } : {}),
    deliveryMayHaveSucceeded: true as const,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    target: input.target,
    targetKind: input.targetKind,
  })
}

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
  resolveDeliveryTransportIdempotent({ media }) {
    return !hasVoiceMemoMedia(media)
  },
  supportedResponseMediaKinds: ['image', 'voice_memo'],
  targetRequiredMessage:
    'iMessage delivery requires an explicit chat id or a stored thread binding.',
  async startTypingIndicator({ candidate, dependencies }) {
    const startTyping = dependencies.startLinqTyping ?? startLinqTypingIndicator
    return (await startTyping({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({ actorId, candidate, deliverySource, dependencies, idempotencyKey, media, message, replyToMessageId }) {
    if (hasVoiceMemoMedia(media)) {
      return await sendLinqVoiceMemoDelivery({
        actorId,
        candidate,
        deliverySource,
        dependencies,
        idempotencyKey,
        media,
        message,
        replyToMessageId,
      })
    }

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
        fromPhoneNumber:
          deliverySource?.kind === 'linq'
            ? deliverySource.fromPhoneNumber
            : null,
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

async function sendLinqVoiceMemoDelivery(input: {
  actorId: string | null
  candidate: AssistantDeliveryCandidate
  deliverySource?: AssistantDeliverySource | null
  dependencies: AssistantChannelDependencies
  idempotencyKey?: string | null
  media: readonly AssistantResponseMedia[]
  message: string
  replyToMessageId?: string | null
}): Promise<{
  providerMessageId?: string | null
  providerMessageIds?: string[] | null
  providerThreadId?: string | null
  target?: string | null
  targetKind?: 'explicit' | 'participant' | 'thread' | null
}> {
  const voiceMemos = input.media.filter(isVoiceMemoMedia)
  if (voiceMemos.length !== 1) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_VOICE_MEMO_LIMIT',
      'iMessage delivery supports one voice memo per assistant response.',
    )
  }
  if (input.media.length !== voiceMemos.length) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_VOICE_MEMO_MEDIA_MIX_UNSUPPORTED',
      'iMessage voice memo delivery cannot mix voice memo media with other media.',
    )
  }

  const attachmentId = voiceMemos[0]?.transportRefs.linq?.attachmentId ?? null
  if (!attachmentId) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_VOICE_MEMO_ATTACHMENT_REQUIRED',
      'iMessage voice memo delivery requires a Linq attachment id.',
    )
  }

  const providerMessageIds: string[] = []
  const text = messageTextOrNull(input.message)
  if (!text && input.candidate.kind === 'participant') {
    throw new VaultCliError(
      'ASSISTANT_LINQ_VOICE_MEMO_CHAT_REQUIRED',
      'Native iMessage voice memo delivery requires an existing Linq chat id.',
    )
  }
  let deliveredText:
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: 'explicit' | 'participant' | 'thread' | null
      }
    | void
    = undefined
  if (text) {
    try {
      deliveredText = input.dependencies.sendLinq
        ? await input.dependencies.sendLinq({
            directRecipientPhoneNumber: normalizeDirectLinqRecipient(input.actorId),
            fromPhoneNumber:
              input.deliverySource?.kind === 'linq'
                ? input.deliverySource.fromPhoneNumber
                : null,
            idempotencyKey: input.idempotencyKey ?? null,
            target: input.candidate.target,
            targetKind: input.candidate.kind,
            message: text,
            replyToMessageId: input.replyToMessageId ?? null,
            ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
          })
        : await sendLinqMessage(
            {
              fromPhoneNumber:
                input.deliverySource?.kind === 'linq'
                  ? input.deliverySource.fromPhoneNumber
                  : null,
              idempotencyKey: input.idempotencyKey ?? null,
              target: input.candidate.target,
              targetKind: input.candidate.kind,
              message: text,
              replyToMessageId: input.replyToMessageId ?? null,
            },
            input.dependencies.signal ? { signal: input.dependencies.signal } : {},
          )
    } catch (error) {
      const recovered = await maybeRecoverMissingLinqDirectThread({
        actorId: input.actorId,
        candidate: input.candidate,
        dependencies: input.dependencies,
        error,
        fromPhoneNumber:
          input.deliverySource?.kind === 'linq'
            ? input.deliverySource.fromPhoneNumber
            : null,
        idempotencyKey: input.idempotencyKey,
        media: [],
        message: text,
        replyToMessageId: input.replyToMessageId,
      })
      if (!recovered) {
        throw error
      }
      deliveredText = recovered
    }
    const textMessageId = readDeliveredProviderMessageId(deliveredText)
    if (textMessageId) {
      providerMessageIds.push(textMessageId)
    }
  }

  const deliveredTextTarget =
    readDeliveredTarget(deliveredText)
    ?? readDeliveredProviderThreadId(deliveredText)
    ?? null
  const voiceMemoTarget = deliveredTextTarget ?? input.candidate.target
  const voiceMemoTargetKind: 'explicit' | 'participant' | 'thread' =
    deliveredTextTarget ? 'thread' : input.candidate.kind
  let deliveredVoiceMemo:
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerThreadId?: string | null
        target?: string | null
        targetKind?: 'explicit' | 'participant' | 'thread' | null
      }
    | void
  try {
    deliveredVoiceMemo = input.dependencies.sendLinqVoiceMemo
      ? await input.dependencies.sendLinqVoiceMemo({
          attachmentId,
          replyToMessageId: input.replyToMessageId ?? null,
          target: voiceMemoTarget,
          targetKind: voiceMemoTargetKind,
          ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
        })
      : await sendLinqVoiceMemoMessage(
          {
            attachmentId,
            target: voiceMemoTarget,
          },
          input.dependencies.signal ? { signal: input.dependencies.signal } : {},
        )
  } catch (error) {
    if (!text) {
      if (isAmbiguousLinqVoiceMemoDeliveryError(error)) {
        throw createLinqVoiceMemoAmbiguousDeliveryFailure({
          idempotencyKey: input.idempotencyKey ?? null,
          target: voiceMemoTarget,
          targetKind: voiceMemoTargetKind,
        })
      }
      throw error
    }
    if (isRetryableLinqVoiceMemoRateLimitError(error)) {
      throw error
    }
    throw createLinqVoiceMemoPartialDeliveryFailure({
      error,
      idempotencyKey: input.idempotencyKey ?? null,
      providerMessageIds,
      providerThreadId: readDeliveredProviderThreadId(deliveredText) ?? deliveredTextTarget,
      target: deliveredTextTarget ?? voiceMemoTarget,
      targetKind: voiceMemoTargetKind,
    })
  }
  const voiceMessageId = readDeliveredProviderMessageId(deliveredVoiceMemo)
  if (voiceMessageId) {
    providerMessageIds.push(voiceMessageId)
  }

  return {
    target: readDeliveredTarget(deliveredVoiceMemo) ?? voiceMemoTarget,
    targetKind: readDeliveredTargetKind(deliveredVoiceMemo) ?? voiceMemoTargetKind,
    providerMessageId: voiceMessageId,
    providerMessageIds: providerMessageIds.length > 0 ? providerMessageIds : null,
    providerThreadId:
      readDeliveredProviderThreadId(deliveredVoiceMemo) ?? voiceMemoTarget,
  }
}

function createLinqVoiceMemoPartialDeliveryFailure(input: {
  error: unknown
  idempotencyKey: string | null
  providerMessageIds: readonly string[]
  providerThreadId?: string | null
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
}): VaultCliError & {
  deliveryMayHaveSucceeded: true
  providerMessageId: string | null
  providerMessageIds: string[]
  providerThreadId?: string | null
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
} {
  const providerMessageIds = [...input.providerMessageIds]
  const error = new VaultCliError(
    'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
    'iMessage voice memo delivery failed after the text message was accepted; automatic retry is disabled to avoid duplicate text.',
    {
      idempotencyKey: input.idempotencyKey,
      providerMessageIds,
      providerThreadId: input.providerThreadId ?? null,
      target: input.target,
      targetKind: input.targetKind,
    },
  )

  return Object.assign(error, {
    deliveryMayHaveSucceeded: true as const,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    providerThreadId: input.providerThreadId ?? null,
    target: input.target,
    targetKind: input.targetKind,
  })
}

function createLinqVoiceMemoAmbiguousDeliveryFailure(input: {
  idempotencyKey: string | null
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
}): VaultCliError & {
  deliveryMayHaveSucceeded: true
  providerMessageId: null
  providerMessageIds: []
  providerThreadId: null
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
} {
  const error = new VaultCliError(
    'ASSISTANT_LINQ_VOICE_MEMO_PARTIAL_DELIVERY',
    'iMessage voice memo delivery ended without a provider response; automatic retry is disabled to avoid a duplicate voice memo.',
    {
      idempotencyKey: input.idempotencyKey,
      providerMessageId: null,
      providerMessageIds: [],
      providerThreadId: null,
      target: input.target,
      targetKind: input.targetKind,
    },
  )

  return Object.assign(error, {
    deliveryMayHaveSucceeded: true as const,
    providerMessageId: null,
    providerMessageIds: [] as [],
    providerThreadId: null,
    target: input.target,
    targetKind: input.targetKind,
  })
}

function isAmbiguousLinqVoiceMemoDeliveryError(error: unknown): boolean {
  return (
    error instanceof VaultCliError &&
    error.code === 'LINQ_API_REQUEST_FAILED' &&
    error.context?.provider === 'linq' &&
    error.context?.operation === 'send_voice_memo' &&
    error.context?.method === 'POST' &&
    error.context?.failureStage === 'transport'
  )
}

function hasVoiceMemoMedia(
  media: readonly AssistantResponseMedia[],
): boolean {
  return media.some(isVoiceMemoMedia)
}

function isVoiceMemoMedia(
  media: AssistantResponseMedia,
): media is Extract<AssistantResponseMedia, { kind: 'voice_memo' }> {
  return media.kind === 'voice_memo'
}

function appendDeliveredProviderMessageIds(
  output: string[],
  delivered:
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
      }
    | void,
): void {
  const providerMessageIds = readDeliveredProviderMessageIds(delivered)
  if (providerMessageIds?.length) {
    output.push(...providerMessageIds)
    return
  }

  const providerMessageId = readDeliveredProviderMessageId(delivered)
  if (providerMessageId) {
    output.push(providerMessageId)
  }
}

function normalizeDeliveryFailureCode(error: unknown): string | null {
  return error instanceof VaultCliError && error.code
    ? error.code
    : null
}

function messageTextOrNull(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

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
  supportedResponseMediaKinds: [],
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
  supportedResponseMediaKinds: [],
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
  fromPhoneNumber?: string | null
  idempotencyKey?: string | null
  media?: readonly AssistantResponseMedia[] | null
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

  const trustedSender = normalizeDirectLinqRecipient(input.fromPhoneNumber ?? null)
  const senders = trustedSender
    ? [trustedSender]
    : await resolveLinqSenderPhoneNumbers({
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

function isRetryableLinqVoiceMemoRateLimitError(error: unknown): boolean {
  return error instanceof VaultCliError &&
    error.code === 'LINQ_API_REQUEST_FAILED' &&
    error.context?.failureStage === 'http' &&
    error.context?.operation === 'send_voice_memo' &&
    error.context?.retryable === true &&
    error.context?.status === 429
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
