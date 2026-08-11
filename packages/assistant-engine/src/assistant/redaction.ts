import type {
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantProviderSessionOptions,
  AssistantSession,
  AssistantTurnReceipt,
  AssistantTurnTimelineEvent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  isSensitiveAssistantHeaderName,
  isSensitiveAssistantHeaderValue,
  mergeAssistantHeaders,
  splitAssistantHeadersForPersistence,
} from '@murphai/operator-config/assistant/redaction'
import type { AssistantHeaderPersistenceSplit } from '@murphai/operator-config/assistant/redaction'

const REDACTED_SECRET_TEXT = '[REDACTED]' as const
const REDACTED_LOCAL_PATH_TEXT = '[path]' as const
const PORTABLE_STATE_STRING_MAX_LENGTH = 240
const PORTABLE_STATE_METADATA_VALUE_MAX_LENGTH = 160

const SENSITIVE_AUTH_SCHEME_PATTERN =
  '(?:AWS4-HMAC-SHA256|Bearer|Basic|Digest|OAuth|Token|ApiKey|Api-Key|X-Api-Key)'
const SENSITIVE_HEADER_VALUE_PATTERN = new RegExp(
  `\\b${SENSITIVE_AUTH_SCHEME_PATTERN}\\s+[A-Za-z0-9._~+/=-]+(?=$|[\\s,;\\]}])`,
  'giu',
)
const UNKNOWN_AUTH_SCHEME_PATTERN = '[A-Za-z][A-Za-z0-9._~-]*'
const UNKNOWN_AUTH_CREDENTIAL_PATTERN = '[^"\'\\s,;\\[\\]}=]{4,}={0,2}'
const SENSITIVE_FIELD_ASSIGNMENT_KEYS_PATTERN =
  '(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|signature|token)'
const SENSITIVE_NON_AUTH_FIELD_ASSIGNMENT_KEYS_PATTERN =
  '(?:cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|signature|token)'
const SENSITIVE_KNOWN_AUTHORIZATION_ASSIGNMENT_PATTERN = new RegExp(
  `((?:authorization|proxy-authorization)\\s*[:=]\\s*["']?)(?:${SENSITIVE_AUTH_SCHEME_PATTERN}\\s+)([^"'\\s,;\\]}]{4,})`,
  'giu',
)
const SENSITIVE_UNKNOWN_AUTHORIZATION_ASSIGNMENT_PATTERN = new RegExp(
  `((?:authorization|proxy-authorization)\\s*[:=]\\s*["']?)(?!${SENSITIVE_AUTH_SCHEME_PATTERN}\\s)${UNKNOWN_AUTH_SCHEME_PATTERN}\\s+${UNKNOWN_AUTH_CREDENTIAL_PATTERN}(?=$|[\\s,;\\]}])`,
  'giu',
)
const SENSITIVE_BARE_AUTHORIZATION_ASSIGNMENT_PATTERN = new RegExp(
  `((?:authorization|proxy-authorization)\\s*[:=]\\s*["']?)(?!\\[REDACTED\\])([^"'\\s,;\\[\\]}]{4,})`,
  'giu',
)
const SENSITIVE_INLINE_ASSIGNMENT_PATTERN =
  new RegExp(
    `((${SENSITIVE_NON_AUTH_FIELD_ASSIGNMENT_KEYS_PATTERN}\\s*[:=]\\s*["']?)(?:${SENSITIVE_AUTH_SCHEME_PATTERN}\\s+)?)([^"'\\s,;\\]}]{4,})`,
    'giu',
  )
const SENSITIVE_BARE_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gu,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9_]{8,}\b/gu,
  /\bwhsec[_-][A-Za-z0-9_-]{8,}\b/gu,
  /\bgh[opsru]_[A-Za-z0-9_]{16,}\b/gu,
  /\bxox[abprs]-[A-Za-z0-9-]{16,}\b/gu,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/gu,
]
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu
const URL_PATTERN = /(?:https?:\/\/|file:\/\/)[^\s),;]+/giu
const POSIX_LOCAL_PATH_PATTERN =
  /(?:file:\/\/)?\/(?:Users|home|mnt|tmp|var)\/[^\s),;]+/giu
const WINDOWS_LOCAL_PATH_PATTERN = /[A-Za-z]:\\[^\s),;]+/gu
const HOSTED_RUNTIME_DIRECT_WORKFLOW_ID_PATTERN =
  /\bhosted-user-runtime:[A-Za-z0-9._:-]+/gu
const HOSTED_RUNTIME_DIRECT_ID_PATTERN =
  /\b(member|user)_[A-Za-z0-9._:-]*\d[A-Za-z0-9._:-]*/gu

