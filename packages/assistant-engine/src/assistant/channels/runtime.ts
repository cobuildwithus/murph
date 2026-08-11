import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
  type TelegramThreadTarget,
} from '@murphai/messaging-ingress/telegram-webhook'
import {
  createAgentmailApiClient,
  resolveAgentmailApiKey,
  resolveAgentmailBaseUrl,
} from '@murphai/operator-config/agentmail-runtime'
import {
  checkLinqIMessageCapability,
  createLinqChat,
  isDefinitiveLinqIMessageAppCardRejection,
  resolveLinqApiToken,
  sendLinqChatMessage,
  sendLinqIMessageAppCard,
  setLinqMessageReaction as setLinqApiMessageReaction,
  sendLinqVoiceMemo,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
  uploadLinqAttachment,
} from '@murphai/operator-config/linq-runtime'
import {
  generateElevenLabsVoiceMemoAudio,
  resolveElevenLabsApiKey,
  type ElevenLabsFetch,
} from '@murphai/operator-config/elevenlabs-runtime'
import {
  assertTelegramAuthorityBoundTarget,
  deleteTelegramMessages,
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  type TelegramFetchImplementation,
  type TelegramFetchResponse,
  startTelegramTypingSession,
} from '@murphai/operator-config/telegram-runtime'
import {
  createLinkedAbortSignal,
  createTimeoutAbortController,
} from '@murphai/operator-config/http-retry'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  createAssistantDeliveryTransientError,
} from '@murphai/operator-config/assistant/delivery-failure'
import {
  renderMarkdownMessageText,
  splitDecoratedMessageText,
  type MessageTextDecoration,
} from '@murphai/operator-config/message-formatting'
import type {
  AssistantChannelActivityHandle,
  AssistantChannelActivityStopOptions,
  AssistantDeliveryCandidate,
  EmailRuntimeDependencies,
  LinqRuntimeDependencies,
  TelegramRuntimeDependencies,
} from './types.js'
import type {
  AssistantMessageReaction,
  AssistantProviderMessageEffect,
  AssistantResponseMedia,
  AssistantVoiceMemoGeneration,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantResponseCard,
  TelegramRichMessage,
} from '@murphai/operator-config/assistant-response-cards'
import { normalizeOptionalText } from './helpers.js'

const TELEGRAM_MAX_TEXT_LENGTH = 4096
const TELEGRAM_MAX_PHOTO_CAPTION_LENGTH = 1024
const TELEGRAM_MAX_DELIVERY_ATTEMPTS = 3
const TELEGRAM_MAX_RETRY_DELAY_MS = 30_000
const TELEGRAM_SEND_TIMEOUT_MS = 30_000
const TELEGRAM_MAX_VOICE_MEMO_BYTES = 10 * 1024 * 1024
const LINQ_TYPING_REFRESH_MS = 45_000
const LINQ_TYPING_MAX_SESSION_MS = 5 * 60_000
// Linq accepts message sends asynchronously and clears typing when the message
// actually sends. Restart after that short provider settle window instead of
// racing the auto-clear immediately after the HTTP acceptance response.
const LINQ_TYPING_POST_MESSAGE_REFRESH_MS = 1_000

type TelegramParsedTarget = TelegramThreadTarget
type TelegramSendOperation =
  | 'sendMessage'
  | 'sendPhoto'
  | 'sendRichMessage'
  | 'sendVoice'
type TelegramImageResponseMedia = Extract<
  AssistantResponseMedia,
  { kind: 'image' | 'vault_image' }
>
type PreparedTelegramPhoto =
  | { kind: 'url'; url: string }
  | {
      bytes: Uint8Array
      contentType: 'image/jpeg' | 'image/png' | 'image/webp'
      filename: string
      kind: 'upload'
    }

type TelegramMessageEntity = {
  length: number
  offset: number
  type: MessageTextDecoration['style']
}

type DecoratedTelegramPhotoCaption = {
  entities: TelegramMessageEntity[]
  text: string
}

interface TelegramCleanupMessage {
  messageId: string
  target: string
}

export interface PreparedTelegramVoiceMemoMessage {
  baseUrl: string
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  fetchImplementation: TelegramFetchImplementation
  filename: string
  target: TelegramThreadTarget
  targetLabel: string
  token: string
}

type TelegramSendAttemptResult =
  | {
      failure: VaultCliError
      kind: 'request-error'
    }
  | {
      kind: 'response'
      payload: unknown
      response: TelegramFetchResponse
    }

