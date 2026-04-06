const REDACTED_SECRET_TEXT = '[REDACTED]' as const

const SENSITIVE_HEADER_NAME_PATTERN =
  /(?:^|[-_])(?:authorization|cookie|token|secret|api[-_]?key|session[-_]?key)(?:$|[-_])/iu
const SENSITIVE_HEADER_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gu

export interface AssistantHeaderPersistenceSplit {
  persistedHeaders: Record<string, string> | null
  secretHeaders: Record<string, string> | null
}

export function splitAssistantHeadersForPersistence(
  headers: Record<string, string> | null | undefined,
): AssistantHeaderPersistenceSplit {
  if (!headers || Object.keys(headers).length === 0) {
    return {
      persistedHeaders: null,
      secretHeaders: null,
    }
  }

  const persistedHeaders: Record<string, string> = {}
  const secretHeaders: Record<string, string> = {}

  for (const [key, rawValue] of Object.entries(headers)) {
    const value = typeof rawValue === 'string' ? rawValue : String(rawValue)
    if (isSensitiveAssistantHeaderName(key) || isSensitiveAssistantHeaderValue(value)) {
      secretHeaders[key] = value
      continue
    }
    persistedHeaders[key] = value
  }

  return {
    persistedHeaders:
      Object.keys(persistedHeaders).length > 0 ? persistedHeaders : null,
    secretHeaders: Object.keys(secretHeaders).length > 0 ? secretHeaders : null,
  }
}

export function isSensitiveAssistantHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAME_PATTERN.test(name)
}

export function isSensitiveAssistantHeaderValue(value: string): boolean {
  return SENSITIVE_HEADER_VALUE_PATTERN.test(value)
}