export {
  isSensitiveAssistantHeaderName,
  isSensitiveAssistantHeaderValue,
  mergeAssistantHeaders,
  splitAssistantHeadersForPersistence,
}
export type { AssistantHeaderPersistenceSplit }

export function redactAssistantStateString(value: string): string {
  const assignedSecretRedacted = value
    .replace(SENSITIVE_KNOWN_AUTHORIZATION_ASSIGNMENT_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_SECRET_TEXT}`
    })
    .replace(SENSITIVE_UNKNOWN_AUTHORIZATION_ASSIGNMENT_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_SECRET_TEXT}`
    })
    .replace(SENSITIVE_BARE_AUTHORIZATION_ASSIGNMENT_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_SECRET_TEXT}`
    })
    .replace(SENSITIVE_INLINE_ASSIGNMENT_PATTERN, (_match, prefix: string) => {
      return `${prefix}${REDACTED_SECRET_TEXT}`
    })
    .replace(SENSITIVE_HEADER_VALUE_PATTERN, (match) => {
      const scheme = match.split(/\s+/u, 1)[0]
      return `${scheme} ${REDACTED_SECRET_TEXT}`
    })

  return redactAssistantDirectIdentifiers(
    redactBareAssistantSecretValues(assignedSecretRedacted),
  )
}

function redactBareAssistantSecretValues(value: string): string {
  let redacted = value
  for (const pattern of SENSITIVE_BARE_SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED_SECRET_TEXT)
  }
  return redacted
}

function redactAssistantDirectIdentifiers(value: string): string {
  return value
    .replace(
      HOSTED_RUNTIME_DIRECT_WORKFLOW_ID_PATTERN,
      'hosted-user-runtime:[redacted-id]',
    )
    .replace(
      HOSTED_RUNTIME_DIRECT_ID_PATTERN,
      (_match, prefix: string) => `${prefix}_[redacted-id]`,
    )
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

export function isSensitiveAssistantFieldName(name: string): boolean {
  if (isSensitiveAssistantHeaderName(name)) {
    return true
  }

  const tokens = name
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
  const joined = tokens.join('')

  if (
    new Set([
      'accesstoken',
      'apikey',
      'authorization',
      'clientsecret',
      'cookie',
      'passphrase',
      'password',
      'privatekey',
      'refreshtoken',
      'sessionkey',
      'setcookie',
    ]).has(joined)
  ) {
    return true
  }

  if (
    tokens.some((token) =>
      new Set(['authorization', 'cookie', 'passphrase', 'password', 'secret', 'token']).has(
        token,
      ),
    )
  ) {
    return true
  }

  return (
    hasTokenPair(tokens, 'access', 'token') ||
    hasTokenPair(tokens, 'api', 'key') ||
    hasTokenPair(tokens, 'client', 'secret') ||
    hasTokenPair(tokens, 'private', 'key') ||
    hasTokenPair(tokens, 'refresh', 'token') ||
    hasTokenPair(tokens, 'session', 'key')
  )
}

export function sanitizeAssistantPortableStateString(
  value: string,
  maxLength = PORTABLE_STATE_STRING_MAX_LENGTH,
): string {
  const redacted = redactAssistantStateString(value)
    .replaceAll(EMAIL_PATTERN, '[email]')
    .replaceAll(URL_PATTERN, '[url]')
    .replaceAll(POSIX_LOCAL_PATH_PATTERN, '[path]')
    .replaceAll(WINDOWS_LOCAL_PATH_PATTERN, '[path]')
    .replaceAll(/\s+/gu, ' ')
    .trim()

  if (redacted.length <= maxLength) {
    return redacted
  }

  return `${redacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function sanitizeAssistantPortableMetadata(
  metadata: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!metadata || Object.keys(metadata).length === 0) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      sanitizeAssistantPortableMetadataKey(key),
      isSensitiveAssistantFieldName(key)
        ? REDACTED_SECRET_TEXT
        : sanitizeAssistantPortableStateString(
            value,
            PORTABLE_STATE_METADATA_VALUE_MAX_LENGTH,
          ),
    ]),
  )
}

export function sanitizeAssistantDeliveryErrorForPersistence(
  error: AssistantDeliveryError | null | undefined,
): AssistantDeliveryError | null {
  if (!error) {
    return null
  }

  const message =
    sanitizeAssistantPortableStateString(error.message) ||
    'assistant delivery failed'

  return {
    code: error.code
      ? sanitizeAssistantPortableStateString(error.code, 80).replaceAll(/\s+/gu, '_')
      : null,
    ...(error.diagnosticContext
      ? {
          diagnosticContext: sanitizeAssistantDeliveryErrorDiagnosticContext(
            error.diagnosticContext,
          ),
        }
      : {}),
    message,
  }
}

