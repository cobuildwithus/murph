import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  isCodexConnectionLossText,
  normalizeStatusText,
} from '../assistant-codex-events.js'

type CodexTurnMessage = Record<string, unknown>

export function extractCodexThreadIdFromResult(result: unknown): string | null {
  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  return (
    normalizeNullableString(asString(thread?.id)) ??
    normalizeNullableString(asString(record?.threadId)) ??
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
  providerSessionId: string | null
  status: string | null
}): VaultCliError {
  if (input.status?.toLowerCase() === 'interrupted') {
    return buildCodexInterruptedError({
      providerActionCount: input.providerActionCount,
      providerSessionId: input.providerSessionId,
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

  return new VaultCliError('ASSISTANT_CODEX_FAILED', parts.join(' '), {
    providerActionCount: input.providerActionCount,
    providerSessionId: input.providerSessionId,
    retryable: false,
  })
}

export function buildCodexFailure(input: {
  code: number | null
  fallback: string | null
  providerActionCount: number
  providerSessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): VaultCliError {
  const detail =
    normalizeStatusText(input.fallback ?? tailText(input.stderr)) ??
    input.fallback ??
    tailText(input.stderr)
  const connectionLost = detail !== null && isCodexConnectionLossText(detail)

  return new VaultCliError(
    connectionLost ? 'ASSISTANT_CODEX_CONNECTION_LOST' : 'ASSISTANT_CODEX_FAILED',
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
      providerActionCount: input.providerActionCount,
      providerSessionId: connectionLost ? input.providerSessionId : null,
      recoverableConnectionLoss: connectionLost,
      retryable: connectionLost,
    },
  )
}

export function buildCodexProcessExitError(input: {
  abortRequested: boolean
  code: number | null
  fallback: string | null
  providerActionCount: number
  providerSessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): VaultCliError {
  if (input.abortRequested || input.signal === 'SIGINT') {
    return buildCodexInterruptedError({
      providerActionCount: input.providerActionCount,
      providerSessionId: input.providerSessionId,
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
  providerSessionId: string | null
  signal: NodeJS.Signals | null
}): VaultCliError {
  const parts = ['Codex app-server was interrupted.']

  if (input.signal) {
    parts.push(`signal ${input.signal}.`)
  }

  if (input.providerSessionId) {
    parts.push(
      `Murph preserved provider thread ${input.providerSessionId}, so the next turn can resume it.`,
    )
  }

  return new VaultCliError(
    'ASSISTANT_CODEX_INTERRUPTED',
    parts.join(' '),
    {
      interrupted: true,
      providerActionCount: input.providerActionCount,
      providerSessionId: input.providerSessionId,
      retryable: false,
    },
  )
}

export function buildCodexConnectionFailureMessage(input: {
  code: number | null
  fallback: string | null
  providerSessionId: string | null
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
    input.providerSessionId
      ? 'Murph preserved the provider thread and will try to resume it automatically on the next turn once connectivity returns.'
      : 'Restore connectivity, then retry the request.',
  )

  return parts.join(' ')
}

export function buildCodexResumeStaleMessage(input: {
  fallback: string | null
}): string {
  const parts = ['Codex app-server could not resume the saved provider thread.']

  if (input.fallback) {
    parts.push(input.fallback)
  }

  parts.push('Murph should start a fresh provider thread for this turn.')

  return parts.join(' ')
}

export function readNodeErrorCode(error: unknown): string | null {
  const record = asRecord(error)
  return normalizeNullableString(asString(record?.code))
}

function buildCodexFailureMessage(input: {
  code: number | null
  fallback: string | null
  providerSessionId: string | null
  signal: NodeJS.Signals | null
  stderr: string
}): string {
  const detail =
    normalizeStatusText(input.fallback ?? tailText(input.stderr)) ??
    input.fallback ??
    tailText(input.stderr)
  const recoverableConnectionLoss =
    detail !== null && isCodexConnectionLossText(detail)

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

    if (input.providerSessionId) {
      parts.push(
        `Murph recovered provider thread ${input.providerSessionId}, so the next chat turn can resume it.`,
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
