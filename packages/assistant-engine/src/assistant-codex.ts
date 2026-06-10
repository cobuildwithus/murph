import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  HostedExpectedCodexRootProcess,
} from '@murphai/hosted-execution/runtime-control'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import type {
  AssistantResponseMedia,
  AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  CodexNormalizedEvent,
  CodexProgressEvent,
} from './assistant-codex-events.js'
import {
  extractAssistantMessageFallback,
  extractCodexErrorInfo,
  extractCodexErrorMessage,
  extractCodexProgressEventFromNormalized,
  type CodexStructuredErrorInfo,
  extractCodexSessionId,
  extractCodexStatusEventFromStderrLine,
  extractCodexTraceUpdatesFromNormalized,
  extractCodexCurrentChannelProgressTextFromNormalized,
  normalizeCodexEvent,
  normalizeStreamingText,
} from './assistant-codex-events.js'
import {
  buildCodexTurnInterruptParams,
  buildCodexThreadResumeParams,
  buildCodexThreadStartParams,
  buildCodexTurnSteerParams,
  buildCodexTurnStartParams,
  mapCodexAppServerApprovalPolicy,
  mapCodexAppServerSandboxMode,
  resolveSupportedCodexAppServerApprovalPolicy,
} from './assistant-codex/app-server-requests.js'
import {
  createCodexActionDiagnosticsReducer,
} from './assistant-codex/action-diagnostics.js'
import {
  executeMurphDynamicToolRequest,
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
  type CodexProcessExitDiagnostics,
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
  AssistantHostedGeneratedImageUploader,
} from './assistant/execution-context.js'
import type {
  AssistantProviderUsageDraft,
} from './assistant/providers/types.js'
import {
  normalizeAssistantResponseMediaList,
} from './assistant/response-media.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import type {
  AssistantProgressDelivery,
  AssistantProgressDeliverySource,
} from './assistant/turn-progress.js'

export { extractCodexTraceUpdates } from './assistant-codex-events.js'
export { listMurphDynamicToolNames } from './assistant-codex/dynamic-tools.js'
export { resolveCodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexProgressEvent } from './assistant-codex-events.js'
export type { CodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexAppServerImageInput } from './assistant-codex/images.js'

const CODEX_RPC_CLIENT_NAME = 'murph'
const CODEX_RPC_CLIENT_TITLE = 'Murph'
const CODEX_RPC_CLIENT_VERSION = '1.0.0'
const CODEX_RPC_DEFAULT_TIMEOUT_MS = 120_000
const CODEX_RPC_STEER_TIMEOUT_MS = 15_000
const CODEX_APP_SERVER_INTERRUPT_CLEANUP_TIMEOUT_MS = 15_000
const CODEX_PROGRESS_FINAL_DRAIN_TIMEOUT_MS = 2_000
const CODEX_APP_SERVER_COMMAND = 'app-server'
const CODEX_APP_SERVER_TIMING_TRACE_SCHEMA =
  'murph.assistant-codex-app-server-timing.v1'
const CODEX_APP_SERVER_TIMING_TRACE_TYPE =
  'assistant.codex.app_server_timing'
const CODEX_APP_SERVER_STARTUP_STDERR_MAX_LENGTH = 16_384

type CodexAppServerProcessState =
  | 'idle'
  | 'reserved'
  | 'running'
  | 'stopped'
  | 'stopping'

type CodexAppServerProcessInput = {
  args: readonly string[]
  codexCommand: string
  env: NodeJS.ProcessEnv
  launchKey: string
  workingDirectory: string
}

type CodexAppServerPreparedTurnInput = CodexAppServerTurnInput & {
  args: readonly string[]
  codexCommand: string
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  hostedGeneratedImageUploader: AssistantHostedGeneratedImageUploader | null
  imagePaths: readonly string[]
  launchKey: string
  tempRoot: string
  workingDirectory: string
}

type CodexAppServerActiveTurnBinding = {
  onClose(code: number | null, signal: NodeJS.Signals | null): void
  onError(error: Error): void
  onFramingError(line: string): void
  onParsedMessage(message: CodexRpcMessage): void
  onStderrLine(line: string): void
  onStderrText(text: string): void
  onStdinError(error: unknown): VaultCliError | null
  onStdoutText(text: string): void
}

function buildCodexAppServerNotFoundError(codexCommand: string): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_CODEX_NOT_FOUND',
    `Codex app-server executable "${codexCommand}" was not found. Install @openai/codex or pass --codexCommand.`,
  )
}

function normalizeCodexStartupFailure(input: {
  codexCommand: string
  error: unknown
}): Error {
  if (readNodeErrorCode(input.error) === 'ENOENT') {
    return buildCodexAppServerNotFoundError(input.codexCommand)
  }

  return input.error instanceof Error
    ? input.error
    : new VaultCliError(
        'ASSISTANT_CODEX_FAILED',
        'Codex app-server failed during startup.',
        {
          retryable: false,
        },
      )
}

function appendCodexStartupStderr(previous: string, next: string): string {
  const combined = `${previous}${next}`
  return combined.length > CODEX_APP_SERVER_STARTUP_STDERR_MAX_LENGTH
    ? combined.slice(-CODEX_APP_SERVER_STARTUP_STDERR_MAX_LENGTH)
    : combined
}

function resolveCodexAppServerProgressDelivery(
  input: Pick<
    CodexAppServerTurnInput,
    'progressDelivery'
  >,
): AssistantProgressDelivery | null {
  return input.progressDelivery ?? null
}

