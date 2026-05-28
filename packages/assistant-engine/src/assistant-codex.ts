import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_TEST_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type { AssistantSandbox } from '@murphai/operator-config/assistant-cli-contracts'
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
  normalizeCodexEvent,
  normalizeStreamingText,
} from './assistant-codex-events.js'
import {
  buildCodexTurnInterruptParams,
  buildCodexThreadResumeParams,
  buildCodexThreadStartParams,
  buildCodexTurnSteerParams,
  buildCodexTurnStartParams,
  resolveSupportedCodexAppServerApprovalPolicy,
} from './assistant-codex/app-server-requests.js'
import {
  createCodexActionDiagnosticsReducer,
} from './assistant-codex/action-diagnostics.js'
import {
  readMurphDynamicToolRequest,
} from './assistant-codex/dynamic-tools.js'
import {
  attachCodexAppServerProcessExitCleanup,
  attachCodexAbortListener,
  consumeCompleteLines,
  denyUnsupportedCodexServerRequest,
  readCodexRpcResponseId,
  readCodexRpcServerRequestId,
  rejectPendingCodexRpcRequests,
  resolvePendingCodexRpcRequest,
  signalCodexAppServerChild,
  stopCodexAppServerChild,
  stripUndefinedRpcParams,
  tryParseJsonLine,
  waitForCodexSpawn,
  withCodexRpcTimeout,
  writeCodexRpcMessage,
  type CodexRpcId,
  type CodexRpcMessage,
  type PendingCodexRpcRequest,
} from './assistant-codex/app-server-rpc.js'
import {
  resolveCodexChildEnv,
} from './assistant-codex/config.js'
import {
  buildCodexProcessExitError,
  buildCodexStdinFailureFallback,
  buildCodexTurnFailedError,
  extractCodexThreadIdFromResult,
  extractCodexThreadPathFromResult,
  extractCodexTurnErrorMessage,
  extractCodexTurnIdFromMessage,
  extractCodexTurnIdFromResult,
  extractCodexTurnStatus,
  isFailedCodexTurnStatus,
  readNodeErrorCode,
} from './assistant-codex/failures.js'
import {
  materializeCodexImagePaths,
  type CodexAppServerImageInput,
} from './assistant-codex/images.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import type {
  AssistantTurnProgress,
} from './assistant/turn-progress.js'

export { extractCodexTraceUpdates } from './assistant-codex-events.js'
export { resolveCodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexProgressEvent } from './assistant-codex-events.js'
export type { CodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexAppServerImageInput } from './assistant-codex/images.js'

const CODEX_RPC_CLIENT_NAME = 'murph'
const CODEX_RPC_CLIENT_TITLE = 'Murph'
const CODEX_RPC_CLIENT_VERSION = '1.0.0'
const CODEX_RPC_DEFAULT_TIMEOUT_MS = 120_000
const CODEX_RPC_STEER_TIMEOUT_MS = 15_000
const CODEX_APP_SERVER_COMMAND = 'app-server'
const HOSTED_RUNTIME_PROCESS_ENV_MARKER = HOSTED_RUNTIME_PROCESS_ENV
const HOSTED_CODEX_APP_SERVER_COMMAND = 'codex'
const HOSTED_RUNNER_EXECUTABLE_PATH = [
  '/app/node_modules/.bin',
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
].join(path.delimiter)
const CODEX_APP_SERVER_TIMING_TRACE_SCHEMA =
  'murph.assistant-codex-app-server-timing.v1'
const CODEX_APP_SERVER_TIMING_TRACE_TYPE =
  'assistant.codex.app_server_timing'

export interface CodexAppServerTurnInput {
  abortSignal?: AbortSignal
  approvalPolicy?: string
  configOverrides?: readonly string[]
  codexCommand?: string
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
  baseInstructions?: string | null
  developerInstructions?: string | null
  excludeResumeTurns?: boolean
  refreshThreadInstructions?: boolean
  model?: string | null
  modelProvider?: string | null
  onLiveTurn?: ((turn: CodexAppServerLiveTurn) => void | (() => void)) | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean
  profile?: string | null
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  turnProgress?: AssistantTurnProgress | null
  workingDirectory: string
}

