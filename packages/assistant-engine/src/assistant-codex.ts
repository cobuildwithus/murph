import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  HostedExpectedCodexRootProcess,
} from '@murphai/hosted-execution/runtime-control'
import type {
  HostedCodexAuthAction,
} from '@murphai/hosted-execution/contracts'
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
  extractCodexCompletedFinalAgentMessageTextFromNormalized,
  extractCodexProgressEventFromNormalized,
  isCodexCompletedUserMessageItemFromNormalized,
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
  buildRuntimeIssueInputForFailedCodexAction,
  createCodexActionDiagnosticsReducer,
} from './assistant-codex/action-diagnostics.js'
import {
  executeMurphDynamicToolRequest,
  isComputerDynamicToolRequest,
  type MurphDynamicToolFinalActionPatch,
  type MurphDynamicToolReactionPatch,
  type MurphDynamicToolRequest,
  readMurphDynamicToolRequest,
} from './assistant-codex/dynamic-tools.js'
import type {
  VoiceMemoToolRuntime,
} from './assistant-codex/generate-voice-memo-tool.js'
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
  withHostedCodexModelCatalogConfigOverride,
} from './assistant-codex/config.js'
import {
  buildCodexProcessExitError,
  buildCodexStdinFailureFallback,
  buildCodexTurnFailedError,
  type CodexProcessExitDiagnostics,
  extractCodexThreadIdFromMessage,
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
  type CodexSubagentTokenUsageSample,
  extractCodexSubagentUsageDrafts,
  isAssistantCodexTokenUsageEventType,
  readCodexCollabReceiverThreadIds,
} from './assistant/providers/helpers.js'
import {
  materializeCodexImagePaths,
  type CodexAppServerImageInput,
} from './assistant-codex/images.js'
import type {
  AssistantHostedGeneratedImageUploader,
} from './assistant/execution-context.js'
import type {
  AssistantHostedToolContext,
} from './assistant/hosted-tool-context.js'
import type {
  AssistantNoReplyDisposition,
  AssistantProviderDynamicTool,
  AssistantProviderServiceTier,
  AssistantProviderUsageDraft,
} from './assistant/providers/types.js'
import type {
  AssistantRuntimeIssueInput,
} from './assistant/issue-reporting.js'
import {
  normalizeAssistantResponseMediaList,
} from './assistant/response-media.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import type {
  AssistantProgressDelivery,
  AssistantProgressDeliveryResult,
  AssistantProgressDeliverySource,
  AssistantTurnProductFeedbackRecorder,
} from './assistant/turn-progress.js'

export { extractCodexTraceUpdates } from './assistant-codex-events.js'
export {
  listMurphDynamicToolNames,
  resolveMurphDynamicTools,
} from './assistant-codex/dynamic-tools.js'
export { resolveCodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexProgressEvent } from './assistant-codex-events.js'
export type { CodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexAppServerImageInput } from './assistant-codex/images.js'
export type {
  VoiceMemoToolRuntime,
} from './assistant-codex/generate-voice-memo-tool.js'

const CODEX_RPC_CLIENT_NAME = 'murph'
const CODEX_RPC_CLIENT_TITLE = 'Murph'
const CODEX_RPC_CLIENT_VERSION = '1.0.0'
const CODEX_RPC_DEFAULT_TIMEOUT_MS = 120_000
const CODEX_RPC_STEER_TIMEOUT_MS = 15_000
const CODEX_APP_SERVER_INTERRUPT_CLEANUP_TIMEOUT_MS = 15_000
const CODEX_MANAGED_ACCOUNT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const CODEX_PROGRESS_FINAL_DRAIN_TIMEOUT_MS = 2_000
const CODEX_APP_SERVER_COMMAND = 'app-server'
const CODEX_APP_SERVER_TIMING_TRACE_SCHEMA =
  'murph.assistant-codex-app-server-timing.v1'
const CODEX_APP_SERVER_TIMING_TRACE_TYPE =
  'assistant.codex.app_server_timing'
const CODEX_APP_SERVER_STARTUP_STDERR_MAX_LENGTH = 16_384
// Bound on distinct subagent threads whose token usage is tracked per parent
// turn. Far above any sane spawn fan-out; threads past the cap are counted
// and surfaced via droppedSubagentUsageThreadCount on recorded drafts.
const MAX_CODEX_SUBAGENT_USAGE_THREADS = 32

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
  publicInternetFetch: typeof fetch | null
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

// Last thread/tokenUsage/updated observed on the warm process. `last` is the
// final provider request's usage, so `lastInputTokens` approximates the
// current thread context size without any extra RPC or model call.
export interface CodexWarmThreadTokenUsage {
  lastInputTokens: number
  serviceTier: AssistantProviderServiceTier | null
  threadId: string
}

function prepareCodexRpcParams(
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = stripUndefinedRpcParams(params)
  if (
    method === 'turn/start' &&
    Object.hasOwn(params, 'serviceTier') &&
    params.serviceTier === null
  ) {
    stripped.serviceTier = null
  }
  return stripped
}

// The 0.135 app-server reports compaction completion to v2 clients as a
// contextCompaction item; `thread/compacted` is the legacy fan-out kept for
// protocol drift tolerance.
function isCodexContextCompactionStarted(message: CodexRpcMessage): boolean {
  const method = typeof message.method === 'string' ? message.method : null
  if (method !== 'item/started' && method !== 'item.started') {
    return false
  }

  return asCodexRecord(asCodexRecord(message.params)?.item)?.type === 'contextCompaction'
}

function readCodexContextCompactionItemId(message: CodexRpcMessage): string | null {
  return normalizeNullableString(
    asCodexString(asCodexRecord(asCodexRecord(message.params)?.item)?.id),
  )
}

function isCodexContextCompactionStartedForThread(
  message: CodexRpcMessage,
  threadId: string,
): boolean {
  if (!isCodexContextCompactionStarted(message)) {
    return false
  }

  const messageThreadId = extractCodexThreadIdFromMessage(message)
  return messageThreadId === null || messageThreadId === threadId
}

function isCodexLegacyContextCompactionCompletion(message: CodexRpcMessage): boolean {
  const method = typeof message.method === 'string' ? message.method : null
  return method === 'thread/compacted' || method === 'thread.compacted'
}

function isCodexContextCompactionCompletion(message: CodexRpcMessage): boolean {
  if (isCodexLegacyContextCompactionCompletion(message)) {
    return true
  }
  const method = typeof message.method === 'string' ? message.method : null
  if (method !== 'item/completed' && method !== 'item.completed') {
    return false
  }

  return asCodexRecord(asCodexRecord(message.params)?.item)?.type === 'contextCompaction'
}

function isCodexContextCompactionCompletionForThread(
  message: CodexRpcMessage,
  threadId: string,
): boolean {
  if (!isCodexContextCompactionCompletion(message)) {
    return false
  }

  const messageThreadId = extractCodexThreadIdFromMessage(message)
  return messageThreadId === null || messageThreadId === threadId
}

function isCodexThreadTokenUsageUpdatedMethod(method: string | null): boolean {
  return (
    method === 'thread/tokenUsage/updated' ||
    method === 'thread/token_usage/updated' ||
    method === 'thread.tokenUsage.updated' ||
    method === 'thread.token.usage.updated' ||
    method === 'thread.token_usage.updated'
  )
}