async function waitForCodexProgressDrain(
  pending: readonly Promise<unknown>[],
): Promise<boolean> {
  if (pending.length === 0) {
    return true
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.allSettled(pending).then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(
          () => resolve(false),
          CODEX_PROGRESS_FINAL_DRAIN_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function resolveCodexCurrentChannelProgressSource(
  normalizedEvent: CodexNormalizedEvent,
): AssistantProgressDeliverySource | null {
  if (
    normalizedEvent.kind === 'assistant_message' &&
    normalizedEvent.itemState === 'completed' &&
    normalizedEvent.messagePhase === 'commentary'
  ) {
    return 'model'
  }

  if (
    normalizedEvent.kind === 'status_item' &&
    normalizedEvent.itemType === 'context.compaction' &&
    normalizedEvent.itemState === 'running'
  ) {
    return 'system'
  }

  return null
}

export interface CodexAppServerTurnInput {
  abortSignal?: AbortSignal
  approvalPolicy?: string
  configOverrides?: readonly string[]
  codexCommand?: string
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  excludeResumeTurns?: boolean
  model?: string | null
  modelProvider?: string | null
  onLiveTurn?: ((turn: CodexAppServerLiveTurn) => void | (() => void)) | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onProviderRequestStarted?: ((event: { startedAt: string }) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  hostedGeneratedImageUploader?: AssistantHostedGeneratedImageUploader | null
  oss?: boolean
  profile?: string | null
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  progressDelivery?: AssistantProgressDelivery | null
  providerRequestOrdinal?: number | null
  requireHostedGeneratedImageUploader?: boolean | null
  workingDirectory: string
}

export interface CodexAppServerTurnFailureContext {
  jsonEvents: unknown[]
  additionalUsages: AssistantProviderUsageDraft[]
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
    additionalUsages: [...context.additionalUsages],
    providerActionCount: context.providerActionCount,
    codexThreadId: context.codexThreadId,
    providerTurnId: context.providerTurnId,
  }
}

export interface CodexAppServerTurnResult {
  finalMessage: string
  additionalUsages: AssistantProviderUsageDraft[]
  responseMedia: AssistantResponseMedia[]
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
  const workingDirectory = path.resolve(input.workingDirectory)
  await assertCodexAppServerWorkingDirectory(workingDirectory)
  const childEnv = await resolveCodexChildEnv({
    codexHome: input.codexHome,
    env: input.env,
  })
  const codexCommand = resolveCodexAppServerCommand(input.codexCommand)
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
  const launchKey = buildCodexAppServerLaunchKey({
    args,
    codexCommand,
    env: childEnv,
    workingDirectory,
  })
  const preparedInput: CodexAppServerPreparedTurnInput = {
    ...normalizedInput,
    args,
    codexCommand,
    env: childEnv,
    fetchImpl: input.fetchImpl ?? fetch,
    hostedGeneratedImageUploader: input.hostedGeneratedImageUploader ?? null,
    imagePaths,
    launchKey,
    tempRoot,
    workingDirectory,
  }

  try {
    const processInstance = await getOrStartWarmCodexProcess(preparedInput)
    try {
      return await runCodexAppServerTurnOnProcess(processInstance, preparedInput)
    } finally {
      clearWarmCodexProcessIfUnusable(processInstance)
    }
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
    })
  }
}

async function assertCodexAppServerWorkingDirectory(
  workingDirectory: string,
): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(workingDirectory)
  } catch {
    throw new VaultCliError(
      'ASSISTANT_CODEX_WORKING_DIRECTORY_MISSING',
      'Codex app-server working directory does not exist.',
      {
        retryable: false,
      },
    )
  }

  if (!stats.isDirectory()) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_WORKING_DIRECTORY_INVALID',
      'Codex app-server working directory is not a directory.',
      {
        retryable: false,
      },
    )
  }
}

function resolveCodexAppServerCommand(
  codexCommand?: string | null,
): string {
  return codexCommand?.trim() || 'codex'
}

function buildCodexAppServerLaunchKey(input: {
  args: readonly string[]
  codexCommand: string
  env: NodeJS.ProcessEnv
  workingDirectory: string
}): string {
  return hashCodexRawString(JSON.stringify({
    args: input.args,
    codexCommand: input.codexCommand,
    env: stableCodexProcessEnv(input.env),
    workingDirectory: input.workingDirectory,
  }))
}

function stableCodexProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

