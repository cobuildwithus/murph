import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { normalizeStatusText } from '../assistant-codex-events.js'
import { buildCodexResumeStaleMessage } from './failures.js'

const CODEX_APP_SERVER_STOP_TIMEOUT_MS = 3_000

export type CodexRpcId = number

export type CodexRpcMessage = Record<string, unknown>

export interface PendingCodexRpcRequest {
  method: string
  reject: (error: unknown) => void
  resolve: (result: unknown) => void
}

export function attachCodexAbortListener(input: {
  abortSignal?: AbortSignal
  onAbort: () => void
}): () => void {
  const signal = input.abortSignal
  if (!signal) {
    return () => {}
  }

  const handleAbort = () => {
    input.onAbort()
  }

  signal.addEventListener('abort', handleAbort, {
    once: true,
  })

  if (signal.aborted) {
    handleAbort()
  }

  return () => {
    signal.removeEventListener('abort', handleAbort)
  }
}

export function writeCodexRpcMessage(
  child: ChildProcessWithoutNullStreams,
  payload: Record<string, unknown>,
): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

export function stripUndefinedRpcParams(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const stripped: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(value)) {
    if (field !== undefined && field !== null) {
      stripped[key] = field
    }
  }
  return stripped
}

export async function waitForCodexSpawn(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.pid) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const handleSpawn = () => {
      child.off('error', handleError)
      resolve()
    }
    const handleError = (error: Error) => {
      child.off('spawn', handleSpawn)
      reject(error)
    }

    child.once('spawn', handleSpawn)
    child.once('error', handleError)
  })
}

export async function stopCodexAppServerChild(input: {
  child: ChildProcessWithoutNullStreams
  closeStdin: () => VaultCliError | null
}): Promise<void> {
  const stdinCloseError = input.closeStdin()

  if (input.child.exitCode !== null || input.child.signalCode !== null) {
    if (stdinCloseError) {
      throw stdinCloseError
    }
    return
  }

  if (!input.child.killed) {
    input.child.kill()
  }

  if (await waitForCodexChildExit(input.child, CODEX_APP_SERVER_STOP_TIMEOUT_MS)) {
    if (stdinCloseError) {
      throw stdinCloseError
    }
    return
  }

  input.child.kill('SIGKILL')
  await waitForCodexChildExit(input.child, CODEX_APP_SERVER_STOP_TIMEOUT_MS)

  if (stdinCloseError) {
    throw stdinCloseError
  }
}

export async function waitForCodexChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true
  }

  let timeoutId: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }

  return child.exitCode !== null || child.signalCode !== null
}

export function readCodexRpcResponseId(message: CodexRpcMessage): CodexRpcId | null {
  if (typeof message.method === 'string') {
    return null
  }
  return typeof message.id === 'number' ? message.id : null
}

export function readCodexRpcServerRequestId(
  message: CodexRpcMessage,
): CodexRpcId | null {
  if (typeof message.method !== 'string') {
    return null
  }
  return typeof message.id === 'number' ? message.id : null
}

export function resolvePendingCodexRpcRequest(input: {
  message: CodexRpcMessage
  pendingRequests: Map<CodexRpcId, PendingCodexRpcRequest>
  responseId: CodexRpcId
}): void {
  const pending = input.pendingRequests.get(input.responseId)
  if (!pending) {
    return
  }
  input.pendingRequests.delete(input.responseId)

  const error = asRecord(input.message.error)
  if (error) {
    pending.reject(
      buildCodexRpcRequestError({
        error,
        method: pending.method,
      }),
    )
    return
  }

  pending.resolve(input.message.result)
}

export function rejectPendingCodexRpcRequests(
  pendingRequests: Map<CodexRpcId, PendingCodexRpcRequest>,
  error: unknown,
): void {
  for (const pending of pendingRequests.values()) {
    pending.reject(error)
  }
  pendingRequests.clear()
}

export function denyUnsupportedCodexServerRequest(input: {
  message: CodexRpcMessage
  requestId: CodexRpcId
  writeRpcMessage: (payload: Record<string, unknown>) => void
}): void {
  const method = typeof input.message.method === 'string'
    ? input.message.method
    : 'unknown'
  input.writeRpcMessage({
    id: input.requestId,
    error: {
      code: -32000,
      message: `Murph does not support interactive Codex app-server request ${method} in noninteractive assistant turns.`,
    },
  })
}

export async function withCodexRpcTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  method: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new VaultCliError(
              'ASSISTANT_CODEX_APP_SERVER_TIMEOUT',
              `Codex app-server ${method} timed out after ${timeoutMs}ms.`,
              {
                method,
                retryable: false,
              },
            ),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

export function consumeCompleteLines(
  buffer: string,
  onLine: (line: string) => void,
): string {
  const lines = buffer.split(/\r?\n/u)
  const remainder = lines.pop() ?? ''
  for (const line of lines) {
    onLine(line)
  }
  return remainder
}

export function tryParseJsonLine(
  line: string,
): { ok: true; value: CodexRpcMessage } | { ok: false } {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return { ok: false }
  }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    const record = asRecord(parsed)
    return record ? { ok: true, value: record } : { ok: false }
  } catch {
    return { ok: false }
  }
}

function buildCodexRpcRequestError(input: {
  error: Record<string, unknown>
  method: string
}): VaultCliError {
  const message =
    normalizeStatusText(asString(input.error.message)) ??
    `Codex app-server ${input.method} failed.`
  const staleResume =
    input.method === 'thread/resume' && isCodexResumeStaleText(message)

  return new VaultCliError(
    staleResume
      ? 'ASSISTANT_CODEX_RESUME_STALE'
      : 'ASSISTANT_CODEX_APP_SERVER_RPC_FAILED',
    staleResume
      ? buildCodexResumeStaleMessage({ fallback: message })
      : message,
    {
      method: input.method,
      retryable: staleResume,
      staleResume,
    },
  )
}

function isCodexResumeStaleText(value: string): boolean {
  if (!value) {
    return false
  }

  const normalized = value.toLowerCase()
  return (
    normalized.includes('no rollout found for thread id') ||
    normalized.includes('thread not found') ||
    normalized.includes('could not resume thread')
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