function readCodexThreadTokenUsageUpdate(message: CodexRpcMessage): {
  last: Record<string, unknown> | null
  threadId: string | null
} | null {
  const method = typeof message.method === 'string' ? message.method : null
  if (!isCodexThreadTokenUsageUpdatedMethod(method)) {
    return null
  }

  const params = asCodexRecord(message.params)
  return {
    last: asCodexRecord(asCodexRecord(params?.tokenUsage)?.last),
    threadId: typeof params?.threadId === 'string' ? params.threadId : null,
  }
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

function resolveCodexAppServerHostedToolContext(
  input: Pick<
    CodexAppServerTurnInput,
    'hostedToolContext'
  >,
): AssistantHostedToolContext | null {
  return input.hostedToolContext ?? null
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
  allowFinishWithoutReply?: boolean | null
  allowMessageReactions?: boolean | null
  abortSignal?: AbortSignal
  approvalPolicy?: string
  configOverrides?: readonly string[]
  codexCommand?: string
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  dynamicTools: readonly AssistantProviderDynamicTool[]
  excludeResumeTurns?: boolean
  model?: string | null
  modelProvider?: string | null
  onLiveTurn?: ((turn: CodexAppServerLiveTurn) => void | (() => void)) | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onCodexThreadHistoryUnsafe?: ((event?: {
    deliveryContextOrdinal?: number
  }) => Promise<void> | void) | null
  onFinishWithoutReplyAccepted?: ((event: {
    deliveryContextOrdinal: number
  }) => Promise<void> | void) | null
  onProviderRequestStarted?: ((event: { startedAt: string }) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  hostedGeneratedImageUploader?: AssistantHostedGeneratedImageUploader | null
  productFeedbackRecorder?: AssistantTurnProductFeedbackRecorder | null
  oss?: boolean
  profile?: string | null
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  // Sent on every turn/start: a value selects the tier, null explicitly
  // resets a sticky thread-level override back to the default tier.
  serviceTier?: AssistantProviderServiceTier | null
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  providerRequestOrdinal?: number | null
  publicInternetFetch?: typeof fetch | null
  requireHostedGeneratedImageUploader?: boolean | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
  workingDirectory: string
}

export interface CodexAppServerTurnFailureContext {
  jsonEvents: unknown[]
  additionalUsages: AssistantProviderUsageDraft[]
  providerActionCount: number
  runtimeIssueInputs: readonly AssistantRuntimeIssueInput[]
  acceptedNoReplyDeliveryContextOrdinals: readonly number[]
  reactions: readonly {
    deliveryContextOrdinal: number
    reaction: MurphDynamicToolReactionPatch['reaction']
  }[]
  codexThreadHistoryUnsafe: boolean
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
    runtimeIssueInputs: [...context.runtimeIssueInputs],
    acceptedNoReplyDeliveryContextOrdinals: [
      ...context.acceptedNoReplyDeliveryContextOrdinals,
    ],
    reactions: (context.reactions ?? []).map((entry) => ({ ...entry })),
    codexThreadHistoryUnsafe: context.codexThreadHistoryUnsafe,
    codexThreadId: context.codexThreadId,
    providerTurnId: context.providerTurnId,
  }
}

export interface CodexAppServerTurnResult {
  finalMessage: string
  acceptedNoReplyDeliveryContextOrdinals: readonly number[]
  codexThreadHistoryUnsafe: boolean
  finalAction: AssistantNoReplyDisposition | null
  finalActionExplicit: boolean
  reactions: readonly {
    deliveryContextOrdinal: number
    reaction: MurphDynamicToolReactionPatch['reaction']
  }[]
  // Completed final-phase agent messages that were followed by a steered user
  // message and later superseded by another final message in the same turn, in
  // completion order. Empty unless the turn was steered after the model had
  // already finished an answer.
  precedingAgentMessageSegments: readonly CodexAppServerResponseSegment[]
  additionalUsages: AssistantProviderUsageDraft[]
  responseMedia: AssistantResponseMedia[]
  jsonEvents: unknown[]
  providerActionCount: number
  runtimeIssueInputs: readonly AssistantRuntimeIssueInput[]
  rolloutRelativePath: string | null
  sessionId: string | null
  stderr: string
  stdout: string
  threadId: string | null
  turnId: string | null
}

export interface CodexAppServerResponseSegment {
  deliveryContextOrdinal?: number
  media: AssistantResponseMedia[]
  response: string
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
    configOverrides: withHostedCodexModelCatalogConfigOverride({
      configOverrides: input.configOverrides,
      env: input.env,
    }),
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
    publicInternetFetch: input.publicInternetFetch ?? null,
    tempRoot,
    voiceMemoRuntime: input.voiceMemoRuntime ?? null,
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
  private boundThreadId: string | null = null
  private boundThreadServiceTier: AssistantProviderServiceTier | null = null
  private cleanupProcessExitListener: () => void
  private completedTurnCount = 0
  private lastThreadTokenUsage: CodexWarmThreadTokenUsage | null = null
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
  private stopPromise: Promise<void> | null = null

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
        params: prepareCodexRpcParams(method, params),
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
      params: prepareCodexRpcParams(method, params),
    })
  }

  sendUntrackedRequest(method: string, params: Record<string, unknown>): void {
    const id = this.nextRequestId
    this.nextRequestId += 1
    this.ignoredResponseIds.add(id)
    void this.writeRpcMessage({
      id,
      method,
      params: prepareCodexRpcParams(method, params),
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

  async stop(reason: string): Promise<void> {
    if (this.stopCompleted) {
      return
    }
    // Memoized so detached kills (idle-compaction abort) and a racing turn's
    // replacement stop share one teardown instead of double-signaling; an
    // unsuccessful teardown clears the memo so later callers retry, matching
    // the pre-memoization semantics.
    this.stopPromise ??= this.runStop(reason).finally(() => {
      if (!this.stopCompleted) {
        this.stopPromise = null
      }
    })
    await this.stopPromise
  }

  private async runStop(_reason: string): Promise<void> {
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

  get warmThreadTokenUsage(): CodexWarmThreadTokenUsage | null {
    return this.lastThreadTokenUsage
  }

  private observeThreadTokenUsage(message: CodexRpcMessage): void {
    // Any compaction (in-turn auto-compact included) invalidates the retained
    // thread size: the compact request's own tokenUsage reports the large
    // pre-compact context, so keeping it would buy one wasted idle re-compact.
    if (isCodexContextCompactionCompletion(message)) {
      const messageThreadId = extractCodexThreadIdFromMessage(message)
      if (
        messageThreadId !== null &&
        this.boundThreadId !== null &&
        messageThreadId !== this.boundThreadId
      ) {
        return
      }
      this.lastThreadTokenUsage = null
      return
    }

    const update = readCodexThreadTokenUsageUpdate(message)
    const lastInputTokens =
      typeof update?.last?.inputTokens === 'number' ? update.last.inputTokens : null
    if (!update?.threadId || lastInputTokens === null) {
      return
    }
    // Subagent threads emit tokenUsage on this connection too; vitals must
    // only ever describe the bound (member) thread or idle compaction could
    // target a child thread.
    if (this.boundThreadId !== null && update.threadId !== this.boundThreadId) {
      return
    }

    this.lastThreadTokenUsage = {
      lastInputTokens,
      serviceTier: this.boundThreadServiceTier,
      threadId: update.threadId,
    }
  }

  // The most recent thread this process ran a turn for. Used between turns
  // to tell subagent-thread notifications apart from same-thread output
  // contamination, which must still poison the warm process.
  noteBoundThreadId(threadId: string | null): void {
    if (threadId) {
      this.boundThreadId = threadId
    }
  }

  noteBoundThreadServiceTier(serviceTier: AssistantProviderServiceTier | null): void {
    this.boundThreadServiceTier = serviceTier
  }

  // Exposed so a freshly bound turn can route foreign-thread events before
  // its own thread/start response has produced the new thread id.
  get lastBoundThreadId(): string | null {
    return this.boundThreadId
  }

  // Subagent threads can outlive the parent turn: codex broadcasts their
  // thread-scoped notifications on this connection even when no turn is
  // active. Tolerate (and never bill) those between turns; deny their server
  // requests so the child does not hang. Idle output for the bound thread
  // keeps poisoning so the contamination guard is unchanged.
  shouldTolerateIdleSubagentMessage(message: CodexRpcMessage): boolean {
    const messageThreadId = extractCodexThreadIdFromMessage(message)
    if (
      messageThreadId === null ||
      this.boundThreadId === null ||
      messageThreadId === this.boundThreadId
    ) {
      return false
    }

    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      void this.writeRpcMessage({
        id: requestId,
        error: {
          code: -32000,
          message: 'Server requests from codex subagent threads are not supported.',
        },
      })
    }
    return true
  }

  private handleStdoutLine(line: string): void {
    const parsed = tryParseJsonLine(line)
    if (parsed.ok) {
      this.observeThreadTokenUsage(parsed.value)
      if (this.activeTurn) {
        this.activeTurn.onParsedMessage(parsed.value)
      } else if (
        line.trim().length > 0 &&
        !this.shouldTolerateIdleSubagentMessage(parsed.value)
      ) {
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

export interface CodexManagedAccountDeviceCode {
  userCode: string
  verificationUrl: string
}

export interface CodexManagedAccountOperationInput {
  action: HostedCodexAuthAction
  abortSignal?: AbortSignal | null
  codexCommand?: string | null
  codexHome?: string | null
  env?: NodeJS.ProcessEnv
  onDeviceCode?: ((deviceCode: CodexManagedAccountDeviceCode) => Promise<void> | void) | null
  timeoutMs?: number | null
  workingDirectory: string
}

export type CodexManagedAccountOperationResult =
  | { kind: 'connected' }
  | { kind: 'disconnected' }

/**
 * Runs one managed ChatGPT account operation through the same app-server
 * transport used by turns. The child is intentionally short lived: account
 * notifications must never leak into the idle warm-turn process, and only one
 * process may write CODEX_HOME at a time.
 */
export async function executeCodexManagedAccountOperation(
  input: CodexManagedAccountOperationInput,
): Promise<CodexManagedAccountOperationResult> {
  const workingDirectory = path.resolve(input.workingDirectory)
  await assertCodexAppServerWorkingDirectory(workingDirectory)
  const env = await resolveCodexChildEnv({
    codexHome: input.codexHome,
    env: input.env,
  })
  const codexCommand = resolveCodexAppServerCommand(input.codexCommand)
  const args = buildCodexAppServerArgs({})
  const launchKey = buildCodexAppServerLaunchKey({
    args,
    codexCommand,
    env,
    workingDirectory,
  })

  await stopWarmCodexAppServer('managed-account-operation')
  const processInstance = await getOrStartWarmCodexProcess({
    args,
    codexCommand,
    env,
    launchKey,
    workingDirectory,
  })

  let settleAccountUpdate!: () => void
  let rejectAccountUpdate!: (error: unknown) => void
  const accountUpdate = new Promise<void>((resolve, reject) => {
    settleAccountUpdate = resolve
    rejectAccountUpdate = reject
  })
  void accountUpdate.catch(() => undefined)
  let settleCompletion!: (success: boolean) => void
  let rejectCompletion!: (error: unknown) => void
  const completion = new Promise<boolean>((resolve, reject) => {
    settleCompletion = resolve
    rejectCompletion = reject
  })
  void completion.catch(() => undefined)
  let expectedLoginId: string | null = null
  let acceptChatGptAccountUpdate = false
  let bufferedChatGptAccountUpdate = false
  const bufferedCompletions = new Map<string, boolean>()

  const binding: CodexAppServerActiveTurnBinding = {
    onClose(code, signal) {
      const error = new VaultCliError(
        'ASSISTANT_CODEX_AUTH_PROCESS_EXITED',
        'Codex app-server exited during ChatGPT account authentication.',
        {
          code,
          retryable: true,
          signal,
        },
      )
      rejectCompletion(error)
      rejectAccountUpdate(error)
    },
    onError(error) {
      rejectCompletion(error)
      rejectAccountUpdate(error)
    },
    onFramingError() {
      const error = new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_FRAMING_ERROR',
        'Codex app-server emitted malformed JSON during account authentication.',
        { retryable: false },
      )
      rejectCompletion(error)
      rejectAccountUpdate(error)
    },
    onParsedMessage(message) {
      const responseId = readCodexRpcResponseId(message)
      if (responseId !== null) {
        const resolved = resolvePendingCodexRpcRequest({
          message,
          pendingRequests: processInstance.pendingRequests,
          responseId,
        })
        if (
          resolved === 'unknown_response_id'
          && !processInstance.consumeIgnoredResponseId(responseId)
        ) {
          const error = new VaultCliError(
            'ASSISTANT_CODEX_APP_SERVER_PROTOCOL_ERROR',
            'Codex app-server returned an unexpected response during account authentication.',
            { retryable: false },
          )
          rejectCompletion(error)
          rejectAccountUpdate(error)
        }
        return
      }

      const requestId = readCodexRpcServerRequestId(message)
      if (requestId !== null) {
        denyUnsupportedCodexServerRequest({
          message,
          requestId,
          writeRpcMessage: (payload) => processInstance.writeRpcMessage(payload),
        })
        return
      }

      const eventMethod = readCodexEventMethod(message)
      if (eventMethod === 'account/updated') {
        const params = asCodexRecord(message.params)
        if (asCodexString(params?.authMode) !== 'chatgpt') {
          return
        }
        if (!acceptChatGptAccountUpdate) {
          return
        }
        if (expectedLoginId === null) {
          bufferedChatGptAccountUpdate = true
        } else {
          settleAccountUpdate()
        }
        return
      }

      if (eventMethod !== 'account/login/completed') {
        return
      }
      const params = asCodexRecord(message.params)
      const loginId = asCodexString(params?.loginId)
      const success = params?.success === true
      if (!loginId) {
        return
      }
      if (loginId === expectedLoginId) {
        settleCompletion(success)
      } else {
        bufferedCompletions.set(loginId, success)
      }
    },
    onStderrLine: () => {},
    onStderrText: () => {},
    onStdinError(error) {
      rejectCompletion(error)
      rejectAccountUpdate(error)
      return null
    },
    onStdoutText: () => {},
  }

  const onAbort = () => {
    const error = new VaultCliError(
      'ASSISTANT_CODEX_AUTH_ABORTED',
      'ChatGPT account authentication was interrupted.',
      { retryable: true },
    )
    rejectCompletion(error)
    rejectAccountUpdate(error)
  }

  try {
    processInstance.bindTurn(binding)
    input.abortSignal?.addEventListener('abort', onAbort, { once: true })
    if (input.abortSignal?.aborted) {
      onAbort()
    }
    await processInstance.waitForSpawn()
    await processInstance.initialize()

    if (input.action === 'disconnect') {
      await withCodexRpcTimeout(
        processInstance.sendRequest('account/logout', {}),
        CODEX_RPC_DEFAULT_TIMEOUT_MS,
        'account/logout',
      ).catch(() => undefined)
      return { kind: 'disconnected' }
    }

    if (isCodexChatGptAccountReadResult(await readCodexManagedAccount(processInstance))) {
      return { kind: 'connected' }
    }

    acceptChatGptAccountUpdate = true
    const startResult = asCodexRecord(await withCodexRpcTimeout(
      processInstance.sendRequest('account/login/start', {
        type: 'chatgptDeviceCode',
      }),
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'account/login/start',
    ))
    const loginId = asCodexString(startResult?.loginId)
    const verificationUrl = asCodexString(startResult?.verificationUrl)
    const userCode = asCodexString(startResult?.userCode)
    if (
      startResult?.type !== 'chatgptDeviceCode'
      || !loginId
      || !verificationUrl
      || !userCode
    ) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_AUTH_PROTOCOL_ERROR',
        'Codex app-server returned an invalid ChatGPT device-code response.',
        { retryable: false },
      )
    }

    expectedLoginId = loginId
    const buffered = bufferedCompletions.get(loginId)
    if (buffered !== undefined) {
      settleCompletion(buffered)
    }
    if (bufferedChatGptAccountUpdate) {
      settleAccountUpdate()
    }
    await input.onDeviceCode?.({ userCode, verificationUrl })

    const succeeded = await withCodexRpcTimeout(
      completion,
      normalizeCodexManagedAccountTimeout(input.timeoutMs),
      'account/login/completed',
    )
    if (!succeeded) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_AUTH_FAILED',
        'ChatGPT account authentication did not complete successfully.',
        { retryable: false },
      )
    }
    await withCodexRpcTimeout(
      accountUpdate,
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'account/updated',
    )
    if (!isCodexChatGptAccountReadResult(await readCodexManagedAccount(processInstance))) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_AUTH_FAILED',
        'Codex app-server completed authentication without a ChatGPT account.',
        { retryable: false },
      )
    }
    return { kind: 'connected' }
  } finally {
    input.abortSignal?.removeEventListener('abort', onAbort)
    processInstance.releaseTurn(binding)
    processInstance.releaseReservation()
    await processInstance.stop('managed-account-operation-complete').catch(() => undefined)
    await withWarmCodexSlotLock(async () => {
      if (warmCodexProcess === processInstance) {
        warmCodexProcess = null
      }
    })
  }
}

