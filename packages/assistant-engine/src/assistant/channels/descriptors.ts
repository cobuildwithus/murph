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
  type AssistantBindingDelivery,
  type AssistantDeliverySource,
  type AssistantProviderMessageEffect,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  resolveTelegramBotToken,
  setTelegramMessageReaction,
} from '@murphai/operator-config/telegram-runtime'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantChannelAdapter,
  inferBindingDeliveryForChannel,
  normalizeOptionalText,
  readDeliveredCleanupMessages,
  readDeliveredCleanupTargetAliases,
  readDeliveredIdempotencyKey,
  readDeliveredProviderMessageId,
  readDeliveredProviderMessageEffects,
  readDeliveredProviderMessageIds,
  readDeliveredProviderThreadId,
  readDeliveredTarget,
  readDeliveredTargetKind,
  readDeliveredTargetMessageId,
} from './helpers.js'
import { createAssistantDeliveryConfirmationPendingError } from '../outbox/retry-policy.js'
import {
  sendEmailMessage,
  sendLinqMessage,
  setLinqMessageReaction,
  sendLinqVoiceMemoMessage,
  sendTelegramImageMessage,
  prepareTelegramVoiceMemoMessage,
  sendPreparedTelegramVoiceMemoMessage,
  sendTelegramMessage,
  startLinqTypingIndicator,
  startTelegramTypingIndicator,
} from './runtime.js'
import type {
  AssistantChannelAdapter,
  AssistantChannelDependencies,
  AssistantChannelName,
  AssistantDeliveryCandidate,
  AssistantEmailDeliverySummary,
} from './types.js'

