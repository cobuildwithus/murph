import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  isCodexConnectionLossText,
  normalizeStatusText,
  type CodexStructuredErrorInfo,
} from '../assistant-codex-events.js'
import {
  readCodexNonEmptyString,
  readCodexRecord,
  readCodexServerNotification,
  readCodexServerRequest,
  readCodexString,
} from './app-server-protocol.js'

type CodexTurnMessage = Record<string, unknown>

export const ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE =
  'ASSISTANT_CODEX_USAGE_LIMIT'

// CodexErrorInfo variants (app-server protocol, pinned codex 0.147.0) that
// describe a lost or unusable provider connection. These map to the
// retryable ASSISTANT_CODEX_CONNECTION_LOST process-exit classification.
const CODEX_CONNECTION_LOSS_ERROR_INFO_KINDS = new Set([
  'httpConnectionFailed',
  'responseStreamConnectionFailed',
  'responseStreamDisconnected',
  'responseTooManyFailedAttempts',
  'serverOverloaded',
])

function isCodexUsageLimitErrorInfo(
  errorInfo: CodexStructuredErrorInfo | null,
): boolean {
  return errorInfo?.kind === 'usageLimitExceeded'
}

function isCodexConnectionLossErrorInfo(
  errorInfo: CodexStructuredErrorInfo | null,
): boolean {
  return errorInfo !== null &&
    CODEX_CONNECTION_LOSS_ERROR_INFO_KINDS.has(errorInfo.kind)
}

function buildCodexErrorInfoContext(
  errorInfo: CodexStructuredErrorInfo | null,
): Record<string, boolean | number | string> {
  return {
    codexErrorInfoPresent: errorInfo !== null,
    ...(errorInfo ? { codexErrorInfo: errorInfo.kind } : {}),
    ...(errorInfo?.httpStatusCode !== null && errorInfo?.httpStatusCode !== undefined
      ? { codexErrorHttpStatusCode: errorInfo.httpStatusCode }
      : {}),
  }
}

export function extractCodexThreadIdFromResult(result: unknown): string | null {
  return readCodexNonEmptyString(
    readCodexRecord(readCodexRecord(result)?.thread)?.id,
  )
}

export function extractCodexThreadPathFromResult(result: unknown): string | null {
  return readCodexNonEmptyString(
    readCodexRecord(readCodexRecord(result)?.thread)?.path,
  )
}

export function extractCodexTurnIdFromResult(result: unknown): string | null {
  return readCodexNonEmptyString(
    readCodexRecord(readCodexRecord(result)?.turn)?.id,
  )
}

export function extractCodexTurnIdFromMessage(
  message: CodexTurnMessage,
): string | null {
  const params =
    readCodexServerNotification(message)?.params ??
    readCodexServerRequest(message)?.params
  if (!params) {
    return null
  }

  return (
    readCodexNonEmptyString(
      readCodexRecord(params.turn)?.id,
    ) ??
    readCodexNonEmptyString(params.turnId)
  )
}

// Codex app-server notifications are thread-scoped. Spawned subagent threads
// broadcast on the same connection, so callers route foreign-thread events
// away from the parent turn rather than rejecting the parent turn.
export function extractCodexThreadIdFromMessage(
  message: CodexTurnMessage,
): string | null {
  const params =
    readCodexServerNotification(message)?.params ??
    readCodexServerRequest(message)?.params
  if (!params) {
    return null
  }

  return (
    readCodexNonEmptyString(params.threadId) ??
    readCodexNonEmptyString(
      readCodexRecord(params.thread)?.id,
    )
  )
}

export function extractCodexTurnStatus(
  message: CodexTurnMessage,
): string | null {
  const notification = readCodexServerNotification(message)
  return notification
    ? readCodexNonEmptyString(
        readCodexRecord(notification.params.turn)?.status,
      )
    : null
}