export function buildCodexAppServerArgs(
  input: Pick<
    CodexAppServerTurnInput,
    'approvalPolicy' | 'configOverrides' | 'oss' | 'profile' | 'sandbox'
  >,
): string[] {
  const args: string[] = []

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

class CodexAppServerProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly launchKey: string
  readonly pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  readonly processGroupPid: number | null
  readonly startedAt = Date.now()

  private activeTurn: CodexAppServerActiveTurnBinding | null = null
  private cleanupProcessExitListener: () => void
  private completedTurnCount = 0
  private readonly codexCommand: string
  private ignoredResponseIds = new Set<CodexRpcId>()
  private initialized = false
  private nextRequestId = 1
  private normalShutdown = false
  private poisoned = false
  private stopCompleted = false
  private state: CodexAppServerProcessState = 'idle'
  private stderrBuffer = ''
  private startupStderr = ''
  private startupFailure: Error | null = null
  private stdinFailure: VaultCliError | null = null
  private stdoutBuffer = ''

  constructor(input: CodexAppServerProcessInput) {
    this.codexCommand = input.codexCommand
    this.launchKey = input.launchKey

    const useProcessGroup = process.platform !== 'win32'
    this.child = spawn(input.codexCommand, [...input.args], {
      cwd: input.workingDirectory,
      detached: useProcessGroup,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.processGroupPid = useProcessGroup ? this.child.pid ?? null : null
    this.cleanupProcessExitListener = attachCodexAppServerProcessExitCleanup({
      processGroupPid: this.processGroupPid,
    })

    this.child.stdin.on('error', (error) => {
      void this.handleStdinError(error)
    })
    this.child.on('error', (error) => {
      this.handleProcessError(error)
    })
    this.child.stdout.on('data', (chunk) => {
      this.handleStdoutData(String(chunk))
    })
    this.child.stderr.on('data', (chunk) => {
      this.handleStderrData(String(chunk))
    })
    this.child.on('close', (code, signal) => {
      this.handleClose(code, signal)
    })
  }

  get initializedForRpc(): boolean {
    return this.initialized
  }

  get processLifetimeMs(): number {
    return Math.max(0, Date.now() - this.startedAt)
  }

  get requiresCompleteTurnCorrelation(): boolean {
    return this.completedTurnCount > 0
  }

  get hasInFlightTurn(): boolean {
    return this.state === 'reserved' || this.state === 'running'
  }

  reserveTurn(): void {
    if (
      this.state !== 'idle' ||
      this.activeTurn ||
      this.poisoned ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      throw this.buildBusyError()
    }

    this.state = 'reserved'
  }

  bindTurn(binding: CodexAppServerActiveTurnBinding): void {
    this.throwStartupFailure()
    if (
      (this.state !== 'idle' && this.state !== 'reserved') ||
      this.activeTurn ||
      this.poisoned ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      throw this.buildBusyError()
    }

    this.activeTurn = binding
    this.state = 'running'
  }

  releaseTurn(binding: CodexAppServerActiveTurnBinding): void {
    if (this.activeTurn !== binding) {
      return
    }

    this.activeTurn = null
    if (this.state === 'running') {
      this.state = 'idle'
      this.completedTurnCount += 1
    }
  }

  releaseReservation(): void {
    if (this.state === 'reserved' && !this.activeTurn) {
      this.state = 'idle'
    }
  }

  buildBusyError(
    message = 'Codex app-server process is not idle.',
  ): VaultCliError {
    return new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_BUSY',
      message,
      {
        retryable: true,
        state: this.state,
      },
    )
  }

  async waitForSpawn(): Promise<void> {
    this.throwStartupFailure()
    try {
      await waitForCodexSpawn(this.child)
    } catch (error) {
      const failure =
        this.startupFailure ??
        this.buildSpawnWaitFailure(error)
      this.startupFailure ??= failure
      throw failure
    }
    this.throwStartupFailure()
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await withCodexRpcTimeout(
      this.sendRequest('initialize', {
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
    this.initialized = true
    this.startupStderr = ''
    this.sendNotification('initialized', {})
  }

  readPendingRpcMethod(): string | null {
    const pending = this.pendingRequests.values().next().value
    return pending?.method ?? null
  }

  rejectPending(error: unknown): void {
    rejectPendingCodexRpcRequests(this.pendingRequests, error)
  }

  sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise<unknown>((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        reject,
        resolve,
      })
      const failure = this.writeRpcMessage({
        id,
        method,
        params: stripUndefinedRpcParams(params),
      })
      if (failure) {
        this.pendingRequests.delete(id)
        reject(failure)
      }
    })
  }

  sendNotification(method: string, params: Record<string, unknown>): void {
    void this.writeRpcMessage({
      method,
      params: stripUndefinedRpcParams(params),
    })
  }

  sendUntrackedRequest(method: string, params: Record<string, unknown>): void {
    const id = this.nextRequestId
    this.nextRequestId += 1
    this.ignoredResponseIds.add(id)
    void this.writeRpcMessage({
      id,
      method,
      params: stripUndefinedRpcParams(params),
    })
  }

  consumeIgnoredResponseId(id: CodexRpcId): boolean {
    return this.ignoredResponseIds.delete(id)
  }

  signal(signal: NodeJS.Signals): void {
    signalCodexAppServerChild({
      child: this.child,
      processGroupPid: this.processGroupPid,
      signal,
    })
  }

  async stop(_reason: string): Promise<void> {
    if (this.stopCompleted) {
      return
    }

    this.normalShutdown = true
    this.state = 'stopping'
    let stopped = false
    try {
      await stopCodexAppServerChild({
        child: this.child,
        closeStdin: () => this.closeStdin(),
        processGroupPid: this.processGroupPid,
      })
      stopped = true
    } finally {
      this.activeTurn = null
      this.ignoredResponseIds.clear()
      if (
        stopped ||
        this.child.exitCode !== null ||
        this.child.signalCode !== null
      ) {
        this.cleanupProcessExitListener()
        this.state = 'stopped'
        this.stopCompleted = true
      } else {
        this.poisoned = true
      }
    }
  }

  async poison(reason: string): Promise<void> {
    this.poisoned = true
    if (this.state === 'stopped') {
      return
    }

    await this.stop(reason).catch(() => undefined)
  }

  isReusableFor(launchKey: string): boolean {
    return (
      this.launchKey === launchKey &&
      this.initialized &&
      !this.poisoned &&
      this.state === 'idle' &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
  }

  async snapshotExpectedRootProcess(): Promise<HostedExpectedCodexRootProcess | null> {
    const pid = this.child.pid
    if (
      typeof pid !== 'number' ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      return null
    }

    const procState = await readCodexProcState(pid)
    if (
      !procState?.commandLineDigest ||
      !procState?.startTimeTicksFromProcStat
    ) {
      return null
    }

    return {
      commandLineDigest: procState.commandLineDigest,
      owner: 'codex-app-server',
      pid,
      processGroupId: this.processGroupPid,
      startTimeTicksFromProcStat: procState.startTimeTicksFromProcStat,
      uid: procState.uid,
    }
  }

  private closeStdin(): VaultCliError | null {
    if (this.stdinFailure) {
      return this.stdinFailure
    }

    try {
      this.child.stdin.end()
      return this.stdinFailure
    } catch (error) {
      return this.handleStdinError(error)
    }
  }

  writeRpcMessage(payload: Record<string, unknown>): VaultCliError | null {
    if (this.stdinFailure) {
      return this.stdinFailure
    }

    try {
      writeCodexRpcMessage(this.child, payload)
      return this.stdinFailure
    } catch (error) {
      return this.handleStdinError(error)
    }
  }

  private handleStdinError(error: unknown): VaultCliError | null {
    if (this.normalShutdown && readNodeErrorCode(error) === 'EPIPE') {
      return null
    }

    const failure =
      this.stdinFailure ??
      this.activeTurn?.onStdinError(error) ??
      buildCodexProcessExitError({
        abortRequested: false,
        code: this.child.exitCode,
        diagnostics: this.buildStartupProcessDiagnostics(),
        errorInfo: null,
        fallback: buildCodexStdinFailureFallback({
          error,
          lastEventError: null,
          stderr: this.startupStderr,
        }),
        providerActionCount: 0,
        codexThreadId: null,
        signal: this.child.signalCode ?? null,
        stderr: this.startupStderr,
      })
    this.stdinFailure = failure
    this.poisoned = true
    if (!this.initialized) {
      this.startupFailure ??= failure
    }
    if (!this.activeTurn) {
      this.startupFailure ??= failure
      this.rejectPending(failure)
    }
    return failure
  }

  private handleProcessError(error: Error): void {
    const failure = normalizeCodexStartupFailure({
      codexCommand: this.codexCommand,
      error,
    })
    this.poisoned = true
    if (this.activeTurn) {
      this.activeTurn.onError(failure)
      return
    }

    this.startupFailure ??= failure
    this.rejectPending(failure)
  }

  private handleStdoutData(text: string): void {
    this.activeTurn?.onStdoutText(text)
    this.stdoutBuffer += text
    this.stdoutBuffer = consumeCompleteLines(this.stdoutBuffer, (line) => {
      this.handleStdoutLine(line)
    })
  }

  private handleStderrData(text: string): void {
    if (!this.initialized) {
      this.startupStderr = appendCodexStartupStderr(this.startupStderr, text)
    }
    this.activeTurn?.onStderrText(text)
    this.stderrBuffer += text
    this.stderrBuffer = consumeCompleteLines(this.stderrBuffer, (line) => {
      this.activeTurn?.onStderrLine(line)
    })
  }

  private handleStdoutLine(line: string): void {
    const parsed = tryParseJsonLine(line)
    if (parsed.ok) {
      if (this.activeTurn) {
        this.activeTurn.onParsedMessage(parsed.value)
      } else if (line.trim().length > 0) {
        void this.poison('off-turn-output')
      }
      return
    }

    if (line.trim().length === 0) {
      return
    }

    if (this.activeTurn) {
      this.poisoned = true
      this.activeTurn.onFramingError(line)
      return
    }

    void this.poison('off-turn-framing-error')
  }

  private handleClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.stderrBuffer.trim().length > 0) {
      this.activeTurn?.onStderrLine(this.stderrBuffer)
    }
    this.stderrBuffer = ''

    if (this.stdoutBuffer.trim().length > 0) {
      this.handleStdoutLine(this.stdoutBuffer)
    }
    this.stdoutBuffer = ''

    if (!this.normalShutdown) {
      this.poisoned = true
    }
    this.state = 'stopped'
    this.cleanupProcessExitListener()

    if (this.normalShutdown) {
      return
    }

    if (this.activeTurn) {
      this.activeTurn.onClose(code, signal)
      return
    }

    const failure = buildCodexProcessExitError({
      abortRequested: false,
      code,
      diagnostics: this.buildStartupProcessDiagnostics(),
      errorInfo: null,
      fallback: null,
      providerActionCount: 0,
      codexThreadId: null,
      signal,
      stderr: this.startupStderr,
    })
    this.startupFailure ??= failure
    this.rejectPending(failure)
  }

  private buildStartupProcessDiagnostics(): CodexProcessExitDiagnostics {
    return {
      abortRequested: false,
      jsonEventCount: 0,
      lifecycleStage: 'startup',
      liveTurnOpen: false,
      pendingRpcCount: this.pendingRequests.size,
      pendingRpcMethod: this.readPendingRpcMethod(),
      processGroupPresent: this.processGroupPid !== null,
      processLifetimeMs: this.processLifetimeMs,
      providerRequestStarted: false,
      shutdownRequested: this.normalShutdown,
      stderrBytes: Buffer.byteLength(this.startupStderr, 'utf8'),
      terminationSignalSent: null,
    }
  }

  private buildSpawnWaitFailure(error: unknown): Error {
    const normalized = normalizeCodexStartupFailure({
      codexCommand: this.codexCommand,
      error,
    })
    const spawnClosedBeforeReady =
      normalized instanceof VaultCliError &&
      normalized.context?.codexSpawnClosedBeforeReady === true

    if (
      spawnClosedBeforeReady &&
      (this.child.exitCode !== null || this.child.signalCode !== null)
    ) {
      return buildCodexProcessExitError({
        abortRequested: false,
        code: this.child.exitCode,
        diagnostics: this.buildStartupProcessDiagnostics(),
        errorInfo: null,
        fallback: null,
        providerActionCount: 0,
        codexThreadId: null,
        signal: this.child.signalCode ?? null,
        stderr: this.startupStderr,
      })
    }

    return normalized
  }

  private throwStartupFailure(): void {
    if (this.startupFailure) {
      throw this.startupFailure
    }
  }
}