const TELEGRAM_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'telegram',
  canAutoReply(eligibility) {
    return eligibility.threadIsDirect === true ||
      (
        eligibility.threadIsDirect === false &&
        eligibility.externalThreadRouteAuthorityPresent === true
      )
      ? null
      : 'Telegram auto-reply only runs for direct chats or validated hosted group routes'
  },
  isReadyForSetup(env) {
    return resolveTelegramBotToken(env) !== null
  },
  supportsIdempotencyKey: false,
  resolveDeliveryTransportIdempotent() {
    return false
  },
  supportedResponseMediaKinds: ['image', 'vault_image', 'voice_memo'],
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
    if (hasImageMedia(media)) {
      return await sendTelegramImageDelivery({
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
  async setMessageReaction({ candidate, dependencies, reaction, targetMessageId }) {
    const delivered = dependencies.setTelegramMessageReaction
      ? await dependencies.setTelegramMessageReaction({
          reaction,
          target: candidate.target,
          targetMessageId,
          signal: dependencies.signal,
        })
      : await setTelegramMessageReaction(
          {
            reaction,
            target: candidate.target,
            targetMessageId,
          },
          dependencies.signal ? { signal: dependencies.signal } : {},
        )

    return {
      target: readDeliveredTarget(delivered) ?? candidate.target,
      targetKind: readDeliveredTargetKind(delivered) ?? candidate.kind,
      targetMessageId,
    }
  },
})

async function sendTelegramImageDelivery(input: {
  candidate: AssistantDeliveryCandidate
  dependencies: AssistantChannelDependencies
  idempotencyKey?: string | null
  media: readonly AssistantResponseMedia[]
  message: string
  replyToMessageId?: string | null
}): Promise<{
  cleanupMessages?: Array<{ messageId: string; target: string }> | null
  cleanupTargetAliases?: string[] | null
  providerMessageId?: string | null
  providerMessageIds?: string[] | null
  target?: string | null
  targetKind?: 'explicit' | 'participant' | 'thread' | null
}> {
  const images = input.media.filter(isImageMedia)
  if (images.length !== input.media.length) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_IMAGE_MEDIA_MIX_UNSUPPORTED',
      'Telegram image delivery cannot mix image media with other media.',
    )
  }

  const request = {
    idempotencyKey: input.idempotencyKey ?? null,
    media: images,
    message: input.message,
    replyToMessageId: input.replyToMessageId ?? null,
    ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
    target: input.candidate.target,
  }
  const delivered = input.dependencies.sendTelegramImage
    ? await input.dependencies.sendTelegramImage(request)
    : await sendTelegramImageMessage(
        request,
        input.dependencies.signal ? { signal: input.dependencies.signal } : {},
      )

  return {
    cleanupMessages: readDeliveredCleanupMessages(delivered),
    cleanupTargetAliases: readDeliveredCleanupTargetAliases(delivered),
    target: readDeliveredTarget(delivered) ?? input.candidate.target,
    targetKind: readDeliveredTargetKind(delivered) ?? input.candidate.kind,
    providerMessageId: readDeliveredProviderMessageId(delivered),
    providerMessageIds: readDeliveredProviderMessageIds(delivered),
  }
}

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
  if (voiceMemo.transport.kind !== 'telegram_generation') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_TRANSPORT_REQUIRED',
      'Telegram voice memo delivery requires a Telegram generation transport.',
    )
  }

  const providerMessageIds: string[] = []
  const cleanupTargetAliases = new Set<string>()
  const text = messageTextOrNull(input.message)
  const fallbackText = messageTextOrNull(voiceMemo.transcript ?? '')
  const voiceMemoRuntimeDependencies = {
    ...(input.dependencies.telegramVoiceMemoRuntime ?? {}),
    ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
  }
  let preparedVoiceMemo: Awaited<ReturnType<typeof prepareTelegramVoiceMemoMessage>>
  try {
    preparedVoiceMemo = await prepareTelegramVoiceMemoMessage(
      {
        filename: voiceMemo.filename,
        generation: voiceMemo.transport.generation,
        target: input.candidate.target,
      },
      voiceMemoRuntimeDependencies,
    )
  } catch (error) {
    const preparationFallbackText = fallbackText
      ? composeVoiceMemoFallbackText(text, fallbackText)
      : text
    if (!preparationFallbackText) {
      throw error
    }
    const deliveredFallback = await sendTelegramTextDelivery({
      dependencies: input.dependencies,
      idempotencyKey: fallbackText ? null : input.idempotencyKey ?? null,
      message: preparationFallbackText,
      replyToMessageId: input.replyToMessageId ?? null,
      target: input.candidate.target,
    })
    appendDeliveredProviderMessageIds(providerMessageIds, deliveredFallback)
    for (const alias of readDeliveredCleanupTargetAliases(deliveredFallback) ?? []) {
      cleanupTargetAliases.add(alias)
    }
    return summarizeTelegramVoiceMemoDelivery({
      cleanupTargetAliases,
      delivered: deliveredFallback,
      fallbackTarget: input.candidate.target,
      fallbackTargetKind: input.candidate.kind,
      providerMessageIds,
    })
  }

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
    deliveredText = await sendTelegramTextDelivery({
      dependencies: input.dependencies,
      idempotencyKey: input.idempotencyKey ?? null,
      message: text,
      replyToMessageId: input.replyToMessageId ?? null,
      target: input.candidate.target,
    })
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
      voiceMemoRuntimeDependencies,
    )
  } catch (error) {
    if (fallbackText) {
      try {
        const deliveredFallback = await sendTelegramTextDelivery({
          dependencies: input.dependencies,
          idempotencyKey: null,
          message: fallbackText,
          replyToMessageId: null,
          target: voiceMemoTarget,
        })
        appendDeliveredProviderMessageIds(providerMessageIds, deliveredFallback)
        for (const alias of readDeliveredCleanupTargetAliases(deliveredFallback) ?? []) {
          cleanupTargetAliases.add(alias)
        }
        return summarizeTelegramVoiceMemoDelivery({
          cleanupTargetAliases,
          delivered: deliveredFallback,
          fallbackTarget: voiceMemoTarget,
          fallbackTargetKind: input.candidate.kind,
          providerMessageIds,
        })
      } catch {
        // Preserve the existing partial-delivery owner when accepted text is
        // the only effect we can prove.
      }
    }
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

  return summarizeTelegramVoiceMemoDelivery({
    cleanupTargetAliases,
    delivered: deliveredVoiceMemo,
    fallbackTarget: voiceMemoTarget,
    fallbackTargetKind: input.candidate.kind,
    providerMessageIds,
  })
}