export interface CodexAppServerTurnFailureContext {
  jsonEvents: unknown[]
  providerActionCount: number
  codexThreadId: string | null
  providerTurnId: string | null
}

const CODEX_APP_SERVER_TURN_FAILURE_CONTEXT =
  Symbol('codexAppServerTurnFailureContext')
const codexAppServerTurnFailureContexts =
  new WeakMap<object, CodexAppServerTurnFailureContext>()

export function readCodexAppServerTurnFailureContext(
  error: unknown,
): CodexAppServerTurnFailureContext | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const context =
    codexAppServerTurnFailureContexts.get(error) ??
    (error as {
    [CODEX_APP_SERVER_TURN_FAILURE_CONTEXT]?:
      | CodexAppServerTurnFailureContext
      | undefined
  })[CODEX_APP_SERVER_TURN_FAILURE_CONTEXT]

  if (!context) {
    return null
  }

  return {
    jsonEvents: [...context.jsonEvents],
    providerActionCount: context.providerActionCount,
    codexThreadId: context.codexThreadId,
    providerTurnId: context.providerTurnId,
  }
}

export interface CodexAppServerTurnResult {
  finalMessage: string
  jsonEvents: unknown[]
  providerActionCount: number
  rolloutRelativePath: string | null
  sessionId: string | null
  stderr: string
  stdout: string
  threadId: string | null
  turnId: string | null
}

export type CodexAppServerSteerInput = {
  threadId: string
  turnId: string
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
}

export type CodexAppServerSteerRequestInput = Omit<
  CodexAppServerSteerInput,
  'images'
> & {
  imagePaths?: readonly string[] | null
}

export interface CodexAppServerSteerRequest {
  method: 'turn/steer'
  params: Record<string, unknown>
}

export interface CodexAppServerLiveTurn {
  interrupt(): Promise<void>
  steer(input: Omit<CodexAppServerSteerInput, 'threadId' | 'turnId'>): Promise<void>
  threadId: string
  turnId: string
}

export function buildCodexAppServerSteerRequest(
  input: CodexAppServerSteerRequestInput,
): CodexAppServerSteerRequest {
  return {
    method: 'turn/steer',
    params: buildCodexTurnSteerParams(input),
  }
}

