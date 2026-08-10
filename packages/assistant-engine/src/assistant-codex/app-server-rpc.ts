import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import { normalizeStatusText } from '../assistant-codex-events.js'
import {
  isCodexRpcId,
  parseCodexAppServerMessage,
  readCodexRecord,
  readCodexString,
  type CodexRpcId,
  type CodexRpcMessage,
} from './app-server-protocol.js'
import { buildCodexResumeStaleMessage } from './failures.js'

const CODEX_APP_SERVER_STOP_TIMEOUT_MS = 3_000

export type { CodexRpcId, CodexRpcMessage } from './app-server-protocol.js'

export interface PendingCodexRpcRequest {
  method: string
  reject: (error: unknown) => void
  resolve: (result: unknown) => void
}

export type ResolvePendingCodexRpcRequestResult =
  | 'resolved'
  | 'unknown_response_id'

interface StoppableCodexAppServerChild {
  exitCode: number | null
  kill(signal?: NodeJS.Signals): boolean
  killed: boolean
  once(eventName: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  signalCode: NodeJS.Signals | null
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

export function attachCodexAppServerProcessExitCleanup(input: {
  processGroupPid?: number | null
}): () => void {
  const processGroupPid = normalizeCodexProcessGroupPid(input.processGroupPid)
  if (processGroupPid === null) {
    return () => {}
  }

  const signalHandlers = new Map<NodeJS.Signals, () => void>()

  const cleanup = () => {
    killCodexProcessGroupBestEffort(processGroupPid, 'SIGKILL')
  }
  const removeListeners = () => {
    process.off('exit', cleanup)
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler)
    }
    signalHandlers.clear()
  }
  const forwardSignalAfterCleanup = (signal: NodeJS.Signals) => {
    cleanup()
    removeListeners()
    try {
      process.kill(process.pid, signal)
    } catch {
      process.exit(resolveSignalExitCode(signal))
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      forwardSignalAfterCleanup(signal)
    }
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }

  process.once('exit', cleanup)
  return removeListeners
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
    const cleanup = () => {
      child.off('close', handleClose)
      child.off('error', handleError)
      child.off('spawn', handleSpawn)
    }
    const handleSpawn = () => {
      cleanup()
      resolve()
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const handleClose = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      cleanup()
      reject(
        new VaultCliError(
          'ASSISTANT_CODEX_FAILED',
          'Codex app-server process exited before it finished spawning.',
          {
            codexSpawnClosedBeforeReady: true,
            ...(typeof code === 'number' ? { codexExitCode: code } : {}),
            ...(signal ? { codexExitSignal: signal } : {}),
            retryable: false,
          },
        ),
      )
    }

    child.once('close', handleClose)
    child.once('spawn', handleSpawn)
    child.once('error', handleError)
  })
}

export function signalCodexAppServerChild(input: {
  child: StoppableCodexAppServerChild
  processGroupPid?: number | null
  signal: NodeJS.Signals
}): void {
  terminateCodexAppServerChild(
    input.child,
    normalizeCodexProcessGroupPid(input.processGroupPid),
    input.signal,
  )
}

export async function stopCodexAppServerChild(input: {
  child: StoppableCodexAppServerChild
  closeStdin: () => VaultCliError | null
  processGroupPid?: number | null
}): Promise<void> {
  const stdinCloseError = input.closeStdin()
  const processGroupPid = normalizeCodexProcessGroupPid(input.processGroupPid)

  if (input.child.exitCode !== null || input.child.signalCode !== null) {
    killCodexProcessGroupBestEffort(processGroupPid, 'SIGKILL')
    if (stdinCloseError) {
      throw stdinCloseError
    }
    return
  }

  if (!input.child.killed) {
    terminateCodexAppServerChild(input.child, processGroupPid, 'SIGTERM')
  }

  if (await waitForCodexChildExit(input.child, CODEX_APP_SERVER_STOP_TIMEOUT_MS)) {
    killCodexProcessGroupBestEffort(processGroupPid, 'SIGKILL')
    if (stdinCloseError) {
      throw stdinCloseError
    }
    return
  }

  terminateCodexAppServerChild(input.child, processGroupPid, 'SIGKILL')
  const stoppedAfterKill = await waitForCodexChildExit(
    input.child,
    CODEX_APP_SERVER_STOP_TIMEOUT_MS,
  )
  killCodexProcessGroupBestEffort(processGroupPid, 'SIGKILL')

  if (
    !stoppedAfterKill &&
    input.child.exitCode === null &&
    input.child.signalCode === null
  ) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_STOP_FAILED',
      'Codex app-server did not exit after SIGKILL.',
      {
        retryable: false,
      },
    )
  }

  if (stdinCloseError) {
    throw stdinCloseError
  }
}