type TelegramSendAttemptOutcome =
  | {
      kind: 'delivered'
      providerMessageId: string | null
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

interface TelegramAmbiguousDeliveryFailure extends VaultCliError {
  cleanupMessages?: TelegramCleanupMessage[]
  cleanupTargetAliases?: string[]
  deliveryMayHaveSucceeded: true
  providerMessageId: string | null
  providerMessageIds: string[]
  target: string
}

export async function sendTelegramMessage(
  input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{
  cleanupMessages?: TelegramCleanupMessage[]
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  providerMessageIds?: string[]
  target: string
}> {
  return sendTelegramMessageDetailed(input, dependencies)
}

export async function sendTelegramRichMessage(
  input: {
    fallbackMessage: string
    idempotencyKey?: string | null
    replyToMessageId?: string | null
    richMessage: TelegramRichMessage
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{
  cleanupMessages?: TelegramCleanupMessage[]
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  providerMessageIds?: string[]
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
  let target = parseTelegramTargetOrThrow(input.target)
  let targetLabel = serializeTelegramThreadTarget(target)
  const cleanupTargetAliases = new Set<string>()
  let retryCount = 0
  const maxDeliveryAttempts = requireTelegramMaxDeliveryAttempts(
    dependencies.maxDeliveryAttempts,
  )

  assertTelegramAuthorityBoundTarget({
    authorityBoundTarget: dependencies.authorityBoundTarget,
    target: targetLabel,
  })

  while (true) {
    const outcome = resolveTelegramSendAttemptOutcome({
      operation: 'sendRichMessage',
      result: await sendTelegramRichMessageOnce({
        baseUrl,
        fetchImplementation,
        replyToMessageId: normalizeTelegramReplyToMessageId(input.replyToMessageId),
        richMessage: input.richMessage,
        signal: dependencies.signal,
        target,
        targetLabel,
        token,
      }),
      target,
      targetLabel,
    })

    if (outcome.kind === 'delivered') {
      const cleanupMessages = outcome.providerMessageId === null
        ? []
        : [{ messageId: outcome.providerMessageId, target: targetLabel }]
      return {
        ...(cleanupMessages.length > 0 ? { cleanupMessages } : {}),
        ...(cleanupTargetAliases.size > 0
          ? { cleanupTargetAliases: [...cleanupTargetAliases] }
          : {}),
        providerMessageId: outcome.providerMessageId,
        target: targetLabel,
      }
    }

    if (outcome.kind === 'migrated') {
      assertTelegramAuthorityBoundTarget({
        authorityBoundTarget: dependencies.authorityBoundTarget,
        target: outcome.targetLabel,
      })
      cleanupTargetAliases.add(targetLabel)
      target = outcome.target
      targetLabel = outcome.targetLabel
      continue
    }

    if (
      outcome.kind === 'failed' &&
      isDefinitiveTelegramRichMessageRejection(outcome.failure)
    ) {
      const fallback = await sendTelegramMessageDetailed(
        {
          idempotencyKey: input.idempotencyKey ?? null,
          message: input.fallbackMessage,
          replyToMessageId: input.replyToMessageId ?? null,
          target: targetLabel,
        },
        dependencies,
      )
      const fallbackAliases = new Set([
        ...cleanupTargetAliases,
        ...(fallback.cleanupTargetAliases ?? []),
      ])
      return {
        ...fallback,
        ...(fallbackAliases.size > 0
          ? { cleanupTargetAliases: [...fallbackAliases] }
          : {}),
      }
    }

    if (
      outcome.kind === 'failed' ||
      retryCount >= maxDeliveryAttempts - 1
    ) {
      throw outcome.failure
    }

    await waitForTelegramRetryDelay(
      retryCount,
      outcome.retryAfterSeconds,
      dependencies.signal,
    )
    if (dependencies.signal?.aborted) {
      throw outcome.failure
    }
    retryCount += 1
  }
}

export async function sendTelegramImageMessage(
  input: {
    idempotencyKey?: string | null
    media: readonly TelegramImageResponseMedia[]
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{
  cleanupMessages?: TelegramCleanupMessage[]
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  providerMessageIds?: string[]
  target: string
}> {
  const media = input.media.filter(
    (item): item is TelegramImageResponseMedia =>
      item.kind === 'image' || item.kind === 'vault_image',
  )
  if (media.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_IMAGE_REQUIRED',
      'Telegram image delivery requires at least one image.',
    )
  }

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
  let target = parseTelegramTargetOrThrow(input.target)
  let targetLabel = serializeTelegramThreadTarget(target)
  let replyToMessageId = normalizeTelegramReplyToMessageId(input.replyToMessageId)
  const cleanupMessages: TelegramCleanupMessage[] = []
  const cleanupTargetAliases = new Set<string>()
  const providerMessageIds: string[] = []
  let lastProviderMessageId: string | null = null

  const accessibleMessage = appendImageAlternativeText(input.message, media)
  const caption = buildTelegramPhotoCaption(accessibleMessage)
  if (!caption && accessibleMessage.trim().length > 0) {
    const deliveredText = await sendTelegramMessageDetailed(
      {
        idempotencyKey: input.idempotencyKey ?? null,
        message: accessibleMessage,
        replyToMessageId,
        target: targetLabel,
      },
      dependencies,
    )
    for (const cleanupMessage of deliveredText.cleanupMessages ?? []) {
      cleanupMessages.push(cleanupMessage)
    }
    for (const alias of deliveredText.cleanupTargetAliases ?? []) {
      cleanupTargetAliases.add(alias)
    }
    if (deliveredText.providerMessageIds) {
      providerMessageIds.push(...deliveredText.providerMessageIds)
    } else if (deliveredText.providerMessageId) {
      providerMessageIds.push(deliveredText.providerMessageId)
    }
    lastProviderMessageId = deliveredText.providerMessageId
    target = parseTelegramTargetOrThrow(deliveredText.target)
    targetLabel = deliveredText.target
    replyToMessageId = null
  }

  for (let index = 0; index < media.length; index += 1) {
    const image = media[index]!
    try {
      const delivered = await sendTelegramPhoto({
        authorityBoundTarget: dependencies.authorityBoundTarget,
        baseUrl,
        caption: index === 0 ? caption : null,
        fetchImplementation,
        photo: await prepareTelegramPhoto(image, dependencies),
        replyToMessageId,
        signal: dependencies.signal,
        target,
        targetLabel,
        token,
      })
      target = delivered.target
      targetLabel = delivered.targetLabel
      lastProviderMessageId = delivered.providerMessageId
      for (const alias of delivered.cleanupTargetAliases ?? []) {
        cleanupTargetAliases.add(alias)
      }
      if (delivered.providerMessageId) {
        cleanupMessages.push({
          messageId: delivered.providerMessageId,
          target: delivered.targetLabel,
        })
        providerMessageIds.push(delivered.providerMessageId)
      }
      replyToMessageId = null
    } catch (error) {
      if (providerMessageIds.length === 0) {
        throw error
      }

      const rollbackError = await rollbackTelegramPartialDelivery({
        cleanupMessages,
        env,
        fetchImplementation,
      })
      if (!rollbackError) {
        throw error
      }

      throw createTelegramAmbiguousDeliveryFailure({
        cleanupMessages,
        cleanupTargetAliases: [...cleanupTargetAliases],
        error,
        providerMessageIds,
        rollbackError,
        target: targetLabel,
      })
    }
  }

  return {
    ...(cleanupMessages.length > 0
      ? {
          cleanupMessages,
        }
      : {}),
    ...(cleanupTargetAliases.size > 0
      ? {
          cleanupTargetAliases: [...cleanupTargetAliases],
        }
      : {}),
    providerMessageId: lastProviderMessageId,
    ...(providerMessageIds.length > 1 ? { providerMessageIds } : {}),
    target: targetLabel,
  }
}

async function prepareTelegramPhoto(
  media: TelegramImageResponseMedia,
  dependencies: TelegramRuntimeDependencies,
): Promise<PreparedTelegramPhoto> {
  if (media.kind === 'image') {
    return { kind: 'url', url: media.url }
  }
  if (!dependencies.loadVaultImage) {
    throw new VaultCliError(
      'ASSISTANT_VAULT_IMAGE_LOADER_REQUIRED',
      'Private image delivery requires a trusted vault-image loader.',
    )
  }
  if (typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_IMAGE_UPLOAD_UNAVAILABLE',
      'Private Telegram image delivery requires FormData and Blob support.',
    )
  }
  return {
    bytes: await dependencies.loadVaultImage(media),
    contentType: media.contentType,
    filename: media.filename,
    kind: 'upload',
  }
}

export async function sendTelegramVoiceMemoMessage(
  input: {
    filename: string
    generation: AssistantVoiceMemoGeneration
    idempotencyKey?: string | null
    replyToMessageId?: string | null
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  target: string
}> {
  const prepared = await prepareTelegramVoiceMemoMessage(input, dependencies)
  return await sendPreparedTelegramVoiceMemoMessage(
    {
      ...prepared,
      replyToMessageId: input.replyToMessageId ?? null,
    },
    dependencies,
  )
}

export async function prepareTelegramVoiceMemoMessage(
  input: {
    filename: string
    generation: AssistantVoiceMemoGeneration
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<PreparedTelegramVoiceMemoMessage> {
  const env = dependencies.env ?? process.env
  const token = resolveTelegramBotToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TOKEN_REQUIRED',
      'Outbound Telegram delivery requires TELEGRAM_BOT_TOKEN.',
    )
  }

  const apiKey = resolveElevenLabsApiKey(env)
  if (!apiKey) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_ELEVENLABS_KEY_REQUIRED',
      'Telegram voice memo delivery requires ELEVENLABS_API_KEY.',
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
  if (typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_UNAVAILABLE',
      'Telegram voice memo delivery requires FormData and Blob support in the current Node.js runtime.',
    )
  }

  const baseUrl = (resolveTelegramApiBaseUrl(env) ?? 'https://api.telegram.org').replace(
    /\/$/u,
    '',
  )
  const target = parseTelegramTargetOrThrow(input.target)
  const audio = await generateElevenLabsVoiceMemoAudio({
    apiKey,
    fetchImplementation: createTelegramElevenLabsFetchAdapter(fetchImplementation),
    generation: input.generation,
    signal: dependencies.signal,
  })
  if (
    audio.bytes.byteLength === 0 ||
    audio.bytes.byteLength > TELEGRAM_MAX_VOICE_MEMO_BYTES
  ) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_AUDIO_INVALID',
      'Telegram voice memo generation returned invalid audio data.',
      {
        sizeBytes: audio.bytes.byteLength,
      },
    )
  }

  return {
    baseUrl,
    bytes: audio.bytes,
    contentType: audio.contentType,
    fetchImplementation,
    filename: normalizeTelegramVoiceMemoFilename(input.filename),
    target,
    targetLabel: serializeTelegramThreadTarget(target),
    token,
  }
}

export async function sendPreparedTelegramVoiceMemoMessage(
  input: PreparedTelegramVoiceMemoMessage & {
    replyToMessageId?: string | null
    targetOverride?: string | null
  },
  dependencies: Pick<
    TelegramRuntimeDependencies,
    'authorityBoundTarget' | 'signal'
  > = {},
): Promise<{
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  target: string
}> {
  const target = input.targetOverride
    ? parseTelegramTargetOrThrow(input.targetOverride)
    : input.target
  const targetLabel = input.targetOverride
    ? serializeTelegramThreadTarget(target)
    : input.targetLabel

  return await sendTelegramVoiceMemo({
    authorityBoundTarget: dependencies.authorityBoundTarget,
    baseUrl: input.baseUrl,
    bytes: input.bytes,
    contentType: input.contentType,
    fetchImplementation: input.fetchImplementation,
    filename: input.filename,
    replyToMessageId: normalizeTelegramReplyToMessageId(input.replyToMessageId),
    signal: dependencies.signal,
    target,
    targetLabel,
    token: input.token,
  })
}

export async function sendLinqMessage(
  input: {
    card?: AssistantResponseCard | null
    directRecipientPhoneNumber?: string | null
    fromPhoneNumber?: string | null
    idempotencyKey?: string | null
    media?: readonly AssistantResponseMedia[] | null
    message: string
    nativeReplyRequested?: true
    replyToMessageId?: string | null
    target: string
    targetKind?: AssistantDeliveryCandidate['kind']
    threadIsDirect?: boolean | null
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<{
  idempotencyKey?: string | null
  providerMessageId: string | null
  providerMessageEffects?: AssistantProviderMessageEffect[]
  providerMessageIds?: string[]
  providerThreadId: string | null
  target: string | null
}> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound iMessage delivery requires LINQ_API_TOKEN.',
    )
  }

  // Validate all local preconditions BEFORE loading or uploading vault-file
  // bytes. Otherwise approved vault-file bytes leave the vault and reach Linq
  // even when the send would fail closed on a missing target or sender phone.
  const target = input.target.trim()
  if (target.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires an explicit chat id or a stored thread binding.',
    )
  }
  const card = input.card ?? null
  const responseMedia = input.media ?? []
  if (card !== null && responseMedia.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
      'A response card cannot be combined with response media.',
    )
  }
  if (input.nativeReplyRequested === true) {
    if (!normalizeOptionalText(input.replyToMessageId)) {
      throw new VaultCliError(
        'ASSISTANT_LINQ_NATIVE_REPLY_TARGET_REQUIRED',
        'A native iMessage reply requires a target message id.',
      )
    }
    if (input.targetKind === 'participant') {
      throw new VaultCliError(
        'ASSISTANT_LINQ_NATIVE_REPLY_CHAT_REQUIRED',
        'A native iMessage reply requires an existing Linq chat.',
      )
    }
  }
  const participantFromPhoneNumber = input.targetKind === 'participant'
    ? normalizeOptionalText(input.fromPhoneNumber)
    : null
  if (input.targetKind === 'participant' && !participantFromPhoneNumber) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_FROM_PHONE_REQUIRED',
      'Materializing an iMessage direct chat requires a sender phone number.',
    )
  }

  const directRecipientPhoneNumber = normalizeOptionalText(
    input.directRecipientPhoneNumber,
  )
  const idempotencyKey = normalizeOptionalText(input.idempotencyKey)
  const shouldAttemptNativeCard =
    card !== null &&
    card.kind !== 'exercise_routine' &&
    input.targetKind === 'thread' &&
    input.threadIsDirect === true &&
    input.nativeReplyRequested !== true &&
    directRecipientPhoneNumber !== null &&
    idempotencyKey !== null
  let appCardFallbackIdempotencyKey: string | null = null
  if (shouldAttemptNativeCard) {
    let capabilityAvailable = false
    try {
      capabilityAvailable = await checkLinqIMessageCapability(
        {
          address: directRecipientPhoneNumber,
          from: normalizeOptionalText(input.fromPhoneNumber),
        },
        {
          env,
          fetchImplementation:
            dependencies.appCardCapabilityFetchImplementation
            ?? dependencies.fetchImplementation,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
        },
      )
    } catch (error) {
      if (
        dependencies.signal?.aborted
        || providerRequestWasSkipped(error)
      ) {
        throw error
      }
      dependencies.onAppCardFallbackError?.({
        error,
        reason: 'capability_check_failed',
      })
    }
    if (capabilityAvailable) {
      try {
        const delivered = await sendLinqIMessageAppCard(
          {
            card,
            chatId: target,
            idempotencyKey,
          },
          {
            env,
            fetchImplementation: dependencies.fetchImplementation,
            ...(dependencies.signal ? { signal: dependencies.signal } : {}),
          },
        )
        const providerMessageId = normalizeOptionalText(
          delivered.message?.id ?? null,
        )
        return {
          providerMessageId,
          ...(providerMessageId
            ? {
                providerMessageEffects: [{
                  message: null,
                  providerMessageId,
                }],
              }
            : {}),
          providerThreadId: null,
          target,
        }
      } catch (error) {
        if (
          dependencies.signal?.aborted ||
          !isDefinitiveLinqIMessageAppCardRejection(error)
        ) {
          throw error
        }
        dependencies.onAppCardFallbackError?.({
          error,
          reason: 'app_card_rejected',
        })
        appCardFallbackIdempotencyKey = `${idempotencyKey}:fallback`
      }
    }
  }

  if (card !== null) {
    const textFallbackIdempotencyKey =
      appCardFallbackIdempotencyKey ?? idempotencyKey
    if (!textFallbackIdempotencyKey) {
      throw new VaultCliError(
        'ASSISTANT_LINQ_APP_CARD_FALLBACK_IDEMPOTENCY_REQUIRED',
        'An iMessage app-card text fallback requires a stable delivery identity.',
      )
    }
    if (!dependencies.persistAppCardTextFallback) {
      throw new VaultCliError(
        'ASSISTANT_LINQ_APP_CARD_FALLBACK_PERSISTENCE_REQUIRED',
        'An iMessage app-card text fallback must be persisted before provider delivery.',
        { retryable: true },
      )
    }
    await dependencies.persistAppCardTextFallback({
      idempotencyKey: textFallbackIdempotencyKey,
    })
  }

  const media = await prepareLinqMessageMedia(
    responseMedia,
    dependencies,
  )
  const message = responseMedia.some((item) => item.kind === 'vault_file')
    ? ''
    : appendImageAlternativeText(input.message, input.media ?? [])

  if (participantFromPhoneNumber) {
    const created = await createLinqChat(
      {
        from: participantFromPhoneNumber,
        idempotencyKey: input.idempotencyKey ?? null,
        message,
        ...(media.length > 0 ? { media } : {}),
        to: [target],
      },
      {
        env,
        fetchImplementation: dependencies.fetchImplementation,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      },
    )

    return {
      providerMessageId: normalizeOptionalText(created.messageId),
      ...(created.providerMessageEffects && created.providerMessageEffects.length > 0
        ? { providerMessageEffects: [...created.providerMessageEffects] }
        : {}),
      ...(created.providerMessageIds && created.providerMessageIds.length > 0
        ? { providerMessageIds: [...created.providerMessageIds] }
        : {}),
      providerThreadId: normalizeOptionalText(created.chatId),
      target: normalizeOptionalText(created.chatId),
    }
  }

  const delivered = await sendLinqChatMessage(
    {
      chatId: target,
      idempotencyKey:
        appCardFallbackIdempotencyKey ?? input.idempotencyKey ?? null,
      message,
      ...(media.length > 0 ? { media } : {}),
      ...(input.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
      replyToMessageId: input.replyToMessageId ?? null,
    },
    {
      env,
      fetchImplementation:
        appCardFallbackIdempotencyKey
          ? dependencies.appCardTextFallbackFetchImplementation
            ?? dependencies.fetchImplementation
          : dependencies.fetchImplementation,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    },
  )
  return {
    ...(appCardFallbackIdempotencyKey
      ? { idempotencyKey: appCardFallbackIdempotencyKey }
      : {}),
    providerMessageId: normalizeOptionalText(delivered.message?.id ?? null),
    ...(delivered.providerMessageEffects && delivered.providerMessageEffects.length > 0
      ? { providerMessageEffects: [...delivered.providerMessageEffects] }
      : {}),
    ...(delivered.providerMessageIds && delivered.providerMessageIds.length > 0
      ? { providerMessageIds: [...delivered.providerMessageIds] }
      : {}),
    providerThreadId: null,
    target,
  }
}

