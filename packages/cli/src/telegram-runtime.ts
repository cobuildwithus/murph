import {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
  type TelegramThreadTarget,
} from '@healthybob/inboxd'
import { VaultCliError } from './vault-cli-errors.js'

export type TelegramSendTarget = TelegramThreadTarget

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
  const parsed = parseTelegramThreadTarget(target)
  if (parsed) {
    return parsed
  }

  const normalizedTarget = normalizeNullableString(target)
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

export function formatTelegramSendTarget(
  target: TelegramSendTarget,
): string {
  const normalized = normalizeTelegramSendTarget(target)
  return serializeTelegramThreadTarget(normalized)
}

export function normalizeTelegramSendTarget(
  target: TelegramSendTarget,
): TelegramSendTarget {
  const normalizedChatId = normalizeNullableString(target.chatId)
  if (!normalizedChatId) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram delivery requires a non-empty chat id, username, or topic target.',
    )
  }

  const businessConnectionId = normalizeNullableString(
    target.businessConnectionId,
  )
  const directMessagesTopicId = normalizePositiveInteger(
    target.directMessagesTopicId,
    'direct_messages_topic_id',
    normalizedChatId,
  )
  const messageThreadId = normalizePositiveInteger(
    target.messageThreadId,
    'message_thread_id',
    normalizedChatId,
  )

  if (directMessagesTopicId !== null && messageThreadId !== null) {
    throw new VaultCliError(
      'ASSISTANT_TELEGRAM_TARGET_INVALID',
      'Telegram targets can include only one topic selector.',
      {
        target: normalizedChatId,
      },
    )
  }

  return {
    chatId: normalizedChatId,
    businessConnectionId,
    directMessagesTopicId,
    messageThreadId,
  }
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