let warmCodexProcess: CodexAppServerProcess | null = null
let warmCodexSlotLock: Promise<void> = Promise.resolve()

async function withWarmCodexSlotLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = warmCodexSlotLock
  let release!: () => void
  warmCodexSlotLock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function getOrStartWarmCodexProcess(
  input: CodexAppServerProcessInput,
): Promise<CodexAppServerProcess> {
  const launchKey = input.launchKey
  return await withWarmCodexSlotLock(async () => {
    if (warmCodexProcess?.isReusableFor(launchKey)) {
      warmCodexProcess.reserveTurn()
      return warmCodexProcess
    }

    if (warmCodexProcess) {
      if (warmCodexProcess.hasInFlightTurn) {
        throw warmCodexProcess.buildBusyError(
          'Codex app-server process is already serving a turn.',
        )
      }
      await warmCodexProcess.stop('identity-or-health-mismatch')
      warmCodexProcess = null
    }

    warmCodexProcess = new CodexAppServerProcess(input)
    warmCodexProcess.reserveTurn()
    return warmCodexProcess
  })
}

function clearWarmCodexProcessIfUnusable(
  processInstance: CodexAppServerProcess,
): void {
  const launchKey = processInstance.launchKey
  if (
    warmCodexProcess === processInstance &&
    !processInstance.isReusableFor(launchKey) &&
    (processInstance.child.exitCode !== null || processInstance.child.signalCode !== null)
  ) {
    warmCodexProcess = null
  }
}

export async function stopWarmCodexAppServer(
  reason = 'external-stop',
): Promise<void> {
  await withWarmCodexSlotLock(async () => {
    const processInstance = warmCodexProcess
    if (!processInstance) {
      return
    }

    if (processInstance.hasInFlightTurn) {
      throw processInstance.buildBusyError(
        'Codex app-server process is serving a turn and cannot be stopped directly.',
      )
    }

    await processInstance.stop(reason)
    if (warmCodexProcess === processInstance) {
      warmCodexProcess = null
    }
  })
}

export async function snapshotExpectedCodexRootProcess(): Promise<
  HostedExpectedCodexRootProcess | null
> {
  return await withWarmCodexSlotLock(async () => {
    const processInstance = warmCodexProcess
    if (!processInstance?.isReusableFor(processInstance.launchKey)) {
      return null
    }

    return await processInstance.snapshotExpectedRootProcess()
  })
}

function hashCodexRawString(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex')
}

function readCodexEventMethod(message: CodexRpcMessage): string | null {
  return typeof message.method === 'string'
    ? message.method
    : typeof message.type === 'string'
      ? message.type
      : typeof message.event === 'string'
        ? message.event
        : null
}

function codexEventMethodRequiresTurnCorrelation(method: string | null): boolean {
  const normalizedMethod = normalizeNullableString(method)
  if (!normalizedMethod) {
    return true
  }

  return (
    normalizedMethod === 'error' ||
    normalizedMethod === 'thread/compacted' ||
    normalizedMethod === 'thread/tokenUsage/updated' ||
    normalizedMethod === 'thread/token_usage/updated' ||
    normalizedMethod === 'thread.tokenUsage.updated' ||
    normalizedMethod === 'thread.token.usage.updated' ||
    normalizedMethod === 'thread.token_usage.updated' ||
    normalizedMethod.startsWith('turn/') ||
    normalizedMethod.startsWith('item/') ||
    normalizedMethod.startsWith('rawResponseItem/') ||
    normalizedMethod.startsWith('command/exec/') ||
    normalizedMethod.startsWith('process/') ||
    normalizedMethod.startsWith('model/') ||
    normalizedMethod.startsWith('turn.') ||
    normalizedMethod.startsWith('item.') ||
    normalizedMethod.startsWith('rawResponseItem.') ||
    normalizedMethod.startsWith('command.exec.') ||
    normalizedMethod.startsWith('process.') ||
    normalizedMethod.startsWith('model.') ||
    normalizedMethod.includes('assistant.message.delta') ||
    normalizedMethod.includes('agent.message.delta')
  )
}

function isCodexTurnStartedMethod(method: string | null): boolean {
  return method === 'turn/started' || method === 'turn.started'
}

function isCodexTurnCompletedMethod(method: string | null): boolean {
  return method === 'turn/completed' || method === 'turn.completed'
}

async function readCodexProcState(pid: number): Promise<{
  commandLineDigest: string | null
  startTimeTicksFromProcStat: string | null
  uid: number | null
} | null> {
  try {
    const [cmdline, stat, status] = await Promise.all([
      readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => null),
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile(`/proc/${pid}/status`, 'utf8').catch(() => null),
    ])
    return {
      commandLineDigest: cmdline ? hashCodexRawString(cmdline) : null,
      startTimeTicksFromProcStat: readCodexProcStartTimeTicks(stat),
      uid: status ? readCodexProcUid(status) : null,
    }
  } catch {
    return null
  }
}