async function sendTelegramTextDelivery(input: {
  dependencies: AssistantChannelDependencies
  idempotencyKey: string | null
  message: string
  replyToMessageId: string | null
  target: string
}) {
  return input.dependencies.sendTelegram
    ? await input.dependencies.sendTelegram({
        idempotencyKey: input.idempotencyKey,
        target: input.target,
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
      })
    : await sendTelegramMessage(
        {
          idempotencyKey: input.idempotencyKey,
          target: input.target,
          message: input.message,
          replyToMessageId: input.replyToMessageId,
        },
        input.dependencies.signal ? { signal: input.dependencies.signal } : {},
      )
}

function summarizeTelegramVoiceMemoDelivery(input: {
  cleanupTargetAliases: ReadonlySet<string>
  delivered:
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        target?: string | null
        targetKind?: 'explicit' | 'participant' | 'thread' | null
      }
    | void
  fallbackTarget: string
  fallbackTargetKind: 'explicit' | 'participant' | 'thread'
  providerMessageIds: readonly string[]
}) {
  return {
    ...(input.cleanupTargetAliases.size > 0
      ? { cleanupTargetAliases: [...input.cleanupTargetAliases] }
      : {}),
    target: readDeliveredTarget(input.delivered) ?? input.fallbackTarget,
    targetKind:
      readDeliveredTargetKind(input.delivered) ?? input.fallbackTargetKind,
    providerMessageId: readDeliveredProviderMessageId(input.delivered),
    providerMessageIds:
      input.providerMessageIds.length > 0 ? [...input.providerMessageIds] : null,
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
    return eligibility.threadIsDirect === true ||
      eligibility.externalThreadRouteAuthorityPresent === true
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
  inferBindingDelivery(input) {
    return inferBindingDeliveryForChannel({
      channel: 'linq',
      conversation: input.conversation,
      deliveryKind: input.deliveryKind ?? null,
      deliveryTarget: input.deliveryTarget ?? null,
    })
  },
  supportedResponseMediaKinds: ['image', 'vault_image', 'voice_memo', 'vault_file'],
  targetRequiredMessage:
    'iMessage delivery requires an explicit chat id or a stored thread binding.',
  async startTypingIndicator({ candidate, dependencies, replyToMessageId }) {
    if (dependencies.startLinqTyping) {
      return (await dependencies.startLinqTyping({
        replyToMessageId,
        target: candidate.target,
        targetKind: candidate.kind,
      })) ?? null
    }

    return (await startLinqTypingIndicator({
      target: candidate.target,
    })) ?? null
  },
  async sendMessage({
    actorId,
    answeredMailboxItemIds,
    bindingDelivery,
    candidate,
    card,
    deliverySource,
    dependencies,
    explicitTarget,
    idempotencyKey,
    media,
    message,
    nativeReplyRequested,
    replyToMessageId,
    threadIsDirect,
  }) {
    if (hasVoiceMemoMedia(media)) {
      return await sendLinqVoiceMemoDelivery({
        actorId,
        answeredMailboxItemIds,
        bindingDelivery,
        candidate,
        deliverySource,
        dependencies,
        explicitTarget,
        idempotencyKey,
        media,
        message,
        ...(nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
        replyToMessageId,
        threadIsDirect,
      })
    }

    let delivered
    let effectiveTextDelivery = card === null
      ? { idempotencyKey }
      : null
    const persistLinqAppCardTextFallback =
      dependencies.persistLinqAppCardTextFallback
    const persistAppCardTextFallback =
      persistLinqAppCardTextFallback
        ? async (input: { idempotencyKey: string }): Promise<void> => {
            await persistLinqAppCardTextFallback(input)
            effectiveTextDelivery = input
          }
        : undefined
    const mediaInput = media.length > 0 ? media : undefined
    const request: Parameters<
      NonNullable<AssistantChannelDependencies['sendLinq']>
    >[0] = {
      directRecipientPhoneNumber: normalizeDirectLinqRecipient(actorId),
      fromPhoneNumber: deliverySource?.kind === 'linq' ? deliverySource.fromPhoneNumber : null,
      idempotencyKey: idempotencyKey ?? null,
      target: candidate.target,
      targetKind: candidate.kind,
      ...(card === null ? {} : { card, threadIsDirect }),
      message,
      ...(nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
      ...(mediaInput ? { media: mediaInput } : {}),
      ...(persistAppCardTextFallback
        ? {
            persistAppCardTextFallback,
          }
        : {}),
      replyToMessageId: replyToMessageId ?? null,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    }
    try {
      delivered = dependencies.sendLinq
        ? await dependencies.sendLinq({
            ...request,
            answeredMailboxItemIds: answeredMailboxItemIds ?? [],
            homeRouteFallbackAllowed: shouldAllowLinqHomeRouteFallback({
              bindingDelivery,
              candidate,
              explicitTarget,
              threadIsDirect,
            }),
            ...(mediaInput ? { media: mediaInput } : {}),
          })
        : await sendLinqMessage(request, {
            ...(request.persistAppCardTextFallback
              ? {
                  persistAppCardTextFallback:
                    request.persistAppCardTextFallback,
                }
              : {}),
            ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          })
    } catch (error) {
      const textDelivery = effectiveTextDelivery
      const recovered = textDelivery
        ? await maybeRecoverMissingLinqDirectThread({
            actorId,
            candidate,
            dependencies,
            error,
            fromPhoneNumber:
              deliverySource?.kind === 'linq'
                ? deliverySource.fromPhoneNumber
                : null,
            idempotencyKey: textDelivery.idempotencyKey,
            media,
            message,
            ...(nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
            replyToMessageId,
            threadIsDirect,
          })
        : null
      if (!recovered) {
        throw error
      }
      delivered = recovered
    }

    const deliveredTarget = readDeliveredTarget(delivered)
    const providerThreadId = readDeliveredProviderThreadId(delivered)
    return {
      idempotencyKey:
        readDeliveredIdempotencyKey(delivered) ??
        effectiveTextDelivery?.idempotencyKey ??
        idempotencyKey,
      target: deliveredTarget ?? providerThreadId ?? candidate.target,
      targetKind: inferDeliveredLinqTargetKind(candidate.kind, delivered),
      providerMessageId: readDeliveredProviderMessageId(delivered),
      providerMessageEffects: readDeliveredProviderMessageEffects(delivered),
      providerMessageIds: readDeliveredProviderMessageIds(delivered),
      providerThreadId: providerThreadId ?? deliveredTarget,
    }
  },
  async setMessageReaction({ candidate, dependencies, reaction, targetMessageId }) {
    const delivered = dependencies.setLinqMessageReaction
      ? await dependencies.setLinqMessageReaction({
          reaction,
          target: candidate.target,
          targetMessageId,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
        })
      : await setLinqMessageReaction(
          {
            reaction,
            targetMessageId,
          },
          dependencies.signal ? { signal: dependencies.signal } : {},
        )

    return {
      target: readDeliveredTarget(delivered) ?? candidate.target,
      targetKind: readDeliveredTargetKind(delivered) ?? candidate.kind,
      targetMessageId:
        readDeliveredTargetMessageId(delivered) ?? targetMessageId,
    }
  },
})

async function sendLinqVoiceMemoDelivery(input: {
  actorId: string | null
  answeredMailboxItemIds?: readonly string[] | null
  bindingDelivery: AssistantBindingDelivery | null
  candidate: AssistantDeliveryCandidate
  deliverySource?: AssistantDeliverySource | null
  dependencies: AssistantChannelDependencies
  explicitTarget: string | null
  idempotencyKey?: string | null
  media: readonly AssistantResponseMedia[]
  message: string
  nativeReplyRequested?: true
  replyToMessageId?: string | null
  threadIsDirect: boolean | null
}): Promise<{
  providerMessageId?: string | null
  providerMessageEffects?: AssistantProviderMessageEffect[] | null
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

  const voiceMemo = voiceMemos[0]!
  if (voiceMemo.transport.kind !== 'linq_attachment') {
    throw new VaultCliError(
      'ASSISTANT_LINQ_VOICE_MEMO_ATTACHMENT_REQUIRED',
      'iMessage voice memo delivery requires a Linq attachment transport.',
    )
  }
  const attachmentId = voiceMemo.transport.attachmentId

  const providerMessageIds: string[] = []
  const providerMessageEffects: AssistantProviderMessageEffect[] = []
  const text = messageTextOrNull(input.message)
  const fallbackText = messageTextOrNull(voiceMemo.transcript ?? '')
  if (input.nativeReplyRequested === true && !text) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_NATIVE_REPLY_TEXT_REQUIRED',
      'A native iMessage voice-memo response requires a text message to carry the reply target.',
    )
  }
  const homeRouteFallbackAllowed = shouldAllowLinqHomeRouteFallback({
    bindingDelivery: input.bindingDelivery,
    candidate: input.candidate,
    explicitTarget: input.explicitTarget,
    threadIsDirect: input.threadIsDirect,
  })
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
            answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
            fromPhoneNumber:
              input.deliverySource?.kind === 'linq'
                ? input.deliverySource.fromPhoneNumber
                : null,
            homeRouteFallbackAllowed,
            idempotencyKey: input.idempotencyKey ?? null,
            target: input.candidate.target,
            targetKind: input.candidate.kind,
            message: text,
            ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
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
              ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
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
        ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
        replyToMessageId: input.replyToMessageId,
        threadIsDirect: input.threadIsDirect,
      })
      if (!recovered) {
        throw error
      }
      deliveredText = recovered
    }
    appendDeliveredProviderMessageIds(providerMessageIds, deliveredText)
    appendDeliveredProviderMessageEffects(
      providerMessageEffects,
      deliveredText,
    )
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
          answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
          attachmentId,
          homeRouteFallbackAllowed,
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
    if (fallbackText) {
      try {
        const deliveredFallback = await sendLinqVoiceMemoFallbackText({
          answeredMailboxItemIds: input.answeredMailboxItemIds ?? [],
          attachmentId,
          dependencies: input.dependencies,
          directRecipientPhoneNumber: normalizeDirectLinqRecipient(input.actorId),
          deliveryIdempotencyKey: input.idempotencyKey ?? null,
          fromPhoneNumber:
            input.deliverySource?.kind === 'linq'
              ? input.deliverySource.fromPhoneNumber
              : null,
          homeRouteFallbackAllowed,
          message: fallbackText,
          replyToMessageId: input.replyToMessageId ?? null,
          target: voiceMemoTarget,
          targetKind: voiceMemoTargetKind,
        })
        appendDeliveredProviderMessageIds(providerMessageIds, deliveredFallback)
        appendDeliveredProviderMessageEffects(
          providerMessageEffects,
          deliveredFallback,
        )
        return {
          target: readDeliveredTarget(deliveredFallback) ?? voiceMemoTarget,
          targetKind:
            readDeliveredTargetKind(deliveredFallback) ?? voiceMemoTargetKind,
          providerMessageId: readDeliveredProviderMessageId(deliveredFallback),
          providerMessageEffects:
            providerMessageEffects.length > 0 ? providerMessageEffects : null,
          providerMessageIds: providerMessageIds.length > 0 ? providerMessageIds : null,
          providerThreadId:
            readDeliveredProviderThreadId(deliveredFallback) ??
            readDeliveredProviderThreadId(deliveredText) ??
            voiceMemoTarget,
        }
      } catch {
        // Preserve the existing partial-delivery owner when accepted text is
        // the only effect we can prove.
      }
    }
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
    if (!fallbackText && isRetryableLinqVoiceMemoRateLimitError(error)) {
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
  appendDeliveredProviderMessageIds(providerMessageIds, deliveredVoiceMemo)
  appendDeliveredProviderMediaEffects(
    providerMessageEffects,
    deliveredVoiceMemo,
  )
  const voiceMessageId = readDeliveredProviderMessageId(deliveredVoiceMemo)

  return {
    target: readDeliveredTarget(deliveredVoiceMemo) ?? voiceMemoTarget,
    targetKind: readDeliveredTargetKind(deliveredVoiceMemo) ?? voiceMemoTargetKind,
    providerMessageId: voiceMessageId,
    providerMessageEffects:
      providerMessageEffects.length > 0 ? providerMessageEffects : null,
    providerMessageIds: providerMessageIds.length > 0 ? providerMessageIds : null,
    providerThreadId:
      readDeliveredProviderThreadId(deliveredVoiceMemo) ?? voiceMemoTarget,
  }
}

