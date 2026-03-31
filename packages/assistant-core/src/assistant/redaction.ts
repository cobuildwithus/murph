import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '../assistant-cli-contracts.js'

const REDACTED_SECRET_TEXT = '[REDACTED]' as const

const SENSITIVE_HEADER_NAME_PATTERN =
  /(?:^|[-_])(?:authorization|cookie|token|secret|api[-_]?key|session[-_]?key)(?:$|[-_])/iu
const SENSITIVE_HEADER_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gu
const SENSITIVE_INLINE_ASSIGNMENT_PATTERN =
  /((?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)\s*[:=]\s*["']?)([^"'\s,;\]}]{4,})/giu

export interface AssistantHeaderPersistenceSplit {
  persistedHeaders: Record<string, string> | null
  secretHeaders: Record<string, string> | null
}

export function redactAssistantStateString(value: string): string {
  return value
    .replace(SENSITIVE_HEADER_VALUE_PATTERN, (match) => {
      const scheme = match.split(/\s+/u, 1)[0]
      return `${scheme} ${REDACTED_SECRET_TEXT}`
    })
    .replace(SENSITIVE_INLINE_ASSIGNMENT_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_SECRET_TEXT}`
    })
}

export function redactAssistantStateStructuredValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactAssistantStateStructuredValue(entry))
  }

  if (typeof value === 'string') {
    return redactAssistantStateString(value)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => {
      if (isSensitiveAssistantFieldName(key)) {
        return [key, REDACTED_SECRET_TEXT]
      }
      return [key, redactAssistantStateStructuredValue(entryValue)]
    }),
  )
}

export function containsInlineAssistantSecretMaterial(value: string): boolean {
  return redactAssistantStateString(value) !== value
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

export function mergeAssistantHeaders(
  publicHeaders: Record<string, string> | null | undefined,
  secretHeaders: Record<string, string> | null | undefined,
): Record<string, string> | null {
  const merged = {
    ...(publicHeaders ?? {}),
    ...(secretHeaders ?? {}),
  }

  return Object.keys(merged).length > 0 ? merged : null
}

export function redactAssistantHeadersForDisplay(
  headers: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!headers || Object.keys(headers).length === 0) {
    return null
  }

  const split = splitAssistantHeadersForPersistence(headers)
  const redactedSecretHeaders = Object.fromEntries(
    Object.keys(split.secretHeaders ?? {}).map((headerName) => [
      headerName,
      REDACTED_SECRET_TEXT,
    ]),
  ) as Record<string, string>

  return mergeAssistantHeaders(split.persistedHeaders, redactedSecretHeaders)
}

export function redactAssistantProviderOptionsForDisplay(
  providerOptions: AssistantProviderSessionOptions,
): AssistantProviderSessionOptions {
  return {
    ...providerOptions,
    headers: redactAssistantHeadersForDisplay(providerOptions.headers),
  }
}

export function redactAssistantSessionForDisplay(
  session: AssistantSession,
): AssistantSession {
  return {
    ...session,
    providerOptions: redactAssistantProviderOptionsForDisplay(session.providerOptions),
    providerBinding: session.providerBinding
      ? {
          ...session.providerBinding,
          providerOptions: redactAssistantProviderOptionsForDisplay(
            session.providerBinding.providerOptions,
          ),
        }
      : null,
  }
}

export function redactAssistantSessionsForDisplay(
  sessions: readonly AssistantSession[],
): AssistantSession[] {
  return sessions.map((session) => redactAssistantSessionForDisplay(session))
}

export function isSensitiveAssistantHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAME_PATTERN.test(name)
}

export function isSensitiveAssistantHeaderValue(value: string): boolean {
  return SENSITIVE_HEADER_VALUE_PATTERN.test(value)
}

function isSensitiveAssistantFieldName(name: string): boolean {
  return SENSITIVE_HEADER_NAME_PATTERN.test(name)
}