function providerRequestWasSkipped(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'deliveryMayHaveSucceeded' in error
    && error.deliveryMayHaveSucceeded === false
}

async function prepareLinqMessageMedia(
  media: readonly AssistantResponseMedia[],
  dependencies: LinqRuntimeDependencies,
): Promise<Array<{ attachmentId: string } | { url: string }>> {
  const prepared: Array<{ attachmentId: string } | { url: string }> = []
  for (const item of media) {
    if (item.kind === 'image') {
      prepared.push({ url: item.url })
      continue
    }

    if (item.kind === 'vault_image') {
      if (!dependencies.loadVaultImage) {
        throw new VaultCliError(
          'ASSISTANT_VAULT_IMAGE_LOADER_REQUIRED',
          'Private image delivery requires a trusted vault-image loader.',
        )
      }
      const upload = await uploadLinqAttachment(
        {
          bytes: await dependencies.loadVaultImage(item),
          contentType: item.contentType,
          filename: item.filename,
        },
        {
          env: dependencies.env,
          fetchImplementation: dependencies.fetchImplementation,
          publicFetchImplementation: dependencies.publicFetchImplementation,
          ...(dependencies.signal ? { signal: dependencies.signal } : {}),
        },
      )
      prepared.push({ attachmentId: upload.attachmentId })
      continue
    }

    if (item.kind !== 'vault_file') {
      throw new VaultCliError(
        'ASSISTANT_LINQ_MEDIA_KIND_UNSUPPORTED',
        'Standard iMessage delivery only supports public images, private vault images, and approved vault files.',
      )
    }

    if (!dependencies.loadVaultFile) {
      throw new VaultCliError(
        'ASSISTANT_VAULT_FILE_LOADER_REQUIRED',
        'Vault-file delivery requires a trusted vault-file loader.',
      )
    }

    const bytes = await dependencies.loadVaultFile(item)
    const upload = await uploadLinqAttachment(
      {
        bytes,
        contentType: item.contentType,
        filename: item.filename,
      },
      {
        env: dependencies.env,
        fetchImplementation: dependencies.fetchImplementation,
        publicFetchImplementation: dependencies.publicFetchImplementation,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      },
    )
    prepared.push({ attachmentId: upload.attachmentId })
  }

  return prepared
}

