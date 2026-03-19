import { VaultCliError } from './vault-cli-errors.js'

const TELEGRAM_BUSINESS_TARGET_MARKER = ':business:'
const TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER = ':dm-topic:'
const TELEGRAM_TOPIC_TARGET_MARKER = ':topic:'

export interface TelegramSendTarget {
  chatId: string
  businessConnectionId: string | null
  directMessagesTopicId: number | null
  messageThreadId: number | null
}

export function resolveTelegramBotToken(
  env: NodeJS.ProcessEnv,
): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_TELEGRAM_BOT_TOKEN) ??
    normalizeNullableString(env.TELEGRAM_BOT_TOKEN)
  )
}

export function resolveTelegramApiBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_TELEGRAM_API_BASE_URL) ??
    normalizeNullableString(env.TELEGRAM_API_BASE_URL)
  )
}

export function resolveTelegramFileBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return (
    normalizeNullableString(env.HEALTHYBOB_TELEGRAM_FILE_BASE_URL) ??
    normalizeNullableString(env.TELEGRAM_FILE_BASE_URL)
  )
}

export function serializeTelegramSendTarget(
  target: TelegramSendTarget,
): string {
  const chatId = normalizeNullableString(target.chatId)
  if (!chatId) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
    )
  }

  const businessConnectionId = normalizeNullableString(
    target.businessConnectionId,
  )
  const messageThreadId = normalizePositiveInteger(
    target.messageThreadId,
    'message_thread_id',
    chatId,
  )
  const directMessagesTopicId = normalizePositiveInteger(
    target.directMessagesTopicId,
    'direct_messages_topic_id',
    chatId,
  )

  if (
    messageThreadId !== null &&
    directMessagesTopicId !== null
  ) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram targets cannot include both message_thread_id and direct_messages_topic_id.',
      {
        target: chatId,
      },
    )
  }

  let serialized = chatId
  if (businessConnectionId) {
    serialized += `${TELEGRAM_BUSINESS_TARGET_MARKER}${encodeURIComponent(
      businessConnectionId,
    )}`
  }
  if (directMessagesTopicId !== null) {
    serialized += `${TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER}${directMessagesTopicId}`
  } else if (messageThreadId !== null) {
    serialized += `${TELEGRAM_TOPIC_TARGET_MARKER}${messageThreadId}`
  }

  return serialized
}

export function parseTelegramSendTarget(target: string): TelegramSendTarget {
  const normalizedTarget = normalizeNullableString(target)
  if (!normalizedTarget) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
    )
  }

  const firstMarkerIndex = firstTelegramMarkerIndex(normalizedTarget)
  const chatId =
    firstMarkerIndex < 0
      ? normalizedTarget
      : normalizeNullableString(normalizedTarget.slice(0, firstMarkerIndex))

  if (!chatId) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
      {
        target: normalizedTarget,
      },
    )
  }

  let businessConnectionId: string | null = null
  let directMessagesTopicId: number | null = null
  let messageThreadId: number | null = null
  let remainder =
    firstMarkerIndex < 0 ? '' : normalizedTarget.slice(firstMarkerIndex)

  while (remainder.length > 0) {
    const marker = matchingTelegramMarker(remainder)
    if (!marker) {
      throw new VaultCliError(
        'ASSISTANT_TELEGRAM_TARGET_INVALID',
        'Telegram targets must use "<chatId>", "<chatId>:topic:<messageThreadId>", "<chatId>:dm-topic:<directMessagesTopicId>", and optional ":business:<businessConnectionId>" routing segments.',
        {
          target: normalizedTarget,
        },
      )
    }

    remainder = remainder.slice(marker.length)
    const nextMarkerIndex = firstTelegramMarkerIndex(remainder)
    const rawValue =
      nextMarkerIndex < 0 ? remainder : remainder.slice(0, nextMarkerIndex)
    remainder = nextMarkerIndex < 0 ? '' : remainder.slice(nextMarkerIndex)

    if (marker === TELEGRAM_BUSINESS_TARGET_MARKER) {
      if (businessConnectionId !== null) {
        throw new VaultCliError(
          'ASSISTANT_TELEGRAM_TARGET_INVALID',
          'Telegram targets can include at most one business connection identifier.',
          {
            target: normalizedTarget,
          },
        )
      }

      businessConnectionId = normalizeTelegramBusinessConnectionId(
        rawValue,
        normalizedTarget,
      )
      continue
    }

    const parsedInteger = parseTelegramTargetPositiveInteger(
      rawValue,
      marker === TELEGRAM_TOPIC_TARGET_MARKER
        ? 'message_thread_id'
        : 'direct_messages_topic_id',
      normalizedTarget,
    )

    if (marker === TELEGRAM_TOPIC_TARGET_MARKER) {
      if (messageThreadId !== null || directMessagesTopicId !== null) {
        throw new VaultCliError(
          'ASSISTANT_TELEGRAM_TARGET_INVALID',
          'Telegram targets can include only one topic selector.',
          {
            target: normalizedTarget,
          },
        )
      }

      messageThreadId = parsedInteger
      continue
    }

    if (directMessagesTopicId !== null || messageThreadId !== null) {
      throw new VaultCliError(
        'ASSISTANT_TELEGRAM_TARGET_INVALID',
        'Telegram targets can include only one topic selector.',
        {
          target: normalizedTarget,
        },
      )
    }

    directMessagesTopicId = parsedInteger
  }

  return {
    chatId,
    businessConnectionId,
    directMessagesTopicId,
    messageThreadId,
  }
}