export function extractCodexTurnErrorMessage(
  message: CodexTurnMessage,
): string | null {
  const notification = readCodexServerNotification(message)
  if (!notification) {
    return null
  }

  const error = notification.method === 'error'
    ? readCodexRecord(notification.params.error)
    : readCodexRecord(
        readCodexRecord(notification.params.turn)?.error,
      )
  return normalizeStatusText(readCodexString(error?.message))
}

export function isFailedCodexTurnStatus(status: string | null): boolean {
  return status === 'failed' || status === 'interrupted'
}

export function buildCodexTurnFailedError(input: {
  errorInfo: CodexStructuredErrorInfo | null
  fallback: string | null
  providerActionCount: number
  codexThreadId: string | null
  status: string | null
}): VaultCliError {
  if (input.status?.toLowerCase() === 'interrupted') {
    return buildCodexInterruptedError({
      providerActionCount: input.providerActionCount,
      codexThreadId: input.codexThreadId,
      signal: null,
    })
  }

  const detail = normalizeStatusText(input.fallback)
  const parts = ['Codex app-server turn failed.']
  if (input.status) {
    parts.push(`status ${input.status}.`)
  }
  if (detail) {
    parts.push(detail)
  }
  const usageLimit = isCodexUsageLimitErrorInfo(input.errorInfo)
  const connectionLost =
    !usageLimit &&
    (input.errorInfo
      ? isCodexConnectionLossErrorInfo(input.errorInfo)
      : detail !== null && isCodexConnectionLossText(detail))

  return new VaultCliError(
    connectionLost
      ? 'ASSISTANT_CODEX_CONNECTION_LOST'
      : usageLimit
        ? ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE
        : 'ASSISTANT_CODEX_FAILED',
    connectionLost
      ? buildCodexConnectionFailureMessage({
          code: null,
          fallback: detail,
          codexThreadId: input.codexThreadId,
          signal: null,
          stderr: '',
        })
      : parts.join(' '),
    {
      connectionLost,
      codexFailureDetailPresent: detail !== null,
      codexDiagnosticsPresent: true,
      codexFailureStage: connectionLost ? 'connection_lost' : 'turn_failed',
      codexTurnStatus: input.status,
      ...buildCodexErrorInfoContext(input.errorInfo),
      providerActionCount: input.providerActionCount,
      codexThreadIdPresent: input.codexThreadId !== null,
      ...(usageLimit ? { providerUsageLimit: true } : {}),
      recoverableConnectionLoss: connectionLost,
      retryable: connectionLost,
    },
  )
}

