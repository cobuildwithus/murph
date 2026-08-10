/**
 * Exact JSON-RPC envelope boundary for the pinned Codex app-server protocol.
 *
 * Payload-specific readers own the fields they consume. This module admits
 * only the canonical server-to-client envelopes emitted by Codex 0.147.0, so
 * legacy `type`/`event`, dotted-method, snake-case-method, and alternate
 * top-level payload shapes cannot enter the runtime.
 */

export type CodexRpcId = string | number
export type CodexRpcMessage = Record<string, unknown>

export interface CodexServerNotification extends CodexRpcMessage {
  emittedAtMs?: number
  method: string
  params: Record<string, unknown>
}

export interface CodexServerRequest extends CodexRpcMessage {
  id: CodexRpcId
  method: string
  params: Record<string, unknown>
}

export interface CodexRpcSuccessResponse extends CodexRpcMessage {
  id: CodexRpcId
  result: unknown
}

export interface CodexRpcErrorResponse extends CodexRpcMessage {
  error: {
    code: number
    data?: unknown
    message: string
  }
  id: CodexRpcId
}

export interface CodexTokenUsageBreakdown {
  cacheWriteInputTokens: number
  cachedInputTokens: number
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export interface CodexThreadTokenUsage {
  last: CodexTokenUsageBreakdown
  modelContextWindow: number | null
  total: CodexTokenUsageBreakdown
}

const CODEX_APP_SERVER_METHOD_PATTERN =
  /^[a-z][A-Za-z0-9]*(?:\/[a-z][A-Za-z0-9]*)*$/u

export function parseCodexAppServerMessage(
  value: unknown,
): CodexRpcMessage | null {
  const message = readCodexRecord(value)
  if (!message) {
    return null
  }

  if (typeof message.method === 'string') {
    return parseCodexAppServerMethodMessage(message)
  }

  return parseCodexAppServerResponse(message)
}

export function readCodexServerNotification(
  value: unknown,
): CodexServerNotification | null {
  const message = parseCodexAppServerMessage(value)
  if (
    !message ||
    typeof message.method !== 'string' ||
    Object.hasOwn(message, 'id')
  ) {
    return null
  }
  return message as CodexServerNotification
}

export function readCodexServerRequest(
  value: unknown,
): CodexServerRequest | null {
  const message = parseCodexAppServerMessage(value)
  if (
    !message ||
    typeof message.method !== 'string' ||
    !isCodexRpcId(message.id)
  ) {
    return null
  }
  return message as CodexServerRequest
}

export function readCodexRpcSuccessResponse(
  value: unknown,
): CodexRpcSuccessResponse | null {
  const message = parseCodexAppServerMessage(value)
  return message && Object.hasOwn(message, 'result')
    ? message as CodexRpcSuccessResponse
    : null
}

export function readCodexRpcErrorResponse(
  value: unknown,
): CodexRpcErrorResponse | null {
  const message = parseCodexAppServerMessage(value)
  return message && Object.hasOwn(message, 'error')
    ? message as CodexRpcErrorResponse
    : null
}

export function isCodexRpcId(value: unknown): value is CodexRpcId {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  )
}

export function readCodexRecord(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function readCodexString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function readCodexNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

export function readCodexNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

export function readCodexFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null
}

export function readCodexTokenUsageBreakdown(
  value: unknown,
): CodexTokenUsageBreakdown | null {
  const usage = readCodexRecord(value)
  if (!usage || !hasOnlyOwn(usage, [
    'cacheWriteInputTokens',
    'cachedInputTokens',
    'inputTokens',
    'outputTokens',
    'reasoningOutputTokens',
    'totalTokens',
  ])) {
    return null
  }

  const cacheWriteInputTokens = readCodexNonNegativeInteger(
    usage.cacheWriteInputTokens,
  )
  const cachedInputTokens = readCodexNonNegativeInteger(usage.cachedInputTokens)
  const inputTokens = readCodexNonNegativeInteger(usage.inputTokens)
  const outputTokens = readCodexNonNegativeInteger(usage.outputTokens)
  const reasoningOutputTokens = readCodexNonNegativeInteger(
    usage.reasoningOutputTokens,
  )
  const totalTokens = readCodexNonNegativeInteger(usage.totalTokens)

  if (
    cacheWriteInputTokens === null ||
    cachedInputTokens === null ||
    inputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null ||
    totalTokens === null
  ) {
    return null
  }

  return {
    cacheWriteInputTokens,
    cachedInputTokens,
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  }
}

export function readCodexThreadTokenUsage(
  value: unknown,
): CodexThreadTokenUsage | null {
  const usage = readCodexRecord(value)
  if (!usage || !hasOnlyOwn(usage, ['last', 'modelContextWindow', 'total'])) {
    return null
  }

  const last = readCodexTokenUsageBreakdown(usage.last)
  const total = readCodexTokenUsageBreakdown(usage.total)
  const modelContextWindow = usage.modelContextWindow === null
    ? null
    : readCodexNonNegativeInteger(usage.modelContextWindow)

  if (
    !last ||
    !total ||
    (modelContextWindow === null && usage.modelContextWindow !== null)
  ) {
    return null
  }

  return {
    last,
    modelContextWindow,
    total,
  }
}

function parseCodexAppServerMethodMessage(
  message: CodexRpcMessage,
): CodexRpcMessage | null {
  if (
    !CODEX_APP_SERVER_METHOD_PATTERN.test(message.method as string) ||
    !readCodexRecord(message.params) ||
    Object.hasOwn(message, 'result') ||
    Object.hasOwn(message, 'error')
  ) {
    return null
  }

  if (Object.hasOwn(message, 'id')) {
    return isCodexRpcId(message.id) && hasOnlyOwn(message, ['id', 'method', 'params'])
      ? message
      : null
  }

  if (!hasOnlyOwn(message, ['emittedAtMs', 'method', 'params'])) {
    return null
  }
  if (
    Object.hasOwn(message, 'emittedAtMs') &&
    readCodexNonNegativeInteger(message.emittedAtMs) === null
  ) {
    return null
  }

  return message
}

function parseCodexAppServerResponse(
  message: CodexRpcMessage,
): CodexRpcMessage | null {
  if (!isCodexRpcId(message.id)) {
    return null
  }

  const hasResult = Object.hasOwn(message, 'result')
  const hasError = Object.hasOwn(message, 'error')
  if (hasResult === hasError) {
    return null
  }

  if (hasResult) {
    return hasOnlyOwn(message, ['id', 'result']) ? message : null
  }

  const error = readCodexRecord(message.error)
  if (
    !error ||
    !hasOnlyOwn(error, ['code', 'data', 'message']) ||
    typeof error.code !== 'number' ||
    !Number.isSafeInteger(error.code) ||
    typeof error.message !== 'string' ||
    !hasOnlyOwn(message, ['error', 'id'])
  ) {
    return null
  }

  return message
}

function hasOnlyOwn(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
}