export async function executeCodexAppServerTurn(
  input: CodexAppServerTurnInput,
): Promise<CodexAppServerTurnResult> {
  const approvalPolicy = resolveSupportedCodexAppServerApprovalPolicy(input.approvalPolicy)
  const hostedRuntimeProcess = isHostedCodexAppServerRuntime(input.env)
  const workingDirectory = path.resolve(input.workingDirectory)
  const resolvedChildEnv = await resolveCodexChildEnv({
    codexHome: resolveCodexAppServerCodexHome({
      codexHome: input.codexHome,
      hostedRuntimeProcess,
    }),
    env: input.env,
  })
  const childEnv = hostedRuntimeProcess
    ? projectHostedCodexAppServerChildEnv(resolvedChildEnv)
    : resolvedChildEnv
  const codexCommand = resolveCodexAppServerCommand({
    codexCommand: input.codexCommand,
    env: childEnv,
    hostedRuntimeProcess,
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
      tempRoot,
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

function resolveCodexAppServerCommand(input: {
  codexCommand?: string | null
  env?: NodeJS.ProcessEnv
  hostedRuntimeProcess: boolean
}): string {
  if (input.hostedRuntimeProcess) {
    return resolveHostedCodexAppServerCommand(input.env ?? process.env)
  }

  return input.codexCommand?.trim() || 'codex'
}

function resolveCodexAppServerCodexHome(input: {
  codexHome?: string | null
  hostedRuntimeProcess: boolean
}): string | null | undefined {
  if (input.hostedRuntimeProcess) {
    return null
  }

  return input.codexHome
}

function isHostedCodexAppServerRuntime(env: NodeJS.ProcessEnv | undefined): boolean {
  return isHostedRuntimeProcessEnv(process.env) || isHostedRuntimeProcessEnv(env)
}

function isHostedRuntimeProcessEnv(env: NodeJS.ProcessEnv | undefined): boolean {
  return env?.[HOSTED_RUNTIME_PROCESS_ENV_MARKER]?.trim() === '1'
}

function resolveHostedCodexAppServerCommand(env: NodeJS.ProcessEnv): string {
  const testCommand = normalizeNullableString(
    env[HOSTED_RUNTIME_CODEX_APP_SERVER_TEST_COMMAND_ENV],
  )

  if (
    env.NODE_ENV?.trim() === 'test'
    && testCommand
    && path.isAbsolute(testCommand)
  ) {
    return testCommand
  }

  return HOSTED_CODEX_APP_SERVER_COMMAND
}

function projectHostedCodexAppServerChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const ambientHostedCodexHome = normalizeNullableString(process.env.CODEX_HOME)
  const providedHostedCodexHome = normalizeNullableString(env.CODEX_HOME)
  const codexHome = isHostedRuntimeProcessEnv(process.env)
    ? ambientHostedCodexHome ?? providedHostedCodexHome
    : providedHostedCodexHome

  return {
    ...env,
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
    [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: '1',
    PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
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
    tempRoot: string
    workingDirectory: string
  },
): Promise<CodexAppServerTurnResult> {
  const useProcessGroup = process.platform !== 'win32'
  const child: ChildProcessWithoutNullStreams = spawn(input.codexCommand, [...input.args], {
    cwd: input.workingDirectory,
    detached: useProcessGroup,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const processGroupPid = useProcessGroup ? child.pid ?? null : null
  const cleanupProcessExitListener = attachCodexAppServerProcessExitCleanup({
    processGroupPid,
  })

  let stdout = ''
  let stderr = ''
  let stdoutBuffer = ''
  let stderrBuffer = ''
  let settled = false
  let normalShutdown = false
  let abortRequested = false
  let nextRequestId = 1
  let codexThreadId = normalizeNullableString(input.resumeSessionId) ?? null
  let turnId: string | null = null
  let lastAgentMessage: string | null = null
  let lastEventError: string | null = null
  let rolloutRelativePath: string | null = null
  let providerActionCount = 0
  const providerActionItemIds = new Set<string>()
  const jsonEvents: unknown[] = []
  const actionDiagnostics = input.onTraceEvent
    ? createCodexActionDiagnosticsReducer()
    : null
  let actionDiagnosticsTraceEmitted = false
  const pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  const assistantStreams = new Map<string, string>()
  const assistantStreamOrder: string[] = []
  let stdinFailure: VaultCliError | null = null
  const appServerStartedAt = Date.now()
  let lastTimingAt = appServerStartedAt

  let completeTurn: (() => void) | null = null
  let failTurn: ((error: unknown) => void) | null = null
  let liveTurnOpen = false
  let releaseLiveTurn = () => {}
  const turnCompleted = new Promise<void>((resolve, reject) => {
    completeTurn = resolve
    failTurn = reject
  })
  void turnCompleted.catch(() => undefined)
  let cleanupAbortListener = () => {}

  const annotateTurnFailureContext = (error: unknown) => {
    if (!error || typeof error !== 'object') {
      return
    }

    const context = {
      jsonEvents: [...jsonEvents],
      providerActionCount,
      codexThreadId,
      providerTurnId: turnId,
    } satisfies CodexAppServerTurnFailureContext
    codexAppServerTurnFailureContexts.set(error, context)
    try {
      Object.defineProperty(error, CODEX_APP_SERVER_TURN_FAILURE_CONTEXT, {
        configurable: true,
        enumerable: false,
        value: context,
      })
    } catch {
      // Frozen provider errors should still preserve the original failure.
    }
  }

  const emitAppServerTimingTrace = (stage: string) => {
    if (!input.onTraceEvent) {
      return
    }

    const now = Date.now()
    try {
      input.onTraceEvent({
        codexThreadId,
        rawEvent: {
          schema: CODEX_APP_SERVER_TIMING_TRACE_SCHEMA,
          type: CODEX_APP_SERVER_TIMING_TRACE_TYPE,
          codexTimingElapsedMs: Math.max(0, now - lastTimingAt),
          codexTimingProviderActionCount: providerActionCount,
          codexTimingThreadIdPresent: codexThreadId !== null,
          codexTimingStage: stage,
          codexTimingTotalElapsedMs: Math.max(0, now - appServerStartedAt),
          codexTimingTurnIdPresent: turnId !== null,
        },
        updates: [],
      })
      lastTimingAt = now
    } catch {
      // Timing traces are diagnostic-only and must not block assistant turns.
    }
  }

  const rejectOnce = (error: unknown) => {
    if (settled) {
      return
    }

    annotateTurnFailureContext(error)
    settled = true
    closeLiveTurn()
    cleanupAbortListener()
    rejectPendingCodexRpcRequests(pendingRequests, error)
    failTurn?.(error)
  }

  const buildLiveTurnInactiveError = () =>
    new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_LIVE_TURN_INACTIVE',
      'Codex app-server live turn is no longer active.',
      {
        retryable: true,
      },
    )

  const rejectPendingLiveTurnRequests = (error: unknown) => {
    for (const [id, pending] of pendingRequests.entries()) {
      if (
        pending.method !== 'turn/steer' &&
        pending.method !== 'turn/interrupt'
      ) {
        continue
      }
      pendingRequests.delete(id)
      pending.reject(error)
    }
  }

  const closeLiveTurn = () => {
    if (liveTurnOpen) {
      rejectPendingLiveTurnRequests(buildLiveTurnInactiveError())
    }
    liveTurnOpen = false
    releaseLiveTurn()
    releaseLiveTurn = () => {}
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
        codexThreadId,
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
      if (codexThreadId && turnId) {
        void tryWriteRpcMessage({
          id: nextRequestId,
          method: 'turn/interrupt',
          params: buildCodexTurnInterruptParams({
            threadId: codexThreadId,
            turnId,
          }),
        })
        nextRequestId += 1
      }
      signalCodexAppServerChild({
        child,
        processGroupPid,
        signal: 'SIGINT',
      })
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
      const pending = pendingRequests.get(responseId)
      if (pending?.method === 'thread/start' || pending?.method === 'thread/resume') {
        codexThreadId = extractCodexThreadIdFromResult(message.result) ?? codexThreadId
      }
      if (pending?.method === 'turn/start') {
        turnId = extractCodexTurnIdFromResult(message.result) ?? turnId
      }
      resolvePendingCodexRpcRequest({
        message,
        pendingRequests,
        responseId,
      })
      return
    }

    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      const dynamicToolRequest = readMurphDynamicToolRequest(message)
      if (!dynamicToolRequest || !input.turnProgress) {
        denyUnsupportedCodexServerRequest({
          message,
          requestId,
          writeRpcMessage: (payload) => {
            void tryWriteRpcMessage(payload)
          },
        })
        return
      }

      if (dynamicToolRequest.kind === 'unsupported-dynamic-tool') {
        void tryWriteRpcMessage({
          id: requestId,
          error: {
            code: -32000,
            message: `Unsupported dynamic tool ${dynamicToolRequest.namespace ?? ''}.${dynamicToolRequest.tool ?? 'unknown'}`,
          },
        })
        return
      }

      if (dynamicToolRequest.kind === 'invalid-progress-arguments') {
        void tryWriteRpcMessage({
          id: requestId,
          result: {
            success: false,
            contentItems: [
              {
                type: 'inputText',
                text: 'invalid progress update arguments',
              },
            ],
          },
        })
        return
      }

      void input.turnProgress.send(dynamicToolRequest.text)
        .then(() => {
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: true,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update accepted',
                },
              ],
            },
          })
        })
        .catch(() => {
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'progress update failed',
                },
              ],
            },
          })
        })
      return
    }

    codexThreadId = codexThreadId ?? extractCodexSessionId(message)
    lastEventError = extractCodexErrorMessage(message) ?? lastEventError
    const method = typeof message.method === 'string' ? message.method : null
    if (method === 'turn/started') {
      turnId = extractCodexTurnIdFromMessage(message) ?? turnId
    }

    const normalizedEvent = normalizeCodexEvent(message)
    actionDiagnostics?.recordEvent({
      activeTurnId: turnId,
      normalizedEvent,
      rawEvent: message,
    })
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
      codexThreadId,
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

    if (method === 'turn/started') {
      registerLiveTurn()
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
          codexThreadId,
          status,
        }),
      )
      return
    }

    completeTurn?.()
  }

  const emitActionDiagnosticsTrace = () => {
    if (
      actionDiagnosticsTraceEmitted ||
      !input.onTraceEvent ||
      !actionDiagnostics
    ) {
      return
    }

    const rawEvent = actionDiagnostics.buildTraceEvent({
      codexThreadId,
      providerActionCount,
      turnId,
    })
    if (!rawEvent) {
      return
    }

    actionDiagnosticsTraceEmitted = true
    try {
      input.onTraceEvent({
        codexThreadId: null,
        rawEvent,
        updates: [],
      })
    } catch {
      // Action diagnostics are metadata-only and must not block assistant turns.
    }
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

  const requireLiveTurnIds = (): {
    threadId: string
    turnId: string
  } => {
    if (!liveTurnOpen || !codexThreadId || !turnId) {
      throw buildLiveTurnInactiveError()
    }

    return {
      threadId: codexThreadId,
      turnId,
    }
  }

  const steerLiveTurn = async (
    steerInput: Omit<CodexAppServerSteerInput, 'threadId' | 'turnId'>,
  ): Promise<void> => {
    const liveTurn = requireLiveTurnIds()
    const steerImagePaths = await materializeCodexImagePaths({
      images: steerInput.images,
      tempRoot: input.tempRoot,
    })
    await withCodexRpcTimeout(
      sendRequest(
        'turn/steer',
        buildCodexTurnSteerParams({
          ...liveTurn,
          imagePaths: steerImagePaths,
          prompt: steerInput.prompt,
        }),
      ),
      CODEX_RPC_STEER_TIMEOUT_MS,
      'turn/steer',
    )
  }

  const interruptLiveTurn = async (): Promise<void> => {
    const liveTurn = requireLiveTurnIds()
    await withCodexRpcTimeout(
      sendRequest('turn/interrupt', buildCodexTurnInterruptParams(liveTurn)),
      CODEX_RPC_STEER_TIMEOUT_MS,
      'turn/interrupt',
    )
  }

  const registerLiveTurn = () => {
    if (liveTurnOpen || !input.onLiveTurn || !codexThreadId || !turnId) {
      return
    }

    liveTurnOpen = true
    const cleanup = input.onLiveTurn({
      interrupt: interruptLiveTurn,
      steer: steerLiveTurn,
      threadId: codexThreadId,
      turnId,
    })
    releaseLiveTurn = typeof cleanup === 'function' ? cleanup : () => {}
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
        codexThreadId,
        signal,
        stderr,
      }),
    )
  })

  try {
    await waitForCodexSpawn(child)
    emitAppServerTimingTrace('spawn-ready')
    await withCodexRpcTimeout(
      sendRequest('initialize', {
        clientInfo: {
          name: CODEX_RPC_CLIENT_NAME,
          title: CODEX_RPC_CLIENT_TITLE,
          version: CODEX_RPC_CLIENT_VERSION,
        },
        capabilities: {
          experimentalApi: true,
        },
      }),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'initialize',
    )
    emitAppServerTimingTrace('initialized')
    sendNotification('initialized', {})

    const threadTimingStage = codexThreadId ? 'thread-resumed' : 'thread-started'
    const threadResult = await withCodexRpcTimeout(
      codexThreadId
        ? sendRequest(
            'thread/resume',
            buildCodexThreadResumeParams({
              input,
              codexThreadId,
            }),
          )
        : sendRequest('thread/start', buildCodexThreadStartParams(input)),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      codexThreadId ? 'thread/resume' : 'thread/start',
    )
    codexThreadId = extractCodexThreadIdFromResult(threadResult) ?? codexThreadId
    rolloutRelativePath = resolveCodexRolloutRelativePath({
      codexHome: input.env.CODEX_HOME,
      codexThreadId,
      threadPath: extractCodexThreadPathFromResult(threadResult),
    })
    emitAppServerTimingTrace(threadTimingStage)
    if (!codexThreadId) {
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
          codexThreadId,
        }),
      ),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'turn/start',
    )
    turnId = extractCodexTurnIdFromResult(turnResult) ?? turnId
    emitAppServerTimingTrace('turn-started')
    registerLiveTurn()

    await turnCompleted
    emitActionDiagnosticsTrace()
    emitAppServerTimingTrace('turn-completed')
    closeLiveTurn()
    normalShutdown = true
    await stopCodexAppServerChild({
      child,
      closeStdin: tryCloseCodexStdin,
      processGroupPid,
    })
    emitAppServerTimingTrace('shutdown')
    if (stdinFailure) {
      throw stdinFailure
    }
  } catch (error) {
    emitActionDiagnosticsTrace()
    annotateTurnFailureContext(error)
    closeLiveTurn()
    normalShutdown = true
    await stopCodexAppServerChild({
      child,
      closeStdin: tryCloseCodexStdin,
      processGroupPid,
    }).catch(() => undefined)
    throw error
  } finally {
    closeLiveTurn()
    cleanupAbortListener()
    cleanupProcessExitListener()
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
    rolloutRelativePath,
    sessionId: codexThreadId,
    stderr: stderr.trim(),
    stdout: stdout.trim(),
    threadId: codexThreadId,
    turnId,
  }
}