function firstTelegramMarkerIndex(target: string): number {
  const indexes = [
    target.indexOf(TELEGRAM_BUSINESS_TARGET_MARKER),
    target.indexOf(TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER),
    target.indexOf(TELEGRAM_TOPIC_TARGET_MARKER),
  ].filter((value) => value >= 0)

  if (indexes.length === 0) {
    return -1
  }

  return Math.min(...indexes)
}

function matchingTelegramMarker(target: string): string | null {
  if (target.startsWith(TELEGRAM_BUSINESS_TARGET_MARKER)) {
    return TELEGRAM_BUSINESS_TARGET_MARKER
  }

  if (target.startsWith(TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER)) {
    return TELEGRAM_DIRECT_MESSAGES_TOPIC_TARGET_MARKER
  }

  if (target.startsWith(TELEGRAM_TOPIC_TARGET_MARKER)) {
    return TELEGRAM_TOPIC_TARGET_MARKER
  }

  return null
}

function normalizeTelegramBusinessConnectionId(
  rawValue: string,
  target: string,
): string {
  const normalized = normalizeNullableString(rawValue)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram business targets must use a non-empty business_connection_id.',
      {
        target,
      },
    )
  }

  try {
    const decoded = decodeURIComponent(normalized)
    if (!decoded.trim()) {
      throw new TypeError('decoded business connection id was empty')
    }
    return decoded
  } catch {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram business targets must use a valid URL-encoded business_connection_id.',
      {
        target,
      },
    )
  }
}

function parseTelegramTargetPositiveInteger(
  rawValue: string,
  fieldName: 'direct_messages_topic_id' | 'message_thread_id',
  target: string,
): number {
  const normalized = normalizeNullableString(rawValue)
  if (!normalized || !/^\d+$/u.test(normalized)) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      `Telegram targets must use a positive integer ${fieldName}.`,
      {
        target,
      },
    )
  }

  const parsed = Number.parseInt(normalized, 10)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      `Telegram targets must use a positive integer ${fieldName}.`,
      {
        target,
      },
    )
  }

  return parsed
}

function normalizePositiveInteger(
  value: number | null,
  fieldName: 'direct_messages_topic_id' | 'message_thread_id',
  target: string,
): number | null {
  if (value === null) {
    return null
  }

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      `Telegram targets must use a positive integer ${fieldName}.`,
      {
        target,
      },
    )
  }

  return value
}

function normalizeNullableString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}