function normalizeCodexProcessGroupPid(value: number | null | undefined): number | null {
  return process.platform !== 'win32' && typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : null
}

function terminateCodexAppServerChild(
  child: StoppableCodexAppServerChild,
  processGroupPid: number | null,
  signal: NodeJS.Signals,
): void {
  if (killCodexProcessGroupBestEffort(processGroupPid, signal)) {
    return
  }

  child.kill(signal)
}

function killCodexProcessGroupBestEffort(
  processGroupPid: number | null,
  signal: NodeJS.Signals,
): boolean {
  if (processGroupPid === null) {
    return false
  }

  try {
    process.kill(-processGroupPid, signal)
    return true
  } catch (error) {
    if (isNodeErrnoException(error) && error.code === 'ESRCH') {
      return false
    }
    return false
  }
}

function isNodeErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error)
}

function resolveSignalExitCode(signal: NodeJS.Signals): number {
  switch (signal) {
    case 'SIGINT':
      return 130
    case 'SIGTERM':
      return 143
    default:
      return 1
  }
}

export async function waitForCodexChildExit(
  child: Pick<StoppableCodexAppServerChild, 'exitCode' | 'once' | 'signalCode'>,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true
  }

  let timeoutId: NodeJS.Timeout | undefined
  try {
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      timeoutId = setTimeout(resolve, timeoutMs)
    })
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
  return isCodexRpcId(message.id) ? message.id : null
}

export function readCodexRpcServerRequestId(
  message: CodexRpcMessage,
): CodexRpcId | null {
  if (typeof message.method !== 'string') {
    return null
  }
  return isCodexRpcId(message.id) ? message.id : null
}

export function resolvePendingCodexRpcRequest(input: {
  message: CodexRpcMessage
  pendingRequests: Map<CodexRpcId, PendingCodexRpcRequest>
  responseId: CodexRpcId
}): ResolvePendingCodexRpcRequestResult {
  const pending = input.pendingRequests.get(input.responseId)
  if (!pending) {
    return 'unknown_response_id'
  }
  input.pendingRequests.delete(input.responseId)

  const error = readCodexRecord(input.message.error)
  if (error) {
    pending.reject(
      buildCodexRpcRequestError({
        error,
        method: pending.method,
      }),
    )
    return 'resolved'
  }

  pending.resolve(input.message.result)
  return 'resolved'
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

export function rejectCodexServerRequest(input: {
  message: string
  requestId: CodexRpcId
  writeRpcMessage: (payload: Record<string, unknown>) => void
}): void {
  input.writeRpcMessage({
    id: input.requestId,
    error: {
      code: -32000,
      message: input.message,
    },
  })
}

export function denyUnsupportedCodexServerRequest(input: {
  message: CodexRpcMessage
  requestId: CodexRpcId
  writeRpcMessage: (payload: Record<string, unknown>) => void
}): void {
  const method = typeof input.message.method === 'string'
    ? input.message.method
    : 'unknown'
  rejectCodexServerRequest({
    message: `Murph does not support interactive Codex app-server request ${method} in noninteractive assistant turns.`,
    requestId: input.requestId,
    writeRpcMessage: input.writeRpcMessage,
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
    const message = parseCodexAppServerMessage(parsed)
    return message ? { ok: true, value: message } : { ok: false }
  } catch {
    return { ok: false }
  }
}

function buildCodexRpcRequestError(input: {
  error: Record<string, unknown>
  method: string
}): VaultCliError {
  const message =
    normalizeStatusText(readCodexString(input.error.message)) ??
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
