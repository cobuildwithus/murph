import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantApprovalPolicy,
  AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  CodexNormalizedEvent,
  CodexProgressEvent,
} from './assistant-codex-events.js'
import {
  extractAssistantMessageFallback,
  extractCodexErrorMessage,
  extractCodexProgressEventFromNormalized,
  extractCodexSessionId,
  extractCodexStatusEventFromStderrLine,
  extractCodexTraceUpdatesFromNormalized,
  isCodexConnectionLossText,
  normalizeCodexEvent,
  normalizeStatusText,
  normalizeStreamingText,
} from './assistant-codex-events.js'
import {
  resolveCodexChildEnv,
} from './assistant-codex/config.js'
import {
  materializeCodexImagePaths,
  type CodexAppServerImageInput,
} from './assistant-codex/images.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'

export { extractCodexTraceUpdates } from './assistant-codex-events.js'
export { resolveCodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexProgressEvent } from './assistant-codex-events.js'
export type { CodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexAppServerImageInput } from './assistant-codex/images.js'

const CODEX_RPC_CLIENT_NAME = 'murph'
const CODEX_RPC_CLIENT_TITLE = 'Murph'
const CODEX_RPC_CLIENT_VERSION = '1.0.0'
const CODEX_RPC_DEFAULT_TIMEOUT_MS = 120_000
const CODEX_APP_SERVER_STOP_TIMEOUT_MS = 3_000
const CODEX_APP_SERVER_COMMAND = 'app-server'

type CodexRpcId = number

type CodexRpcMessage = Record<string, unknown>

type CodexAppServerInputItem =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'localImage'
      path: string
    }

interface PendingCodexRpcRequest {
  method: string
  reject: (error: unknown) => void
  resolve: (result: unknown) => void
}

export interface CodexAppServerTurnInput {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy
  configOverrides?: readonly string[]
  codexCommand?: string
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
  model?: string | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean
  profile?: string | null
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  workingDirectory: string
}

export interface CodexAppServerTurnResult {
  finalMessage: string
  jsonEvents: unknown[]
  providerActionCount: number
  sessionId: string | null
  stderr: string
  stdout: string
}

export async function executeCodexAppServerTurn(
  input: CodexAppServerTurnInput,
): Promise<CodexAppServerTurnResult> {
  const approvalPolicy = resolveSupportedCodexAppServerApprovalPolicy(input.approvalPolicy)
  const codexCommand = input.codexCommand?.trim() || 'codex'
  const workingDirectory = path.resolve(input.workingDirectory)
  const childEnv = await resolveCodexChildEnv({
    codexHome: input.codexHome,
    env: input.env,
  })
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-codex-'))
  const imagePaths = await materializeCodexImagePaths({
    images: input.images,
    tempRoot,
  })
  const normalizedInput = {
    ...input,
    approvalPolicy,
  }
  const args = buildCodexAppServerArgs(normalizedInput)

  try {
    return await runCodexAppServerTurn({
      ...normalizedInput,
      args,
      codexCommand,
      imagePaths,
      workingDirectory,
      env: childEnv,
    })
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
    })
  }
}

export function buildCodexAppServerArgs(
  input: Pick<
    CodexAppServerTurnInput,
    'approvalPolicy' | 'configOverrides' | 'oss' | 'profile' | 'sandbox'
  >,
): string[] {
  const approvalPolicy = resolveSupportedCodexAppServerApprovalPolicy(input.approvalPolicy)
  const args: string[] = []

  if (input.sandbox) {
    args.push('-s', input.sandbox)
  }

  args.push('-a', approvalPolicy)

  for (const override of input.configOverrides ?? []) {
    args.push('--config', override)
  }

  if (input.profile) {
    args.push('--profile', input.profile)
  }

  if (input.oss) {
    args.push('--oss')
  }

  args.push(CODEX_APP_SERVER_COMMAND)
  return args
}

