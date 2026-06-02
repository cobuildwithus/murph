import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  isCodexConnectionLossText,
  normalizeStatusText,
} from '../assistant-codex-events.js'

type CodexTurnMessage = Record<string, unknown>

export const ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE =
  'ASSISTANT_CODEX_USAGE_LIMIT'

export function extractCodexThreadIdFromResult(result: unknown): string | null {
  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  return (
    normalizeNullableString(asString(thread?.id)) ??
    normalizeNullableString(asString(record?.threadId)) ??
    null
  )
}

export function extractCodexThreadPathFromResult(result: unknown): string | null {
  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  return (
    normalizeNullableString(asString(thread?.path)) ??
    normalizeNullableString(asString(record?.path)) ??
    null
  )
}

export function extractCodexTurnIdFromResult(result: unknown): string | null {
  const record = asRecord(result)
  const turn = asRecord(record?.turn)
  return (
    normalizeNullableString(asString(turn?.id)) ??
    normalizeNullableString(asString(record?.turnId)) ??
    null
  )
}

export function extractCodexTurnIdFromMessage(
  message: CodexTurnMessage,
): string | null {
  const params = asRecord(message.params)
  const turn = asRecord(params?.turn)
  return (
    normalizeNullableString(asString(turn?.id)) ??
    normalizeNullableString(asString(params?.turnId)) ??
    null
  )
}

export function extractCodexTurnStatus(
  message: CodexTurnMessage,
): string | null {
  const params = asRecord(message.params)
  const turn = asRecord(params?.turn)
  return normalizeNullableString(asString(turn?.status) ?? asString(params?.status))
}

export function extractCodexTurnErrorMessage(
  message: CodexTurnMessage,
): string | null {
  const params = asRecord(message.params)
  const turn = asRecord(params?.turn)
  const error = asRecord(turn?.error) ?? asRecord(params?.error)
  return normalizeStatusText(
    asString(error?.message) ??
      asString(turn?.error) ??
      asString(params?.error) ??
      null,
  )
}

export function isFailedCodexTurnStatus(status: string | null): boolean {
  const normalized = status?.toLowerCase() ?? null
  return (
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'cancelled' ||
    normalized === 'canceled' ||
    normalized === 'interrupted'
  )
}

export function buildCodexTurnFailedError(input: {
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
  const usageLimit = isCodexUsageLimitFailureText(detail)

  return new VaultCliError(
    usageLimit ? ASSISTANT_CODEX_USAGE_LIMIT_ERROR_CODE : 'ASSISTANT_CODEX_FAILED',
    parts.join(' '),
    {
      codexFailureDetailPresent: detail !== null,
      codexDiagnosticsPresent: true,
      codexFailureStage: 'turn_failed',
      codexTurnStatus: input.status,
      providerActionCount: input.providerActionCount,
      codexThreadIdPresent: input.codexThreadId !== null,
      ...(usageLimit ? { providerUsageLimit: true } : {}),
      retryable: false,
    },
  )
}

export function buildCodexFailure(input: {
  code: number | null
  diagnostics?: CodexProcessExitDiagnostics
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
  const usageLimit = isCodexUsageLimitFailureText(detail)
  const connectionLost =
    !usageLimit && detail !== null && isCodexConnectionLossText(detail)

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
      providerActionCount: input.providerActionCount,
      ...(usageLimit ? { providerUsageLimit: true } : {}),
      codexThreadIdPresent: input.codexThreadId !== null,
      recoverableConnectionLoss: connectionLost,
      retryable: connectionLost,
    },
  )
}

export function isCodexUsageLimitFailureText(value: string | null): boolean {
  const normalized = value?.toLowerCase() ?? ''

  return (
    normalized.includes('usage limit') ||
    normalized.includes('quota exceeded') ||
    normalized.includes('current quota') ||
    normalized.includes('insufficient quota') ||
    normalized.includes('purchase more credits') ||
    normalized.includes('out of credits') ||
    normalized.includes('credit balance') ||
    normalized.includes('plan and billing details')
  )
}

export function buildCodexProcessExitError(input: {
  abortRequested: boolean
  code: number | null
  diagnostics?: CodexProcessExitDiagnostics
  fallback: string | null
  providerActionCount: number
  codexThreadId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): VaultCliError {
  if (input.abortRequested || input.signal === 'SIGINT') {
    return buildCodexInterruptedError({
      providerActionCount: input.providerActionCount,
      codexThreadId: input.codexThreadId,
      diagnostics: {
        ...input.diagnostics,
        abortRequested: input.abortRequested,
      },
      signal: input.signal,
    })
  }

  return buildCodexFailure({
    ...input,
    diagnostics: {
      ...input.diagnostics,
      abortRequested: input.abortRequested,
    },
  })
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
  const record = asRecord(error)
  return normalizeNullableString(asString(record?.code))
}

function buildCodexFailureMessage(input: {
  code: number | null
  fallback: string | null
  codexThreadId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const detail =
    normalizeStatusText(input.fallback ?? tailText(input.stderr)) ??
    input.fallback ??
    tailText(input.stderr)
  const recoverableConnectionLoss =
    !isCodexUsageLimitFailureText(detail) &&
    detail !== null &&
    isCodexConnectionLossText(detail)

  if (recoverableConnectionLoss) {
    const parts = ['Codex app-server lost the provider stream before the turn finished.']

    if (typeof input.code === 'number') {
      parts.push(`exit code ${input.code}.`)
    }

    if (input.signal) {
      parts.push(`signal ${input.signal}.`)
    }

    if (detail) {
      parts.push(detail)
    }

    if (input.codexThreadId) {
      parts.push(
        'Codex thread id was captured for diagnostics only. Send another message to retry the turn.',
      )
    } else {
      parts.push('Send another message to retry the turn.')
    }

    return parts.join(' ')
  }

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

  const record = asRecord(error)
  return normalizeStatusText(asString(record?.message) ?? null)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
