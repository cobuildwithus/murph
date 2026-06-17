import { redactAssistantStateString } from '../redaction.js'
import {
  formatStructuredErrorMessage,
  normalizeNullableString,
} from '../shared.js'
import { redactSensitivePathSegments } from '@murphai/operator-config/text/shared'

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

export type AssistantSafeFailureContextValue =
  | boolean
  | number
  | string
  | null

const SAFE_FAILURE_CONTEXT_KEYS = new Set([
  'assistantProviderAdapter',
  'assistantProviderErrorBodyCode',
  'assistantProviderErrorBodyMessage',
  'assistantProviderErrorBodyPresent',
  'assistantProviderErrorBodyType',
  'assistantProviderErrorCode',
  'assistantProviderErrorMessage',
  'assistantProviderErrorRetryable',
  'assistantProviderErrorStatus',
  'assistantProviderErrorStatusText',
  'assistantProviderErrorType',
  'assistantProviderExecutionDriver',
  'assistantProviderModel',
  'connectionLost',
  'codexAbortRequested',
  'codexExitCode',
  'codexExitSignal',
  'codexFailureDetailPresent',
  'codexDiagnosticsPresent',
  'codexFailureStage',
  'codexJsonEventCount',
  'codexLifecycleStage',
  'codexLiveTurnOpen',
  'codexPendingRpcCount',
  'codexPendingRpcMethod',
  'codexProcessGroupPresent',
  'codexProcessLifetimeMs',
  'codexProviderRequestStarted',
  'codexShutdownRequested',
  'codexSignalPresent',
  'codexStderrPresent',
  'codexStderrBytes',
  'codexTerminationSignalSent',
  'codexThreadIdPresent',
  'codexTurnStatus',
  'errorCode',
  'interrupted',
  'providerActionCount',
  'providerStalled',
  'providerUsageLimit',
  'recoverableConnectionLoss',
  'recoveredCodexThreadIdPresent',
  'retryAfterSeconds',
  'retryable',
  'status',
])

const SAFE_FAILURE_TOP_LEVEL_KEYS = new Set(['outboxIntentId'])
const SAFE_FAILURE_DIAGNOSTIC_TEXT_KEY_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u

export function describeAssistantAutoReplyFailure(
  error: unknown,
): AssistantAutoReplyFailureSnapshot {
  const code = readFailureCode(error)
  const message = sanitizeAssistantAutomationFailureText(
    formatStructuredErrorMessage(error),
  )
  const retryable = readFailureRetryable(error)
  const context = annotateMissingCodexFailureContext({
    code,
    context: readFailureContext(error),
  })
  const kind = classifyFailureKind({
    code,
    message,
  })

  return {
    code,
    context,
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

function annotateMissingCodexFailureContext(input: {
  code: string | null
  context: Record<string, unknown> | null
}): Record<string, unknown> | null {
  if (
    input.code !== 'ASSISTANT_CODEX_FAILED' &&
    input.code !== 'ASSISTANT_CODEX_USAGE_LIMIT'
  ) {
    return input.context
  }

  if (!input.context || !hasCodexFailureContext(input.context)) {
    return {
      ...(input.context ?? {}),
      codexDiagnosticsPresent: false,
    }
  }

  return input.context
}

function hasCodexFailureContext(context: Record<string, unknown>): boolean {
  return Object.keys(context).some((key) =>
    key.startsWith('codex') ||
    key === 'providerActionCount',
  )
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

export function normalizeAssistantSafeFailureContext(
  context: Record<string, unknown> | null,
): Record<string, AssistantSafeFailureContextValue> | undefined {
  if (!context) {
    return undefined
  }

  const values = Object.fromEntries(
    Object.entries(context).flatMap(([key, value]) =>
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      typeof value === 'number' ||
      value === null
        ? [[key, value]]
        : [],
    ),
  )

  return Object.keys(values).length > 0 ? values : undefined
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
    message.includes('assistant provider') ||
    isUsageLimitMessage(message)
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
    (input.code === null ||
      input.code === 'ASSISTANT_CODEX_FAILED' ||
      input.code === 'ASSISTANT_CODEX_USAGE_LIMIT') &&
    isUsageLimitMessage(message)
  )
}

function isUsageLimitMessage(message: string): boolean {
  return (
    message.includes('usage limit') ||
    message.includes('quota exceeded') ||
    message.includes('current quota') ||
    message.includes('insufficient quota') ||
    message.includes('purchase more credits') ||
    message.includes('out of credits') ||
    message.includes('credit balance') ||
    message.includes('plan and billing details') ||
    message.includes('try again at ')
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

  const details = readFailureRecord(error, 'details')
  const context = readFailureRecord(error, 'context')
  return readFailureString(details, 'assistantProviderErrorCode') ??
    readFailureString(details, 'assistantProviderErrorBodyCode') ??
    readFailureString(context, 'assistantProviderErrorCode') ??
    readFailureString(context, 'assistantProviderErrorBodyCode')
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

  if (typeof details?.assistantProviderErrorRetryable === 'boolean') {
    return details.assistantProviderErrorRetryable
  }

  if (typeof context?.assistantProviderErrorRetryable === 'boolean') {
    return context.assistantProviderErrorRetryable
  }

  return null
}

function readFailureString(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  return typeof value?.[key] === 'string'
    ? normalizeNullableString(value[key])
    : null
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
      if (!isSafeFailureContextKey(key)) {
        return []
      }

      const sanitizedValue = sanitizeFailureContextValue(entryValue)
      return sanitizedValue === undefined ? [] : [[key, sanitizedValue]]
    }),
  )
}

function isSafeFailureContextKey(key: string): boolean {
  return SAFE_FAILURE_CONTEXT_KEYS.has(key) ||
    SAFE_FAILURE_DIAGNOSTIC_TEXT_KEY_PATTERN.test(key)
}

function sanitizeFailureContextValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeAssistantAutomationFailureText(value)
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

    const sanitized = sanitizeAssistantAutomationFailureText(entry)
    return sanitized ? [sanitized] : []
  })

  return normalized.length > 0 ? normalized : undefined
}

export function sanitizeAssistantAutomationFailureText(value: string): string {
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
