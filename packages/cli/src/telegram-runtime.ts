import { VaultCliError } from './vault-cli-errors.js'

const TELEGRAM_TOPIC_TARGET_MARKER = ':topic:'

export interface TelegramSendTarget {
  chatId: string
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

export function parseTelegramSendTarget(target: string): TelegramSendTarget {
  const normalizedTarget = normalizeNullableString(target)
  if (!normalizedTarget) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
    )
  }

  const topicMarkerIndex = normalizedTarget.lastIndexOf(
    TELEGRAM_TOPIC_TARGET_MARKER,
  )
  if (topicMarkerIndex < 0) {
    return {
      chatId: normalizedTarget,
      messageThreadId: null,
    }
  }

  const chatId = normalizeNullableString(
    normalizedTarget.slice(0, topicMarkerIndex),
  )
  const messageThreadToken = normalizeNullableString(
    normalizedTarget.slice(
      topicMarkerIndex + TELEGRAM_TOPIC_TARGET_MARKER.length,
    ),
  )

  if (!chatId || !messageThreadToken || !/^\d+$/u.test(messageThreadToken)) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram topic targets must use "<chatId>:topic:<messageThreadId>".',
      {
        target: normalizedTarget,
      },
    )
  }

  const messageThreadId = Number.parseInt(messageThreadToken, 10)
  if (!Number.isSafeInteger(messageThreadId) || messageThreadId <= 0) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram topic targets must use a positive integer message_thread_id.',
      {
        target: normalizedTarget,
      },
    )
  }

  return {
    chatId,
    messageThreadId,
  }
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
