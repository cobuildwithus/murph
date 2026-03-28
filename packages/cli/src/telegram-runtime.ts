import { normalizeNullableString } from './text/shared.js'

export function resolveTelegramBotToken(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.TELEGRAM_BOT_TOKEN)
}

export function resolveTelegramApiBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.TELEGRAM_API_BASE_URL)
}

export function resolveTelegramFileBaseUrl(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.TELEGRAM_FILE_BASE_URL)
}