function sanitizeAssistantDeliveryErrorDiagnosticContext(
  context: NonNullable<AssistantDeliveryError['diagnosticContext']>,
): NonNullable<AssistantDeliveryError['diagnosticContext']> | undefined {
  const sanitized: NonNullable<AssistantDeliveryError['diagnosticContext']> = {}

  for (const [key, value] of Object.entries(context)) {
    const sanitizedKey = sanitizeAssistantPortableMetadataKey(key)
    if (isSensitiveAssistantFieldName(key)) {
      sanitized[sanitizedKey] = REDACTED_SECRET_TEXT
      continue
    }
    if (value === null || typeof value === 'boolean') {
      sanitized[sanitizedKey] = value
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        sanitized[sanitizedKey] = value
      }
      continue
    }
    if (typeof value === 'string') {
      const sanitizedValue = sanitizeAssistantPortableStateString(value, 2048)
      if (sanitizedValue.length > 0) {
        sanitized[sanitizedKey] = sanitizedValue
      }
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

export function sanitizeAssistantTurnTimelineEventForPersistence(
  event: AssistantTurnTimelineEvent,
): AssistantTurnTimelineEvent {
  return {
    ...event,
    detail:
      typeof event.detail === 'string'
        ? sanitizeAssistantPortableStateString(event.detail)
        : null,
    metadata: sanitizeAssistantPortableMetadata(event.metadata),
  }
}

export function sanitizeAssistantTurnReceiptForPersistence(
  receipt: AssistantTurnReceipt,
): AssistantTurnReceipt {
  return {
    ...receipt,
    lastError: sanitizeAssistantDeliveryErrorForPersistence(receipt.lastError),
    timeline: receipt.timeline.map((event) =>
      sanitizeAssistantTurnTimelineEventForPersistence(event),
    ),
  }
}

export function sanitizeAssistantOutboxIntentForPersistence(
  intent: AssistantOutboxIntent,
): Omit<AssistantOutboxIntent, 'card' | 'operation'> & {
  card?: NonNullable<AssistantOutboxIntent['card']>
  operation?: NonNullable<AssistantOutboxIntent['operation']>
} {
  const {
    card,
    groupEmailAuthorizationProof,
    newsletterAuthorizationProof,
    operation,
    ...baseIntent
  } = intent
  const persistedGroupEmailAuthorizationProof =
    groupEmailAuthorizationProof ?? newsletterAuthorizationProof ?? null
  return {
    ...baseIntent,
    schema: 'murph.assistant-outbox-intent.v1',
    lastError: sanitizeAssistantDeliveryErrorForPersistence(intent.lastError),
    // The pre-generic runner schema is strict. Keep the durable representation
    // rollback-readable until current runner/Worker artifacts are the enforced
    // rollback floor and every intent written in this window has drained.
    newsletterAuthorizationProof: persistedGroupEmailAuthorizationProof,
    ...(card ? { card } : {}),
    ...(operation ? { operation } : {}),
  }
}

export function containsInlineAssistantSecretMaterial(value: string): boolean {
  return redactAssistantStateString(value) !== value
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
  const redacted = {
    ...providerOptions,
    headers: redactAssistantHeadersForDisplay(providerOptions.headers),
  }

  if (redacted.codexHome) {
    redacted.codexHome = REDACTED_LOCAL_PATH_TEXT
  }

  return redacted
}

export function redactAssistantSessionForDisplay(
  session: AssistantSession,
): AssistantSession {
  return {
    ...session,
    target: redactAssistantSessionTargetForDisplay(session.target),
    providerOptions: redactAssistantProviderOptionsForDisplay(session.providerOptions),
  }
}

function redactAssistantSessionTargetForDisplay(
  target: AssistantSession['target'],
): AssistantSession['target'] {
  return {
    ...target,
    codexCommand: target.codexCommand
      ? REDACTED_LOCAL_PATH_TEXT
      : target.codexCommand,
    ...(target.codexHome ? { codexHome: REDACTED_LOCAL_PATH_TEXT } : {}),
  }
}

export function redactAssistantSessionsForDisplay(
  sessions: readonly AssistantSession[],
): AssistantSession[] {
  return sessions.map((session) => redactAssistantSessionForDisplay(session))
}

function hasTokenPair(tokens: readonly string[], first: string, second: string): boolean {
  return tokens.includes(first) && tokens.includes(second)
}

function sanitizeAssistantPortableMetadataKey(key: string): string {
  const sanitized = sanitizeAssistantPortableStateString(key, 120)
    .replaceAll(/\s+/gu, '-')
    .replaceAll(/[^A-Za-z0-9_.:-]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 80)

  return sanitized || 'metadata'
}