async function runCodexAppServerTurn(
  input: CodexAppServerTurnInput & {
    args: readonly string[]
    codexCommand: string
    env: NodeJS.ProcessEnv
    imagePaths: readonly string[]
    workingDirectory: string
  },
): Promise<CodexAppServerTurnResult> {
  const child: ChildProcessWithoutNullStreams = spawn(input.codexCommand, [...input.args], {
    cwd: input.workingDirectory,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let settled = false
  let normalShutdown = false
  let abortRequested = false
  let nextRequestId = 1
  let providerSessionId = normalizeNullableString(input.resumeSessionId) ?? null
  let turnId: string | null = null
  let lastAgentMessage: string | null = null
  let lastEventError: string | null = null
  let providerActionCount = 0
  const providerActionItemIds = new Set<string>()
  const jsonEvents: unknown[] = []
  const pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  const assistantStreams = new Map<string, string>()
  const assistantStreamOrder: string[] = []
  let stdinFailure: VaultCliError | null = null

  let completeTurn: (() => void) | null = null
  let failTurn: ((error: unknown) => void) | null = null
  const turnCompleted = new Promise<void>((resolve, reject) => {
    completeTurn = resolve
    failTurn = reject
  })
  void turnCompleted.catch(() => undefined)
  let cleanupAbortListener = () => {}

  const rejectOnce = (error: unknown) => {
    if (settled) {
      return
    }

    settled = true
    cleanupAbortListener()
    rejectPendingCodexRpcRequests(pendingRequests, error)
    failTurn?.(error)
  }

  const handleCodexStdinError = (error: unknown): VaultCliError | null => {
    if (normalShutdown && readNodeErrorCode(error) === 'EPIPE') {
      return null
    }

    const failure =
      stdinFailure ??
      buildCodexProcessExitError({
        abortRequested,
        code: child.exitCode,
        fallback: buildCodexStdinFailureFallback({
          error,
          lastEventError,
          stderr,
        }),
        providerActionCount,
        providerSessionId,
        signal: child.signalCode ?? null,
        stderr,
      })
    stdinFailure = failure
    rejectOnce(failure)
    return failure
  }

  const tryWriteRpcMessage = (
    payload: Record<string, unknown>,
  ): VaultCliError | null => {
    if (stdinFailure) {
      return stdinFailure
    }

    try {
      writeCodexRpcMessage(child, payload)
      return stdinFailure
    } catch (error) {
      return handleCodexStdinError(error)
    }
  }

  const tryCloseCodexStdin = (): VaultCliError | null => {
    if (stdinFailure) {
      return stdinFailure
    }

    try {
      child.stdin.end()
      return stdinFailure
    } catch (error) {
      return handleCodexStdinError(error)
    }
  }

  child.stdin.on('error', (error) => {
    void handleCodexStdinError(error)
  })

  cleanupAbortListener = attachCodexAbortListener({
    abortSignal: input.abortSignal,
    onAbort: () => {
      abortRequested = true
      if (providerSessionId && turnId) {
        void tryWriteRpcMessage({
          id: nextRequestId,
          method: 'turn/interrupt',
          params: {
            threadId: providerSessionId,
            turnId,
          },
        })
        nextRequestId += 1
      }
      child.kill('SIGINT')
    },
  })

  const recordAssistantTraceUpdate = (update: AssistantProviderTraceUpdate) => {
    if (update.kind !== 'assistant') {
      return
    }

    const normalizedText = normalizeStreamingText(update.text)
    if (!normalizedText) {
      return
    }

    const streamKey = normalizeNullableString(update.streamKey) ?? 'assistant:main'
    const previousText = assistantStreams.get(streamKey) ?? ''

    if (!assistantStreams.has(streamKey)) {
      assistantStreamOrder.push(streamKey)
    }

    assistantStreams.set(
      streamKey,
      update.mode === 'append'
        ? `${previousText}${normalizedText}`
        : normalizedText,
    )
  }

  const handleParsedMessage = (message: CodexRpcMessage) => {
    jsonEvents.push(message)

    const responseId = readCodexRpcResponseId(message)
    if (responseId !== null) {
      resolvePendingCodexRpcRequest({
        message,
        pendingRequests,
        responseId,
      })
      return
    }

    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      denyUnsupportedCodexServerRequest({
        message,
        requestId,
        writeRpcMessage: (payload) => {
          void tryWriteRpcMessage(payload)
        },
      })
      return
    }

    providerSessionId = providerSessionId ?? extractCodexSessionId(message)
    lastEventError = extractCodexErrorMessage(message) ?? lastEventError

    const normalizedEvent = normalizeCodexEvent(message)
    const providerActionKey = extractCodexProviderActionKey(normalizedEvent)
    if (providerActionKey && !providerActionItemIds.has(providerActionKey)) {
      providerActionItemIds.add(providerActionKey)
      providerActionCount += 1
    }

    const updates = extractCodexTraceUpdatesFromNormalized(normalizedEvent)
    for (const update of updates) {
      recordAssistantTraceUpdate(update)
    }

    input.onTraceEvent?.({
      providerSessionId,
      rawEvent: message,
      updates,
    })

    const progressEvent = extractCodexProgressEventFromNormalized(normalizedEvent)
    if (progressEvent) {
      if (progressEvent.kind === 'message') {
        lastAgentMessage = progressEvent.text
      }
      input.onProgress?.(progressEvent)
    }

    const method = typeof message.method === 'string' ? message.method : null
    if (method === 'turn/started') {
      turnId = extractCodexTurnIdFromMessage(message) ?? turnId
    }

    if (method !== 'turn/completed') {
      return
    }

    const status = extractCodexTurnStatus(message)
    if (isFailedCodexTurnStatus(status)) {
      failTurn?.(
        buildCodexTurnFailedError({
          fallback: lastEventError ?? extractCodexTurnErrorMessage(message),
          providerActionCount,
          providerSessionId,
          status,
        }),
      )
      return
    }

    completeTurn?.()
  }

  const sendRequest = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextRequestId
    nextRequestId += 1

    return new Promise<unknown>((resolve, reject) => {
      pendingRequests.set(id, {
        method,
        reject,
        resolve,
      })
      const failure = tryWriteRpcMessage({
        id,
        method,
        params: stripUndefinedRpcParams(params),
      })
      if (failure) {
        pendingRequests.delete(id)
        reject(failure)
      }
    })
  }

  const sendNotification = (method: string, params: Record<string, unknown>): void => {
    void tryWriteRpcMessage({
      method,
      params: stripUndefinedRpcParams(params),
    })
  }

  child.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      rejectOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_NOT_FOUND',
          `Codex app-server executable "${input.codexCommand}" was not found. Install @openai/codex or pass --codexCommand.`,
        ),
      )
      return
    }

    rejectOnce(error)
  })

  child.stdout.on('data', (chunk) => {
    const text = String(chunk)
    stdout += text
    stdoutBuffer += text
    stdoutBuffer = consumeCompleteLines(stdoutBuffer, (line) => {
      const parsed = tryParseJsonLine(line)
      if (parsed.ok) {
        handleParsedMessage(parsed.value)
      }
    })
  })

  child.stderr.on('data', (chunk) => {
    const text = String(chunk)
    stderr += text
    stderrBuffer += text
    stderrBuffer = consumeCompleteLines(stderrBuffer, (line) => {
      const progressEvent = extractCodexStatusEventFromStderrLine(line)
      if (progressEvent) {
        input.onProgress?.(progressEvent)
      }
    })
  })

  child.on('close', (code, signal) => {
    if (stderrBuffer.trim().length > 0) {
      const progressEvent = extractCodexStatusEventFromStderrLine(stderrBuffer)
      if (progressEvent) {
        input.onProgress?.(progressEvent)
      }
    }

    if (stdoutBuffer.trim().length > 0) {
      const parsed = tryParseJsonLine(stdoutBuffer)
      if (parsed.ok) {
        handleParsedMessage(parsed.value)
      }
    }

    if (normalShutdown || settled) {
      return
    }

    rejectOnce(
      buildCodexProcessExitError({
        abortRequested,
        code,
        fallback: lastEventError,
        providerActionCount,
        providerSessionId,
        signal,
        stderr,
      }),
    )
  })

  try {
    await waitForCodexSpawn(child)
    await withCodexRpcTimeout(
      sendRequest('initialize', {
        clientInfo: {
          name: CODEX_RPC_CLIENT_NAME,
          title: CODEX_RPC_CLIENT_TITLE,
          version: CODEX_RPC_CLIENT_VERSION,
        },
      }),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'initialize',
    )
    sendNotification('initialized', {})

    const threadResult = await withCodexRpcTimeout(
      providerSessionId
        ? sendRequest(
            'thread/resume',
            buildCodexThreadResumeParams({
              input,
              providerSessionId,
            }),
          )
        : sendRequest('thread/start', buildCodexThreadStartParams(input)),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      providerSessionId ? 'thread/resume' : 'thread/start',
    )
    providerSessionId = extractCodexThreadIdFromResult(threadResult) ?? providerSessionId
    if (!providerSessionId) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_FAILED',
        'Codex app-server did not return a thread id.',
      )
    }

    const turnResult = await withCodexRpcTimeout(
      sendRequest(
        'turn/start',
        buildCodexTurnStartParams({
          input,
          imagePaths: input.imagePaths,
          providerSessionId,
        }),
      ),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'turn/start',
    )
    turnId = extractCodexTurnIdFromResult(turnResult) ?? turnId

    await turnCompleted
    normalShutdown = true
    await stopCodexAppServerChild({
      child,
      closeStdin: tryCloseCodexStdin,
    })
    if (stdinFailure) {
      throw stdinFailure
    }
  } catch (error) {
    normalShutdown = true
    await stopCodexAppServerChild({
      child,
      closeStdin: tryCloseCodexStdin,
    }).catch(() => undefined)
    throw error
  } finally {
    cleanupAbortListener()
  }

  const finalMessage =
    extractAssistantMessageFallback({
      assistantStreams,
      assistantStreamOrder,
    }) ??
    lastAgentMessage ??
    ''

  return {
    finalMessage,
    jsonEvents,
    providerActionCount,
    sessionId: providerSessionId,
    stderr: stderr.trim(),
    stdout: stdout.trim(),
  }
}

