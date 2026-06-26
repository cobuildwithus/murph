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
  createLinqAttachmentUpload,
  createLinqChat,
  resolveLinqApiToken,
  sendLinqChatMessage,
  setLinqMessageReaction as setLinqApiMessageReaction,
  sendLinqVoiceMemo,
  startLinqChatTypingIndicator,
  stopLinqChatTypingIndicator,
  uploadLinqAttachmentBytes,
} from '@murphai/operator-config/linq-runtime'
import {
  generateElevenLabsVoiceMemoAudio,
  resolveElevenLabsApiKey,
  type ElevenLabsFetch,
} from '@murphai/operator-config/elevenlabs-runtime'
import {
  deleteTelegramMessages,
  resolveTelegramApiBaseUrl,
  resolveTelegramBotToken,
  type TelegramFetchImplementation,
  type TelegramFetchResponse,
  startTelegramTypingSession,
} from '@murphai/operator-config/telegram-runtime'
import {
  sendWhatsAppTextMessage,
} from '@murphai/operator-config/whatsapp-runtime'
import {
  createLinkedAbortSignal,
  createTimeoutAbortController,
} from '@murphai/operator-config/http-retry'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  renderMarkdownMessageText,
  splitDecoratedMessageText,
  type MessageTextDecoration,
} from '@murphai/operator-config/message-formatting'
import type {
  AssistantChannelActivityHandle,
  AssistantDeliveryCandidate,
  EmailRuntimeDependencies,
  LinqRuntimeDependencies,
  TelegramRuntimeDependencies,
  WhatsAppRuntimeDependencies,
} from './types.js'
import type {
  AssistantMessageReaction,
  AssistantResponseMedia,
  AssistantVoiceMemoGeneration,
} from '@murphai/operator-config/assistant-cli-contracts'
import { normalizeOptionalText } from './helpers.js'

const TELEGRAM_MAX_TEXT_LENGTH = 4096
const TELEGRAM_MAX_PHOTO_CAPTION_LENGTH = 1024
const TELEGRAM_MAX_DELIVERY_ATTEMPTS = 3
const TELEGRAM_MAX_RETRY_DELAY_MS = 30_000
const TELEGRAM_SEND_TIMEOUT_MS = 30_000
const TELEGRAM_MAX_VOICE_MEMO_BYTES = 10 * 1024 * 1024
const LINQ_TYPING_REFRESH_MS = 45_000
const LINQ_TYPING_MAX_SESSION_MS = 5 * 60_000