function appendImageAlternativeText(
  message: string,
  media: readonly AssistantResponseMedia[],
): string {
  const alternatives: string[] = []
  for (const item of media) {
    if (item.kind !== 'image' && item.kind !== 'vault_image') {
      continue
    }
    const alternative = normalizeOptionalText(item.alt)
    if (
      !alternative ||
      message.includes(alternative) ||
      alternatives.includes(alternative)
    ) {
      continue
    }
    alternatives.push(alternative)
  }
  if (alternatives.length === 0) {
    return message
  }
  const normalizedMessage = message.trim()
  return normalizedMessage.length > 0
    ? `${normalizedMessage}\n\n${alternatives.join('\n\n')}`
    : alternatives.join('\n\n')
}

export async function sendLinqVoiceMemoMessage(
  input: {
    attachmentId: string
    target: string
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<{
  providerMessageId: string | null
  providerThreadId: string | null
  target: string | null
}> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound iMessage delivery requires LINQ_API_TOKEN.',
    )
  }

  const target = input.target.trim()
  if (target.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires an explicit chat id or a stored thread binding.',
    )
  }

  const delivered = await sendLinqVoiceMemo(
    {
      attachmentId: input.attachmentId,
      chatId: target,
    },
    {
      env,
      fetchImplementation: dependencies.fetchImplementation,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    },
  )

  return {
    providerMessageId: normalizeOptionalText(delivered.providerMessageId),
    providerThreadId: normalizeOptionalText(delivered.providerThreadId),
    target: normalizeOptionalText(delivered.target),
  }
}

export async function setLinqMessageReaction(
  input: {
    reaction: AssistantMessageReaction
    targetMessageId: string
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<{
  reaction: AssistantMessageReaction
  targetMessageId: string
}> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound iMessage delivery requires LINQ_API_TOKEN.',
    )
  }

  const delivered = await setLinqApiMessageReaction(
    {
      reaction: input.reaction,
      targetMessageId: input.targetMessageId,
    },
    {
      env,
      fetchImplementation: dependencies.fetchImplementation,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    },
  )

  return {
    reaction: delivered.reaction,
    targetMessageId: delivered.targetMessageId,
  }
}

export async function startTelegramTypingIndicator(
  input: {
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<AssistantChannelActivityHandle> {
  return startTelegramTypingSession(
    {
      target: input.target,
    },
    {
      env: dependencies.env,
      fetchImplementation: dependencies.fetchImplementation,
      signal: dependencies.signal,
    },
  )
}

export async function startAssistantChannelActivitySession(input: {
  afterMessageRefreshMs?: number | null
  refresh?: ((signal: AbortSignal) => Promise<void>) | null
  refreshMs: number
  maxSessionMs?: number | null
  signal?: AbortSignal
  start: (signal: AbortSignal) => Promise<void>
  stop?: (() => Promise<void>) | null
}): Promise<AssistantChannelActivityHandle> {
  const linkedStopSignal = createLinkedAbortSignal(input.signal)
  try {
    await input.start(linkedStopSignal.signal)
  } catch (error) {
    linkedStopSignal.cleanup()
    throw error
  }

  const refreshMs = Math.max(1, Math.trunc(input.refreshMs))
  const afterMessageRefreshMs = input.afterMessageRefreshMs == null
    ? null
    : Math.max(0, Math.trunc(input.afterMessageRefreshMs))
  const maxSessionMs = normalizeAssistantChannelActivityMaxSessionMs(
    input.maxSessionMs ?? null,
  )
  const refresh = input.refresh ?? input.start
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let maxSessionTimer: ReturnType<typeof setTimeout> | null = null
  let refreshFailure: unknown = null
  let refreshScheduleVersion = 0
  let refreshTail: Promise<void> = Promise.resolve()
  let stopped = false
  let stopPromise: Promise<void> | null = null

  scheduleRefresh(refreshMs)
  if (maxSessionMs !== null) {
    maxSessionTimer = setTimeout(() => {
      void stopActivity({
        retryableFailure: true,
      }).catch(() => {})
    }, maxSessionMs)
    unrefAssistantChannelActivityTimer(maxSessionTimer)
  }

  return {
    ...(afterMessageRefreshMs === null
      ? {}
      : {
          refreshAfterMessage: async () => scheduleRefresh(afterMessageRefreshMs),
        }),
    refreshNow: async () => {
      clearRefreshTimer()
      const scheduleVersion = ++refreshScheduleVersion
      await enqueueRefresh()
      if (scheduleVersion === refreshScheduleVersion) {
        scheduleRefresh(refreshMs)
      }
    },
    stop: stopActivity,
  }

  function scheduleRefresh(delayMs: number): void {
    if (stopped || linkedStopSignal.signal.aborted || refreshFailure) {
      return
    }

    clearRefreshTimer()
    const scheduleVersion = ++refreshScheduleVersion
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void enqueueRefresh().then(() => {
        if (scheduleVersion === refreshScheduleVersion) {
          scheduleRefresh(refreshMs)
        }
      })
    }, delayMs)
    unrefAssistantChannelActivityTimer(refreshTimer)
  }

  function enqueueRefresh(): Promise<void> {
    refreshTail = refreshTail.then(async () => {
      if (stopped || linkedStopSignal.signal.aborted || refreshFailure) {
        return
      }

      await refresh(linkedStopSignal.signal)
        .catch((error) => {
          if (!linkedStopSignal.signal.aborted) {
            refreshFailure = error
          }
        })
    })
    return refreshTail
  }

  async function stopActivity(
    options: {
      providerStop?: boolean
      retryableFailure?: boolean
    } = {},
  ): Promise<void> {
    if (!stopPromise) {
      startStopActivity(options)
    }

    try {
      await stopPromise
    } catch (error) {
      if (options.retryableFailure || stopPromise) {
        throw error
      }

      startStopActivity(options)
      await stopPromise
    }
  }

  function startStopActivity(
    options: {
      providerStop?: boolean
      retryableFailure?: boolean
    } = {},
  ): void {
    const attempt = stopActivityOnce(options)
    if (!options.retryableFailure) {
      stopPromise = attempt
      return
    }

    const retryableAttempt = attempt.catch((error) => {
      if (stopPromise === retryableAttempt) {
        stopPromise = null
      }
      throw error
    })
    stopPromise = retryableAttempt
  }

  async function stopActivityOnce(
    options: AssistantChannelActivityStopOptions = {},
  ): Promise<void> {
    stopped = true
    clearRefreshTimer()
    clearMaxSessionTimer()
    linkedStopSignal.controller.abort()
    linkedStopSignal.cleanup()

    await refreshTail

    let stopFailure: unknown = null
    if (options.providerStop !== false) {
      try {
        await input.stop?.()
      } catch (error) {
        stopFailure = error
      }
    }

    if (refreshFailure) {
      throw refreshFailure
    }
    if (stopFailure) {
      throw stopFailure
    }
  }

  function clearRefreshTimer(): void {
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  }

  function clearMaxSessionTimer(): void {
    if (maxSessionTimer) {
      clearTimeout(maxSessionTimer)
      maxSessionTimer = null
    }
  }
}

