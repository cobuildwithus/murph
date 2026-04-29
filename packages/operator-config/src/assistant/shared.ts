import { normalizeNullableString as normalizeNullableText } from '../text/shared.js'

export { normalizeNullableString } from '../text/shared.js'

export function parseAssistantBaseUrl(
  value: string | null | undefined,
): URL | null {
  const normalized = normalizeNullableText(value)
  if (!normalized) {
    return null
  }

  try {
    const parsed = new URL(normalized)
    return parsed.username || parsed.password ? null : parsed
  } catch {
    return null
  }
}

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

export function isAssistantVercelAIGatewayBaseUrl(
  value: string | null | undefined,
): boolean {
  return matchesAssistantHttpsHost(value, 'ai-gateway.vercel.sh')
}

export function isAssistantLocalDevelopmentBaseUrl(
  value: string | null | undefined,
): boolean {
  const parsed = parseAssistantBaseUrl(value)
  if (!parsed) {
    return false
  }

  return [
    '127.0.0.1',
    '::1',
    'host.containers.internal',
    'host.docker.internal',
    'localhost',
  ].includes(parsed.hostname.toLowerCase())
}

function matchesAssistantHttpsHost(
  value: string | null | undefined,
  expectedHostname: string,
): boolean {
  const parsed = parseAssistantBaseUrl(value)
  if (!parsed) {
    return false
  }

  return (
    parsed.protocol === 'https:' &&
    parsed.hostname.toLowerCase() === expectedHostname &&
    parsed.port === ''
  )
}