type TelegramParsedTarget = TelegramThreadTarget
type TelegramSendOperation = 'sendMessage' | 'sendPhoto' | 'sendVoice'
type TelegramImageResponseMedia = Extract<AssistantResponseMedia, { kind: 'image' }>

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
  const media = input.media.filter((item) => item.kind === 'image')
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

  const caption = buildTelegramPhotoCaption(input.message)
  if (!caption && input.message.trim().length > 0) {
    const deliveredText = await sendTelegramMessageDetailed(
      {
        idempotencyKey: input.idempotencyKey ?? null,
        message: input.message,
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
        baseUrl,
        caption: index === 0 ? caption : null,
        fetchImplementation,
        photoUrl: image.url,
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
  dependencies: Pick<TelegramRuntimeDependencies, 'signal'> = {},
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
    fromPhoneNumber?: string | null
    idempotencyKey?: string | null
    media?: readonly AssistantResponseMedia[] | null
    message: string
    replyToMessageId?: string | null
    target: string
    targetKind?: AssistantDeliveryCandidate['kind']
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
  const participantFromPhoneNumber = input.targetKind === 'participant'
    ? normalizeOptionalText(input.fromPhoneNumber)
    : null
  if (input.targetKind === 'participant' && !participantFromPhoneNumber) {
    throw new VaultCliError(
      'ASSISTANT_LINQ_FROM_PHONE_REQUIRED',
      'Materializing an iMessage direct chat requires a sender phone number.',
    )
  }

  const media = await prepareLinqMessageMedia(
    input.media ?? [],
    dependencies,
  )

  if (participantFromPhoneNumber) {
    const created = await createLinqChat(
      {
        from: participantFromPhoneNumber,
        idempotencyKey: input.idempotencyKey ?? null,
        message: input.message,
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
      providerThreadId: normalizeOptionalText(created.chatId),
      target: normalizeOptionalText(created.chatId),
    }
  }

  const delivered = await sendLinqChatMessage(
    {
      chatId: target,
      idempotencyKey: input.idempotencyKey ?? null,
      message: input.message,
      ...(media.length > 0 ? { media } : {}),
      replyToMessageId: input.replyToMessageId ?? null,
    },
    {
      env,
      fetchImplementation: dependencies.fetchImplementation,
      ...(dependencies.signal ? { signal: dependencies.signal } : {}),
    },
  )
  return {
    providerMessageId: normalizeOptionalText(delivered.message?.id ?? null),
    providerThreadId: null,
    target,
  }
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

    if (item.kind !== 'vault_file') {
      throw new VaultCliError(
        'ASSISTANT_LINQ_MEDIA_KIND_UNSUPPORTED',
        'Standard iMessage delivery only supports image and approved vault-file media parts.',
      )
    }

    if (!dependencies.loadVaultFile) {
      throw new VaultCliError(
        'ASSISTANT_VAULT_FILE_LOADER_REQUIRED',
        'Vault-file delivery requires a trusted vault-file loader.',
      )
    }

    const bytes = await dependencies.loadVaultFile(item)
    const upload = await createLinqAttachmentUpload(
      {
        contentType: item.contentType,
        filename: item.filename,
        sizeBytes: item.sizeBytes,
      },
      {
        env: dependencies.env,
        fetchImplementation: dependencies.fetchImplementation,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      },
    )
    await uploadLinqAttachmentBytes(
      {
        bytes,
        requiredHeaders: upload.requiredHeaders,
        uploadUrl: upload.uploadUrl,
      },
      {
        fetchImplementation: dependencies.fetchImplementation,
        ...(dependencies.signal ? { signal: dependencies.signal } : {}),
      },
    )
    prepared.push({ attachmentId: upload.attachmentId })
  }

  return prepared
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

export async function sendWhatsAppMessage(
  input: {
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: WhatsAppRuntimeDependencies = {},
): Promise<{
  providerMessageId: string | null
  providerThreadId: string | null
  target: string
}> {
  return sendWhatsAppTextMessage(input, {
    env: dependencies.env,
    fetchImplementation: dependencies.fetchImplementation,
    signal: dependencies.signal,
  })
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
  const maxSessionMs = normalizeAssistantChannelActivityMaxSessionMs(
    input.maxSessionMs ?? null,
  )
  const refresh = input.refresh ?? input.start
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let maxSessionTimer: ReturnType<typeof setTimeout> | null = null
  let refreshFailure: unknown = null
  let refreshTail: Promise<void> = Promise.resolve()
  let stopped = false
  let stopPromise: Promise<void> | null = null

  scheduleNextRefresh()
  if (maxSessionMs !== null) {
    maxSessionTimer = setTimeout(() => {
      void stopActivity().catch(() => {})
    }, maxSessionMs)
    unrefAssistantChannelActivityTimer(maxSessionTimer)
  }

  return {
    refreshNow: async () => {
      clearRefreshTimer()
      await enqueueRefresh()
      scheduleNextRefresh()
    },
    stop: stopActivity,
  }

  function scheduleNextRefresh(): void {
    if (stopped || linkedStopSignal.signal.aborted || refreshFailure) {
      return
    }

    clearRefreshTimer()
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void enqueueRefresh().then(() => {
        scheduleNextRefresh()
      })
    }, refreshMs)
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

  async function stopActivity(): Promise<void> {
    if (!stopPromise) {
      stopPromise = stopActivityOnce()
    }

    await stopPromise
  }

  async function stopActivityOnce(): Promise<void> {
    stopped = true
    clearRefreshTimer()
    clearMaxSessionTimer()
    linkedStopSignal.controller.abort()
    linkedStopSignal.cleanup()

    await refreshTail

    let stopFailure: unknown = null
    try {
      await input.stop?.()
    } catch (error) {
      stopFailure = error
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
  for (const chunk of chunks) {
    try {
      const delivered = await sendTelegramTextChunk({
        baseUrl,
        entities: buildTelegramMessageEntities(chunk.decorations),
        fetchImplementation,
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
  baseUrl: string
  entities: TelegramMessageEntity[]
  fetchImplementation: TelegramFetchImplementation
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

async function sendTelegramPhoto(input: {
  baseUrl: string
  caption: DecoratedTelegramPhotoCaption | null
  fetchImplementation: TelegramFetchImplementation
  photoUrl: string
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

  while (true) {
    const outcome = resolveTelegramSendAttemptOutcome({
      operation: 'sendPhoto',
      result: await sendTelegramPhotoOnce({
        baseUrl: input.baseUrl,
        caption: input.caption,
        fetchImplementation: input.fetchImplementation,
        photoUrl: input.photoUrl,
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

async function readTelegramResponsePayload(
  response: TelegramFetchResponse,
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
  body?: string | Blob | FormData
  fetchImplementation: TelegramFetchImplementation
  headers?: Record<string, string>
  method: 'POST'
  operation: 'sendChatAction' | 'sendMessage' | 'sendPhoto' | 'sendVoice'
  payload?: Record<string, unknown>
  signal?: AbortSignal
  token: string
}): Promise<TelegramFetchResponse> {
  const timeout = createTimeoutAbortController(
    input.signal,
    TELEGRAM_SEND_TIMEOUT_MS,
  )

  try {
    return await input.fetchImplementation(
      `${input.baseUrl}/bot${input.token}/${input.operation}`,
      {
        method: input.method,
        headers: input.headers ??
          (input.payload
            ? {
                'content-type': 'application/json',
              }
            : undefined),
        body: input.body ?? (input.payload ? JSON.stringify(input.payload) : undefined),
        signal: timeout.signal,
      },
    )
  } finally {
    timeout.cleanup()
  }
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
    const response = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      method: 'POST',
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
      payload: await readTelegramResponsePayload(response),
      response,
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
  photoUrl: string
  replyToMessageId: string | null
  signal?: AbortSignal
  target: TelegramParsedTarget
  targetLabel: string
  token: string
}): Promise<TelegramSendAttemptResult> {
  try {
    const response = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      method: 'POST',
      operation: 'sendPhoto',
      payload: {
        ...buildTelegramTargetPayload(input.target),
        ...(input.caption
          ? {
              caption: input.caption.text,
              ...(input.caption.entities.length > 0
                ? {
                    caption_entities: input.caption.entities,
                  }
                : {}),
            }
          : {}),
        photo: input.photoUrl,
        reply_to_message_id: input.replyToMessageId ? Number.parseInt(input.replyToMessageId, 10) : undefined,
      },
      signal: input.signal,
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
    const response = await sendTelegramBotApiRequest({
      baseUrl: input.baseUrl,
      body: buildTelegramVoiceMemoFormData({
        bytes: input.bytes,
        contentType: input.contentType,
        filename: input.filename,
        replyToMessageId: input.replyToMessageId,
        target: input.target,
      }),
      fetchImplementation: input.fetchImplementation,
      method: 'POST',
      operation: 'sendVoice',
      signal: input.signal,
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

  const failure = new VaultCliError(
    'ASSISTANT_TELEGRAM_DELIVERY_FAILED',
    errorContext.description ??
      `Telegram Bot API ${input.operation} failed with HTTP ${input.result.response.status}.`,
    {
      errorCode: errorContext.errorCode,
      migrateToChatId: errorContext.migrateToChatId,
      operation: input.operation,
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