async function sendLinqVoiceMemoFallbackText(input: {
  answeredMailboxItemIds: readonly string[]
  attachmentId: string
  dependencies: AssistantChannelDependencies
  directRecipientPhoneNumber: string | null
  deliveryIdempotencyKey: string | null
  fromPhoneNumber: string | null
  homeRouteFallbackAllowed: boolean
  message: string
  replyToMessageId: string | null
  target: string
  targetKind: 'explicit' | 'participant' | 'thread'
}) {
  const idempotencyKey = buildLinqVoiceMemoFallbackIdempotencyKey(input)
  return input.dependencies.sendLinq
    ? await input.dependencies.sendLinq({
        answeredMailboxItemIds: input.answeredMailboxItemIds,
        directRecipientPhoneNumber: input.directRecipientPhoneNumber,
        fromPhoneNumber: input.fromPhoneNumber,
        homeRouteFallbackAllowed: input.homeRouteFallbackAllowed,
        idempotencyKey,
        message: input.message,
        replyToMessageId: input.replyToMessageId,
        ...(input.dependencies.signal ? { signal: input.dependencies.signal } : {}),
        target: input.target,
        targetKind: input.targetKind,
      })
    : await sendLinqMessage(
        {
          fromPhoneNumber: input.fromPhoneNumber,
          idempotencyKey,
          message: input.message,
          replyToMessageId: input.replyToMessageId,
          target: input.target,
          targetKind: input.targetKind,
        },
        input.dependencies.signal ? { signal: input.dependencies.signal } : {},
      )
}