export async function startLinqTypingIndicator(
  input: {
    target: string
  },
  dependencies: LinqRuntimeDependencies = {},
): Promise<AssistantChannelActivityHandle> {
  const env = dependencies.env ?? process.env
  const token = resolveLinqApiToken(env)
  if (!token) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_API_TOKEN_REQUIRED',
      'Outbound iMessage delivery requires LINQ_API_TOKEN.',
    )
  }

  const chatId = input.target.trim()
  if (chatId.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CHANNEL_TARGET_REQUIRED',
      'iMessage delivery requires an explicit chat id or a stored thread binding.',
    )
  }

  return startAssistantChannelActivitySession({
    afterMessageRefreshMs: LINQ_TYPING_POST_MESSAGE_REFRESH_MS,
    refreshMs: dependencies.refreshMs ?? LINQ_TYPING_REFRESH_MS,
    maxSessionMs: dependencies.maxSessionMs ?? LINQ_TYPING_MAX_SESSION_MS,
    signal: dependencies.signal,
    start: (signal) => startLinqChatTypingIndicator(
      {
        chatId,
      },
      {
        env,
        fetchImplementation: dependencies.fetchImplementation,
        signal,
      },
    ),
    stop: () => stopLinqChatTypingIndicator(
      {
        chatId,
      },
      {
        env,
        fetchImplementation: dependencies.fetchImplementation,
      },
    ),
  })
}

function normalizeAssistantChannelActivityMaxSessionMs(
  value: number | null,
): number | null {
  if (value === null) {
    return null
  }

  const normalized = Math.trunc(value)
  return normalized > 0 ? normalized : null
}

function unrefAssistantChannelActivityTimer(
  timer: ReturnType<typeof setTimeout>,
): void {
  if (typeof timer !== 'object' || timer === null || !('unref' in timer)) {
    return
  }

  const unref = (timer as { unref?: () => void }).unref
  if (typeof unref === 'function') {
    unref.call(timer)
  }
}

function waitForAssistantChannelActivityRefresh(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      resolve()
    }
    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}


export async function sendEmailMessage(
  input: {
    idempotencyKey?: string | null
    identityId: string
    message: string
    replyToMessageId?: string | null
    target: string
    targetKind: AssistantDeliveryCandidate['kind']
    subject?: string | null
  },
  dependencies: EmailRuntimeDependencies = {},
): Promise<{ providerMessageId: string | null; providerThreadId: string | null }> {
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

  const subject = normalizeOptionalText(input.subject)
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
    if (subject) {
      throw new VaultCliError(
        'ASSISTANT_EMAIL_THREAD_SUBJECT_UNSUPPORTED',
        'Email thread replies preserve the existing subject. Do not provide a subject override when replying to a thread.',
        { threadId: target },
      )
    }

    const thread = await client.getThread(target)
    const messageId = resolveAgentmailThreadReplyMessageId(thread)
    if (!messageId) {
      throw new VaultCliError(
        'ASSISTANT_EMAIL_THREAD_REPLY_UNAVAILABLE',
        'Email thread delivery requires a resolvable parent AgentMail message.',
        { threadId: target },
      )
    }

    const delivered = await client.replyToMessage({
      inboxId: identityId,
      messageId: normalizeOptionalText(input.replyToMessageId) ?? messageId,
      text: input.message,
      replyAll: true,
    })
    return {
      providerMessageId: normalizeOptionalText(delivered.message_id),
      providerThreadId: normalizeOptionalText(delivered.thread_id),
    }
  }

  const delivered = await client.sendMessage({
    inboxId: identityId,
    to: target,
    subject: subject ?? 'Murph update',
    text: input.message,
  })

  return {
    providerMessageId: normalizeOptionalText(delivered.message_id),
    providerThreadId: normalizeOptionalText(delivered.thread_id),
  }
}