async function readCodexManagedAccount(
  processInstance: CodexAppServerProcess,
): Promise<unknown> {
  return await withCodexRpcTimeout(
    processInstance.sendRequest('account/read', { refreshToken: false }),
    CODEX_RPC_DEFAULT_TIMEOUT_MS,
    'account/read',
  )
}

function isCodexChatGptAccountReadResult(value: unknown): boolean {
  const record = asCodexRecord(value)
  const account = asCodexRecord(record?.account) ?? record
  return asCodexString(account?.type) === 'chatgpt'
}

function normalizeCodexManagedAccountTimeout(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : CODEX_MANAGED_ACCOUNT_LOGIN_TIMEOUT_MS
}

export interface CodexWarmThreadCompactionUsage {
  cachedInputTokens: number | null
  inputTokens: number
  outputTokens: number | null
  source: 'estimated' | 'provider'
  totalTokens: number
}

function estimateCodexWarmThreadCompactionUsage(
  threadContextTokensBefore: number,
): CodexWarmThreadCompactionUsage {
  // Codex 0.135 compact_remote_v2 consumes the provider response without
  // surfacing ResponseEvent::Completed.token_usage, then emits a recomputed
  // post-compact context-size update whose request input/output buckets are
  // zero. Until Codex surfaces real compact request usage, store the
  // pre-compact thread context as an explicit lower-bound input/total estimate
  // so idle compaction spend is not recorded as 0/0/0.
  return {
    cachedInputTokens: null,
    inputTokens: threadContextTokensBefore,
    outputTokens: null,
    source: 'estimated',
    totalTokens: threadContextTokensBefore,
  }
}