function buildCodexThreadStartParams(
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  },
): Record<string, unknown> {
  return buildCodexThreadContextParams({
    includeServiceName: true,
    input,
  })
}

function buildCodexThreadResumeParams(input: {
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  providerSessionId: string
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    ...buildCodexThreadContextParams({
      includeServiceName: false,
      input: input.input,
    }),
    threadId: input.providerSessionId,
  })
}

function buildCodexThreadContextParams(input: {
  includeServiceName: boolean
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    approvalPolicy: mapCodexAppServerApprovalPolicy(input.input.approvalPolicy),
    cwd: input.input.workingDirectory,
    model: normalizeNullableString(input.input.model),
    sandbox: mapCodexAppServerSandboxMode(input.input.sandbox),
    serviceName: input.includeServiceName ? CODEX_RPC_CLIENT_NAME : undefined,
  })
}

function buildCodexTurnStartParams(input: {
  imagePaths: readonly string[]
  input: CodexAppServerTurnInput & {
    workingDirectory: string
  }
  providerSessionId: string
}): Record<string, unknown> {
  return stripUndefinedRpcParams({
    effort: normalizeNullableString(input.input.reasoningEffort),
    input: buildCodexAppServerInputItems({
      imagePaths: input.imagePaths,
      prompt: input.input.prompt,
    }),
    threadId: input.providerSessionId,
  })
}

