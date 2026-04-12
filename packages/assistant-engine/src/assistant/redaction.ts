import type {
  AssistantProviderSessionOptions,
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  isSensitiveAssistantHeaderName as isSensitiveSharedAssistantHeaderName,
  isSensitiveAssistantHeaderValue as isSensitiveSharedAssistantHeaderValue,
  splitAssistantHeadersForPersistence as splitSharedAssistantHeadersForPersistence,
  type AssistantHeaderPersistenceSplit as SharedAssistantHeaderPersistenceSplit,
} from '@murphai/operator-config/assistant/redaction'

const REDACTED_SECRET_TEXT = '[REDACTED]' as const

const SENSITIVE_HEADER_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gu
const SENSITIVE_INLINE_ASSIGNMENT_PATTERN =
  /((?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)\s*[:=]\s*["']?)([^"'\s,;\]}]{4,})/giu

export type AssistantHeaderPersistenceSplit = SharedAssistantHeaderPersistenceSplit

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
  return splitSharedAssistantHeadersForPersistence(headers)
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
    target:
      session.target.adapter === 'openai-compatible'
        ? {
            ...session.target,
            headers: redactAssistantHeadersForDisplay(session.target.headers),
          }
        : session.target,
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
  return isSensitiveSharedAssistantHeaderName(name)
}

export function isSensitiveAssistantHeaderValue(value: string): boolean {
  return isSensitiveSharedAssistantHeaderValue(value)
}

function isSensitiveAssistantFieldName(name: string): boolean {
  return isSensitiveAssistantHeaderName(name)
}
