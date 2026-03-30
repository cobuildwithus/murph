import { redactAssistantStateString } from '../redaction.js'
import {
  formatStructuredErrorMessage,
  normalizeNullableString,
} from '../shared.js'
import { redactSensitivePathSegments } from '../../text/shared.js'

export type AssistantAutoReplyFailureKind =
  | 'delivery'
  | 'provider'
  | 'unknown'

export interface AssistantAutoReplyFailureSnapshot {
  code: string | null
  context: Record<string, unknown> | null
  kind: AssistantAutoReplyFailureKind
  message: string
  retryable: boolean | null
  safeSummary: string
}

const SAFE_FAILURE_CONTEXT_KEYS = new Set([
  'connectionLost',
  'errorCode',
  'interrupted',
  'providerSessionId',
  'providerStalled',
  'recoverableConnectionLoss',
  'repairedFields',
  'retryAfterSeconds',
  'retryable',
  'status',
])

const SAFE_FAILURE_TOP_LEVEL_KEYS = new Set(['outboxIntentId'])

export function describeAssistantAutoReplyFailure(
  error: unknown,
): AssistantAutoReplyFailureSnapshot {
  const code = readFailureCode(error)
  const message = sanitizeFailureText(formatStructuredErrorMessage(error))
  const retryable = readFailureRetryable(error)
  const kind = classifyFailureKind({
    code,
    message,
  })

  return {
    code,
    context: readFailureContext(error),
    kind,
    message,
    retryable,
    safeSummary: buildSafeSummary({
      code,
      kind,
      message,
      retryable,
    }),
  }
}

function buildSafeSummary(input: {
  code: string | null
  kind: AssistantAutoReplyFailureKind
  message: string
  retryable: boolean | null
}): string {
  if (isUsageLimitFailure(input)) {
    return summarizeFailure(
      'provider usage limit reached',
      input.code,
    )
  }

  if (input.kind === 'delivery') {
    return summarizeFailure('outbound delivery failed', input.code)
  }

  if (input.kind === 'provider') {
    return summarizeFailure(
      input.retryable === true
        ? 'assistant provider failed; retry may succeed'
        : 'assistant provider failed',
      input.code,
    )
  }

  return summarizeFailure('assistant reply failed', input.code)
}

function summarizeFailure(summary: string, code: string | null): string {
  return code ? `${summary} (${code})` : summary
}

function classifyFailureKind(input: {
  code: string | null
  message: string
}): AssistantAutoReplyFailureKind {
  const code = input.code?.toUpperCase() ?? null
  const message = input.message.toLowerCase()

  if (
    code?.includes('DELIVERY') ||
    message.includes('delivery failed') ||
    message.includes('outbound delivery')
  ) {
    return 'delivery'
  }

  if (
    code?.startsWith('ASSISTANT_') ||
    message.includes('codex cli failed') ||
    message.includes('assistant provider')
  ) {
    return 'provider'
  }

  return 'unknown'
}

function isUsageLimitFailure(input: {
  code: string | null
  message: string
}): boolean {
  const message = input.message.toLowerCase()

  return (
    input.code === 'ASSISTANT_CODEX_FAILED' &&
    (message.includes('usage limit') ||
      message.includes('purchase more credits') ||
      message.includes('try again at '))
  )
}

function readFailureCode(error: unknown): string | null {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return normalizeNullableString((error as { code: string }).code)
  }

  return null
}

function readFailureRetryable(error: unknown): boolean | null {
  const context = readFailureRecord(error, 'context')
  const details = readFailureRecord(error, 'details')

  if (typeof context?.retryable === 'boolean') {
    return context.retryable
  }

  if (typeof details?.retryable === 'boolean') {
    return details.retryable
  }

  return null
}

function readFailureContext(error: unknown): Record<string, unknown> | null {
  const merged = {
    ...pickFailureContext(readFailureRecord(error, 'details')),
    ...pickFailureContext(readFailureRecord(error, 'context')),
    ...pickTopLevelFailureContext(error),
  }

  return Object.keys(merged).length > 0 ? merged : null
}

function pickFailureContext(
  value: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!value) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) => {
      if (!SAFE_FAILURE_CONTEXT_KEYS.has(key)) {
        return []
      }

      const sanitizedValue = sanitizeFailureContextValue(entryValue)
      return sanitizedValue === undefined ? [] : [[key, sanitizedValue]]
    }),
  )
}

function sanitizeFailureContextValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeFailureText(value)
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value.flatMap((entry) => {
    if (typeof entry !== 'string') {
      return []
    }

    const sanitized = sanitizeFailureText(entry)
    return sanitized ? [sanitized] : []
  })

  return normalized.length > 0 ? normalized : undefined
}

function sanitizeFailureText(value: string): string {
  return (
    normalizeNullableString(
      redactSensitivePathSegments(redactAssistantStateString(value))
        .replace(/\r\n?/gu, '\n'),
    ) ?? 'Assistant reply failed.'
  )
}

function pickTopLevelFailureContext(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Array.from(SAFE_FAILURE_TOP_LEVEL_KEYS).flatMap((key) => {
      const sanitizedValue = sanitizeFailureContextValue(
        (error as Record<string, unknown>)[key],
      )
      return sanitizedValue === undefined ? [] : [[key, sanitizedValue]]
    }),
  )
}

function readFailureRecord(
  error: unknown,
  key: 'context' | 'details',
): Record<string, unknown> | null {
  if (
    !error ||
    typeof error !== 'object' ||
    !(key in error) ||
    typeof (error as Record<string, unknown>)[key] !== 'object' ||
    (error as Record<string, unknown>)[key] === null ||
    Array.isArray((error as Record<string, unknown>)[key])
  ) {
    return null
  }

  return (error as Record<string, unknown>)[key] as Record<string, unknown>
}