function readCodexCompactionCompletionProviderUsage(
  message: CodexRpcMessage,
  threadId: string,
): CodexWarmThreadCompactionUsage | null {
  if (!isCodexContextCompactionCompletionForThread(message, threadId)) {
    return null
  }

  const params = asCodexRecord(message.params)
  const item = asCodexRecord(params?.item)
  const candidates = [
    ...readCodexProviderUsageCandidates(params),
    ...readCodexProviderUsageCandidates(item),
  ]

  for (const candidate of candidates) {
    const usage = readCodexCompactionProviderUsage(candidate)
    if (usage) {
      return usage
    }
  }

  return null
}

function readCodexProviderUsageCandidates(
  value: Record<string, unknown> | null,
): readonly (Record<string, unknown> | null)[] {
  if (!value) {
    return []
  }
  const providerUsage = asCodexRecord(value.providerUsage)
    ?? asCodexRecord(value.provider_usage)
  return [providerUsage, asCodexRecord(providerUsage?.last)]
}

function readCodexCompactionProviderUsage(
  value: Record<string, unknown> | null,
): CodexWarmThreadCompactionUsage | null {
  if (!value) {
    return null
  }

  const inputTokens = readCodexUsageNumber(value, 'inputTokens', 'input_tokens')
  const outputTokens = readCodexUsageNumber(value, 'outputTokens', 'output_tokens')
  const totalTokens = readCodexUsageNumber(value, 'totalTokens', 'total_tokens')
  if (inputTokens === null || outputTokens === null || totalTokens === null) {
    return null
  }
  if (inputTokens <= 0 || outputTokens < 0 || totalTokens < inputTokens + outputTokens) {
    return null
  }
  const cachedInputTokens = readCodexUsageNumber(
    value,
    'cachedInputTokens',
    'cached_input_tokens',
  )
  if (cachedInputTokens !== null && cachedInputTokens > inputTokens) {
    return null
  }

  return {
    cachedInputTokens,
    inputTokens,
    outputTokens,
    source: 'provider',
    totalTokens,
  }
}

function readCodexUsageNumber(
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): number | null {
  const raw = value[camelKey] ?? value[snakeKey]
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
    ? raw
    : null
}

export type CodexWarmThreadCompactionOutcome =
  | {
      kind: 'compacted'
      durationMs: number
      threadContextTokensBefore: number
      threadId: string
      serviceTier: AssistantProviderServiceTier | null
      usage: CodexWarmThreadCompactionUsage
    }
  | {
      kind: 'failed'
      reason: 'aborted' | 'process_exit' | 'rpc_error' | 'timeout'
      threadContextTokensBefore: number
      threadId: string
    }
  | {
      kind: 'skipped'
      reason: 'below_threshold' | 'no_thread_vitals' | 'no_warm_process' | 'turn_in_flight'
      threadContextTokensBefore: number | null
    }