function buildCodexAppServerInputItems(input: {
  imagePaths: readonly string[]
  prompt: string
}): CodexAppServerInputItem[] {
  return [
    {
      type: 'text',
      text: input.prompt,
    },
    ...input.imagePaths.map((imagePath) => ({
      type: 'localImage' as const,
      path: imagePath,
    })),
  ]
}

function mapCodexAppServerApprovalPolicy(
  approvalPolicy: AssistantApprovalPolicy | null | undefined,
): string | undefined {
  switch (approvalPolicy) {
    case 'on-request':
      return 'onRequest'
    case 'untrusted':
      return 'unlessTrusted'
    case 'never':
      return 'never'
    default:
      return undefined
  }
}

function mapCodexAppServerSandboxMode(
  sandbox: AssistantSandbox | null | undefined,
): string | undefined {
  switch (sandbox) {
    case 'read-only':
      return 'readOnly'
    case 'workspace-write':
      return 'workspaceWrite'
    case 'danger-full-access':
      return 'dangerFullAccess'
    default:
      return undefined
  }
}

function resolveSupportedCodexAppServerApprovalPolicy(
  approvalPolicy: AssistantApprovalPolicy | null | undefined,
): 'never' {
  if (!approvalPolicy || approvalPolicy === 'never') {
    return 'never'
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_APPROVAL_POLICY_UNSUPPORTED',
    `Codex app-server approval policy "${approvalPolicy}" is not supported in noninteractive assistant turns. Use approvalPolicy=never.`,
    {
      approvalPolicy,
      retryable: false,
    },
  )
}

