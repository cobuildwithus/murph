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
  return matchesAssistantHttpsHost(value, 'api.openai.com')
}

export function isAssistantVercelAIGatewayBaseUrl(
  value: string | null | undefined,
): boolean {
  return matchesAssistantHttpsHost(value, 'ai-gateway.vercel.sh')
}

function matchesAssistantHttpsHost(
  value: string | null | undefined,
  expectedHostname: string,
): boolean {
  const normalized = normalizeNullableText(value)
  if (!normalized) {
    return false
  }

  try {
    const parsed = new URL(normalized)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === expectedHostname
    )
  } catch {
    return false
  }
}