// Non-turn compaction of the warm Codex thread, for idle-time maintenance.
// Modeled on the other warm-slot lifecycle exports above. Failure handling is
// deliberately blunt: any non-success poisons (kills) the warm process, which
// is always safe because rollouts only contain completed entries — an aborted
// compact leaves the thread uncompacted and the next turn spawns a fresh
// process and resumes natively. A pending wake therefore never waits on the
// in-flight provider call or the compact timeout; it is bounded only by the
// old process's kill teardown (SIGTERM, 3s ceiling, then SIGKILL — typically
// milliseconds), which the next turn must join via the memoized stop because
// two app-server processes must never write the same rollout concurrently.
export async function compactWarmCodexThread(input: {
  minThreadTokens: number
  signal?: AbortSignal | null
  timeoutMs: number
}): Promise<CodexWarmThreadCompactionOutcome> {
  const reservation = await withWarmCodexSlotLock(async () => {
    const processInstance = warmCodexProcess
    if (!processInstance || !processInstance.isReusableFor(processInstance.launchKey)) {
      return processInstance?.hasInFlightTurn
        ? ({ kind: 'skipped', reason: 'turn_in_flight', threadContextTokensBefore: null } as const)
        : ({ kind: 'skipped', reason: 'no_warm_process', threadContextTokensBefore: null } as const)
    }

    const vitals = processInstance.warmThreadTokenUsage
    if (!vitals) {
      return { kind: 'skipped', reason: 'no_thread_vitals', threadContextTokensBefore: null } as const
    }
    if (vitals.lastInputTokens < input.minThreadTokens) {
      return {
        kind: 'skipped',
        reason: 'below_threshold',
        threadContextTokensBefore: vitals.lastInputTokens,
      } as const
    }

    processInstance.reserveTurn()
    return { kind: 'reserved', processInstance, vitals } as const
  })
  if (reservation.kind !== 'reserved') {
    return reservation
  }

  const { processInstance, vitals } = reservation
  const startedAt = Date.now()
  let compactRequestSubmitted = false
  let compactRequestAccepted = false
  let compactStartedItemId: string | null = null
  let compactCompletionBuffered = false
  let providerUsage: CodexWarmThreadCompactionUsage | null = null
  type CompactionSettleReason = 'aborted' | 'compacted' | 'process_exit' | 'rpc_error' | 'timeout'
  let compactionSettleReason: CompactionSettleReason | null = null
  let resolveCompaction!: (reason: CompactionSettleReason) => void
  const compactionSettled = new Promise<CompactionSettleReason>((resolve) => {
    resolveCompaction = resolve
  })
  const settleCompaction = (reason: CompactionSettleReason): void => {
    if (compactionSettleReason !== null) {
      return
    }
    compactionSettleReason = reason
    resolveCompaction(reason)
  }

  const binding: CodexAppServerActiveTurnBinding = {
    onClose: () => settleCompaction('process_exit'),
    onError: () => settleCompaction('rpc_error'),
    onFramingError: () => settleCompaction('rpc_error'),
    onParsedMessage: (message) => {
      const responseId = readCodexRpcResponseId(message)
      if (responseId !== null) {
        const pending = processInstance.pendingRequests.get(responseId)
        const resolveResult = resolvePendingCodexRpcRequest({
          message,
          pendingRequests: processInstance.pendingRequests,
          responseId,
        })
        if (resolveResult === 'unknown_response_id') {
          processInstance.consumeIgnoredResponseId(responseId)
        }
        if (
          resolveResult !== 'unknown_response_id' &&
          pending?.method === 'thread/compact/start' &&
          !message.error
        ) {
          compactRequestAccepted = true
          if (compactCompletionBuffered) {
            settleCompaction('compacted')
          }
        }
        return
      }

      if (processInstance.shouldTolerateIdleSubagentMessage(message)) {
        return
      }

      const update = readCodexThreadTokenUsageUpdate(message)
      if (update) {
        return
      }

      if (
        compactRequestSubmitted &&
        isCodexContextCompactionStartedForThread(message, vitals.threadId)
      ) {
        const itemId = readCodexContextCompactionItemId(message)
        if (itemId !== null && compactStartedItemId === null) {
          compactStartedItemId = itemId
        }
        return
      }

      if (!isCodexContextCompactionCompletionForThread(message, vitals.threadId)) {
        return
      }
      if (isCodexLegacyContextCompactionCompletion(message)) {
        if (!compactRequestAccepted) {
          return
        }
        providerUsage = readCodexCompactionCompletionProviderUsage(message, vitals.threadId)
          ?? providerUsage
        settleCompaction('compacted')
        return
      }
      if (compactRequestSubmitted) {
        const itemId = readCodexContextCompactionItemId(message)
        // The v2 protocol pairs item/completed with an item/started id. Without
        // that id a same-thread delayed completion from an earlier compact is
        // indistinguishable from this request, so modern item completions fail
        // closed. Legacy no-id completions are handled above.
        if (compactStartedItemId === null || itemId !== compactStartedItemId) {
          return
        }
        providerUsage = readCodexCompactionCompletionProviderUsage(message, vitals.threadId)
          ?? providerUsage
        if (compactRequestAccepted) {
          settleCompaction('compacted')
        } else {
          compactCompletionBuffered = true
        }
      }
    },
    onStderrLine: () => {},
    onStderrText: () => {},
    onStdinError: () => {
      settleCompaction('rpc_error')
      return null
    },
    onStdoutText: () => {},
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const onAbort = () => settleCompaction('aborted')
  try {
    processInstance.bindTurn(binding)
    processInstance
      .sendRequest('config/read', { includeLayers: false })
      .then(() => {
        if (compactionSettleReason !== null) {
          return undefined
        }
        if (input.signal?.aborted) {
          settleCompaction('aborted')
          return undefined
        }
        compactRequestSubmitted = true
        return processInstance.sendRequest('thread/compact/start', { threadId: vitals.threadId })
      })
      .catch(() => settleCompaction('rpc_error'))
    timeoutHandle = setTimeout(() => settleCompaction('timeout'), input.timeoutMs)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) {
      settleCompaction('aborted')
    }

    const settledReason = await compactionSettled
    if (settledReason === 'compacted') {
      // Vitals were cleared by the stdout observer when the compaction item
      // completed, so a repeat idle pass skips with no_thread_vitals instead
      // of re-compacting; the next turn's tokenUsage events repopulate them.
      return {
        kind: 'compacted',
        durationMs: Date.now() - startedAt,
        threadContextTokensBefore: vitals.lastInputTokens,
        threadId: vitals.threadId,
        serviceTier: vitals.serviceTier,
        usage: providerUsage
          ?? estimateCodexWarmThreadCompactionUsage(vitals.lastInputTokens),
      }
    }

    // Abort (pending wake or shutdown) detaches teardown: poison() flags the
    // process unusable synchronously and SIGTERM->SIGKILL completes out of
    // band; a racing turn joins it via the memoized stop (3s ceiling,
    // typically milliseconds) and never waits on the provider call or the
    // compact timeout. Non-abort failures (timeout/rpc_error/process_exit)
    // have no wake racing and an idle checkpoint next, so they await
    // teardown — the snapshot must never capture a rollout mid-teardown.
    if (settledReason === 'aborted') {
      void processInstance.poison('idle-compaction-failed')
    } else {
      await processInstance.poison('idle-compaction-failed')
    }
    return {
      kind: 'failed',
      reason: settledReason,
      threadContextTokensBefore: vitals.lastInputTokens,
      threadId: vitals.threadId,
    }
  } catch {
    await processInstance.poison('idle-compaction-failed')
    return {
      kind: 'failed',
      reason: 'rpc_error',
      threadContextTokensBefore: vitals.lastInputTokens,
      threadId: vitals.threadId,
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
    input.signal?.removeEventListener('abort', onAbort)
    processInstance.releaseTurn(binding)
    processInstance.releaseReservation()
    await withWarmCodexSlotLock(async () => {
      clearWarmCodexProcessIfUnusable(processInstance)
    })
  }
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
    isCodexThreadTokenUsageUpdatedMethod(normalizedMethod) ||
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
  // Completed final-phase agent messages that were followed by a steered
  // user-message item and then superseded by a newer final message in the
  // same turn. A closed segment is held as a candidate until a later final
  // appears; if the turn ends at the steer boundary, that segment remains the
  // final reply rather than a preceding duplicate.
  const precedingAgentMessageSegments: CodexAppServerResponseSegment[] = []
  let completedFinalAgentMessage: string | null = null
  let trailingSteerCandidate: CodexAppServerResponseSegment | null = null
  let trailingSteerCandidateDeliveryContextOrdinal: number | null = null
  let trailingSteerCandidateMedia: AssistantResponseMedia[] | null = null
  let completedUserMessageOrdinal = -1
  let lastEventError: string | null = null
  let lastEventErrorInfo: CodexStructuredErrorInfo | null = null
  let responseMedia: AssistantResponseMedia[] = []
  let finalActionPatches: Array<{
    deliveryContextOrdinal: number
    patch: MurphDynamicToolFinalActionPatch
  }> = []
  let reactionPatches: Array<{
    deliveryContextOrdinal: number
    patch: MurphDynamicToolReactionPatch
  }> = []
  const reservedNoReplyDeliveryContextOrdinals = new Set<number>()
  const additionalUsages: AssistantProviderUsageDraft[] = []
  let nextDynamicToolUsageOrdinal = (input.providerRequestOrdinal ?? 0) + 1
  const subagentTokenUsageByThread =
    new Map<string, CodexSubagentTokenUsageSample>()
  const subagentDroppedUsageThreadIds = new Set<string>()
  // Thread ids named by this turn's collab tool calls (spawn/sendInput/...),
  // collected live so evidenced subagent threads win buffer slots over
  // stale/unattributed foreign threads when the cap is reached.
  const collabReceiverThreadIds = new Set<string>()
  let rolloutRelativePath: string | null = null
  let providerActionCount = 0
  const providerActionItemIds = new Set<string>()
  const jsonEvents: unknown[] = []
  const runtimeIssueInputs: AssistantRuntimeIssueInput[] = []
  let computerToolsLockedAfterUserPause = false
  const actionDiagnostics = input.onTraceEvent
    ? createCodexActionDiagnosticsReducer()
    : null
  let actionDiagnosticsTraceEmitted = false
  const assistantStreams = new Map<string, string>()
  const assistantStreamOrder: string[] = []
  const externallyVisibleAssistantOutputDeliveryContexts = new Set<number>()
  const pendingExternallyVisibleAssistantOutputDeliveryContextCounts =
    new Map<number, number>()
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

  // Subagent usage drafts are derived lazily from the buffered per-thread
  // samples so both the success result and the failure context can include
  // whatever child usage was observed before the turn settled.
  const buildSubagentUsageDrafts = (): AssistantProviderUsageDraft[] =>
    extractCodexSubagentUsageDrafts({
      droppedThreadCount: subagentDroppedUsageThreadIds.size,
      modelProvider: normalizeNullableString(input.modelProvider) ?? null,
      ordinalStart: nextDynamicToolUsageOrdinal,
      parentRawEvents: jsonEvents,
      serviceTier: input.serviceTier ?? null,
      subagentTokenUsageByThread,
    })

  const hasNoReplyFinalActionPatch = (): boolean =>
    finalActionPatches.some((entry) => entry.patch.kind === 'none')

  const listNoReplyFinalActionPatchOrdinals = (): number[] =>
    [...new Set(
      finalActionPatches
        .filter((entry) => entry.patch.kind === 'none')
        .map((entry) => entry.deliveryContextOrdinal),
    )].sort((left, right) => left - right)

  const annotateTurnFailureContext = (error: unknown) => {
    if (!error || typeof error !== 'object') {
      return
    }

    const context = {
      jsonEvents: [...jsonEvents],
      additionalUsages: [...additionalUsages, ...buildSubagentUsageDrafts()],
      providerActionCount,
      runtimeIssueInputs: [...runtimeIssueInputs],
      acceptedNoReplyDeliveryContextOrdinals:
        listNoReplyFinalActionPatchOrdinals(),
      reactions: reactionPatches.map((entry) => ({
        deliveryContextOrdinal: entry.deliveryContextOrdinal,
        reaction: entry.patch.reaction,
      })),
      codexThreadHistoryUnsafe: hasNoReplyFinalActionPatch(),
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

  const pushRuntimeIssueInput = (issue: AssistantRuntimeIssueInput): void => {
    if (runtimeIssueInputs.length >= 8) {
      return
    }

    runtimeIssueInputs.push(issue)
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

  const currentDeliveryContextOrdinal = (): number =>
    Math.max(0, completedUserMessageOrdinal)

  const normalizeAssistantTraceStreamKey = (
    update: AssistantProviderTraceUpdate,
  ): string =>
    normalizeNullableString(update.streamKey) ?? 'assistant:main'

  const isVisibleAssistantTraceUpdate = (
    update: AssistantProviderTraceUpdate,
  ): boolean =>
    update.kind === 'assistant' &&
    normalizeStreamingText(update.text) !== null

  const markExternallyVisibleAssistantOutput = (
    deliveryContextOrdinal: number,
  ): void => {
    externallyVisibleAssistantOutputDeliveryContexts.add(deliveryContextOrdinal)
  }

  const addPendingExternallyVisibleAssistantOutput = (
    deliveryContextOrdinal: number,
  ): (() => void) => {
    pendingExternallyVisibleAssistantOutputDeliveryContextCounts.set(
      deliveryContextOrdinal,
      (pendingExternallyVisibleAssistantOutputDeliveryContextCounts.get(
        deliveryContextOrdinal,
      ) ?? 0) + 1,
    )
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      const current =
        pendingExternallyVisibleAssistantOutputDeliveryContextCounts.get(
          deliveryContextOrdinal,
        ) ?? 0
      if (current <= 1) {
        pendingExternallyVisibleAssistantOutputDeliveryContextCounts.delete(
          deliveryContextOrdinal,
        )
        return
      }
      pendingExternallyVisibleAssistantOutputDeliveryContextCounts.set(
        deliveryContextOrdinal,
        current - 1,
      )
    }
  }

  const hasPendingExternallyVisibleAssistantOutput = (
    deliveryContextOrdinal: number,
  ): boolean =>
    (pendingExternallyVisibleAssistantOutputDeliveryContextCounts.get(
      deliveryContextOrdinal,
    ) ?? 0) > 0

  const recordAssistantTraceUpdate = (
    update: AssistantProviderTraceUpdate,
    deliveryContextOrdinal: number,
  ) => {
    if (update.kind !== 'assistant') {
      return
    }

    const normalizedText = normalizeStreamingText(update.text)
    if (!normalizedText) {
      return
    }

    const streamKey = normalizeAssistantTraceStreamKey(update)
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

  const trackExternallyVisibleProgressDelivery = (input: {
    deliveryContextOrdinal: number
    promise: Promise<AssistantProgressDeliveryResult>
  }): Promise<void> => {
    const releasePending = addPendingExternallyVisibleAssistantOutput(
      input.deliveryContextOrdinal,
    )
    return input.promise
      .then((result) => {
        if (result.kind === 'sent') {
          markExternallyVisibleAssistantOutput(input.deliveryContextOrdinal)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        releasePending()
      })
  }

  const notifyCurrentChannelProgress = (
    deliveryContextOrdinal: number,
    text: string,
    source: AssistantProgressDeliverySource,
  ): boolean => {
    const progressDelivery = resolveCodexAppServerProgressDelivery(input)
    if (
      !progressDelivery ||
      (source === 'system' && contextCompactionProgressNotified)
    ) {
      return false
    }

    if (source === 'system') {
      contextCompactionProgressNotified = true
    }
    let progressPromise: Promise<AssistantProgressDeliveryResult>
    try {
      progressPromise = progressDelivery.send(text, { source })
    } catch {
      return false
    }
    trackProgressDelivery(
      trackExternallyVisibleProgressDelivery({
        deliveryContextOrdinal,
        promise: progressPromise,
      }),
    )
    return true
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

  // Stateful dynamic tools run serialized in request order so response media,
  // final-action patches, and computer pause barriers apply deterministically
  // even if Codex issues overlapping tool requests.
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

  const canApplyNoReplyPatch = (deliveryContextOrdinal: number): boolean => {
    if (
      externallyVisibleAssistantOutputDeliveryContexts.has(deliveryContextOrdinal) ||
      hasPendingExternallyVisibleAssistantOutput(deliveryContextOrdinal)
    ) {
      return false
    }
    if (
      trailingSteerCandidate !== null &&
      trailingSteerCandidateDeliveryContextOrdinal !== null &&
      trailingSteerCandidateDeliveryContextOrdinal < deliveryContextOrdinal
    ) {
      return false
    }
    if (
      precedingAgentMessageSegments.some((segment) =>
        typeof segment.deliveryContextOrdinal !== 'number' ||
        segment.deliveryContextOrdinal < deliveryContextOrdinal
      )
    ) {
      return false
    }
    return true
  }

  const reserveNoReplyDeliveryContext = (
    deliveryContextOrdinal: number,
  ): (() => void) => {
    reservedNoReplyDeliveryContextOrdinals.add(deliveryContextOrdinal)
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      if (
        !finalActionPatches.some(
          (action) =>
            action.deliveryContextOrdinal === deliveryContextOrdinal &&
            action.patch.kind === 'none',
        )
      ) {
        reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
      }
    }
  }

  const applyFinalActionPatch = async (
    patch: MurphDynamicToolFinalActionPatch,
    deliveryContextOrdinal: number,
  ): Promise<boolean> => {
    if (patch.kind === 'none' && !canApplyNoReplyPatch(deliveryContextOrdinal)) {
      return false
    }

    if (
      finalActionPatches.some(
        (action) => action.deliveryContextOrdinal === deliveryContextOrdinal,
      )
    ) {
      return true
    }

    let reservedNoReply = false
    try {
      if (patch.kind === 'none') {
        reserveNoReplyDeliveryContext(deliveryContextOrdinal)
        reservedNoReply = true
        await input.onFinishWithoutReplyAccepted?.({
          deliveryContextOrdinal,
        })
      }
      finalActionPatches = [
        ...finalActionPatches,
        {
          deliveryContextOrdinal,
          patch,
        },
      ]
      if (patch.kind === 'none') {
        reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
        await input.onCodexThreadHistoryUnsafe?.({
          deliveryContextOrdinal,
        })
      }
      return true
    } catch (error) {
      if (
        reservedNoReply &&
        !finalActionPatches.some(
          (action) => action.deliveryContextOrdinal === deliveryContextOrdinal,
        )
      ) {
        reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
      }
      throw error
    }
  }

  const resolveFinalActionPatch = (
    deliveryContextOrdinal: number,
  ): MurphDynamicToolFinalActionPatch | null =>
    finalActionPatches.find(
      (action) => action.deliveryContextOrdinal === deliveryContextOrdinal,
    )?.patch ?? null

  const shouldSuppressDeliveryContext = (
    deliveryContextOrdinal?: number,
  ): boolean => {
    if (
      reservedNoReplyDeliveryContextOrdinals.has(deliveryContextOrdinal ?? 0)
    ) {
      return true
    }
    const patch = resolveFinalActionPatch(deliveryContextOrdinal ?? 0)
    return patch?.kind === 'none'
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
      pushRuntimeIssueInput(createDynamicToolRuntimeIssueInput({
        request: dynamicToolRequest,
        reason: 'unsupported',
      }))
      void tryWriteRpcMessage({
        id: requestId,
        error: {
          code: -32000,
          message: `Unsupported dynamic tool ${dynamicToolRequest.namespace ?? ''}.${dynamicToolRequest.tool ?? 'unknown'}`,
        },
      })
      return
    }

    if (isInvalidDynamicToolRequest(dynamicToolRequest)) {
      pushRuntimeIssueInput(createDynamicToolRuntimeIssueInput({
        request: dynamicToolRequest,
        reason: 'invalid_arguments',
      }))
    }

    if (
      input.allowFinishWithoutReply === false &&
      (dynamicToolRequest.kind === 'finish-without-reply' ||
        dynamicToolRequest.kind === 'invalid-finish-without-reply-arguments')
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'finish_without_reply is not available for this turn',
            },
          ],
        },
      })
      return
    }

    if (
      computerToolsLockedAfterUserPause &&
      isComputerDynamicToolRequest(dynamicToolRequest)
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'computer run is paused for user input; end this turn and wait for the next user reply',
            },
          ],
        },
      })
      return
    }

    const dynamicToolDeliveryContextOrdinal =
      dynamicToolRequest.kind === 'finish-without-reply' ||
      dynamicToolRequest.kind === 'react-to-message' ||
      dynamicToolRequest.kind === 'send-progress-update'
        ? Math.max(0, completedUserMessageOrdinal)
        : null
    const dynamicToolProgressDelivery =
      dynamicToolRequest.kind === 'send-progress-update'
        ? resolveCodexAppServerProgressDelivery(input)
        : null
    const releaseNoReplyRequestReservation =
      dynamicToolRequest.kind === 'finish-without-reply' &&
      dynamicToolDeliveryContextOrdinal !== null &&
      canApplyNoReplyPatch(dynamicToolDeliveryContextOrdinal) &&
      !finalActionPatches.some(
        (action) =>
          action.deliveryContextOrdinal === dynamicToolDeliveryContextOrdinal,
      )
        ? reserveNoReplyDeliveryContext(dynamicToolDeliveryContextOrdinal)
        : null

    if (
      dynamicToolRequest.kind === 'send-progress-update' &&
      shouldSuppressDeliveryContext(dynamicToolDeliveryContextOrdinal ?? 0)
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'progress update skipped after finish_without_reply',
            },
          ],
        },
      })
      return
    }

    const releaseDynamicProgressPending =
      dynamicToolRequest.kind === 'send-progress-update' &&
      dynamicToolProgressDelivery
        ? addPendingExternallyVisibleAssistantOutput(
            dynamicToolDeliveryContextOrdinal ?? 0,
          )
        : null

    if (dynamicToolRequest.kind === 'computer-pause-for-user') {
      computerToolsLockedAfterUserPause = true
      closeLiveTurn()
    }

    const runDynamicTool = () => executeMurphDynamicToolRequest({
      abortSignal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, dynamicToolAbortController.signal])
        : dynamicToolAbortController.signal,
      codexHome: input.codexHome ?? input.env.CODEX_HOME ?? null,
      env: input.env,
      fetchImpl: input.fetchImpl,
      hostedGeneratedImageUploader: input.hostedGeneratedImageUploader,
      hostedToolContext: resolveCodexAppServerHostedToolContext(input),
      currentResponseMedia: responseMedia,
      nextUsageOrdinal: () => nextDynamicToolUsageOrdinal++,
      productFeedbackRecorder: input.productFeedbackRecorder ?? null,
      progressDelivery:
        dynamicToolRequest.kind === 'send-progress-update'
          ? dynamicToolProgressDelivery
          : null,
      publicFetchImpl: input.publicInternetFetch ?? null,
      request: dynamicToolRequest,
      requireHostedGeneratedImageUploader:
        input.requireHostedGeneratedImageUploader ?? false,
      voiceMemoRuntime:
        dynamicToolRequest.kind === 'generate-voice-memo' ||
        dynamicToolRequest.kind === 'generate-song'
          ? input.voiceMemoRuntime ?? null
          : null,
    }).then(async (result) => {
      if (dynamicToolRequest.kind === 'send-progress-update') {
        releaseDynamicProgressPending?.()
      }
      if (result.usageDraft) {
        additionalUsages.push(result.usageDraft)
      }
      if (result.computerRunPausedForUser) {
        computerToolsLockedAfterUserPause = true
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
      if (result.finalActionPatch) {
        const applied = await applyFinalActionPatch(
          result.finalActionPatch,
          dynamicToolDeliveryContextOrdinal ?? 0,
        )
        if (!applied) {
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: 'finish_without_reply unavailable after assistant output',
                },
              ],
            },
          })
          return
        }
      }
      if (result.reactionPatch && dynamicToolDeliveryContextOrdinal !== null) {
        reactionPatches = [
          ...reactionPatches.filter(
            (entry) =>
              entry.deliveryContextOrdinal !== dynamicToolDeliveryContextOrdinal,
          ),
          {
            deliveryContextOrdinal: dynamicToolDeliveryContextOrdinal,
            patch: result.reactionPatch,
          },
        ]
      }
      if (
        dynamicToolRequest.kind === 'send-progress-update' &&
        result.rpcResult.success
      ) {
        markExternallyVisibleAssistantOutput(
          dynamicToolDeliveryContextOrdinal ?? 0,
        )
      }
      void tryWriteRpcMessage({
        id: requestId,
        result: result.rpcResult,
      })
    }).catch((error: unknown) => {
      if (dynamicToolRequest.kind === 'send-progress-update') {
        releaseDynamicProgressPending?.()
      }
      pushRuntimeIssueInput(createDynamicToolRuntimeIssueInput({
        request: dynamicToolRequest,
        reason: 'execution_failed',
      }))
      if (dynamicToolRequest.kind === 'finish-without-reply') {
        throw error
      }
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
    }).finally(() => {
      releaseNoReplyRequestReservation?.()
    })

    if (
      isSerializedDynamicToolRequest(dynamicToolRequest) ||
      dynamicToolRequest.kind === 'finish-without-reply'
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
    for (const receiverThreadId of readCodexCollabReceiverThreadIds(message)) {
      collabReceiverThreadIds.add(receiverThreadId)
    }
    lastEventError = extractCodexErrorMessage(message) ?? lastEventError
    lastEventErrorInfo = extractCodexErrorInfo(message) ?? lastEventErrorInfo
    if (isCodexTurnStartedMethod(method)) {
      turnId = extractCodexTurnIdFromMessage(message) ?? turnId
    }

    const normalizedEvent = normalizeCodexEvent(message)
    const runtimeIssueInput = buildRuntimeIssueInputForFailedCodexAction({
      normalizedEvent,
      rawEvent: message,
    })
    if (runtimeIssueInput) {
      pushRuntimeIssueInput(runtimeIssueInput)
    }
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

    const deliveryContextOrdinal = currentDeliveryContextOrdinal()
    const suppressDeliveryContext =
      shouldSuppressDeliveryContext(deliveryContextOrdinal)
    const updates = extractCodexTraceUpdatesFromNormalized(normalizedEvent)
      .filter((update) => !(suppressDeliveryContext && update.kind === 'assistant'))
    for (const update of updates) {
      recordAssistantTraceUpdate(update, deliveryContextOrdinal)
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
      if (
        input.onTraceEvent &&
        updates.some((update) => isVisibleAssistantTraceUpdate(update))
      ) {
        markExternallyVisibleAssistantOutput(deliveryContextOrdinal)
      }
    }

    const progressDeliveryText =
      extractCodexCurrentChannelProgressTextFromNormalized(normalizedEvent)
    const progressDeliverySource = progressDeliveryText
      ? resolveCodexCurrentChannelProgressSource(normalizedEvent)
      : null
    if (
      progressDeliveryText &&
      progressDeliverySource &&
      !suppressDeliveryContext
    ) {
      notifyCurrentChannelProgress(
        deliveryContextOrdinal,
        progressDeliveryText,
        progressDeliverySource,
      )
    }

    const completedFinalAgentMessageText =
      extractCodexCompletedFinalAgentMessageTextFromNormalized(normalizedEvent)
    if (completedFinalAgentMessageText !== null && !suppressDeliveryContext) {
      if (trailingSteerCandidate) {
        precedingAgentMessageSegments.push(trailingSteerCandidate)
        trailingSteerCandidate = null
        trailingSteerCandidateDeliveryContextOrdinal = null
        trailingSteerCandidateMedia = null
      }
      completedFinalAgentMessage = completedFinalAgentMessageText
    } else if (isCodexCompletedUserMessageItemFromNormalized(normalizedEvent)) {
      if (completedFinalAgentMessage !== null) {
        trailingSteerCandidate = {
          deliveryContextOrdinal: Math.max(0, completedUserMessageOrdinal),
          response: completedFinalAgentMessage,
          media: [...responseMedia],
        }
        trailingSteerCandidateDeliveryContextOrdinal =
          trailingSteerCandidate.deliveryContextOrdinal ?? 0
        trailingSteerCandidateMedia = trailingSteerCandidate.media
        completedFinalAgentMessage = null
        responseMedia = []
      }
      completedUserMessageOrdinal += 1
    }

    const progressEvent = extractCodexProgressEventFromNormalized(normalizedEvent)
    if (progressEvent) {
      if (suppressDeliveryContext && progressEvent.kind === 'message') {
        // A completed no-reply context must not leak later text progress.
      } else {
        if (progressEvent.kind === 'message') {
          lastAgentMessage = progressEvent.text
          if (input.onProgress && normalizeStreamingText(progressEvent.text)) {
            markExternallyVisibleAssistantOutput(deliveryContextOrdinal)
          }
        }
        input.onProgress?.(progressEvent)
      }
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

  const handleSubagentThreadMessage = (
    threadId: string,
    message: CodexRpcMessage,
  ): void => {
    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      // Dynamic tools and approvals stay parent-thread-scoped; answer the
      // child so it does not hang, without involving the parent turn.
      void tryWriteRpcMessage({
        id: requestId,
        error: {
          code: -32000,
          message: 'Server requests from codex subagent threads are not supported.',
        },
      })
      return
    }

    if (!isAssistantCodexTokenUsageEventType(readCodexEventMethod(message))) {
      return
    }

    const sample = subagentTokenUsageByThread.get(threadId)
    if (sample) {
      sample.eventCount += 1
      sample.lastEvent = message
      return
    }
    if (subagentTokenUsageByThread.size >= MAX_CODEX_SUBAGENT_USAGE_THREADS) {
      // Evidenced subagent threads win buffer slots: evict an unattributed
      // sample (e.g. a stale flush from a previous warm-process thread, which
      // is never billable) before dropping a billable child's usage.
      const evictableThreadId = collabReceiverThreadIds.has(threadId)
        ? [...subagentTokenUsageByThread.keys()].find(
          (bufferedThreadId) => !collabReceiverThreadIds.has(bufferedThreadId),
        )
        : undefined
      if (evictableThreadId === undefined) {
        subagentDroppedUsageThreadIds.add(threadId)
        return
      }
      subagentTokenUsageByThread.delete(evictableThreadId)
      subagentDroppedUsageThreadIds.add(evictableThreadId)
    }
    subagentTokenUsageByThread.set(threadId, {
      eventCount: 1,
      firstEvent: message,
      lastEvent: message,
    })
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
          codexProcess.noteBoundThreadId(codexThreadId)
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

    // Codex app-server auto-attaches this connection to every thread it
    // creates, including spawned subagent threads, and their notifications
    // carry foreign thread/turn ids. Route them off the single-turn
    // correlation path: token usage is buffered for billing, server requests
    // are denied without failing the parent turn, everything else is dropped.
    // Before a fresh thread/start response produces this turn's thread id,
    // fall back to the process's last bound thread id so a late child event
    // in that window is still routed instead of failing correlation; events
    // for the last bound thread itself keep today's strict stale handling.
    const messageThreadId = extractCodexThreadIdFromMessage(message)
    const knownParentThreadId = codexThreadId ?? codexProcess.lastBoundThreadId
    if (
      messageThreadId !== null &&
      knownParentThreadId !== null &&
      messageThreadId !== knownParentThreadId
    ) {
      handleSubagentThreadMessage(messageThreadId, message)
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
    if (
      computerToolsLockedAfterUserPause ||
      liveTurnOpen ||
      !input.onLiveTurn ||
      !codexThreadId ||
      !turnId
    ) {
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
    codexProcess.noteBoundThreadId(codexThreadId)
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
    codexProcess.noteBoundThreadServiceTier(input.serviceTier ?? null)
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
    codexProcess.noteBoundThreadId(codexThreadId)
    codexProcess.releaseTurn(activeTurnBinding)
    codexProcess.releaseReservation()
  }

  const extractedFinalMessage =
    extractAssistantMessageFallback({
      assistantStreams,
      assistantStreamOrder,
    }) ??
    lastAgentMessage ??
    ''
  const latestDeliveryContextOrdinal = Math.max(0, completedUserMessageOrdinal)
  const latestFinalActionPatch = resolveFinalActionPatch(
    latestDeliveryContextOrdinal,
  )
  const trailingSteerCandidateFinalActionPatch =
    trailingSteerCandidateDeliveryContextOrdinal !== null
      ? resolveFinalActionPatch(trailingSteerCandidateDeliveryContextOrdinal)
      : null
  const suppressTrailingSteerCandidateForEarlierNoReply =
    latestFinalActionPatch === null &&
    trailingSteerCandidate !== null &&
    trailingSteerCandidateFinalActionPatch?.kind === 'none'
  const finalPrecedingAgentMessageSegments =
    latestFinalActionPatch?.kind === 'none' && trailingSteerCandidate
      ? [...precedingAgentMessageSegments, trailingSteerCandidate]
      : precedingAgentMessageSegments
  const finalResponseMedia =
    latestFinalActionPatch?.kind === 'none'
      ? responseMedia
      : suppressTrailingSteerCandidateForEarlierNoReply
        ? responseMedia
        : trailingSteerCandidateMedia ?? responseMedia
  const finalDeliveryContextOrdinal =
    latestFinalActionPatch?.kind === 'none'
      ? latestDeliveryContextOrdinal
      : suppressTrailingSteerCandidateForEarlierNoReply
        ? latestDeliveryContextOrdinal
        : trailingSteerCandidateDeliveryContextOrdinal ??
          latestDeliveryContextOrdinal
  const finalActionPatch = resolveFinalActionPatch(finalDeliveryContextOrdinal)
  const noReplySelected = finalActionPatch?.kind === 'none'
  const finalAction: AssistantNoReplyDisposition | null = noReplySelected
    ? { kind: 'none' }
    : null
  const finalMessage =
    noReplySelected || suppressTrailingSteerCandidateForEarlierNoReply
      ? ''
      : extractedFinalMessage
  if (
    noReplySelected &&
    normalizeNullableString(extractedFinalMessage) !== null
  ) {
    emitCodexSuppressedFinalMessageTrace({
      codexThreadId,
      finalActionKind: 'none',
      onTraceEvent: input.onTraceEvent,
      suppressedTextLength: extractedFinalMessage.length,
    })
  }
  const filteredPrecedingAgentMessageSegments = finalPrecedingAgentMessageSegments
    .filter((segment) => !shouldSuppressDeliveryContext(
      segment.deliveryContextOrdinal,
    ))
  const codexThreadHistoryUnsafe =
    finalActionPatches.some((entry) => entry.patch.kind === 'none') ||
    suppressTrailingSteerCandidateForEarlierNoReply ||
    filteredPrecedingAgentMessageSegments.length !==
      finalPrecedingAgentMessageSegments.length
  const finalHasDeliverableOutput =
    normalizeNullableString(finalMessage) !== null ||
    (!noReplySelected && finalResponseMedia.length > 0)

  return {
    acceptedNoReplyDeliveryContextOrdinals:
      listNoReplyFinalActionPatchOrdinals(),
    codexThreadHistoryUnsafe,
    finalAction,
    finalActionExplicit: finalActionPatch !== null,
    finalMessage,
    reactions: reactionPatches.map((entry) => ({
      deliveryContextOrdinal: entry.deliveryContextOrdinal,
      reaction: entry.patch.reaction,
    })),
    precedingAgentMessageSegments: filteredPrecedingAgentMessageSegments.map((segment) => ({
      ...(typeof segment.deliveryContextOrdinal === 'number'
        ? { deliveryContextOrdinal: segment.deliveryContextOrdinal }
        : {}),
      response: segment.response,
      media: [...segment.media],
    })),
    additionalUsages: [...additionalUsages, ...buildSubagentUsageDrafts()],
    responseMedia: finalHasDeliverableOutput ? [...finalResponseMedia] : [],
    jsonEvents,
    providerActionCount,
    runtimeIssueInputs,
    rolloutRelativePath,
    sessionId: codexThreadId,
    stderr: stderr.trim(),
    stdout: stdout.trim(),
    threadId: codexThreadId,
    turnId,
  }
}

function emitCodexSuppressedFinalMessageTrace(input: {
  codexThreadId: string | null
  finalActionKind: AssistantNoReplyDisposition['kind']
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  suppressedTextLength: number
}): void {
  if (!input.onTraceEvent) {
    return
  }

  try {
    input.onTraceEvent({
      codexThreadId: input.codexThreadId,
      rawEvent: {
        schema: 'murph.assistant-codex-final-action.v1',
        type: 'assistant.codex.final_action_suppressed_text',
        finalActionKind: input.finalActionKind,
        suppressedTextLength: input.suppressedTextLength,
      },
      updates: [],
    })
  } catch {
    // Diagnostic-only.
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

function isInvalidDynamicToolRequest(
  request: MurphDynamicToolRequest,
): request is Extract<
  MurphDynamicToolRequest,
  {
    kind:
      | 'invalid-generate-image-arguments'
      | 'invalid-computer-arguments'
      | 'invalid-generate-voice-memo-arguments'
      | 'invalid-finish-without-reply-arguments'
      | 'invalid-progress-arguments'
      | 'invalid-reaction-arguments'
      | 'invalid-product-feedback-arguments'
      | 'invalid-response-media-arguments'
  }
> {
  return (
    request.kind === 'invalid-generate-image-arguments' ||
    request.kind === 'invalid-computer-arguments' ||
    request.kind === 'invalid-generate-voice-memo-arguments' ||
    request.kind === 'invalid-finish-without-reply-arguments' ||
    request.kind === 'invalid-progress-arguments' ||
    request.kind === 'invalid-reaction-arguments' ||
    request.kind === 'invalid-product-feedback-arguments' ||
    request.kind === 'invalid-response-media-arguments'
  )
}

function isSerializedDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  return request.kind === 'generate-image' ||
    request.kind === 'generate-voice-memo' ||
    request.kind === 'generate-song' ||
    request.kind === 'attach-response-media' ||
    request.kind === 'submit-product-feedback' ||
    isComputerDynamicToolRequest(request)
}

function createDynamicToolRuntimeIssueInput(input: {
  request: MurphDynamicToolRequest
  reason: 'execution_failed' | 'invalid_arguments' | 'unsupported'
}): AssistantRuntimeIssueInput {
  if (input.reason === 'unsupported') {
    return {
      component: 'assistant.codex-dynamic-tool',
      operation: 'unsupported-dynamic-tool',
      phase: 'tool_call',
      issueKind: 'schema_rejection',
      severity: 'warning',
      errorCode: 'ASSISTANT_DYNAMIC_TOOL_UNSUPPORTED',
      summary: 'Codex requested an unsupported Murph dynamic tool.',
      details: {
        requestKind: 'unsupported-dynamic-tool',
        namespacePresent:
          input.request.kind === 'unsupported-dynamic-tool'
            ? input.request.namespace !== null
            : false,
        toolPresent:
          input.request.kind === 'unsupported-dynamic-tool'
            ? input.request.tool !== null
            : false,
      },
    }
  }

  if (input.reason === 'invalid_arguments' && isInvalidDynamicToolRequest(input.request)) {
    const validationDigest = input.request.validationDigest
    return {
      component: 'assistant.tool-validation',
      operation: validationDigest.toolName ?? input.request.kind,
      phase: 'tool_call',
      issueKind: 'schema_rejection',
      severity: 'warning',
      errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
      summary: 'Tool input failed schema validation.',
      details: validationDigest,
    }
  }

  return {
    component: 'assistant.codex-dynamic-tool',
    operation: input.request.kind,
    phase: 'tool_call',
    issueKind: 'tool_error',
    severity: 'warning',
    errorCode: 'ASSISTANT_DYNAMIC_TOOL_FAILED',
    summary: 'Murph dynamic tool execution failed.',
    details: {
      requestKind: input.request.kind,
    },
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
