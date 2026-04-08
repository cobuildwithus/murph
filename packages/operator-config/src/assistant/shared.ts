import { normalizeNullableString as normalizeNullableText } from '../text/shared.js'

export { normalizeNullableString } from '../text/shared.js'

export function readAssistantEnvString(
  env: NodeJS.ProcessEnv | null | undefined,
  key: string | null | undefined,
): string | null {
  const normalizedKey = normalizeNullableText(key)
  if (!normalizedKey) {
    return null
  }

  const value = env?.[normalizedKey]
  return typeof value === 'string' ? normalizeNullableText(value) : null
}

export function isAssistantOpenAIBaseUrl(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeNullableText(value)
  if (!normalized) {
    return false
  }

  try {
    const parsed = new URL(normalized)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'api.openai.com'
    )
  } catch {
    return false
  }
}

export function isAssistantVercelAIGatewayBaseUrl(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeNullableText(value)
  if (!normalized) {
    return false
  }

  try {
    const parsed = new URL(normalized)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'ai-gateway.vercel.sh'
    )
  } catch {
    return false
  }
}