function resolveCodexRolloutRelativePath(input: {
  codexHome: string | null | undefined
  codexThreadId: string | null
  threadPath: string | null
}): string | null {
  const codexHome = normalizeNullableString(input.codexHome)
  const codexThreadId = normalizeNullableString(input.codexThreadId)
  const threadPath = normalizeNullableString(input.threadPath)
  if (!codexHome || !codexThreadId || !threadPath) {
    return null
  }

  const homeRoot = path.resolve(codexHome)
  const absoluteThreadPath = path.resolve(threadPath)
  const relativePath = path.relative(homeRoot, absoluteThreadPath)
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    return null
  }

  return normalizeCodexRolloutRelativePath(
    relativePath.split(path.sep).join('/'),
    codexThreadId,
  )
}

const codexRolloutRelativePathPattern =
  /^sessions\/(\d{4})\/(\d{2})\/(\d{2})\/rollout-(\d{4})-(\d{2})-(\d{2})T[^/]+-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/u

function normalizeCodexRolloutRelativePath(
  value: string,
  codexThreadId: string,
): string | null {
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\')
  ) {
    return null
  }

  const segments = value.split('/')
  if (segments.some((segment) =>
    segment.length === 0 || segment === '.' || segment === '..',
  )) {
    return null
  }

  const match = codexRolloutRelativePathPattern.exec(value)
  if (
    !match ||
    match[1] !== match[4] ||
    match[2] !== match[5] ||
    match[3] !== match[6] ||
    match[7] !== codexThreadId
  ) {
    return null
  }

  return value
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