function readCodexProcStartTimeTicks(stat: string): string | null {
  const commandEnd = stat.lastIndexOf(') ')
  if (commandEnd === -1 || commandEnd + 2 >= stat.length) {
    return null
  }

  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/u)
  const startTime = fields[19]
  return typeof startTime === 'string' && /^[0-9]+$/u.test(startTime)
    ? startTime
    : null
}

function readCodexProcUid(status: string): number | null {
  const uidLine = status.split('\n').find((line) => line.startsWith('Uid:'))
  const uidRaw = uidLine?.trim().split(/\s+/u)[1]
  const uid = Number.parseInt(uidRaw ?? '', 10)
  return Number.isInteger(uid) && uid >= 0 ? uid : null
}

async function runCodexAppServerTurnOnProcess(
  codexProcess: CodexAppServerProcess,
  input: CodexAppServerPreparedTurnInput,
): Promise<CodexAppServerTurnResult> {
  let stdout = ''
  let stderr = ''
  let settled = false
  let normalShutdown = false
  let abortRequested = false
  let lifecycleStage = 'spawn_start'
  let terminationSignalSent: NodeJS.Signals | null = null
  let codexThreadId = normalizeNullableString(input.resumeSessionId) ?? null
  let turnId: string | null = null
  let expectedTurnId: string | null = null
  let lastAgentMessage: string | null = null
  let lastEventError: string | null = null
  let lastEventErrorInfo: CodexStructuredErrorInfo | null = null
  let responseMedia: AssistantResponseMedia[] = []
  const additionalUsages: AssistantProviderUsageDraft[] = []
  let nextDynamicToolUsageOrdinal = (input.providerRequestOrdinal ?? 0) + 1
  let rolloutRelativePath: string | null = null
  let providerActionCount = 0
  const providerActionItemIds = new Set<string>()
  const jsonEvents: unknown[] = []
  const actionDiagnostics = input.onTraceEvent
    ? createCodexActionDiagnosticsReducer()
    : null
  let actionDiagnosticsTraceEmitted = false
  const assistantStreams = new Map<string, string>()
  const assistantStreamOrder: string[] = []
  let stdinFailure: VaultCliError | null = null
  let lastTimingAt = Date.now()
  let liveInterruptRequested = false

  let completeTurn: (() => void) | null = null
  let failTurn: ((error: unknown) => void) | null = null
  let liveTurnOpen = false
  let turnTerminal = false
  let providerRequestStartedNotified = false
  let contextCompactionProgressNotified = false
  let releaseLiveTurn = () => {}
  const pendingProgressDeliveries = new Set<Promise<void>>()
  let dynamicToolExecutionChain: Promise<void> = Promise.resolve()
  const dynamicToolAbortController = new AbortController()
  const pendingPreStartMessages: Array<{
    kind: 'event' | 'server_request'
    message: CodexRpcMessage
    method: string | null
  }> = []
  const turnCompleted = new Promise<void>((resolve, reject) => {
    completeTurn = resolve
    failTurn = reject
  })
  void turnCompleted.catch(() => undefined)
  let cleanupAbortListener = () => {}
  let interruptCleanupTimer: ReturnType<typeof setTimeout> | null = null

  const readPendingRpcMethod = (): string | null => {
    return codexProcess.readPendingRpcMethod()
  }

  const buildProcessExitDiagnostics = (): CodexProcessExitDiagnostics => ({
    abortRequested,
    jsonEventCount: jsonEvents.length,
    lifecycleStage,
    liveTurnOpen,
    pendingRpcCount: codexProcess.pendingRequests.size,
    pendingRpcMethod: readPendingRpcMethod(),
    processGroupPresent: codexProcess.processGroupPid !== null,
    processLifetimeMs: codexProcess.processLifetimeMs,
    providerRequestStarted: providerRequestStartedNotified,
    shutdownRequested: normalShutdown,
    stderrBytes: Buffer.byteLength(stderr, 'utf8'),
    terminationSignalSent,
  })

  const annotateTurnFailureContext = (error: unknown) => {
    if (!error || typeof error !== 'object') {
      return
    }

    const context = {
      jsonEvents: [...jsonEvents],
      additionalUsages: [...additionalUsages],
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

  const clearInterruptCleanupTimer = (): void => {
    if (!interruptCleanupTimer) {
      return
    }

    clearTimeout(interruptCleanupTimer)
    interruptCleanupTimer = null
  }

  const buildInterruptCleanupTimeoutError = (): VaultCliError =>
    new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_INTERRUPT_TIMEOUT',
      'Codex app-server did not finish the interrupted turn.',
      {
        diagnostics: buildProcessExitDiagnostics(),
        interruptCleanupTimeoutMs: CODEX_APP_SERVER_INTERRUPT_CLEANUP_TIMEOUT_MS,
        liveInterruptRequested,
        retryable: true,
      },
    )

  const scheduleInterruptCleanupTimeout = (): void => {
    if (interruptCleanupTimer) {
      return
    }

    interruptCleanupTimer = setTimeout(() => {
      interruptCleanupTimer = null
      lifecycleStage = 'interrupt_timeout_cleanup'
      normalShutdown = true
      rejectOnce(buildInterruptCleanupTimeoutError())
    }, CODEX_APP_SERVER_INTERRUPT_CLEANUP_TIMEOUT_MS)
    interruptCleanupTimer.unref?.()
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
          codexTimingTotalElapsedMs: codexProcess.processLifetimeMs,
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

    clearInterruptCleanupTimer()
    annotateTurnFailureContext(error)
    settled = true
    closeLiveTurn()
    cleanupAbortListener()
    codexProcess.rejectPending(error)
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
    for (const [id, pending] of codexProcess.pendingRequests.entries()) {
      if (
        pending.method !== 'turn/steer' &&
        pending.method !== 'turn/interrupt'
      ) {
        continue
      }
      codexProcess.pendingRequests.delete(id)
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
        code: codexProcess.child.exitCode,
        diagnostics: buildProcessExitDiagnostics(),
        errorInfo: lastEventErrorInfo,
        fallback: buildCodexStdinFailureFallback({
          error,
          lastEventError,
          stderr,
        }),
        providerActionCount,
        codexThreadId,
        signal: codexProcess.child.signalCode ?? null,
        stderr,
      })
    stdinFailure = failure
    rejectOnce(failure)
    return failure
  }

  const tryWriteRpcMessage = (
    payload: Record<string, unknown>,
  ): VaultCliError | null => {
    return codexProcess.writeRpcMessage(payload)
  }

  cleanupAbortListener = attachCodexAbortListener({
    abortSignal: input.abortSignal,
    onAbort: () => {
      abortRequested = true
      if (codexThreadId && turnId) {
        codexProcess.sendUntrackedRequest(
          'turn/interrupt',
          buildCodexTurnInterruptParams({
            threadId: codexThreadId,
            turnId,
          }),
        )
      }
      terminationSignalSent = 'SIGINT'
      codexProcess.signal('SIGINT')
      scheduleInterruptCleanupTimeout()
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

  const notifyProviderRequestStarted = () => {
    if (providerRequestStartedNotified) {
      return
    }
    providerRequestStartedNotified = true
    notifyCodexAppServerProviderRequestStartedBestEffort({
      hook: input.onProviderRequestStarted ?? null,
      startedAt: new Date().toISOString(),
    })
  }

  const notifyCurrentChannelProgress = (
    text: string,
    source: AssistantProgressDeliverySource,
  ) => {
    const progressDelivery = resolveCodexAppServerProgressDelivery(input)
    if (
      !progressDelivery ||
      (source === 'system' && contextCompactionProgressNotified)
    ) {
      return
    }

    if (source === 'system') {
      contextCompactionProgressNotified = true
    }
    trackProgressDelivery(progressDelivery.send(text, { source }))
  }

  const trackProgressDelivery = (promise: Promise<unknown>): void => {
    const tracked = promise
      .catch(() => undefined)
      .then(() => {
        pendingProgressDeliveries.delete(tracked)
      })
    pendingProgressDeliveries.add(tracked)
  }

  const closeProgressDelivery = (): void => {
    resolveCodexAppServerProgressDelivery(input)?.close?.()
  }

  const drainPendingProgressDeliveries = async (): Promise<void> => {
    while (pendingProgressDeliveries.size > 0) {
      const drained = await waitForCodexProgressDrain([
        ...pendingProgressDeliveries,
      ])
      if (!drained) {
        closeProgressDelivery()
        return
      }
    }
  }

  // Media-mutating dynamic tools run serialized in request order so
  // response-media patches apply deterministically even if Codex issues
  // overlapping tool requests.
  const trackDynamicToolExecution = (run: () => Promise<unknown>): void => {
    dynamicToolExecutionChain = dynamicToolExecutionChain
      .then(run)
      .then(
        () => undefined,
        (error) => {
          rejectOnce(error)
        },
      )
  }

  const drainPendingDynamicToolExecutions = async (): Promise<void> => {
    let drained: Promise<void>
    do {
      drained = dynamicToolExecutionChain
      await drained
    } while (drained !== dynamicToolExecutionChain)
  }

  const applyResponseMediaPatch = (patch: {
    media: AssistantResponseMedia[]
    op: 'append' | 'replace'
  }): void => {
    responseMedia = patch.op === 'replace'
      ? patch.media
      : normalizeAssistantResponseMediaList([...responseMedia, ...patch.media])
  }

  const buildUnknownRpcResponseError = (): VaultCliError =>
    new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_LATE_RESPONSE',
      'Codex app-server emitted a response for an unknown request id.',
      {
        retryable: true,
      },
    )

  const buildStaleTurnEventError = (input: {
    eventMethod: string | null
    eventTurnId: string | null
  }): VaultCliError =>
    new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT',
      'Codex app-server emitted an event that does not match the active turn.',
      {
        eventMethod: input.eventMethod,
        eventTurnIdPresent: input.eventTurnId !== null,
        expectedTurnIdPresent: expectedTurnId !== null,
        retryable: true,
      },
    )

  const buildMissingReusedTurnIdError = (): VaultCliError =>
    new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_TURN_ID_MISSING',
      'Codex app-server turn/start response is missing a turn id on a reused warm process.',
      {
        retryable: true,
      },
    )

  const bindExpectedTurnId = (
    candidateTurnId: string | null,
    eventMethod: string | null,
  ): VaultCliError | null => {
    if (!candidateTurnId) {
      return null
    }

    if (expectedTurnId === null) {
      expectedTurnId = candidateTurnId
      return null
    }

    if (candidateTurnId === expectedTurnId) {
      return null
    }

    return buildStaleTurnEventError({
      eventMethod,
      eventTurnId: candidateTurnId,
    })
  }

  const validateWarmTurnEventCorrelation = (
    message: CodexRpcMessage,
    eventMethod: string | null,
  ): VaultCliError | null => {
    const eventTurnId = extractCodexTurnIdFromMessage(message)
    if (
      codexProcess.requiresCompleteTurnCorrelation &&
      expectedTurnId === null &&
      codexEventMethodRequiresTurnCorrelation(eventMethod)
    ) {
      if (eventTurnId) {
        return null
      }

      return buildStaleTurnEventError({
        eventMethod,
        eventTurnId,
      })
    }

    if (eventTurnId) {
      return bindExpectedTurnId(eventTurnId, eventMethod)
    }

    return codexProcess.requiresCompleteTurnCorrelation &&
      codexEventMethodRequiresTurnCorrelation(eventMethod)
      ? buildStaleTurnEventError({
        eventMethod,
        eventTurnId: null,
      })
      : null
  }

  const shouldBufferPreStartWarmMessage = (
    message: CodexRpcMessage,
    eventMethod: string | null,
  ): boolean => {
    return (
      codexProcess.requiresCompleteTurnCorrelation &&
      expectedTurnId === null &&
      codexEventMethodRequiresTurnCorrelation(eventMethod) &&
      extractCodexTurnIdFromMessage(message) !== null
    ) || (
      codexProcess.requiresCompleteTurnCorrelation &&
      expectedTurnId === null &&
      readCodexRpcServerRequestId(message) !== null &&
      extractCodexTurnIdFromMessage(message) !== null
    )
  }

  const acceptJsonEvent = (message: CodexRpcMessage): void => {
    jsonEvents.push(message)
  }

  const handleAcceptedServerRequest = (
    message: CodexRpcMessage,
    requestId: CodexRpcId,
  ): void => {
    acceptJsonEvent(message)

    if (turnTerminal) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'turn already completed',
            },
          ],
        },
      })
      return
    }

    const dynamicToolRequest = readMurphDynamicToolRequest(message)
    if (!dynamicToolRequest) {
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

    const runDynamicTool = () => executeMurphDynamicToolRequest({
      abortSignal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, dynamicToolAbortController.signal])
        : dynamicToolAbortController.signal,
      codexHome: input.codexHome ?? input.env.CODEX_HOME ?? null,
      env: input.env,
      fetchImpl: input.fetchImpl,
      hostedGeneratedImageUploader: input.hostedGeneratedImageUploader,
      nextUsageOrdinal: () => nextDynamicToolUsageOrdinal++,
      progressDelivery: resolveCodexAppServerProgressDelivery(input),
      request: dynamicToolRequest,
      requireHostedGeneratedImageUploader:
        input.requireHostedGeneratedImageUploader ?? false,
    }).then((result) => {
      if (result.usageDraft) {
        additionalUsages.push(result.usageDraft)
      }
      if (result.responseMediaPatch) {
        try {
          applyResponseMediaPatch(result.responseMediaPatch)
        } catch {
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'response media limit reached',
                },
              ],
            },
          })
          return
        }
      }
      void tryWriteRpcMessage({
        id: requestId,
        result: result.rpcResult,
      })
    }).catch(() => {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'dynamic tool failed',
            },
          ],
        },
      })
    })

    if (
      dynamicToolRequest.kind === 'generate-image' ||
      dynamicToolRequest.kind === 'attach-response-media'
    ) {
      trackDynamicToolExecution(runDynamicTool)
    } else {
      // Non-media tools answer immediately; progress sends drain on the
      // bounded progress-delivery path instead of the media tool chain.
      trackProgressDelivery(runDynamicTool())
    }
  }

  const handleAcceptedEvent = (
    message: CodexRpcMessage,
    method: string | null,
  ): void => {
    acceptJsonEvent(message)
    codexThreadId = codexThreadId ?? extractCodexSessionId(message)
    lastEventError = extractCodexErrorMessage(message) ?? lastEventError
    lastEventErrorInfo = extractCodexErrorInfo(message) ?? lastEventErrorInfo
    if (isCodexTurnStartedMethod(method)) {
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

    if (
      normalizedEvent.kind !== 'status_item' ||
      normalizedEvent.itemType !== 'context.compaction'
    ) {
      input.onTraceEvent?.({
        codexThreadId,
        rawEvent: message,
        updates,
      })
    }

    const progressDeliveryText =
      extractCodexCurrentChannelProgressTextFromNormalized(normalizedEvent)
    const progressDeliverySource = progressDeliveryText
      ? resolveCodexCurrentChannelProgressSource(normalizedEvent)
      : null
    if (progressDeliveryText && progressDeliverySource) {
      notifyCurrentChannelProgress(progressDeliveryText, progressDeliverySource)
    }

    const progressEvent = extractCodexProgressEventFromNormalized(normalizedEvent)
    if (progressEvent) {
      if (progressEvent.kind === 'message') {
        lastAgentMessage = progressEvent.text
      }
      input.onProgress?.(progressEvent)
    }

    if (isCodexTurnStartedMethod(method)) {
      notifyProviderRequestStarted()
      registerLiveTurn()
    }

    if (!isCodexTurnCompletedMethod(method)) {
      return
    }

    const status = extractCodexTurnStatus(message)
    if (isFailedCodexTurnStatus(status)) {
      turnTerminal = true
      failTurn?.(
        buildCodexTurnFailedError({
          errorInfo: extractCodexErrorInfo(message) ?? lastEventErrorInfo,
          fallback: lastEventError ?? extractCodexTurnErrorMessage(message),
          providerActionCount,
          codexThreadId,
          status,
        }),
      )
      return
    }

    turnTerminal = true
    completeTurn?.()
  }

  const flushPendingPreStartMessages = (): boolean => {
    while (pendingPreStartMessages.length > 0) {
      const pending = pendingPreStartMessages.shift()!
      const correlationError = validateWarmTurnEventCorrelation(
        pending.message,
        pending.method,
      )
      if (correlationError) {
        rejectOnce(correlationError)
        return false
      }

      if (pending.kind === 'server_request') {
        const requestId = readCodexRpcServerRequestId(pending.message)
        if (requestId === null) {
          rejectOnce(buildUnknownRpcResponseError())
          return false
        }
        handleAcceptedServerRequest(pending.message, requestId)
      } else {
        handleAcceptedEvent(pending.message, pending.method)
      }
    }

    return true
  }

  const handleParsedMessage = (message: CodexRpcMessage) => {
    const responseId = readCodexRpcResponseId(message)
    if (responseId !== null) {
      const pending = codexProcess.pendingRequests.get(responseId)
      const resolveResult = resolvePendingCodexRpcRequest({
        message,
        pendingRequests: codexProcess.pendingRequests,
        responseId,
      })
      if (
        resolveResult === 'unknown_response_id' &&
        !codexProcess.consumeIgnoredResponseId(responseId)
      ) {
        rejectOnce(buildUnknownRpcResponseError())
        return
      }
      if (resolveResult !== 'unknown_response_id') {
        acceptJsonEvent(message)
        if (message.error) {
          return
        }
        if (pending?.method === 'thread/start' || pending?.method === 'thread/resume') {
          codexThreadId = extractCodexThreadIdFromResult(message.result) ?? codexThreadId
        }
        if (pending?.method === 'turn/start') {
          const resultTurnId = extractCodexTurnIdFromResult(message.result)
          if (codexProcess.requiresCompleteTurnCorrelation && !resultTurnId) {
            rejectOnce(buildMissingReusedTurnIdError())
            return
          }
          const correlationError = bindExpectedTurnId(resultTurnId, 'turn/start')
          if (correlationError) {
            rejectOnce(correlationError)
            return
          }
          turnId = resultTurnId ?? turnId
        }
        if (pending?.method === 'turn/start' && !flushPendingPreStartMessages()) {
          return
        }
      }
      return
    }

    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      const requestMethod = typeof message.method === 'string' ? message.method : null
      if (shouldBufferPreStartWarmMessage(message, requestMethod)) {
        pendingPreStartMessages.push({
          kind: 'server_request',
          message,
          method: requestMethod,
        })
        return
      }
      const correlationError = validateWarmTurnEventCorrelation(
        message,
        requestMethod,
      )
      if (correlationError) {
        rejectOnce(correlationError)
        return
      }
      handleAcceptedServerRequest(message, requestId)
      return
    }

    const method = readCodexEventMethod(message)
    if (shouldBufferPreStartWarmMessage(message, method)) {
      pendingPreStartMessages.push({
        kind: 'event',
        message,
        method,
      })
      return
    }

    const correlationError = validateWarmTurnEventCorrelation(message, method)
    if (correlationError) {
      rejectOnce(correlationError)
      return
    }
    handleAcceptedEvent(message, method)
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

  const sendRequest = (
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> => codexProcess.sendRequest(method, params)

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
    liveInterruptRequested = true
    scheduleInterruptCleanupTimeout()
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

  const activeTurnBinding: CodexAppServerActiveTurnBinding = {
    onClose(code, signal) {
      if (normalShutdown || settled) {
        return
      }

      rejectOnce(
        buildCodexProcessExitError({
          abortRequested,
          code,
          diagnostics: buildProcessExitDiagnostics(),
          errorInfo: lastEventErrorInfo,
          fallback: lastEventError,
          providerActionCount,
          codexThreadId,
          signal,
          stderr,
        }),
      )
    },
    onError(error) {
      rejectOnce(
        normalizeCodexStartupFailure({
          codexCommand: input.codexCommand,
          error,
        }),
      )
    },
    onFramingError() {
      rejectOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
          'Codex app-server emitted malformed JSON on stdout.',
          {
            retryable: false,
          },
        ),
      )
    },
    onParsedMessage: handleParsedMessage,
    onStderrLine(line) {
      const progressEvent = extractCodexStatusEventFromStderrLine(line)
      if (progressEvent) {
        input.onProgress?.(progressEvent)
      }
    },
    onStderrText(text) {
      stderr += text
    },
    onStdinError: handleCodexStdinError,
    onStdoutText(text) {
      stdout += text
    },
  }

  try {
    codexProcess.bindTurn(activeTurnBinding)
    if (!codexProcess.initializedForRpc) {
      lifecycleStage = 'spawn_wait'
      await codexProcess.waitForSpawn()
      lifecycleStage = 'initialize'
      emitAppServerTimingTrace('spawn-ready')
      await codexProcess.initialize()
      lifecycleStage = 'initialized'
      emitAppServerTimingTrace('initialized')
    } else {
      lifecycleStage = 'initialized'
      emitAppServerTimingTrace('warm-reused')
    }

    const resumeThreadId = codexThreadId
    const threadTimingStage = resumeThreadId ? 'thread-resumed' : 'thread-started'
    lifecycleStage = resumeThreadId ? 'thread_resume' : 'thread_start'
    const threadResult = await withCodexRpcTimeout(
      resumeThreadId
        ? sendRequest(
            'thread/resume',
            buildCodexThreadResumeParams({
              input,
              codexThreadId: resumeThreadId,
            }),
          )
        : sendRequest('thread/start', buildCodexThreadStartParams(input)),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      resumeThreadId ? 'thread/resume' : 'thread/start',
    )
    if (resumeThreadId) {
      assertCodexResumeContextMatches({
        input,
        requestedThreadId: resumeThreadId,
        threadResult,
      })
    }
    codexThreadId = extractCodexThreadIdFromResult(threadResult) ?? codexThreadId
    rolloutRelativePath = resolveCodexRolloutRelativePath({
      codexHome: input.env.CODEX_HOME,
      codexThreadId,
      threadPath: extractCodexThreadPathFromResult(threadResult),
    })
    emitAppServerTimingTrace(threadTimingStage)
    lifecycleStage = threadTimingStage
    if (!codexThreadId) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_FAILED',
        'Codex app-server did not return a thread id.',
      )
    }

    lifecycleStage = 'turn_start'
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
    lifecycleStage = 'turn_started'
    emitAppServerTimingTrace('turn-started')
    notifyProviderRequestStarted()
    registerLiveTurn()

    lifecycleStage = 'turn_running'
    await turnCompleted
    clearInterruptCleanupTimer()
    await drainPendingDynamicToolExecutions()
    await drainPendingProgressDeliveries()
    emitActionDiagnosticsTrace()
    lifecycleStage = 'turn_completed'
    emitAppServerTimingTrace('turn-completed')
    closeLiveTurn()
    if (abortRequested || terminationSignalSent) {
      normalShutdown = true
      lifecycleStage = 'abort_cleanup'
      await codexProcess.poison('turn-completed-after-abort')
      lifecycleStage = 'shutdown_complete'
      emitAppServerTimingTrace('warm-abort-poisoned')
    } else {
      lifecycleStage = 'idle'
      codexProcess.releaseTurn(activeTurnBinding)
      emitAppServerTimingTrace('warm-idle')
    }
    if (stdinFailure) {
      throw stdinFailure
    }
  } catch (error) {
    emitActionDiagnosticsTrace()
    dynamicToolAbortController.abort()
    await drainPendingDynamicToolExecutions()
    annotateTurnFailureContext(error)
    closeLiveTurn()
    normalShutdown = true
    lifecycleStage = 'error_cleanup'
    await codexProcess.poison('turn-failure').catch(() => undefined)
    throw error
  } finally {
    closeLiveTurn()
    clearInterruptCleanupTimer()
    cleanupAbortListener()
    codexProcess.releaseTurn(activeTurnBinding)
    codexProcess.releaseReservation()
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
    additionalUsages,
    responseMedia,
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

function notifyCodexAppServerProviderRequestStartedBestEffort(input: {
  hook?: ((event: { startedAt: string }) => Promise<void> | void) | null
  startedAt: string
}): void {
  if (!input.hook) {
    return
  }

  try {
    void Promise.resolve(input.hook({ startedAt: input.startedAt })).catch(() => {
      // Provider-start hooks are diagnostic-only and must not block turns.
    })
  } catch {
    // Provider-start hooks are diagnostic-only and must not block turns.
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

// Upstream Codex can rejoin a thread that is still loaded in the warm process
// and ignore resume overrides with only a server-side warning when listeners
// remain attached (codex-rs `thread_processor.rs` `resume_running_thread`).
// The thread/resume response echoes the effective execution context, so this
// echo check is the only client-visible stale-rejoin signal before turn/start.
// Fields with no requested value are skipped; requested fields must echo back.
function assertCodexResumeContextMatches(input: {
  input: CodexAppServerPreparedTurnInput
  requestedThreadId: string
  threadResult: unknown
}): void {
  const result = asCodexRecord(input.threadResult)
  const actualCwd = normalizeNullableString(asCodexString(result?.cwd))
  const checks: [field: string, expected: string | null, actual: string | null][] = [
    [
      'threadId',
      input.requestedThreadId,
      extractCodexThreadIdFromResult(input.threadResult) ?? input.requestedThreadId,
    ],
    [
      'approvalPolicy',
      mapCodexAppServerApprovalPolicy(input.input.approvalPolicy),
      asCodexString(result?.approvalPolicy),
    ],
    ['cwd', input.input.workingDirectory, actualCwd ? path.resolve(actualCwd) : null],
    [
      'model',
      normalizeNullableString(input.input.model),
      normalizeNullableString(asCodexString(result?.model)),
    ],
    [
      'modelProvider',
      normalizeNullableString(input.input.modelProvider),
      normalizeNullableString(asCodexString(result?.modelProvider)),
    ],
    [
      'sandbox',
      mapCodexAppServerSandboxMode(input.input.sandbox) ?? null,
      readCodexResumeSandboxMode(result?.sandbox),
    ],
  ]

  const mismatchedFields = checks
    .filter(([, expected, actual]) => expected !== null && actual !== expected)
    .map(([field]) => field)
  if (mismatchedFields.length === 0) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_RESUME_STALE',
    'Codex app-server resumed the thread with stale execution context.',
    {
      mismatchedFields,
      resumeContextMismatch: true,
      retryable: true,
      staleResume: true,
    },
  )
}

// The deployed Codex app-server echoes sandbox as a SandboxPolicy tagged
// object; an unrecognized shape returns null and fails closed as a stale
// resume, which stays visible through resume-stale trace events.
function readCodexResumeSandboxMode(
  value: unknown,
): 'danger-full-access' | 'read-only' | 'workspace-write' | null {
  switch (asCodexString(asCodexRecord(value)?.type)) {
    case 'dangerFullAccess':
      return 'danger-full-access'
    case 'readOnly':
      return 'read-only'
    case 'workspaceWrite':
      return 'workspace-write'
    default:
      return null
  }
}

function asCodexRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asCodexString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
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