function buildLinqVoiceMemoFallbackIdempotencyKey(input: {
  attachmentId: string
  deliveryIdempotencyKey: string | null
}): string {
  const stableParent = input.deliveryIdempotencyKey?.trim() || input.attachmentId
  return `linq-voice-memo-transcript:${stableParent}`
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

function hasImageMedia(
  media: readonly AssistantResponseMedia[],
): boolean {
  return media.some(isImageMedia)
}

function isImageMedia(
  media: AssistantResponseMedia,
): media is Extract<AssistantResponseMedia, { kind: 'image' | 'vault_image' }> {
  return media.kind === 'image' || media.kind === 'vault_image'
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

function appendDeliveredProviderMessageEffects(
  output: AssistantProviderMessageEffect[],
  delivered:
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerMessageEffects?: AssistantProviderMessageEffect[] | null
      }
    | void,
): void {
  const deliveredEffects = readDeliveredProviderMessageEffects(delivered)
  if (deliveredEffects) {
    output.push(...deliveredEffects)
  }
}

function appendDeliveredProviderMediaEffects(
  output: AssistantProviderMessageEffect[],
  delivered:
    | {
        providerMessageId?: string | null
        providerMessageIds?: string[] | null
        providerMessageEffects?: AssistantProviderMessageEffect[] | null
      }
    | void,
): void {
  const deliveredEffects = readDeliveredProviderMessageEffects(delivered)
  if (deliveredEffects) {
    output.push(...deliveredEffects)
    return
  }

  const providerMessageIds =
    readDeliveredProviderMessageIds(delivered) ??
    [readDeliveredProviderMessageId(delivered)].filter(
      (providerMessageId): providerMessageId is string =>
        providerMessageId !== null,
    )
  for (const providerMessageId of providerMessageIds) {
    output.push({ message: null, providerMessageId })
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

function composeVoiceMemoFallbackText(
  message: string | null,
  transcript: string,
): string {
  return message ? `${message}\n\n${transcript}` : transcript
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

function shouldAllowLinqHomeRouteFallback(input: {
  bindingDelivery: AssistantBindingDelivery | null
  candidate: AssistantDeliveryCandidate
  explicitTarget: string | null
  threadIsDirect: boolean | null
}): boolean {
  return (
    input.threadIsDirect === true &&
    input.explicitTarget === null &&
    input.candidate.kind === 'thread' &&
    input.bindingDelivery?.kind === 'thread' &&
    normalizeOptionalText(input.bindingDelivery.target) === input.candidate.target
  )
}

const EMAIL_CHANNEL_ADAPTER = createAssistantChannelAdapter({
  channel: 'email',
  canAutoReply(eligibility) {
    const hostedThreadTarget = parseHostedEmailThreadTarget(
      eligibility.replyTargetThreadId,
    )
    return eligibility.threadIsDirect === true ||
      (
        eligibility.threadIsDirect === false &&
        hostedThreadTarget?.targetKind === 'group'
      )
      ? null
      : 'Email auto-reply only runs for direct threads or validated hosted group routes'
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
    const deliverySummary =
      delivered && typeof delivered === 'object' && 'delivery' in delivered
        ? delivered.delivery
        : null
    if (deliverySummary && deliverySummary.status !== 'sent') {
      if (
        deliverySummary.sentCount === 0 &&
        deliverySummary.failedCount === 0 &&
        deliverySummary.skippedCount > 0
      ) {
        throw createEmailGroupRecipientAuthoritySupersededError(deliverySummary)
      }
      throw createEmailGroupFanoutIncompleteError(deliverySummary)
    }
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

function createEmailGroupRecipientAuthoritySupersededError(
  delivery: AssistantEmailDeliverySummary,
): VaultCliError & { deliveryMayHaveSucceeded: false; retryable: false } {
  const error = new VaultCliError(
    'ASSISTANT_EMAIL_GROUP_RECIPIENT_AUTHORITY_SUPERSEDED',
    'Group email recipient authority changed before delivery began; the recipient-scoped delivery was superseded before the provider call.',
    {
      failedCount: delivery.failedCount,
      sentCount: delivery.sentCount,
      skippedCount: delivery.skippedCount,
      status: delivery.status,
    },
  )

  return Object.assign(error, {
    deliveryMayHaveSucceeded: false as const,
    retryable: false as const,
  })
}

function createEmailGroupFanoutIncompleteError(
  delivery: AssistantEmailDeliverySummary,
): VaultCliError & { deliveryMayHaveSucceeded: true } {
  const error = new VaultCliError(
    'ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE',
    'Group email delivery could not be confirmed for every recipient; automatic retry is disabled to avoid duplicate email.',
    {
      failedCount: delivery.failedCount,
      sentCount: delivery.sentCount,
      skippedCount: delivery.skippedCount,
      status: delivery.status,
    },
  )

  return Object.assign(error, {
    deliveryMayHaveSucceeded: true as const,
  })
}

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
  fromPhoneNumber?: string | null
  idempotencyKey?: string | null
  media?: readonly AssistantResponseMedia[] | null
  message: string
  nativeReplyRequested?: true
  replyToMessageId?: string | null
  threadIsDirect: boolean | null
}): Promise<
  | {
      providerMessageId?: string | null
      providerThreadId?: string | null
      target?: string | null
    }
  | null
> {
  if (
    input.threadIsDirect !== true ||
    input.dependencies.sendLinq ||
    input.nativeReplyRequested === true ||
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