async function sendTelegramMessageDetailed(
  input: {
    idempotencyKey?: string | null
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: TelegramRuntimeDependencies = {},
): Promise<{
  cleanupMessages?: TelegramCleanupMessage[]
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  providerMessageIds?: string[]
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
  let target = parseTelegramTargetOrThrow(input.target)
  let targetLabel = serializeTelegramThreadTarget(target)
  let lastProviderMessageId: string | null = null
  const cleanupMessages: TelegramCleanupMessage[] = []
  const cleanupTargetAliases = new Set<string>()
  const providerMessageIds: string[] = []
  let replyToMessageId = normalizeTelegramReplyToMessageId(input.replyToMessageId)

  const renderedMessage = renderMarkdownMessageText(input.message)
  const chunks = splitDecoratedMessageText(renderedMessage, TELEGRAM_MAX_TEXT_LENGTH)
  const maxDeliveryAttempts = requireTelegramMaxDeliveryAttempts(
    dependencies.maxDeliveryAttempts,
  )
  for (const chunk of chunks) {
    try {
      const delivered = await sendTelegramTextChunk({
        authorityBoundTarget: dependencies.authorityBoundTarget,
        baseUrl,
        entities: buildTelegramMessageEntities(chunk.decorations),
        fetchImplementation,
        maxDeliveryAttempts,
        replyToMessageId,
        signal: dependencies.signal,
        target,
        targetLabel,
        text: chunk.text,
        token,
      })
      target = delivered.target
      targetLabel = delivered.targetLabel
      lastProviderMessageId = delivered.providerMessageId
      for (const alias of delivered.cleanupTargetAliases ?? []) {
        cleanupTargetAliases.add(alias)
      }
      if (delivered.providerMessageId) {
        cleanupMessages.push({
          messageId: delivered.providerMessageId,
          target: delivered.targetLabel,
        })
        providerMessageIds.push(delivered.providerMessageId)
      }
      replyToMessageId = null
    } catch (error) {
      if (providerMessageIds.length === 0) {
        throw error
      }

      const rollbackError = await rollbackTelegramPartialDelivery({
        cleanupMessages,
        env,
        fetchImplementation,
      })
      if (!rollbackError) {
        throw error
      }

      throw createTelegramAmbiguousDeliveryFailure({
        cleanupMessages,
        cleanupTargetAliases: [...cleanupTargetAliases],
        error,
        providerMessageIds,
        rollbackError,
        target: targetLabel,
      })
    }
  }

  return {
    ...(cleanupMessages.length > 0
      ? {
          cleanupMessages,
        }
      : {}),
    ...(cleanupTargetAliases.size > 0
      ? {
          cleanupTargetAliases: [...cleanupTargetAliases],
        }
      : {}),
    providerMessageId: lastProviderMessageId,
    ...(providerMessageIds.length > 1 ? { providerMessageIds } : {}),
    target: targetLabel,
  }
}

async function rollbackTelegramPartialDelivery(input: {
  cleanupMessages: readonly TelegramCleanupMessage[]
  env: NodeJS.ProcessEnv
  fetchImplementation: TelegramFetchImplementation
}): Promise<unknown | null> {
  try {
    for (const [target, messageIds] of groupTelegramCleanupMessagesByTarget(input.cleanupMessages)) {
      await deleteTelegramMessages(
        {
          messageIds,
          target,
        },
        {
          env: input.env,
          fetchImplementation: input.fetchImplementation,
        },
      )
    }
    return null
  } catch (error) {
    return error
  }
}

function createTelegramAmbiguousDeliveryFailure(input: {
  cleanupMessages?: readonly TelegramCleanupMessage[]
  cleanupTargetAliases?: readonly string[]
  error: unknown
  providerMessageIds: readonly string[]
  rollbackError: unknown
  target: string
}): TelegramAmbiguousDeliveryFailure {
  const cleanupMessages = normalizeTelegramCleanupMessages(input.cleanupMessages ?? [])
  const cleanupTargetAliases = Array.from(
    new Set(
      (input.cleanupTargetAliases ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  )
  const providerMessageIds = [...input.providerMessageIds]
  const originalFailure = normalizeOptionalText(describeUnknownError(input.error))
  const rollbackFailure = normalizeOptionalText(describeUnknownError(input.rollbackError))
  const message = rollbackFailure
    ? `Telegram delivery partially succeeded before a later chunk failed, and rollback could not be confirmed. ${originalFailure ?? 'A later chunk failed.'} Rollback failure: ${rollbackFailure}`
    : `Telegram delivery partially succeeded before a later chunk failed, and rollback could not be confirmed. ${originalFailure ?? 'A later chunk failed.'}`
  const error = new VaultCliError(
    'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
    message,
    {
      ...(cleanupMessages.length > 0 ? { cleanupMessages } : {}),
      originalFailure,
      ...(cleanupTargetAliases.length > 0 ? { cleanupTargetAliases } : {}),
      providerMessageIds,
      rollbackFailure,
      target: input.target,
    },
  )

  return Object.assign(error, {
    ...(cleanupMessages.length > 0 ? { cleanupMessages } : {}),
    ...(cleanupTargetAliases.length > 0 ? { cleanupTargetAliases } : {}),
    deliveryMayHaveSucceeded: true as const,
    providerMessageId: providerMessageIds.at(-1) ?? null,
    providerMessageIds,
    target: input.target,
  })
}

function normalizeTelegramCleanupMessages(
  cleanupMessages: readonly TelegramCleanupMessage[],
): TelegramCleanupMessage[] {
  const normalized: TelegramCleanupMessage[] = []
  const seen = new Set<string>()

  for (const cleanupMessage of cleanupMessages) {
    const messageId = cleanupMessage.messageId.trim()
    const target = cleanupMessage.target.trim()
    if (messageId.length === 0 || target.length === 0) {
      continue
    }

    const key = `${target}\u0000${messageId}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    normalized.push({
      messageId,
      target,
    })
  }

  return normalized
}

function groupTelegramCleanupMessagesByTarget(
  cleanupMessages: readonly TelegramCleanupMessage[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const cleanupMessage of normalizeTelegramCleanupMessages(cleanupMessages)) {
    const bucket = grouped.get(cleanupMessage.target) ?? []
    bucket.push(cleanupMessage.messageId)
    grouped.set(cleanupMessage.target, bucket)
  }

  return grouped
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

async function sendTelegramTextChunk(input: {
  authorityBoundTarget?: string | null
  baseUrl: string
  entities: TelegramMessageEntity[]
  fetchImplementation: TelegramFetchImplementation
  maxDeliveryAttempts: number
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  text: string
  token: string
}): Promise<{
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  target: TelegramParsedTarget
  targetLabel: string
}> {
  const cleanupTargetAliases = new Set<string>()
  let retryCount = 0
  let target = input.target
  let targetLabel = input.targetLabel

  assertTelegramAuthorityBoundTarget({
    authorityBoundTarget: input.authorityBoundTarget,
    target: targetLabel,
  })

  while (true) {
    const outcome = resolveTelegramSendAttemptOutcome({
      operation: 'sendMessage',
      result: await sendTelegramTextChunkOnce({
        baseUrl: input.baseUrl,
        entities: input.entities,
        fetchImplementation: input.fetchImplementation,
        replyToMessageId: input.replyToMessageId,
        signal: input.signal,
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
        ...(cleanupTargetAliases.size > 0
          ? {
              cleanupTargetAliases: [...cleanupTargetAliases],
            }
          : {}),
        providerMessageId: outcome.providerMessageId,
        target,
        targetLabel,
      }
    }

    if (outcome.kind === 'migrated') {
      assertTelegramAuthorityBoundTarget({
        authorityBoundTarget: input.authorityBoundTarget,
        target: outcome.targetLabel,
      })
      cleanupTargetAliases.add(targetLabel)
      target = outcome.target
      targetLabel = outcome.targetLabel
      continue
    }

    if (
      outcome.kind === 'failed' ||
      retryCount >= input.maxDeliveryAttempts - 1
    ) {
      throw outcome.failure
    }

    await waitForTelegramRetryDelay(
      retryCount,
      outcome.retryAfterSeconds,
      input.signal,
    )
    if (input.signal?.aborted) {
      throw outcome.failure
    }
    retryCount += 1
  }
}

async function sendTelegramPhoto(input: {
  authorityBoundTarget?: string | null
  baseUrl: string
  caption: DecoratedTelegramPhotoCaption | null
  fetchImplementation: TelegramFetchImplementation
  photo: PreparedTelegramPhoto
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  token: string
}): Promise<{
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  target: TelegramParsedTarget
  targetLabel: string
}> {
  const cleanupTargetAliases = new Set<string>()
  let retryCount = 0
  let target = input.target
  let targetLabel = input.targetLabel

  assertTelegramAuthorityBoundTarget({
    authorityBoundTarget: input.authorityBoundTarget,
    target: targetLabel,
  })

  while (true) {
    const outcome = resolveTelegramSendAttemptOutcome({
      operation: 'sendPhoto',
      result: await sendTelegramPhotoOnce({
        baseUrl: input.baseUrl,
        caption: input.caption,
        fetchImplementation: input.fetchImplementation,
        photo: input.photo,
        replyToMessageId: input.replyToMessageId,
        signal: input.signal,
        target,
        targetLabel,
        token: input.token,
      }),
      target,
      targetLabel,
    })

    if (outcome.kind === 'delivered') {
      return {
        ...(cleanupTargetAliases.size > 0
          ? {
              cleanupTargetAliases: [...cleanupTargetAliases],
            }
          : {}),
        providerMessageId: outcome.providerMessageId,
        target,
        targetLabel,
      }
    }

    if (outcome.kind === 'migrated') {
      assertTelegramAuthorityBoundTarget({
        authorityBoundTarget: input.authorityBoundTarget,
        target: outcome.targetLabel,
      })
      cleanupTargetAliases.add(targetLabel)
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

    await waitForTelegramRetryDelay(
      retryCount,
      outcome.retryAfterSeconds,
      input.signal,
    )
    if (input.signal?.aborted) {
      throw outcome.failure
    }
    retryCount += 1
  }
}

async function sendTelegramVoiceMemo(input: {
  authorityBoundTarget?: string | null
  baseUrl: string
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  fetchImplementation: TelegramFetchImplementation
  filename: string
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  token: string
}): Promise<{
  cleanupTargetAliases?: string[]
  providerMessageId: string | null
  target: string
}> {
  const cleanupTargetAliases = new Set<string>()
  let retryCount = 0
  let target = input.target
  let targetLabel = input.targetLabel

  assertTelegramAuthorityBoundTarget({
    authorityBoundTarget: input.authorityBoundTarget,
    target: targetLabel,
  })

  while (true) {
    const outcome = resolveTelegramSendAttemptOutcome({
      operation: 'sendVoice',
      result: await sendTelegramVoiceMemoOnce({
        baseUrl: input.baseUrl,
        bytes: input.bytes,
        contentType: input.contentType,
        fetchImplementation: input.fetchImplementation,
        filename: input.filename,
        replyToMessageId: input.replyToMessageId,
        signal: input.signal,
        target,
        targetLabel,
        token: input.token,
      }),
      target,
      targetLabel,
    })

    if (outcome.kind === 'delivered') {
      return {
        ...(cleanupTargetAliases.size > 0
          ? {
              cleanupTargetAliases: [...cleanupTargetAliases],
            }
          : {}),
        providerMessageId: outcome.providerMessageId,
        target: targetLabel,
      }
    }

    if (outcome.kind === 'migrated') {
      assertTelegramAuthorityBoundTarget({
        authorityBoundTarget: input.authorityBoundTarget,
        target: outcome.targetLabel,
      })
      cleanupTargetAliases.add(targetLabel)
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

    await waitForTelegramRetryDelay(
      retryCount,
      outcome.retryAfterSeconds,
      input.signal,
    )
    if (input.signal?.aborted) {
      throw outcome.failure
    }
    retryCount += 1
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
  body?: string | Blob | FormData
  fetchImplementation: TelegramFetchImplementation
  operation: TelegramSendOperation
  payload?: Record<string, unknown>
  signal?: AbortSignal
  token: string
}): Promise<{
  payload: unknown
  response: TelegramFetchResponse
}> {
  const timeout = createTimeoutAbortController(
    input.signal,
    TELEGRAM_SEND_TIMEOUT_MS,
  )

  try {
    const response = await input.fetchImplementation(
      `${input.baseUrl}/bot${input.token}/${input.operation}`,
      {
        method: 'POST',
        headers: input.payload
          ? {
              'content-type': 'application/json',
            }
          : undefined,
        body: input.body ?? (input.payload ? JSON.stringify(input.payload) : undefined),
        signal: timeout.signal,
      },
    )
    timeout.signal.throwIfAborted()
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch (error) {
      if (timeout.signal.aborted) {
        throw error
      }
    }
    timeout.signal.throwIfAborted()
    return {
      payload,
      response,
    }
  } finally {
    timeout.cleanup()
  }
}

function buildTelegramPhotoFormData(input: {
  caption: DecoratedTelegramPhotoCaption | null
  photo: Extract<PreparedTelegramPhoto, { kind: 'upload' }>
  replyToMessageId: string | null
  target: TelegramParsedTarget
}): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(buildTelegramTargetPayload(input.target))) {
    appendTelegramFormField(form, key, value)
  }
  if (input.caption) {
    appendTelegramFormField(form, 'caption', input.caption.text)
    if (input.caption.entities.length > 0) {
      appendTelegramFormField(
        form,
        'caption_entities',
        JSON.stringify(input.caption.entities),
      )
    }
  }
  appendTelegramFormField(form, 'reply_to_message_id', input.replyToMessageId)
  form.append(
    'photo',
    new Blob([copyUint8ArrayToArrayBuffer(input.photo.bytes)], {
      type: input.photo.contentType,
    }),
    input.photo.filename,
  )
  return form
}

function buildTelegramVoiceMemoFormData(input: {
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  filename: string
  replyToMessageId: string | null
  target: TelegramParsedTarget
}): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(buildTelegramTargetPayload(input.target))) {
    appendTelegramFormField(form, key, value)
  }
  appendTelegramFormField(form, 'reply_to_message_id', input.replyToMessageId)
  form.append(
    'voice',
    new Blob([copyUint8ArrayToArrayBuffer(input.bytes)], {
      type: input.contentType,
    }),
    input.filename,
  )
  return form
}

function appendTelegramFormField(
  form: FormData,
  key: string,
  value: unknown,
): void {
  if (value === null || value === undefined) {
    return
  }
  form.append(key, String(value))
}

function createTelegramElevenLabsFetchAdapter(
  fetchImplementation: TelegramFetchImplementation,
): ElevenLabsFetch {
  return async (
    input: string,
    init: Parameters<ElevenLabsFetch>[1],
  ) => {
    const response = await fetchImplementation(input, {
      body: init.body,
      headers: init.headers,
      method: init.method,
      signal: init.signal,
    })
    return {
      arrayBuffer: async () => {
        if (typeof response.arrayBuffer === 'function') {
          return await response.arrayBuffer()
        }
        throw new TypeError('Fetch response did not expose arrayBuffer().')
      },
      ok: response.ok,
      status: response.status,
      text: async () => {
        if (typeof response.text === 'function') {
          return await response.text()
        }
        try {
          return JSON.stringify(await response.json())
        } catch {
          return ''
        }
      },
    }
  }
}

function normalizeTelegramVoiceMemoFilename(value: string): string {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return 'voice-memo.mp3'
  }
  return normalized.toLowerCase().endsWith('.mp3')
    ? normalized
    : `${normalized}.mp3`
}

function copyUint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function buildTelegramTargetPayload(target: TelegramParsedTarget): Record<string, unknown> {
  return {
    business_connection_id: target.businessConnectionId ?? undefined,
    chat_id: target.chatId,
    direct_messages_topic_id: target.directMessagesTopicId ?? undefined,
    message_thread_id: target.messageThreadId ?? undefined,
  }
}

function shouldRetryTelegramSend(
  status: number,
  errorCode: number | null,
): boolean {
  if (status === 429 || errorCode === 429) {
    return true
  }

  return status >= 500
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

function requireTelegramMaxDeliveryAttempts(value: number | undefined): number {
  if (value === undefined) {
    return TELEGRAM_MAX_DELIVERY_ATTEMPTS
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('Telegram maxDeliveryAttempts must be a positive integer.')
  }
  return Math.min(value, TELEGRAM_MAX_DELIVERY_ATTEMPTS)
}

async function waitForTelegramRetryDelay(
  attempt: number,
  retryAfterSeconds: number | null,
  signal?: AbortSignal,
): Promise<void> {
  const retryAfterMs =
    typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds)
      ? Math.min(
          Math.max(retryAfterSeconds * 1000, 1),
          TELEGRAM_MAX_RETRY_DELAY_MS,
        )
      : Math.min(250 * 2 ** attempt, 2000)

  if (signal) {
    await waitForAssistantChannelActivityRefresh(retryAfterMs, signal)
    return
  }

  await new Promise((resolve) => setTimeout(resolve, retryAfterMs))
}

function parseTelegramTargetOrThrow(target: string): TelegramParsedTarget {
  const parsed = parseTelegramThreadTarget(target)
  if (parsed) {
    return parsed
  }

  const normalizedTarget = normalizeOptionalText(target)
  if (!normalizedTarget) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
    )
  }

  throw new VaultCliError(
    'ASSISTANT_TELEGRAM_TARGET_INVALID',
    'Telegram targets must use "<chatId>", "<chatId>:topic:<messageThreadId>", "<chatId>:dm-topic:<directMessagesTopicId>", and optional ":business:<businessConnectionId>" routing segments.',
    {
      target: normalizedTarget,
    },
  )
}

async function sendTelegramRichMessageOnce(input: {
  baseUrl: string
  fetchImplementation: TelegramFetchImplementation
  replyToMessageId: string | null
  richMessage: TelegramRichMessage
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const result = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      operation: 'sendRichMessage',
      payload: {
        ...buildTelegramTargetPayload(input.target),
        reply_parameters: input.replyToMessageId
          ? { message_id: Number.parseInt(input.replyToMessageId, 10) }
          : undefined,
        rich_message: input.richMessage,
      },
      signal: input.signal,
      token: input.token,
    })

    return {
      kind: 'response',
      ...result,
    }
  } catch (error) {
    return {
      kind: 'request-error',
      failure: Object.assign(
        new VaultCliError(
          'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
          'Outbound Telegram rich-message delivery could not be confirmed after calling the Bot API.',
          {
            error: describeUnknownError(error),
            target: input.targetLabel,
          },
        ),
        {
          deliveryMayHaveSucceeded: true as const,
          providerMessageId: null,
          providerMessageIds: [] as [],
          target: input.targetLabel,
        },
      ),
    }
  }
}

async function sendTelegramTextChunkOnce(input: {
  baseUrl: string
  entities: TelegramMessageEntity[]
  fetchImplementation: TelegramFetchImplementation
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  text: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const result = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      operation: 'sendMessage',
      payload: {
        ...buildTelegramTargetPayload(input.target),
        ...(input.entities.length > 0
          ? {
              entities: input.entities,
            }
          : {}),
        reply_to_message_id: input.replyToMessageId ? Number.parseInt(input.replyToMessageId, 10) : undefined,
        text: input.text,
      },
      signal: input.signal,
      token: input.token,
    })

    return {
      kind: 'response',
      ...result,
    }
  } catch (error) {
    return {
      kind: 'request-error',
      failure: Object.assign(
        new VaultCliError(
          'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
          'Outbound Telegram delivery could not be confirmed after calling the Bot API.',
          {
            error: describeUnknownError(error),
            target: input.targetLabel,
          },
        ),
        {
          deliveryMayHaveSucceeded: true as const,
          providerMessageId: null,
          providerMessageIds: [],
          target: input.targetLabel,
        },
      ),
    }
  }
}

function buildTelegramMessageEntities(
  decorations: readonly MessageTextDecoration[],
): TelegramMessageEntity[] {
  return decorations.map((decoration) => ({
    length: decoration.range[1] - decoration.range[0],
    offset: decoration.range[0],
    type: decoration.style,
  }))
}

function buildTelegramPhotoCaption(
  message: string,
): DecoratedTelegramPhotoCaption | null {
  if (message.trim().length === 0) {
    return null
  }

  const chunks = splitDecoratedMessageText(
    renderMarkdownMessageText(message),
    TELEGRAM_MAX_PHOTO_CAPTION_LENGTH,
  )
  if (chunks.length !== 1) {
    return null
  }

  const chunk = chunks[0]!
  return {
    entities: buildTelegramMessageEntities(chunk.decorations),
    text: chunk.text,
  }
}

async function sendTelegramPhotoOnce(input: {
  baseUrl: string
  caption: DecoratedTelegramPhotoCaption | null
  fetchImplementation: TelegramFetchImplementation
  photo: PreparedTelegramPhoto
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const result = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      ...(input.photo.kind === 'url'
        ? {
            payload: {
              ...buildTelegramTargetPayload(input.target),
              ...(input.caption
                ? {
                    caption: input.caption.text,
                    ...(input.caption.entities.length > 0
                      ? { caption_entities: input.caption.entities }
                      : {}),
                  }
                : {}),
              photo: input.photo.url,
              reply_to_message_id: input.replyToMessageId
                ? Number.parseInt(input.replyToMessageId, 10)
                : undefined,
            },
          }
        : {
            body: buildTelegramPhotoFormData({
              caption: input.caption,
              photo: input.photo,
              replyToMessageId: input.replyToMessageId,
              target: input.target,
            }),
          }),
      fetchImplementation: input.fetchImplementation,
      operation: 'sendPhoto',
      signal: input.signal,
      token: input.token,
    })

    return {
      kind: 'response',
      ...result,
    }
  } catch (error) {
    return {
      kind: 'request-error',
      failure: Object.assign(
        new VaultCliError(
          'ASSISTANT_TELEGRAM_DELIVERY_AMBIGUOUS',
          'Outbound Telegram photo delivery could not be confirmed after calling the Bot API.',
          {
            error: describeUnknownError(error),
            target: input.targetLabel,
          },
        ),
        {
          deliveryMayHaveSucceeded: true as const,
          providerMessageId: null,
          providerMessageIds: [] as [],
          target: input.targetLabel,
        },
      ),
    }
  }
}

async function sendTelegramVoiceMemoOnce(input: {
  baseUrl: string
  bytes: Uint8Array
  contentType: 'audio/mpeg'
  fetchImplementation: TelegramFetchImplementation
  filename: string
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const result = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      body: buildTelegramVoiceMemoFormData({
        bytes: input.bytes,
        contentType: input.contentType,
        filename: input.filename,
        replyToMessageId: input.replyToMessageId,
        target: input.target,
      }),
      fetchImplementation: input.fetchImplementation,
      operation: 'sendVoice',
      signal: input.signal,
      token: input.token,
    })

    return {
      kind: 'response',
      ...result,
    }
  } catch (error) {
    return {
      kind: 'request-error',
      failure: createTelegramVoiceMemoAmbiguousDeliveryFailure({
        error,
        target: input.targetLabel,
      }),
    }
  }
}

function createTelegramVoiceMemoAmbiguousDeliveryFailure(input: {
  context?: Record<string, unknown>
  error: unknown
  target: string
}): VaultCliError & {
  deliveryMayHaveSucceeded: true
  providerMessageId: null
  providerMessageIds: []
  target: string
} {
  return Object.assign(
    new VaultCliError(
      'ASSISTANT_TELEGRAM_VOICE_MEMO_DELIVERY_AMBIGUOUS',
      'Outbound Telegram voice memo delivery could not be confirmed after calling the Bot API.',
      {
        error: describeUnknownError(input.error),
        ...(input.context ?? {}),
        target: input.target,
      },
    ),
    {
      deliveryMayHaveSucceeded: true as const,
      providerMessageId: null,
      providerMessageIds: [] as [],
      target: input.target,
    },
  )
}

function resolveTelegramSendAttemptOutcome(input: {
  operation: TelegramSendOperation
  result: TelegramSendAttemptResult
  target: TelegramParsedTarget
  targetLabel: string
}): TelegramSendAttemptOutcome {
  if (input.result.kind === 'request-error') {
    return {
      kind: 'failed',
      failure: input.result.failure,
    }
  }

  if (
    input.result.response.ok &&
    isTelegramSuccessResponse(input.result.payload)
  ) {
    return {
      kind: 'delivered',
      providerMessageId: extractTelegramProviderMessageId(input.result.payload),
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
      targetLabel: serializeTelegramThreadTarget(migratedTarget),
    }
  }

  const retryable = shouldRetryTelegramSend(
    input.result.response.status,
    errorContext.errorCode,
  )
  const failureMessage = errorContext.description ??
    `Telegram Bot API ${input.operation} failed with HTTP ${input.result.response.status}.`
  const failureContext = {
    errorCode: errorContext.errorCode,
    migrateToChatId: errorContext.migrateToChatId,
    operation: input.operation,
    retryAfterSeconds: errorContext.retryAfterSeconds,
    status: input.result.response.status,
    target: input.targetLabel,
  }
  const failure = retryable
    ? createAssistantDeliveryTransientError(
      'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
      failureMessage,
      failureContext,
    )
    : new VaultCliError(
      'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
      failureMessage,
      failureContext,
    )

  if (retryable) {
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

function isDefinitiveTelegramRichMessageRejection(error: unknown): boolean {
  if (!(error instanceof VaultCliError)) {
    return false
  }
  const status = error.context?.status
  return typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 425, 429].includes(status)
}

function normalizeTelegramReplyToMessageId(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalText(value)
  if (!normalized) {
    return null
  }

  return /^\d+$/u.test(normalized) ? normalized : null
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return String(error)
}

function extractTelegramProviderMessageId(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const result = 'result' in value ? (value as { result?: unknown }).result : null
  if (!result || typeof result !== 'object') {
    return null
  }

  const messageId = (result as { message_id?: unknown }).message_id
  if (typeof messageId === 'number' || typeof messageId === 'string') {
    return String(messageId)
  }

  return null
}