function attachCodexAbortListener(input: {
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

function writeCodexRpcMessage(
  child: ChildProcessWithoutNullStreams,
  payload: Record<string, unknown>,
): void {
  child.stdin.write(`${JSON.stringify(payload)}\n`)
}

function stripUndefinedRpcParams(
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

async function waitForCodexSpawn(child: ChildProcessWithoutNullStreams): Promise<void> {
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

async function stopCodexAppServerChild(input: {
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

async function waitForCodexChildExit(
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

function readCodexRpcResponseId(message: CodexRpcMessage): CodexRpcId | null {
  if (typeof message.method === 'string') {
    return null
  }
  return typeof message.id === 'number' ? message.id : null
}

function readCodexRpcServerRequestId(message: CodexRpcMessage): CodexRpcId | null {
  if (typeof message.method !== 'string') {
    return null
  }
  return typeof message.id === 'number' ? message.id : null
}

function resolvePendingCodexRpcRequest(input: {
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

function rejectPendingCodexRpcRequests(
  pendingRequests: Map<CodexRpcId, PendingCodexRpcRequest>,
  error: unknown,
): void {
  for (const pending of pendingRequests.values()) {
    pending.reject(error)
  }
  pendingRequests.clear()
}

function denyUnsupportedCodexServerRequest(input: {
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

async function withCodexRpcTimeout<T>(
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

function extractCodexThreadIdFromResult(result: unknown): string | null {
  const record = asRecord(result)
  const thread = asRecord(record?.thread)
  return (
    normalizeNullableString(asString(thread?.id)) ??
    normalizeNullableString(asString(record?.threadId)) ??
    null
  )
}

function extractCodexTurnIdFromResult(result: unknown): string | null {
  const record = asRecord(result)
  const turn = asRecord(record?.turn)
  return (
    normalizeNullableString(asString(turn?.id)) ??
    normalizeNullableString(asString(record?.turnId)) ??
    null
  )
}

function extractCodexTurnIdFromMessage(message: CodexRpcMessage): string | null {
  const params = asRecord(message.params)
  const turn = asRecord(params?.turn)
  return (
    normalizeNullableString(asString(turn?.id)) ??
    normalizeNullableString(asString(params?.turnId)) ??
    null
  )
}

function extractCodexTurnStatus(message: CodexRpcMessage): string | null {
  const params = asRecord(message.params)
  const turn = asRecord(params?.turn)
  return normalizeNullableString(asString(turn?.status) ?? asString(params?.status))
}

function extractCodexTurnErrorMessage(message: CodexRpcMessage): string | null {
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

function isFailedCodexTurnStatus(status: string | null): boolean {
  const normalized = status?.toLowerCase() ?? null
  return (
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'cancelled' ||
    normalized === 'canceled' ||
    normalized === 'interrupted'
  )
}

function extractCodexProviderActionKey(
  normalizedEvent: CodexNormalizedEvent,
): string | null {
  if (normalizedEvent.kind === 'status_item') {
    if (
      normalizedEvent.itemType !== 'command.execution' &&
      normalizedEvent.itemType !== 'dynamic.tool.call' &&
      normalizedEvent.itemType !== 'file.change'
    ) {
      return null
    }

    return (
      normalizedEvent.itemId ??
      providerActionFallbackKeyFromNormalized(normalizedEvent)
    )
  }

  if (
    normalizedEvent.kind !== 'tool_call' &&
    normalizedEvent.kind !== 'web_search'
  ) {
    return null
  }

  return (
    normalizedEvent.itemId ??
    providerActionFallbackKeyFromNormalized(normalizedEvent)
  )
}

function providerActionFallbackKeyFromNormalized(
  event: Extract<
    CodexNormalizedEvent,
    { kind: 'status_item' | 'tool_call' | 'web_search' }
  >,
): string {
  switch (event.kind) {
    case 'status_item':
      return JSON.stringify({
        commandLabel: event.commandLabel,
        filePaths: event.filePaths,
        itemType: event.itemType,
      })
    case 'tool_call':
      return JSON.stringify({
        toolName: event.toolName,
        toolServer: event.toolServer,
      })
    case 'web_search':
      return JSON.stringify({
        query: event.query,
      })
  }
}

function buildCodexTurnFailedError(input: {
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

function buildCodexFailure(input: {
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

function buildCodexProcessExitError(input: {
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

function buildCodexStdinFailureFallback(input: {
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

function buildCodexInterruptedError(input: {
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

function buildCodexConnectionFailureMessage(input: {
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

function buildCodexResumeStaleMessage(input: {
  fallback: string | null
}): string {
  const parts = ['Codex app-server could not resume the saved provider thread.']

  if (input.fallback) {
    parts.push(input.fallback)
  }

  parts.push('Murph should start a fresh provider thread for this turn.')

  return parts.join(' ')
}

function consumeCompleteLines(
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

function tryParseJsonLine(
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

function readNodeErrorCode(error: unknown): string | null {
  const record = asRecord(error)
  return normalizeNullableString(asString(record?.code))
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
