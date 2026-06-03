import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import type {
  HostedExpectedCodexRootProcess,
} from '@murphai/hosted-execution/runtime-control'
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
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import type {
  AssistantProgressDelivery,
  AssistantProgressDeliveryResult,
  AssistantProgressDeliverySource,
} from './assistant/turn-progress.js'
import {
  isAssistantModelProgressAvailable,
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
const CODEX_PROGRESS_FINAL_DRAIN_TIMEOUT_MS = 2_000
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
const HOSTED_CODEX_APP_SERVER_STABLE_IDENTITY_ENV_NAMES = [
  'ALL_PROXY',
  'CODEX_CA_CERTIFICATE',
  'CODEX_HOME',
  'CURL_CA_BUNDLE',
  'HOME',
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV_MARKER,
  'HOSTED_ASSISTANT_APPROVAL_POLICY',
  'HOSTED_ASSISTANT_MODEL',
  'HOSTED_ASSISTANT_REASONING_EFFORT',
  'HOSTED_ASSISTANT_SANDBOX',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'MURPH_ASSISTANT_SKILLS_ROOT',
  'MURPH_HOSTED_CODEX_MODEL_PROVIDER_ID',
  'NO_PROXY',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'OPENAI_API_KEY',
  'PATH',
  'REQUESTS_CA_BUNDLE',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'VAULT',
] as const
const HOSTED_CODEX_APP_SERVER_REJECTED_CHILD_ENV_NAMES = [
  'MURPH_HOSTED_CODEX_BOUND_USER_ID',
  'MURPH_HOSTED_CODEX_RUNTIME_ATTEMPT_ID',
  'MURPH_HOSTED_CODEX_RUNTIME_LEASE_GENERATION',
  'MURPH_HOSTED_CODEX_RUNTIME_WORKSPACE_VERSION',
] as const

type CodexAppServerProcessState =
  | 'idle'
  | 'running'
  | 'stopped'
  | 'stopping'

type CodexAppServerProcessInput = {
  args: readonly string[]
  codexCommand: string
  commandDigest: string | null
  env: NodeJS.ProcessEnv
  identityDigest: string | null
  workingDirectory: string
}

type CodexAppServerPreparedTurnInput = CodexAppServerTurnInput & {
  args: readonly string[]
  codexCommand: string
  commandDigest: string | null
  env: NodeJS.ProcessEnv
  hostedRuntimeProcess: boolean
  identityDigest: string | null
  imagePaths: readonly string[]
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

function resolveCodexAppServerProgressDelivery(
  input: Pick<
    CodexAppServerTurnInput,
    'modelProgressUpdatesEnabled' | 'progressDelivery'
  >,
): AssistantProgressDelivery | null {
  return isAssistantModelProgressAvailable(input)
    ? input.progressDelivery ?? null
    : null
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

function resolveCodexProgressToolResultText(
  result: AssistantProgressDeliveryResult,
): { success: boolean; text: string } {
  if (result.kind === 'sent') {
    return {
      success: true,
      text: 'progress update sent',
    }
  }

  if (result.kind === 'failed') {
    return {
      success: false,
      text: 'progress update failed during best-effort delivery',
    }
  }

  if (result.reason === 'limit') {
    return {
      success: false,
      text: 'progress update skipped: one progress update was already sent',
    }
  }

  if (result.reason === 'duplicate') {
    return {
      success: false,
      text: 'progress update skipped: duplicate progress update',
    }
  }

  return {
    success: false,
    text: 'progress update skipped: empty progress update',
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
  baseInstructions?: string | null
  developerInstructions?: string | null
  excludeResumeTurns?: boolean
  refreshThreadInstructions?: boolean
  model?: string | null
  modelProvider?: string | null
  modelProgressUpdatesEnabled?: boolean | null
  onLiveTurn?: ((turn: CodexAppServerLiveTurn) => void | (() => void)) | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onProviderRequestStarted?: ((event: { startedAt: string }) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean
  profile?: string | null
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  progressDelivery?: AssistantProgressDelivery | null
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
  const preparedInput: CodexAppServerPreparedTurnInput = {
    ...normalizedInput,
    args,
    codexCommand,
    commandDigest: null,
    env: childEnv,
    hostedRuntimeProcess,
    identityDigest: null,
    imagePaths,
    tempRoot,
    workingDirectory,
  }

  try {
    if (hostedRuntimeProcess) {
      const processIdentity = await buildCodexAppServerProcessIdentity({
        args,
        codexCommand,
        env: childEnv,
        hostedRuntimeProcess,
        workingDirectory,
      })
      const hostedPreparedInput: CodexAppServerPreparedTurnInput = {
        ...preparedInput,
        commandDigest: processIdentity.commandDigest,
        identityDigest: processIdentity.identityDigest,
      }
      const processInstance = await getOrStartHostedWarmCodexProcess(hostedPreparedInput)
      try {
        return await runCodexAppServerTurnOnProcess(processInstance, hostedPreparedInput, {
          keepProcessWarm: true,
        })
      } finally {
        clearHostedWarmCodexProcessIfUnusable(processInstance)
      }
    }

    return await runCodexAppServerTurn(preparedInput)
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
    return resolveHostedCodexAppServerCommand(input.env ?? {})
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
  return isHostedRuntimeProcessEnv(env)
}

function isHostedRuntimeProcessEnv(env: NodeJS.ProcessEnv | undefined): boolean {
  return env?.[HOSTED_RUNTIME_PROCESS_ENV_MARKER]?.trim() === '1'
}

function resolveHostedCodexAppServerCommand(env: NodeJS.ProcessEnv): string {
  const commandOverride = normalizeNullableString(
    env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
  )

  if (
    env.NODE_ENV?.trim() === 'test'
    && commandOverride
    && path.isAbsolute(commandOverride)
  ) {
    return commandOverride
  }

  return HOSTED_CODEX_APP_SERVER_COMMAND
}

function projectHostedCodexAppServerChildEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const codexHome = normalizeNullableString(env.CODEX_HOME)
  const childEnv = { ...env }
  for (const key of HOSTED_CODEX_APP_SERVER_REJECTED_CHILD_ENV_NAMES) {
    delete childEnv[key]
  }

  return {
    ...childEnv,
    ...(codexHome ? { CODEX_HOME: codexHome } : {}),
    [HOSTED_RUNTIME_PROCESS_ENV_MARKER]: '1',
    PATH: HOSTED_RUNNER_EXECUTABLE_PATH,
  }
}

function projectHostedCodexAppServerIdentityEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const projected: NodeJS.ProcessEnv = {}

  for (const key of HOSTED_CODEX_APP_SERVER_STABLE_IDENTITY_ENV_NAMES) {
    const value = env[key]
    if (typeof value === 'string') {
      projected[key] = value
    }
  }

  return projected
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

class CodexAppServerProcess {
  readonly child: ChildProcessWithoutNullStreams
  readonly commandDigest: string | null
  readonly identityDigest: string | null
  readonly pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  readonly processGroupPid: number | null
  readonly startedAt = Date.now()

  private activeTurn: CodexAppServerActiveTurnBinding | null = null
  private cleanupProcessExitListener: () => void
  private ignoredResponseIds = new Set<CodexRpcId>()
  private initialized = false
  private nextRequestId = 1
  private normalShutdown = false
  private poisoned = false
  private stopCompleted = false
  private state: CodexAppServerProcessState = 'idle'
  private stderrBuffer = ''
  private stdinFailure: VaultCliError | null = null
  private stdoutBuffer = ''

  constructor(input: CodexAppServerProcessInput) {
    this.commandDigest = input.commandDigest
    this.identityDigest = input.identityDigest

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

  bindTurn(binding: CodexAppServerActiveTurnBinding): void {
    if (
      this.state !== 'idle' ||
      this.activeTurn ||
      this.poisoned ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_BUSY',
        'Codex app-server process is not idle.',
        {
          retryable: true,
          state: this.state,
        },
      )
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
    }
  }

  async waitForSpawn(): Promise<void> {
    await waitForCodexSpawn(this.child)
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

  isReusableFor(identityDigest: string): boolean {
    return (
      this.identityDigest === identityDigest &&
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
      new VaultCliError(
        'ASSISTANT_CODEX_FAILED',
        'Codex app-server stdin failed.',
        {
          retryable: false,
        },
      )
    this.stdinFailure = failure
    this.poisoned = true
    if (!this.activeTurn) {
      this.rejectPending(failure)
    }
    return failure
  }

  private handleProcessError(error: Error): void {
    this.poisoned = true
    if (this.activeTurn) {
      this.activeTurn.onError(error)
      return
    }

    this.rejectPending(error)
  }

  private handleStdoutData(text: string): void {
    this.activeTurn?.onStdoutText(text)
    this.stdoutBuffer += text
    this.stdoutBuffer = consumeCompleteLines(this.stdoutBuffer, (line) => {
      this.handleStdoutLine(line)
    })
  }

  private handleStderrData(text: string): void {
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

    this.rejectPending(
      new VaultCliError(
        'ASSISTANT_CODEX_FAILED',
        'Codex app-server process exited unexpectedly.',
        {
          retryable: false,
        },
      ),
    )
  }
}

let hostedWarmCodexProcess: CodexAppServerProcess | null = null
let hostedWarmCodexSlotLock: Promise<void> = Promise.resolve()

async function withHostedWarmCodexSlotLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previous = hostedWarmCodexSlotLock
  let release!: () => void
  hostedWarmCodexSlotLock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

async function getOrStartHostedWarmCodexProcess(
  input: CodexAppServerProcessInput,
): Promise<CodexAppServerProcess> {
  const identityDigest = input.identityDigest
  if (!identityDigest) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_IDENTITY_MISSING',
      'Hosted Codex app-server process identity is missing.',
      {
        retryable: false,
      },
    )
  }

  return await withHostedWarmCodexSlotLock(async () => {
    if (hostedWarmCodexProcess?.isReusableFor(identityDigest)) {
      return hostedWarmCodexProcess
    }

    if (hostedWarmCodexProcess) {
      await hostedWarmCodexProcess.stop('identity-or-health-mismatch')
      hostedWarmCodexProcess = null
    }

    hostedWarmCodexProcess = new CodexAppServerProcess(input)
    return hostedWarmCodexProcess
  })
}

function clearHostedWarmCodexProcessIfUnusable(
  processInstance: CodexAppServerProcess,
): void {
  const identityDigest = processInstance.identityDigest
  if (
    hostedWarmCodexProcess === processInstance &&
    (!identityDigest || !processInstance.isReusableFor(identityDigest)) &&
    (processInstance.child.exitCode !== null || processInstance.child.signalCode !== null)
  ) {
    hostedWarmCodexProcess = null
  }
}

export async function stopHostedWarmCodexAppServer(
  reason = 'external-stop',
): Promise<void> {
  await withHostedWarmCodexSlotLock(async () => {
    const processInstance = hostedWarmCodexProcess
    if (!processInstance) {
      return
    }

    await processInstance.stop(reason)
    if (hostedWarmCodexProcess === processInstance) {
      hostedWarmCodexProcess = null
    }
  })
}

export async function snapshotExpectedHostedCodexRootProcess(): Promise<
  HostedExpectedCodexRootProcess | null
> {
  return await withHostedWarmCodexSlotLock(async () => {
    const processInstance = hostedWarmCodexProcess
    const identityDigest = processInstance?.identityDigest
    if (!identityDigest || !processInstance?.isReusableFor(identityDigest)) {
      return null
    }

    return await processInstance.snapshotExpectedRootProcess()
  })
}

async function buildCodexAppServerProcessIdentity(input: {
  args: readonly string[]
  codexCommand: string
  env: NodeJS.ProcessEnv
  hostedRuntimeProcess: boolean
  workingDirectory: string
}): Promise<{
  commandDigest: string
  identityDigest: string
}> {
  const commandIdentity = {
    args: input.args,
    codexCommand: input.codexCommand,
  }
  const configTomlDigest = await readCodexConfigTomlDigest(input.env.CODEX_HOME)
  const identityEnv = input.hostedRuntimeProcess
    ? projectHostedCodexAppServerIdentityEnv(input.env)
    : input.env
  const identity = {
    ...commandIdentity,
    codexHome: normalizeNullableString(input.env.CODEX_HOME),
    configTomlDigest,
    envDigest: hashStableCodexIdentity(identityEnv),
    hostedRuntimeProcess: input.hostedRuntimeProcess,
    hostedCommandOverride:
      normalizeNullableString(input.env[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV]),
    workingDirectory: input.workingDirectory,
  }

  return {
    commandDigest: hashStableCodexIdentity(commandIdentity),
    identityDigest: hashStableCodexIdentity(identity),
  }
}

async function readCodexConfigTomlDigest(
  codexHome: string | undefined,
): Promise<string | null> {
  const normalized = normalizeNullableString(codexHome)
  if (!normalized) {
    return null
  }

  try {
    return hashStableCodexIdentity(
      await readFile(path.join(normalized, 'config.toml'), 'utf8'),
    )
  } catch {
    return null
  }
}

function hashStableCodexIdentity(value: unknown): string {
  return createHash('sha256')
    .update(stableCodexIdentityStringify(value))
    .digest('hex')
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

function stableCodexIdentityStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableCodexIdentityStringify(entry)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) =>
      `${JSON.stringify(key)}:${stableCodexIdentityStringify(record[key])}`,
    )
    .join(',')}}`
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

async function runCodexAppServerTurn(
  input: CodexAppServerPreparedTurnInput,
): Promise<CodexAppServerTurnResult> {
  const processInstance = new CodexAppServerProcess(input)
  return await runCodexAppServerTurnOnProcess(processInstance, input, {
    keepProcessWarm: false,
  })
}

async function runCodexAppServerTurnOnProcess(
  codexProcess: CodexAppServerProcess,
  input: CodexAppServerPreparedTurnInput,
  options: {
    keepProcessWarm: boolean
  },
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

  let completeTurn: (() => void) | null = null
  let failTurn: ((error: unknown) => void) | null = null
  let liveTurnOpen = false
  let providerRequestStartedNotified = false
  let contextCompactionProgressNotified = false
  let releaseLiveTurn = () => {}
  const pendingProgressDeliveries = new Set<Promise<void>>()
  const turnCompleted = new Promise<void>((resolve, reject) => {
    completeTurn = resolve
    failTurn = reject
  })
  void turnCompleted.catch(() => undefined)
  let cleanupAbortListener = () => {}

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
    if (!options.keepProcessWarm) {
      return null
    }

    const eventTurnId = extractCodexTurnIdFromMessage(message)
    if (eventTurnId) {
      return bindExpectedTurnId(eventTurnId, eventMethod)
    }

    return codexEventMethodRequiresTurnCorrelation(eventMethod)
      ? buildStaleTurnEventError({
        eventMethod,
        eventTurnId: null,
      })
      : null
  }

  const handleParsedMessage = (message: CodexRpcMessage) => {
    jsonEvents.push(message)

    const responseId = readCodexRpcResponseId(message)
    if (responseId !== null) {
      const pending = codexProcess.pendingRequests.get(responseId)
      if (pending?.method === 'thread/start' || pending?.method === 'thread/resume') {
        codexThreadId = extractCodexThreadIdFromResult(message.result) ?? codexThreadId
      }
      if (pending?.method === 'turn/start') {
        const resultTurnId = extractCodexTurnIdFromResult(message.result)
        const correlationError = bindExpectedTurnId(resultTurnId, 'turn/start')
        if (correlationError) {
          rejectOnce(correlationError)
          return
        }
        turnId = resultTurnId ?? turnId
      }
      const resolveResult = resolvePendingCodexRpcRequest({
        message,
        pendingRequests: codexProcess.pendingRequests,
        responseId,
      })
      if (
        resolveResult === 'unknown_response_id' &&
        !codexProcess.consumeIgnoredResponseId(responseId)
      ) {
        if (options.keepProcessWarm) {
          rejectOnce(buildUnknownRpcResponseError())
        }
      }
      return
    }

    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      const requestMethod = typeof message.method === 'string' ? message.method : null
      const requestTurnId = extractCodexTurnIdFromMessage(message)
      if (requestTurnId) {
        const correlationError = validateWarmTurnEventCorrelation(message, requestMethod)
        if (correlationError) {
          rejectOnce(correlationError)
          return
        }
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

      const correlationError = requestTurnId
        ? null
        : validateWarmTurnEventCorrelation(message, requestMethod)
      if (correlationError) {
        rejectOnce(correlationError)
        return
      }

      const progressDelivery = resolveCodexAppServerProgressDelivery(input)
      if (!progressDelivery) {
        void tryWriteRpcMessage({
          id: requestId,
          result: {
            success: false,
            contentItems: [
              {
                type: 'inputText',
                text: 'progress updates are not available for this turn',
              },
            ],
          },
        })
        return
      }

      const progressToolResponse = progressDelivery
        .send(dynamicToolRequest.text, { source: 'model' })
        .then((progressResult) => {
          const toolResult = resolveCodexProgressToolResultText(progressResult)
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: toolResult.success,
              contentItems: [
                {
                  type: 'inputText',
                  text: toolResult.text,
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
                  text: 'progress update failed during best-effort delivery',
                },
              ],
            },
          })
        })
      trackProgressDelivery(progressToolResponse)
      return
    }

    codexThreadId = codexThreadId ?? extractCodexSessionId(message)
    lastEventError = extractCodexErrorMessage(message) ?? lastEventError
    const method = readCodexEventMethod(message)
    const correlationError = validateWarmTurnEventCorrelation(message, method)
    if (correlationError) {
      rejectOnce(correlationError)
      return
    }
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

    if (method === 'turn/started') {
      notifyProviderRequestStarted()
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
          fallback: lastEventError,
          providerActionCount,
          codexThreadId,
          signal,
          stderr,
        }),
      )
    },
    onError(error) {
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
  codexProcess.bindTurn(activeTurnBinding)

  try {
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

    const threadTimingStage = codexThreadId ? 'thread-resumed' : 'thread-started'
    lifecycleStage = codexThreadId ? 'thread_resume' : 'thread_start'
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
    await drainPendingProgressDeliveries()
    emitActionDiagnosticsTrace()
    lifecycleStage = 'turn_completed'
    emitAppServerTimingTrace('turn-completed')
    closeLiveTurn()
    if (options.keepProcessWarm) {
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
    } else {
      normalShutdown = true
      lifecycleStage = 'shutdown'
      await codexProcess.stop('turn-completed')
      lifecycleStage = 'shutdown_complete'
      emitAppServerTimingTrace('shutdown')
    }
    if (stdinFailure) {
      throw stdinFailure
    }
  } catch (error) {
    emitActionDiagnosticsTrace()
    annotateTurnFailureContext(error)
    closeLiveTurn()
    normalShutdown = true
    lifecycleStage = 'error_cleanup'
    await (options.keepProcessWarm
      ? codexProcess.poison('turn-failure')
      : codexProcess.stop('turn-failure')
    ).catch(() => undefined)
    throw error
  } finally {
    closeLiveTurn()
    cleanupAbortListener()
    codexProcess.releaseTurn(activeTurnBinding)
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