export function buildCodexFailure(input: {
  code: number | null
  diagnostics?: CodexProcessExitDiagnostics
  errorInfo: CodexStructuredErrorInfo | null
  fallback: string | null
  providerActionCount: number
  codexThreadId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): VaultCliError {
  const stderrTail = tailText(input.stderr)
  const detail =
    normalizeStatusText(input.fallback ?? stderrTail) ??
    input.fallback ??
    stderrTail
  const usageLimit = isCodexUsageLimitErrorInfo(input.errorInfo)
  // Prefer the structured protocol classification when an RPC error arrived
  // before the process died; fall back to stderr text sniffing only for true
  // process crashes where no structured error was ever observed.
  const connectionLost =
    !usageLimit &&
    (input.errorInfo
      ? isCodexConnectionLossErrorInfo(input.errorInfo)
      : detail !== null && isCodexConnectionLossText(detail))

  return new VaultCliError(
    connectionLost
      ? 'ASSISTANT_CODEX_CONNECTION_LOST'
      : usageLimit
        ? ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE
        : 'ASSISTANT_CODEX_FAILED',
    connectionLost
      ? buildCodexConnectionFailureMessage({
          ...input,
          fallback: detail,
        })
      : buildCodexFailureMessage({
          ...input,
          fallback: detail,
        }),
    {
      connectionLost,
      codexFailureDetailPresent: detail !== null,
      codexDiagnosticsPresent: true,
      codexFailureStage: connectionLost ? 'connection_lost' : 'process_exit',
      codexStderrPresent: stderrTail !== null,
      ...(typeof input.code === 'number' ? { codexExitCode: input.code } : {}),
      ...(input.signal
        ? {
            codexExitSignal: input.signal,
            codexSignalPresent: true,
          }
        : {}),
      ...buildCodexProcessExitDiagnosticsContext(input.diagnostics),
      ...buildCodexErrorInfoContext(input.errorInfo),
      providerActionCount: input.providerActionCount,
      ...(usageLimit ? { providerUsageLimit: true } : {}),
      codexThreadIdPresent: input.codexThreadId !== null,
      recoverableConnectionLoss: connectionLost,
      retryable: connectionLost,
    },
  )
}

export function buildCodexProcessExitError(input: {
  abortOwnsTermination: boolean
  code: number | null
  diagnostics?: CodexProcessExitDiagnostics
  errorInfo: CodexStructuredErrorInfo | null
  fallback: string | null
  providerActionCount: number
  codexThreadId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): VaultCliError {
  if (input.abortOwnsTermination) {
    return buildCodexInterruptedError({
      providerActionCount: input.providerActionCount,
      codexThreadId: input.codexThreadId,
      diagnostics: input.diagnostics,
      signal: input.signal,
    })
  }

  return buildCodexFailure(input)
}

export function buildCodexStdinFailureFallback(input: {
  error: unknown
  lastEventError: string | null
  stderr: string
}): string | null {
  const preferredDetail =
    normalizeStatusText(input.lastEventError ?? tailText(input.stderr)) ??
    input.lastEventError ??
    tailText(input.stderr)
  const streamErrorDetail = readNodeErrorMessage(input.error)

  if (!preferredDetail) {
    return streamErrorDetail
  }

  if (!streamErrorDetail) {
    return preferredDetail
  }

  return preferredDetail.toLowerCase() === streamErrorDetail.toLowerCase()
    ? preferredDetail
    : `${preferredDetail} ${streamErrorDetail}`
}

export function buildCodexInterruptedError(input: {
  providerActionCount: number
  codexThreadId: string | null
  diagnostics?: CodexProcessExitDiagnostics
  signal: NodeJS.Signals | null
}): VaultCliError {
  const parts = ['Codex app-server was interrupted.']

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (input.codexThreadId) {
    parts.push(
      'Codex thread id was captured for diagnostics only. Retry the request when ready.',
    )
  }

  return new VaultCliError(
    'ASSISTANT_CODEX_INTERRUPTED',
    parts.join(' '),
    {
      codexDiagnosticsPresent: true,
      codexFailureStage: 'interrupted',
      ...(input.signal
        ? {
            codexExitSignal: input.signal,
            codexSignalPresent: true,
          }
        : {}),
      ...buildCodexProcessExitDiagnosticsContext(input.diagnostics),
      interrupted: true,
      providerActionCount: input.providerActionCount,
      codexThreadIdPresent: input.codexThreadId !== null,
      retryable: false,
    },
  )
}

export interface CodexProcessExitDiagnostics {
  abortRequested?: boolean
  jsonEventCount?: number
  lifecycleStage?: string | null
  liveTurnOpen?: boolean
  pendingRpcCount?: number
  pendingRpcMethod?: string | null
  processGroupPresent?: boolean
  processLifetimeMs?: number
  providerRequestStarted?: boolean
  shutdownRequested?: boolean
  stderrBytes?: number
  terminationSignalSent?: NodeJS.Signals | null
}

export function buildCodexConnectionFailureMessage(input: {
  code: number | null
  fallback: string | null
  codexThreadId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const parts = ['Codex app-server lost its connection while waiting for the model.']

  if (typeof input.code === 'number') {
    parts.push(`exit code ${input.code}.`)
  }

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (input.fallback) {
    parts.push(input.fallback)
  }

  parts.push(
    input.codexThreadId
      ? 'Codex thread id was captured for diagnostics only. Restore connectivity, then retry the request.'
      : 'Restore connectivity, then retry the request.',
  )

  return parts.join(' ')
}

export function buildCodexResumeStaleMessage(input: {
  fallback: string | null
}): string {
  const parts = ['Codex app-server could not resume the saved Codex thread.']

  if (input.fallback) {
    parts.push(input.fallback)
  }

  parts.push('Murph should start a fresh Codex thread for this turn.')

  return parts.join(' ')
}

export function readNodeErrorCode(error: unknown): string | null {
  const record = readCodexRecord(error)
  return normalizeNullableString(readCodexString(record?.code))
}

function buildCodexFailureMessage(input: {
  code: number | null
  fallback: string | null
  codexThreadId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  // Connection-loss phrasing is chosen by buildCodexFailure (the only
  // caller), which routes those failures to buildCodexConnectionFailureMessage.
  const detail =
    normalizeStatusText(input.fallback ?? tailText(input.stderr)) ??
    input.fallback ??
    tailText(input.stderr)

  const parts = ['Codex app-server failed.']

  if (typeof input.code === 'number') {
    parts.push(`exit code ${input.code}.`)
  }

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (detail) {
    parts.push(detail)
  }

  return parts.join(' ')
}

function tailText(value: string): string | null {
  const lines = value
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    return null
  }

  return lines.slice(-3).join(' ')
}

function buildCodexProcessExitDiagnosticsContext(
  diagnostics: CodexProcessExitDiagnostics | undefined,
): Record<string, boolean | number | string> {
  if (!diagnostics) {
    return {}
  }

  const context: Record<string, boolean | number | string> = {}
  assignDiagnosticBoolean(
    context,
    'codexAbortRequested',
    diagnostics.abortRequested,
  )
  assignDiagnosticNumber(
    context,
    'codexJsonEventCount',
    diagnostics.jsonEventCount,
  )
  assignDiagnosticToken(
    context,
    'codexLifecycleStage',
    diagnostics.lifecycleStage,
  )
  assignDiagnosticBoolean(context, 'codexLiveTurnOpen', diagnostics.liveTurnOpen)
  assignDiagnosticNumber(
    context,
    'codexPendingRpcCount',
    diagnostics.pendingRpcCount,
  )
  assignDiagnosticToken(
    context,
    'codexPendingRpcMethod',
    diagnostics.pendingRpcMethod,
  )
  assignDiagnosticBoolean(
    context,
    'codexProcessGroupPresent',
    diagnostics.processGroupPresent,
  )
  assignDiagnosticNumber(
    context,
    'codexProcessLifetimeMs',
    diagnostics.processLifetimeMs,
  )
  assignDiagnosticBoolean(
    context,
    'codexProviderRequestStarted',
    diagnostics.providerRequestStarted,
  )
  assignDiagnosticBoolean(
    context,
    'codexShutdownRequested',
    diagnostics.shutdownRequested,
  )
  assignDiagnosticNumber(context, 'codexStderrBytes', diagnostics.stderrBytes)
  assignDiagnosticToken(
    context,
    'codexTerminationSignalSent',
    diagnostics.terminationSignalSent,
  )

  return context
}

function assignDiagnosticBoolean(
  context: Record<string, boolean | number | string>,
  key: string,
  value: boolean | undefined,
): void {
  if (typeof value === 'boolean') {
    context[key] = value
  }
}

function assignDiagnosticNumber(
  context: Record<string, boolean | number | string>,
  key: string,
  value: number | undefined,
): void {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    Number.isSafeInteger(value)
  ) {
    context[key] = value
  }
}

function assignDiagnosticToken(
  context: Record<string, boolean | number | string>,
  key: string,
  value: string | null | undefined,
): void {
  const token = normalizeDiagnosticToken(value)
  if (token) {
    context[key] = token
  }
}

function normalizeDiagnosticToken(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized || !/^[A-Za-z][A-Za-z0-9_./:-]{0,63}$/u.test(normalized)) {
    return null
  }

  return normalized
}

function readNodeErrorMessage(error: unknown): string | null {
  if (error instanceof Error) {
    return normalizeStatusText(error.message) ?? error.message
  }

  const record = readCodexRecord(error)
  return normalizeStatusText(readCodexString(record?.message))
}
