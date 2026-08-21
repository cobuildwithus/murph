import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  HostedCodexAuthAction,
} from '@murphai/hosted-execution/contracts'
import {
  MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE,
} from '@murphai/hosted-execution/assistant-permissions'
import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  readHostedCanonicalWritePort,
  withHostedCanonicalWritePort,
} from '@murphai/core'

import type {
  AssistantResponseMedia,
  AssistantSandbox,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantAcceptedTurnInputReferenceWindow,
} from './assistant/active-turn-input-journal.js'
import {
  renderAssistantResponseCardText,
  renderAssistantResponseCardTranscriptText,
  renderAssistantWorkoutResponseCardText,
  renderAssistantWorkoutResponseCardTranscriptText,
  type AssistantResponseCard,
  type CompactTableWorkoutResponseCardV1,
} from '@murphai/operator-config/assistant-response-cards'
import type {
  CodexNormalizedEvent,
  CodexProgressEvent,
} from './assistant-codex-events.js'
import {
  registerStopWarmCodexAppServer,
  registerWaitForWarmCodexBackgroundWork,
  type WaitForWarmCodexBackgroundWorkInput,
} from './codex-lifecycle.js'
import {
  extractAssistantMessageFallback,
  extractCodexErrorInfo,
  extractCodexErrorMessage,
  extractCodexCompletedFinalAgentMessageTextFromNormalized,
  extractCodexProgressEventFromNormalized,
  isCodexCompletedFinalAgentMessageItemFromNormalized,
  isCodexCompletedUserMessageItemFromNormalized,
  type CodexStructuredErrorInfo,
  extractCodexStatusEventFromStderrLine,
  extractCodexTraceUpdatesFromNormalized,
  extractCodexContextCompactionProgressTextFromNormalized,
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
  createCodexActionRuntimeIssueTracker,
} from './assistant-codex/action-diagnostics.js'
import type {
  MurphDynamicToolFinalActionPatch,
  MurphDynamicToolReactionPatch,
  MurphDynamicToolReplyTargetPatch,
  MurphDynamicToolRequest,
} from './assistant-codex/dynamic-tools.js'
import {
  MURPH_ASSISTANT_STYLE_TOOL,
  MURPH_GROUP_ROOM_MODEL_TOOL,
  MURPH_MEMBER_MEMORY_TOOL,
  type AssistantStyleTurnSettingsOverlay,
} from './assistant-codex/dynamic-tool-catalog.js'
import type {
  VoiceMemoPhaseTiming,
  VoiceMemoToolRuntime,
} from './assistant-codex/generate-voice-memo-tool.js'
import {
  createAskGrokTurnState,
  type AskGrokToolRuntime,
} from './assistant-codex/ask-grok-tool.js'
import {
  createAnalyzeVideoTurnState,
  type AnalyzeVideoToolRuntime,
} from './assistant-codex/analyze-video-tool.js'
import {
  attachCodexAppServerProcessExitCleanup,
  attachCodexAbortListener,
  consumeCompleteLines,
  denyUnsupportedCodexServerRequest,
  rejectCodexServerRequest,
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
  readCodexNonEmptyString,
  readCodexRecord,
  readCodexThreadTokenUsage,
  type CodexTokenUsageBreakdown,
} from './assistant-codex/app-server-protocol.js'
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
  type CodexSubagentTurnTokenUsageSample,
  extractCodexSubagentUsageDrafts,
  isAssistantCodexTokenUsageEventType,
  readCodexCollabReceiverThreadIds,
} from './assistant/providers/helpers.js'
import {
  materializeCodexImages,
  normalizeCodexAppServerImageDetails,
  type CodexAppServerImageInput,
  type CodexAppServerPreparedImageInput,
} from './assistant-codex/images.js'
import type {
  AssistantWorkspaceArtifactMaterializer,
} from './assistant/execution-context.js'
import type {
  AssistantHostedToolContext,
} from './assistant/hosted-tool-context.js'
import type {
  AssistantAcceptedMessageTargetAuthorizer,
} from './assistant/message-target-selection.js'
import type {
  AssistantGenerateSongTurnPolicy,
  AssistantNoReplyDisposition,
  AssistantProviderDynamicTool,
  AssistantProviderFinishWithoutReplyAcceptedEvent,
  AssistantProviderRequestStartedEvent,
  AssistantProviderRequestStartTiming,
  AssistantProviderServiceTier,
  AssistantProviderUsageDraft,
} from './assistant/providers/types.js'
import type {
  AssistantRuntimeIssueInput,
} from './assistant/issue-reporting.js'
import {
  ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS,
  normalizeAssistantResponseMediaList,
} from './assistant/response-media.js'
import type {
  AssistantProviderTraceEvent,
  AssistantProviderTraceUpdate,
} from './assistant/provider-traces.js'
import {
  completeAssistantProviderStartCriticalPath,
  readAssistantProviderStartMonotonicTickMs,
  stampAssistantProviderStartCriticalPath,
  type AssistantProviderStartCriticalPathContext,
} from './assistant/provider-start-critical-path.js'
import type {
  AssistantProgressDelivery,
  AssistantProgressDeliveryResult,
  AssistantTurnProductFeedbackRecorder,
} from './assistant/turn-progress.js'

export { extractCodexTraceUpdates } from './assistant-codex-events.js'
export {
  listMurphDynamicToolNames,
  resolveMurphDynamicTools,
} from './assistant-codex/dynamic-tool-catalog.js'
export { resolveCodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexProgressEvent } from './assistant-codex-events.js'
export type { CodexDisplayOptions } from './assistant-codex/config.js'
export type { CodexAppServerImageInput } from './assistant-codex/images.js'
export type {
  VoiceMemoToolRuntime,
} from './assistant-codex/generate-voice-memo-tool.js'
export type {
  AskGrokToolRuntime,
} from './assistant-codex/ask-grok-tool.js'
export type {
  AnalyzeVideoToolRuntime,
} from './assistant-codex/analyze-video-tool.js'

const CODEX_RPC_CLIENT_NAME = 'murph'
const CODEX_RPC_CLIENT_TITLE = 'Murph'
const CODEX_RPC_CLIENT_VERSION = '1.0.0'
const CODEX_RPC_DEFAULT_TIMEOUT_MS = 120_000
const CODEX_BACKGROUND_WORK_RPC_TIMEOUT_MS = 5_000
const CODEX_BACKGROUND_WORK_WAIT_TIMEOUT_MS = 120_000
const CODEX_BACKGROUND_WORK_POLL_INTERVAL_MS = 50
const CODEX_RPC_STEER_TIMEOUT_MS = 15_000
type MurphDynamicToolRuntime =
  typeof import('./assistant-codex/dynamic-tools.js')
let murphDynamicToolRuntimePromise: Promise<MurphDynamicToolRuntime> | null = null

function loadMurphDynamicToolRuntime(): Promise<MurphDynamicToolRuntime> {
  murphDynamicToolRuntimePromise ??=
    import('./assistant-codex/dynamic-tools.js')
  return murphDynamicToolRuntimePromise
}
const CODEX_APP_SERVER_INTERRUPT_CLEANUP_TIMEOUT_MS = 15_000
const CODEX_MANAGED_ACCOUNT_LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const CODEX_MANAGED_ACCOUNT_CONFIG_OVERRIDES = [
  'model_provider="openai"',
  'cli_auth_credentials_store="file"',
] as const
const CODEX_APP_SERVER_COMMAND = 'app-server'
const CODEX_APP_SERVER_TIMING_TRACE_SCHEMA =
  'murph.assistant-codex-app-server-timing.v1'
const CODEX_APP_SERVER_TIMING_TRACE_TYPE =
  'assistant.codex.app_server_timing'
const CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA =
  'murph.assistant-codex-transport-diagnostics.v1'
const CODEX_TRANSPORT_DIAGNOSTICS_TRACE_TYPE =
  'assistant.codex.transport_diagnostics'
const CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_SCHEMA =
  'murph.assistant-codex-generated-audio-phase-timing.v1'
const CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_TYPE =
  'assistant.codex.generated_audio_phase_timing'
const CODEX_APP_SERVER_STARTUP_STDERR_MAX_LENGTH = 16_384
// Bound on distinct subagent threads whose token usage is tracked per parent
// turn. Far above any sane spawn fan-out; threads past the cap are ignored.
const MAX_CODEX_SUBAGENT_USAGE_THREADS = 32

type CodexAppServerProcessState =
  | 'idle'
  | 'reserved'
  | 'running'
  | 'stopped'
  | 'stopping'

export type CodexAppServerProcessLifetime = 'one-shot' | 'warm'

type CodexAppServerColdStartReason =
  | 'node-process-first-use'
  | 'previous-explicit-stop'
  | 'previous-idle-compaction-failure'
  | 'previous-launch-identity-change'
  | 'previous-process-exit'
  | 'previous-process-unhealthy'
  | 'previous-turn-abort'
  | 'previous-turn-failure'

type CodexAppServerProcessInput = {
  args: readonly string[]
  codexCommand: string
  env: NodeJS.ProcessEnv
  launchKey: string
}

type CodexAppServerLaunchInput = {
  codexCommand?: string | null
  codexHome?: string | null
  configOverrides?: readonly string[]
  env?: NodeJS.ProcessEnv
  oss?: boolean
  profile?: string | null
  workingDirectory: string
}

type CodexAppServerPreparedProcessInput = CodexAppServerProcessInput & {
  configOverrides: readonly string[]
  workingDirectory: string
}

type CodexAppServerSpawnInput = CodexAppServerProcessInput & {
  coldStartReason: CodexAppServerColdStartReason
}

type CodexAppServerPreparedTurnInput = CodexAppServerTurnInput & {
  args: readonly string[]
  codexCommand: string
  env: NodeJS.ProcessEnv
  fetchImpl: typeof fetch
  launchKey: string
  preparedImages: readonly CodexAppServerPreparedImageInput[]
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
  groupConversation: boolean
  lastInputTokens: number
  model: string | null
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

// Codex emits contextCompaction item lifecycle notifications and also retains
// the canonical deprecated thread/compacted notification. Both exact pinned
// protocol shapes are accepted; no dotted or alternate envelope aliases are.
function isCodexContextCompactionStarted(message: CodexRpcMessage): boolean {
  if (message.method !== 'item/started') {
    return false
  }
  return readCodexRecord(readCodexRecord(message.params)?.item)?.type
    === 'contextCompaction'
}

function readCodexContextCompactionItemId(message: CodexRpcMessage): string | null {
  return readCodexNonEmptyString(
    readCodexRecord(readCodexRecord(message.params)?.item)?.id,
  )
}

function isCodexContextCompactionStartedForThread(
  message: CodexRpcMessage,
  threadId: string,
): boolean {
  return isCodexContextCompactionStarted(message)
    && extractCodexThreadIdFromMessage(message) === threadId
}

function isCodexLegacyContextCompactionCompletion(message: CodexRpcMessage): boolean {
  return message.method === 'thread/compacted'
}

function isCodexContextCompactionCompletion(message: CodexRpcMessage): boolean {
  if (isCodexLegacyContextCompactionCompletion(message)) {
    return true
  }
  if (message.method !== 'item/completed') {
    return false
  }
  return readCodexRecord(readCodexRecord(message.params)?.item)?.type
    === 'contextCompaction'
}

function isCodexContextCompactionCompletionForThread(
  message: CodexRpcMessage,
  threadId: string,
): boolean {
  return isCodexContextCompactionCompletion(message)
    && extractCodexThreadIdFromMessage(message) === threadId
}

function isCodexThreadTokenUsageUpdatedMethod(method: string | null): boolean {
  return method === 'thread/tokenUsage/updated'
}

function readCodexThreadTokenUsageUpdate(message: CodexRpcMessage): {
  last: CodexTokenUsageBreakdown
  threadId: string
} | null {
  if (!isCodexThreadTokenUsageUpdatedMethod(readCodexEventMethod(message))) {
    return null
  }

  const params = readCodexRecord(message.params)
  const threadId = readCodexNonEmptyString(params?.threadId)
  const tokenUsage = readCodexThreadTokenUsage(params?.tokenUsage)
  return threadId && tokenUsage
    ? {
        last: tokenUsage.last,
        threadId,
      }
    : null
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
): Promise<void> {
  if (pending.length === 0) {
    return
  }

  await Promise.allSettled(pending)
}

export interface CodexAppServerTurnInput {
  allowFinishWithoutReply?: boolean | null
  automationRelativeDateReferenceWindow?: AssistantAcceptedTurnInputReferenceWindow | null
  authorizeAcceptedMessageTarget?: AssistantAcceptedMessageTargetAuthorizer | null
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
  generateSongPolicy?: AssistantGenerateSongTurnPolicy | null
  excludeResumeTurns?: boolean
  model?: string | null
  modelProvider?: string | null
  onboardingFirstReadCompletionTransitionAvailable?: boolean | null
  outputSchema?: Readonly<Record<string, unknown>> | null
  onFirstAssistantResponseCompleted?: (() => void) | null
  onLiveTurn?: ((turn: CodexAppServerLiveTurn) => void | (() => void)) | null
  onProgress?: ((event: CodexProgressEvent) => void) | null
  onFinishWithoutReplyAccepted?: ((
    event: AssistantProviderFinishWithoutReplyAcceptedEvent
  ) => Promise<void> | void) | null
  onFinishWithoutReplyRecorded?: ((event: {
    deliveryContextOrdinal: number
  }) => Promise<void> | void) | null
  onProviderRequestStarted?: ((event: AssistantProviderRequestStartedEvent) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  groupConversation?: boolean | null
  groupRoomModelMaintenanceAuthorized?: boolean | null
  memberMemoryMaintenanceAuthorized?: boolean | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  productFeedbackRecorder?: AssistantTurnProductFeedbackRecorder | null
  oss?: boolean
  profile?: string | null
  permissions?: string | null
  processLifetime?: CodexAppServerProcessLifetime
  prompt: string
  images?: readonly CodexAppServerImageInput[] | null
  reasoningEffort?: string | null
  resumeSessionId?: string | null
  sandbox?: AssistantSandbox
  ephemeral?: boolean | null
  environments?: readonly Readonly<Record<string, unknown>>[] | null
  runtimeWorkspaceRoots?: readonly string[] | null
  threadConfig?: Readonly<Record<string, unknown>> | null
  // Sent on every turn/start: a value selects the tier, null explicitly
  // resets a sticky thread-level override back to the default tier.
  serviceTier?: AssistantProviderServiceTier | null
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  providerRequestOrdinal?: number | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
  publicInternetFetch?: typeof fetch | null
  requireHostedPrivateImageDelivery?: boolean | null
  vaultRoot?: string | null
  voiceMemoRuntime?: VoiceMemoToolRuntime | null
  analyzeVideoRuntime?: AnalyzeVideoToolRuntime | null
  askGrokRuntime?: AskGrokToolRuntime | null
  workingDirectory: string
}

export interface CodexAppServerPreinitializeInput
  extends CodexAppServerLaunchInput {
  signal?: AbortSignal | null
}

export interface CodexAppServerPreinitialization {
  cancelPending(): Promise<void>
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
    targetInputId: string
  }[]
  codexThreadId: string | null
  providerTurnId: string | null
  rolloutRelativePath: string | null
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
    codexThreadId: context.codexThreadId,
    providerTurnId: context.providerTurnId,
    rolloutRelativePath: context.rolloutRelativePath,
  }
}

export interface CodexAppServerTurnResult {
  finalMessage: string
  /** Final model-authored text before runtime-owned presentation transforms. */
  providerAuthoredFinalMessage?: string | null
  transcriptMessage: string | null
  acceptedNoReplyDeliveryContextOrdinals: readonly number[]
  finalAction: AssistantNoReplyDisposition | null
  finalActionExplicit: boolean
  reactions: readonly {
    deliveryContextOrdinal: number
    reaction: MurphDynamicToolReactionPatch['reaction']
    targetInputId: string
  }[]
  // Completed final-phase agent messages that were followed by a steered user
  // message and later superseded by another response segment in the same turn,
  // in completion order. Empty unless the turn was steered after the model had
  // already finished an answer.
  precedingAgentMessageSegments: readonly CodexAppServerResponseSegment[]
  /** Accepted-input ordinal whose delivery context owns the selected final reply. */
  responseDeliveryContextOrdinal: number
  /** Accepted input selected as the native target for the final reply, if any. */
  targetInputId: string | null
  additionalUsages: AssistantProviderUsageDraft[]
  responseMedia: AssistantResponseMedia[]
  responseCard: AssistantResponseCard | null
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
  deliveryContextOrdinal: number
  media: AssistantResponseMedia[]
  response: string
  transcriptResponse?: string
  targetInputId?: string
}

interface CodexAppServerTrailingResponseCandidate
  extends Omit<CodexAppServerResponseSegment, 'transcriptResponse'> {
  card: AssistantResponseCard | null
  cardTextFallback: CompactTableWorkoutResponseCardV1 | null
}

export type CodexAppServerSteerInput = {
  threadId: string
  turnId: string
  prompt: string
  relativeDateReferenceWindow?: AssistantAcceptedTurnInputReferenceWindow | null
  images?: readonly CodexAppServerImageInput[] | null
}

export type CodexAppServerSteerRequestInput = Omit<
  CodexAppServerSteerInput,
  'images'
> & {
  images?: readonly CodexAppServerPreparedImageInput[] | null
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

function appendRequiredVaultFileApprovalUrls(
  message: string | null,
  approvalUrls: readonly string[],
): string {
  return [
    normalizeNullableString(message),
    ...approvalUrls,
  ].filter((part): part is string => part !== null).join('\n\n')
}

interface RequiredAutomationLocalAtClarification {
  code: 'local_at_fold' | 'local_at_gap'
  resolvedLocalDate: string
  targetKey: string
  targetLabel: string
}

function buildRequiredAutomationLocalAtClarificationKey(input: {
  resolvedLocalDate: string
  targetKey: string
}): string {
  return `${input.targetKey}:${input.resolvedLocalDate}`
}

function buildRequiredAutomationLocalAtClarification(
  requirement: RequiredAutomationLocalAtClarification,
): string {
  const reminder = `reminder ${JSON.stringify(requirement.targetLabel)}`
  return requirement.code === 'local_at_gap'
    ? `For ${reminder}, the trusted date is ${requirement.resolvedLocalDate}. What other local time on ${requirement.resolvedLocalDate} should I use?`
    : `For ${reminder}, the trusted date is ${requirement.resolvedLocalDate}. Should I use the earlier or later occurrence on ${requirement.resolvedLocalDate}?`
}

function appendRequiredAutomationLocalAtClarification(
  message: string | null,
  requirements: readonly RequiredAutomationLocalAtClarification[],
): string | null {
  if (requirements.length === 0) {
    return message
  }
  const normalizedMessage = normalizeNullableString(message)
  const missingClarifications = requirements
    .map(buildRequiredAutomationLocalAtClarification)
    .filter((clarification) => !normalizedMessage?.includes(clarification))

  return [normalizedMessage, ...missingClarifications]
    .filter((part): part is string => part !== null)
    .join('\n\n')
}

export async function executeCodexAppServerTurn(
  input: CodexAppServerTurnInput,
): Promise<CodexAppServerTurnResult> {
  const providerStartCriticalPath = stampAssistantProviderStartCriticalPath(
    input.providerStartCriticalPath,
    'codexAppServerTurnStartedAtMonotonicMs',
  )
  assertCodexAppServerPermissionRequest(input)
  const approvalPolicy = resolveSupportedCodexAppServerApprovalPolicy(input.approvalPolicy)
  if (
    input.processLifetime !== 'one-shot' &&
    warmCodexWorkspaceBoundaryActive
  ) {
    throw buildWarmCodexWorkspaceBoundaryBusyError()
  }
  const processInput = await prepareCodexAppServerProcessInput(input)
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-codex-'))
  const preparedImages = await materializeCodexImages({
    images: normalizeCodexAppServerImageDetails({
      images: input.images,
      model: input.model,
      modelProvider: input.modelProvider,
      turnKind: 'initial',
    }),
    tempRoot,
  })
  const normalizedInput = {
    ...input,
    approvalPolicy,
    configOverrides: processInput.configOverrides,
    ...(providerStartCriticalPath ? { providerStartCriticalPath } : {}),
    runtimeWorkspaceRoots: input.runtimeWorkspaceRoots?.map((root) =>
      path.resolve(root),
    ),
  }
  const preparedInput: CodexAppServerPreparedTurnInput = {
    ...normalizedInput,
    ...processInput,
    fetchImpl: input.fetchImpl ?? fetch,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
    preparedImages,
    publicInternetFetch: input.publicInternetFetch ?? null,
    tempRoot,
    voiceMemoRuntime: input.voiceMemoRuntime ?? null,
    analyzeVideoRuntime: input.analyzeVideoRuntime ?? null,
    askGrokRuntime: input.askGrokRuntime ?? null,
  }

  let oneShotProcess: CodexAppServerProcess | null = null
  try {
    if (preparedInput.processLifetime === 'one-shot') {
      oneShotProcess = new CodexAppServerProcess({
        args: preparedInput.args,
        codexCommand: preparedInput.codexCommand,
        coldStartReason: 'node-process-first-use',
        env: preparedInput.env,
        launchKey: preparedInput.launchKey,
      })
      oneShotProcess.reserveTurn()
      return await runCodexAppServerTurnOnProcess(oneShotProcess, preparedInput)
    }

    let allowPreinitializeFallback = true
    while (true) {
      const processInstance = await getOrStartWarmCodexProcess(preparedInput)
      try {
        return await runCodexAppServerTurnOnProcess(processInstance, preparedInput)
      } catch (error) {
        if (
          !allowPreinitializeFallback ||
          !processInstance.didSpeculativeInitializationFail(error)
        ) {
          throw error
        }
        allowPreinitializeFallback = false
      }
    }
  } finally {
    try {
      await oneShotProcess?.stop('one-shot-complete')
    } finally {
      await rm(tempRoot, {
        recursive: true,
        force: true,
      })
    }
  }
}

function assertCodexAppServerPermissionRequest(
  input: CodexAppServerTurnInput,
): void {
  const permissions = normalizeNullableString(input.permissions)
  if (!permissions) {
    return
  }

  const residentWorkspacePermissionRequest =
    permissions === MURPH_MEMBER_WORKSPACE_PERMISSION_PROFILE
  const invalidFields = [
    ...(input.sandbox ? ['sandbox'] : []),
    ...(
      residentWorkspacePermissionRequest || !normalizeNullableString(input.resumeSessionId)
        ? []
        : ['resumeSessionId']
    ),
    ...(
      residentWorkspacePermissionRequest || input.ephemeral === true
        ? []
        : ['ephemeral']
    ),
    ...(
      residentWorkspacePermissionRequest || input.processLifetime === 'one-shot'
        ? []
        : ['processLifetime']
    ),
  ]
  if (invalidFields.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      residentWorkspacePermissionRequest
        ? 'Named Codex permissions cannot be combined with a legacy sandbox.'
        : 'Restricted named Codex permissions require a fresh ephemeral thread in a one-shot process without a legacy sandbox.',
      {
        invalidFields,
        retryable: false,
      },
    )
  }

  if (!input.runtimeWorkspaceRoots || input.runtimeWorkspaceRoots.length === 0) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_APP_SERVER_REQUEST_INVALID',
      'Named Codex permissions require at least one explicit runtime workspace root.',
      {
        invalidFields: ['runtimeWorkspaceRoots'],
        retryable: false,
      },
    )
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

async function prepareCodexAppServerProcessInput(
  input: CodexAppServerLaunchInput,
): Promise<CodexAppServerPreparedProcessInput> {
  const workingDirectory = path.resolve(input.workingDirectory)
  await assertCodexAppServerWorkingDirectory(workingDirectory)
  const env = await resolveCodexChildEnv({
    codexHome: input.codexHome,
    env: input.env,
  })
  const codexCommand = resolveCodexAppServerCommand(input.codexCommand)
  const configOverrides =
    withHostedCodexModelCatalogConfigOverride({
      configOverrides: input.configOverrides,
      env: input.env,
    }) ?? []
  const args = buildCodexAppServerArgs({
    configOverrides,
    oss: input.oss,
    profile: input.profile,
  })
  const launchKey = buildCodexAppServerLaunchKey({
    args,
    codexCommand,
    env,
    workingDirectory,
  })
  return {
    args,
    codexCommand,
    configOverrides,
    env,
    launchKey,
    workingDirectory,
  }
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
  readonly coldStartReason: CodexAppServerColdStartReason
  readonly launchKey: string
  readonly pendingRequests = new Map<CodexRpcId, PendingCodexRpcRequest>()
  readonly processGroupPid: number | null
  readonly startedAt = Date.now()

  private activeTurn: CodexAppServerActiveTurnBinding | null = null
  private boundThreadGroupConversation = false
  private boundThreadId: string | null = null
  private boundThreadModel: string | null = null
  private boundThreadServiceTier: AssistantProviderServiceTier | null = null
  private cleanupProcessExitListener: () => void
  private completedTurn = false
  private lastThreadTokenUsage: CodexWarmThreadTokenUsage | null = null
  private readonly codexCommand: string
  private ignoredResponseIds = new Set<CodexRpcId>()
  private initialized = false
  private initializationFailure: unknown = null
  private initializationPromise: Promise<void> | null = null
  private initializationWasSpeculative = false
  private endReason: CodexAppServerColdStartReason | null = null
  private nextRequestId = 1
  private normalShutdown = false
  private poisoned = false
  // MultiAgent V2 may retain several concurrent children. Keep every child
  // admitted since the last workspace boundary so checkpointing waits for and
  // scans all of them, including children that completed before their parent
  // reply.
  private readonly detachedChildThreadIds = new Set<string>()
  private readonly detachedCompletedChildThreadIds = new Set<string>()
  private detachedChildViolation: string | null = null
  private readonly detachedRootThreadIds = new Set<string>()
  private stopCompleted = false
  private state: CodexAppServerProcessState = 'idle'
  private stderrBuffer = ''
  private startupStderr = ''
  private startupFailure: Error | null = null
  private spawnReadyPromise: Promise<void> | null = null
  private stdinFailure: VaultCliError | null = null
  private stdoutBuffer = ''
  private stopPromise: Promise<void> | null = null

  constructor(input: CodexAppServerSpawnInput) {
    this.codexCommand = input.codexCommand
    this.coldStartReason = input.coldStartReason
    this.launchKey = input.launchKey

    const useProcessGroup = process.platform !== 'win32'
    // The warm app-server outlives hosted workspace restores, which delete and
    // recreate the workspace path between invocations. A process anchored to
    // that directory keeps a dead cwd inode, and Codex config loading then
    // fails with ENOENT on the next thread/start. Threads receive the real
    // workspace via the explicit per-thread `cwd` param instead.
    this.child = spawn(input.codexCommand, [...input.args], {
      cwd: tmpdir(),
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
    this.child.on('exit', () => {
      // `exit` precedes `close`; claim the cause and sweep the exact owned
      // group before a descendant can keep an inherited stream open forever.
      if (!this.normalShutdown) {
        this.endReason ??= 'previous-process-exit'
        this.signal('SIGKILL')
      }
    })
    this.child.on('close', (code, signal) => {
      this.handleClose(code, signal)
    })
  }

  get initializedForRpc(): boolean {
    return this.initialized
  }

  get wasPreinitialized(): boolean {
    return this.initializationWasSpeculative
  }

  get hasCompletedTurn(): boolean {
    return this.completedTurn
  }

  get processLifetimeMs(): number {
    return Math.max(0, Date.now() - this.startedAt)
  }

  get nextColdStartReason(): CodexAppServerColdStartReason {
    return this.endReason ?? 'previous-process-unhealthy'
  }

  get recordedEndReason(): CodexAppServerColdStartReason | null {
    return this.endReason
  }

  noteTurnAbort(): void {
    this.endReason ??= 'previous-turn-abort'
  }

  get hasInFlightTurn(): boolean {
    return this.state === 'reserved' || this.state === 'running'
  }

  get isStopped(): boolean {
    return this.state === 'stopped'
  }

  get isStoppingOrStopped(): boolean {
    return this.state === 'stopping' || this.state === 'stopped'
  }

  get hasUnclaimedSpeculativeInitialization(): boolean {
    return (
      this.initializationWasSpeculative &&
      !this.initialized &&
      !this.hasInFlightTurn
    )
  }

  canClaimForLaunch(launchKey: string): boolean {
    return (
      this.launchKey === launchKey &&
      !this.poisoned &&
      this.state === 'idle' &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
  }

  noteSpeculativeInitialization(): void {
    this.initializationWasSpeculative = true
  }

  didSpeculativeInitializationFail(error: unknown): boolean {
    return (
      this.initializationWasSpeculative &&
      this.initializationFailure !== null &&
      this.initializationFailure === error
    )
  }

  noteTurnCompleted(): void {
    this.completedTurn = true
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
    this.spawnReadyPromise ??= this.runWaitForSpawn()
    await this.spawnReadyPromise
  }

  private async runWaitForSpawn(): Promise<void> {
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
    this.initializationPromise ??= this.runInitialize().catch((error: unknown) => {
      this.initializationFailure = error
      this.poisoned = true
      if (error instanceof Error) {
        this.startupFailure ??= error
      }
      throw error
    })
    await this.initializationPromise
  }

  private async runInitialize(): Promise<void> {
    await this.waitForSpawn()
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

  async waitForBackgroundWork(
    input: WaitForWarmCodexBackgroundWorkInput = {},
  ): Promise<void> {
    const signal = input.signal ?? null

    try {
      throwIfCodexBackgroundWorkWaitAborted(signal)
      this.assertBackgroundWorkProcessAvailable()
      await this.waitForDetachedChildren(signal)
      this.assertDetachedChildrenQuiescent()
      await this.assertNoBackgroundTerminals(signal)
      throwIfCodexBackgroundWorkWaitAborted(signal)
      this.assertBackgroundWorkProcessAvailable()
      this.assertDetachedChildrenQuiescent()
      this.clearDetachedChildBoundary()
    } catch (error) {
      if (signal?.aborted) {
        throw readCodexBackgroundWorkAbortReason(signal)
      }
      this.poisoned = true
      await this.stop('background-work-boundary-failure')
      throw error
    }
  }

  private assertBackgroundWorkProcessAvailable(): void {
    if (
      this.initialized &&
      !this.poisoned &&
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      (
        this.state === 'idle' ||
        (this.state === 'reserved' && this.activeTurn === null)
      )
    ) {
      return
    }

    throw new VaultCliError(
      'ASSISTANT_CODEX_BACKGROUND_WORK_UNAVAILABLE',
      'Codex app-server background work could not be verified before the workspace boundary.',
      { retryable: true },
    )
  }

  private hasPendingDetachedChildren(): boolean {
    for (const threadId of this.detachedChildThreadIds) {
      if (!this.detachedCompletedChildThreadIds.has(threadId)) {
        return true
      }
    }
    return false
  }

  private async waitForDetachedChildren(signal: AbortSignal | null): Promise<void> {
    const deadline = Date.now() + CODEX_BACKGROUND_WORK_WAIT_TIMEOUT_MS
    while (this.hasPendingDetachedChildren()) {
      throwIfCodexBackgroundWorkWaitAborted(signal)
      this.assertBackgroundWorkProcessAvailable()
      this.assertDetachedChildContractSupported()
      if (Date.now() >= deadline) {
        throw new VaultCliError(
          'ASSISTANT_CODEX_BACKGROUND_WORK_TIMEOUT',
          `Codex background work did not finish within ${CODEX_BACKGROUND_WORK_WAIT_TIMEOUT_MS}ms.`,
          { retryable: true },
        )
      }
      await waitForCodexBackgroundWorkPoll(signal)
    }
  }

  private assertDetachedChildContractSupported(): void {
    if (this.detachedChildViolation) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_BACKGROUND_WORK_UNSUPPORTED',
        this.detachedChildViolation,
        { retryable: true },
      )
    }
  }

  private assertDetachedChildrenQuiescent(): void {
    this.assertDetachedChildContractSupported()
    if (this.hasPendingDetachedChildren()) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_BACKGROUND_WORK_FAILED',
        'Detached Codex work was still active at the workspace boundary.',
        { retryable: true },
      )
    }
  }

  private async assertNoBackgroundTerminals(
    signal: AbortSignal | null,
  ): Promise<void> {
    const threadIds = new Set([
      ...this.detachedRootThreadIds,
      ...this.detachedChildThreadIds,
    ])
    for (const threadId of threadIds) {
      throwIfCodexBackgroundWorkWaitAborted(signal)
      const result = await waitForCodexBackgroundWorkOperation(
        withCodexRpcTimeout(
          this.sendRequest('thread/backgroundTerminals/list', {
            threadId,
            limit: 1,
          }),
          CODEX_BACKGROUND_WORK_RPC_TIMEOUT_MS,
          'thread/backgroundTerminals/list',
        ),
        signal,
      )
      if (readCodexBackgroundTerminalPresence(result)) {
        throw new VaultCliError(
          'ASSISTANT_CODEX_BACKGROUND_TERMINAL_UNSUPPORTED',
          'Detached Codex work left a background terminal running at the workspace boundary.',
          { retryable: true },
        )
      }
    }
  }

  private clearDetachedChildBoundary(): void {
    this.detachedChildThreadIds.clear()
    this.detachedCompletedChildThreadIds.clear()
    this.detachedChildViolation = null
    this.detachedRootThreadIds.clear()
  }

  private recordDetachedChildViolation(message: string): void {
    this.detachedChildViolation ??= message
  }

  private observeDetachedChildLifecycle(message: CodexRpcMessage): void {
    const activity = readCodexSubagentActivity(message)
    if (activity) {
      const senderThreadId = extractCodexThreadIdFromMessage(message)
      if (activity.kind === 'malformed' || !activity.agentThreadId) {
        this.recordDetachedChildViolation(
          'Codex emitted a malformed detached-child lifecycle.',
        )
      } else if (activity.kind === 'started') {
        if (!senderThreadId || !this.detachedRootThreadIds.has(senderThreadId)) {
          this.recordDetachedChildViolation(
            'Detached Codex children may not spawn nested children.',
          )
        } else {
          this.detachedChildThreadIds.add(activity.agentThreadId)
        }
      } else {
        this.recordDetachedChildViolation(
          'Detached Codex children may not be messaged, reused, or interrupted.',
        )
      }
    }

    const method = typeof message.method === 'string' ? message.method : null
    if (!isCodexTurnCompletedMethod(method)) {
      return
    }
    const threadId = extractCodexThreadIdFromMessage(message)
    if (!threadId || this.detachedRootThreadIds.has(threadId)) {
      return
    }
    this.detachedCompletedChildThreadIds.add(threadId)
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
    if (this.stopPromise) {
      await this.stopPromise
      return
    }
    if (this.stopCompleted || this.state === 'stopped') {
      return
    }
    // Memoized while in flight so concurrent callers (a failed compaction's
    // poison and a racing turn's replacement stop) share one teardown instead
    // of double-signaling. Once settled, later calls either observe the stopped
    // state or retry an unsuccessful teardown.
    this.stopPromise = this.runStop(reason).finally(() => {
      this.stopPromise = null
    })
    await this.stopPromise
  }

  private async runStop(reason: string): Promise<void> {
    this.endReason ??= resolveCodexAppServerEndReason(reason)
    this.normalShutdown = true
    this.state = 'stopping'
    this.rejectPending(
      new VaultCliError(
        'ASSISTANT_CODEX_APP_SERVER_STOPPED',
        'Codex app-server stopped before its pending RPC completed.',
        {
          reason,
          retryable: true,
        },
      ),
    )
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
      this.canClaimForLaunch(launchKey) &&
      this.initialized &&
      this.initializationFailure === null
    )
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
        abortOwnsTermination: false,
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

  get hasUncheckpointedDetachedWork(): boolean {
    return (
      this.detachedChildThreadIds.size > 0 ||
      this.detachedChildViolation !== null
    )
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
      groupConversation: this.boundThreadGroupConversation,
      lastInputTokens,
      model: this.boundThreadModel,
      serviceTier: this.boundThreadServiceTier,
      threadId: update.threadId,
    }
  }

  // The most recent parent thread this process ran. A freshly bound turn can
  // use it to route late child-thread traffic before thread/start returns.
  noteBoundThreadId(threadId: string | null): void {
    if (threadId) {
      this.boundThreadId = threadId
      this.detachedRootThreadIds.add(threadId)
    }
  }

  noteBoundThreadServiceTier(serviceTier: AssistantProviderServiceTier | null): void {
    this.boundThreadServiceTier = serviceTier
  }

  noteBoundThreadGroupConversation(groupConversation: boolean): void {
    this.boundThreadGroupConversation = groupConversation
  }

  noteBoundThreadModel(model: string | null): void {
    this.boundThreadModel = normalizeNullableString(model)
  }

  // Exposed so a freshly bound turn can route foreign-thread events before
  // its own thread/start response has produced the new thread id.
  get lastBoundThreadId(): string | null {
    return this.boundThreadId
  }

  private handleIdleServerMessage(message: CodexRpcMessage): void {
    const responseId = readCodexRpcResponseId(message)
    if (responseId !== null) {
      const resolved = resolvePendingCodexRpcRequest({
        message,
        pendingRequests: this.pendingRequests,
        responseId,
      })
      if (resolved === 'unknown_response_id') {
        this.consumeIgnoredResponseId(responseId)
      }
      return
    }

    const requestId = readCodexRpcServerRequestId(message)
    if (requestId === null) {
      return
    }

    rejectCodexServerRequest({
      message: 'Server requests outside an active Codex turn are not supported.',
      requestId,
      writeRpcMessage: (payload) => void this.writeRpcMessage(payload),
    })
  }

  private handleStdoutLine(line: string): void {
    const parsed = tryParseJsonLine(line)
    if (parsed.ok) {
      this.observeDetachedChildLifecycle(parsed.value)
      this.observeThreadTokenUsage(parsed.value)
      if (this.activeTurn) {
        this.activeTurn.onParsedMessage(parsed.value)
      } else {
        this.handleIdleServerMessage(parsed.value)
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

    // Codex may emit lifecycle text while no Murph turn is bound. Do not kill
    // the resident app-server for output that cannot affect the current user.
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
      this.endReason ??= 'previous-process-exit'
      // Retain the exact-group signal as an idempotent fallback before
      // releasing parent-exit cleanup.
      this.signal('SIGKILL')
    }
    this.state = 'stopped'
    this.cleanupProcessExitListener()

    if (this.normalShutdown) {
      this.rejectPending(
        new VaultCliError(
          'ASSISTANT_CODEX_APP_SERVER_STOPPED',
          'Codex app-server closed before its pending RPC completed.',
          { retryable: true },
        ),
      )
      return
    }

    if (this.activeTurn) {
      this.activeTurn.onClose(code, signal)
      return
    }

    const failure = buildCodexProcessExitError({
      abortOwnsTermination: false,
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
        abortOwnsTermination: false,
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

function readCodexBackgroundTerminalPresence(value: unknown): boolean {
  const result = asCodexRecord(value)
  const data = result?.data
  if (!Array.isArray(data)) {
    throw new VaultCliError(
      'ASSISTANT_CODEX_BACKGROUND_WORK_PROTOCOL_ERROR',
      'Codex app-server returned an invalid background-terminal page at the workspace boundary.',
      { retryable: true },
    )
  }

  return data.length > 0
}

function readCodexSubagentActivity(message: CodexRpcMessage): {
  agentThreadId: string | null
  kind: 'interacted' | 'interrupted' | 'malformed' | 'started'
} | null {
  const method = typeof message.method === 'string' ? message.method : null
  if (method !== 'item/completed') {
    return null
  }
  const item = asCodexRecord(asCodexRecord(message.params)?.item)
  if (asCodexString(item?.type) !== 'subAgentActivity') {
    return null
  }
  const agentThreadId = asCodexString(item?.agentThreadId)
  const kind = asCodexString(item?.kind)
  if (!agentThreadId || (kind !== 'started' && kind !== 'interacted' && kind !== 'interrupted')) {
    return { agentThreadId: agentThreadId ?? null, kind: 'malformed' }
  }
  return { agentThreadId, kind }
}

function throwIfCodexBackgroundWorkWaitAborted(
  signal: AbortSignal | null,
): void {
  if (signal?.aborted) {
    throw readCodexBackgroundWorkAbortReason(signal)
  }
}

async function waitForCodexBackgroundWorkPoll(
  signal: AbortSignal | null,
): Promise<void> {
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CODEX_BACKGROUND_WORK_POLL_INTERVAL_MS)
    })
    return
  }

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      reject(readCodexBackgroundWorkAbortReason(signal))
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, CODEX_BACKGROUND_WORK_POLL_INTERVAL_MS)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  })
}

async function waitForCodexBackgroundWorkOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal | null,
): Promise<T> {
  if (!signal) {
    return await operation
  }
  throwIfCodexBackgroundWorkWaitAborted(signal)

  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(readCodexBackgroundWorkAbortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function readCodexBackgroundWorkAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Codex background-work wait was interrupted.', 'AbortError')
}

function resolveCodexAppServerEndReason(
  reason: string,
): CodexAppServerColdStartReason {
  switch (reason) {
    case 'idle-compaction-failed':
      return 'previous-idle-compaction-failure'
    case 'launch-identity-changed':
      return 'previous-launch-identity-change'
    case 'process-exited':
      return 'previous-process-exit'
    case 'process-unhealthy':
      return 'previous-process-unhealthy'
    case 'turn-completed-after-abort':
      return 'previous-turn-abort'
    case 'turn-failure':
      return 'previous-turn-failure'
    default:
      return 'previous-explicit-stop'
  }
}

let warmCodexProcess: CodexAppServerProcess | null = null
let warmCodexSlotLock: Promise<void> = Promise.resolve()
let warmCodexWorkspaceBoundaryActive = false

function buildWarmCodexWorkspaceBoundaryBusyError(): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_CODEX_APP_SERVER_BUSY',
    'Codex app-server cannot be claimed while a workspace boundary is active.',
    {
      retryable: true,
      state: 'workspace-boundary',
    },
  )
}

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
  if (warmCodexWorkspaceBoundaryActive) {
    throw buildWarmCodexWorkspaceBoundaryBusyError()
  }
  const launchKey = input.launchKey
  return await withWarmCodexSlotLock(async () => {
    const previousProcess = warmCodexProcess
    if (previousProcess) {
      if (previousProcess.canClaimForLaunch(launchKey)) {
        previousProcess.reserveTurn()
        return previousProcess
      }
      if (previousProcess.hasInFlightTurn) {
        throw previousProcess.buildBusyError(
          'Codex app-server process is already serving a turn.',
        )
      }
      const processExited =
        previousProcess.child.exitCode !== null ||
        previousProcess.child.signalCode !== null
      const stopReason = processExited
        ? 'process-exited'
        : previousProcess.launchKey !== launchKey
          ? 'launch-identity-changed'
          : 'process-unhealthy'
      await previousProcess.stop(stopReason)
    }

    const processInstance = new CodexAppServerProcess({
      ...input,
      coldStartReason:
        previousProcess?.nextColdStartReason ?? 'node-process-first-use',
    })
    warmCodexProcess = processInstance
    processInstance.reserveTurn()
    return processInstance
  })
}

async function stopExactUnclaimedWarmCodexProcess(
  processInstance: CodexAppServerProcess,
  reason: string,
): Promise<void> {
  await withWarmCodexSlotLock(async () => {
    if (
      warmCodexProcess !== processInstance ||
      !processInstance.hasUnclaimedSpeculativeInitialization
    ) {
      return
    }
    await processInstance.stop(reason)
  })
}

function createCodexAppServerPreinitialization(
  processInstance: CodexAppServerProcess,
): CodexAppServerPreinitialization {
  return {
    async cancelPending(): Promise<void> {
      try {
        await stopExactUnclaimedWarmCodexProcess(
          processInstance,
          'invocation-release-during-preinitialize',
        )
      } catch (error) {
        // An already-proven exit is sufficient for this optional optimization's
        // invocation-release boundary. Unproven teardown still fails closed.
        if (!processInstance.isStopped) {
          throw error
        }
      }
    },
  }
}

function readCodexPreinitializeAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException(
        'Codex app-server preinitialization was interrupted.',
        'AbortError',
      )
}

function beginCodexPreinitialize(
  processInstance: CodexAppServerProcess,
  signal: AbortSignal | null,
): void {
  const readiness = processInstance.initialize()
  const onAbort = () => {
    void stopExactUnclaimedWarmCodexProcess(
      processInstance,
      'preinitialize-aborted',
    ).catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    onAbort()
  }
  void readiness.then(
    () => {
      signal?.removeEventListener('abort', onAbort)
    },
    () => {
      signal?.removeEventListener('abort', onAbort)
      if (processInstance.isStoppingOrStopped) {
        return
      }
      void stopExactUnclaimedWarmCodexProcess(
        processInstance,
        'preinitialize-failure',
      ).catch(() => undefined)
    },
  )
}

export async function preinitializeCodexAppServer(
  input: CodexAppServerPreinitializeInput,
): Promise<CodexAppServerPreinitialization | null> {
  const signal = input.signal ?? null
  if (signal?.aborted) {
    throw readCodexPreinitializeAbortReason(signal)
  }
  if (warmCodexWorkspaceBoundaryActive) {
    return null
  }
  const processInput = await prepareCodexAppServerProcessInput(input)
  if (signal?.aborted) {
    throw readCodexPreinitializeAbortReason(signal)
  }
  if (warmCodexWorkspaceBoundaryActive) {
    return null
  }

  return await withWarmCodexSlotLock(async () => {
    if (signal?.aborted) {
      throw readCodexPreinitializeAbortReason(signal)
    }
    const processInstance = warmCodexProcess
    if (processInstance) {
      if (processInstance.canClaimForLaunch(processInput.launchKey)) {
        if (!processInstance.initializedForRpc) {
          processInstance.noteSpeculativeInitialization()
          beginCodexPreinitialize(processInstance, signal)
        }
        return createCodexAppServerPreinitialization(processInstance)
      }
      if (processInstance.hasInFlightTurn) {
        return null
      }
      if (processInstance.canClaimForLaunch(processInstance.launchKey)) {
        return null
      }
      const processExited =
        processInstance.child.exitCode !== null ||
        processInstance.child.signalCode !== null
      await processInstance.stop(
        processExited
          ? 'process-exited'
          : processInstance.launchKey !== processInput.launchKey
            ? 'launch-identity-changed'
            : 'process-unhealthy',
      )
    }

    if (signal?.aborted) {
      throw readCodexPreinitializeAbortReason(signal)
    }
    const preparedProcess = new CodexAppServerProcess({
      args: processInput.args,
      codexCommand: processInput.codexCommand,
      coldStartReason:
        processInstance?.nextColdStartReason ?? 'node-process-first-use',
      env: processInput.env,
      launchKey: processInput.launchKey,
    })
    preparedProcess.noteSpeculativeInitialization()
    warmCodexProcess = preparedProcess
    beginCodexPreinitialize(preparedProcess, signal)
    return createCodexAppServerPreinitialization(preparedProcess)
  })
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
  })
}

export async function waitForWarmCodexBackgroundWork(
  input: WaitForWarmCodexBackgroundWorkInput = {},
): Promise<void> {
  if (warmCodexWorkspaceBoundaryActive) {
    throw buildWarmCodexWorkspaceBoundaryBusyError()
  }
  warmCodexWorkspaceBoundaryActive = true
  try {
    const processInstance = await withWarmCodexSlotLock(async () => {
      const processInstance = warmCodexProcess
      if (!processInstance || processInstance.isStopped) {
        return null
      }
      if (processInstance.hasUnclaimedSpeculativeInitialization) {
        await processInstance.stop('workspace-boundary-during-preinitialize')
        return null
      }
      if (processInstance.hasInFlightTurn) {
        throw processInstance.buildBusyError(
          'Codex app-server process is serving a turn and cannot cross a workspace boundary.',
        )
      }
      if (!processInstance.isReusableFor(processInstance.launchKey)) {
        await processInstance.stop('workspace-boundary-process-unhealthy')
        return null
      }

      processInstance.reserveTurn()
      return processInstance
    })
    if (!processInstance) {
      return
    }

    try {
      await processInstance.waitForBackgroundWork(input)
    } finally {
      processInstance.releaseReservation()
    }
  } finally {
    warmCodexWorkspaceBoundaryActive = false
  }
}

registerStopWarmCodexAppServer(stopWarmCodexAppServer)
registerWaitForWarmCodexBackgroundWork(waitForWarmCodexBackgroundWork)

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

interface CodexManagedAccountLoginCompletion {
  error: string | null
  success: boolean
}

/**
 * Runs one managed ChatGPT account operation through the same app-server
 * transport used by turns. The child is intentionally short lived: account
 * notifications must never leak into the idle warm-turn process, and only one
 * process may write CODEX_HOME at a time.
 */
export async function executeCodexManagedAccountOperation(
  input: CodexManagedAccountOperationInput,
): Promise<CodexManagedAccountOperationResult> {
  if (warmCodexWorkspaceBoundaryActive) {
    throw buildWarmCodexWorkspaceBoundaryBusyError()
  }
  const workingDirectory = path.resolve(input.workingDirectory)
  await assertCodexAppServerWorkingDirectory(workingDirectory)
  const env = await resolveCodexChildEnv({
    codexHome: input.codexHome,
    env: input.env,
  })
  const codexCommand = resolveCodexAppServerCommand(input.codexCommand)
  const args = buildCodexAppServerArgs({
    configOverrides: CODEX_MANAGED_ACCOUNT_CONFIG_OVERRIDES,
  })
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
  })

  let settleAccountUpdate!: () => void
  let rejectAccountUpdate!: (error: unknown) => void
  const accountUpdate = new Promise<void>((resolve, reject) => {
    settleAccountUpdate = resolve
    rejectAccountUpdate = reject
  })
  void accountUpdate.catch(() => undefined)
  let settleCompletion!: (completion: CodexManagedAccountLoginCompletion) => void
  let rejectCompletion!: (error: unknown) => void
  const completion = new Promise<CodexManagedAccountLoginCompletion>((resolve, reject) => {
    settleCompletion = resolve
    rejectCompletion = reject
  })
  void completion.catch(() => undefined)
  let expectedLoginId: string | null = null
  let acceptChatGptAccountUpdate = false
  let bufferedChatGptAccountUpdate = false
  const bufferedCompletions = new Map<string, CodexManagedAccountLoginCompletion>()

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
      if (!loginId) {
        return
      }
      const completionResult: CodexManagedAccountLoginCompletion = {
        error: asCodexString(params?.error),
        success: params?.success === true,
      }
      if (loginId === expectedLoginId) {
        settleCompletion(completionResult)
      } else {
        bufferedCompletions.set(loginId, completionResult)
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

    const loginCompletion = await withCodexRpcTimeout(
      completion,
      normalizeCodexManagedAccountTimeout(input.timeoutMs),
      'account/login/completed',
    )
    if (!loginCompletion.success) {
      throw new VaultCliError(
        'ASSISTANT_CODEX_AUTH_FAILED',
        'ChatGPT account authentication did not complete successfully.',
        {
          ...(loginCompletion.error ? { codexLoginError: loginCompletion.error } : {}),
          retryable: false,
        },
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
  source: 'estimated'
  totalTokens: number
}

function estimateCodexWarmThreadCompactionUsage(
  threadContextTokensBefore: number,
): CodexWarmThreadCompactionUsage {
  // Codex idle compaction consumes the provider response without
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

export type CodexWarmThreadCompactionOutcome =
  | {
      kind: 'compacted'
      durationMs: number
      model: string | null
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
      reason:
        | 'background_work_pending'
        | 'below_threshold'
        | 'model_not_accountable'
        | 'no_thread_vitals'
        | 'no_warm_process'
        | 'turn_in_flight'
      model?: string | null
      threadContextTokensBefore: number | null
    }

// Non-turn compaction of the warm Codex thread, for idle-time maintenance.
// Modeled on the other warm-slot lifecycle exports above. Failure handling is
// deliberately blunt: any non-success poisons (kills) the warm process. A
// process retaining detached-child evidence is therefore ineligible until the
// workspace boundary has waited for and scanned that work. Once eligible, an
// aborted compact leaves the thread uncompacted and the next turn spawns a
// fresh process and resumes natively. Teardown is awaited on every failure
// path because the idle checkpoint that follows snapshots the Codex home,
// including rollout files, and must never capture a rollout mid-teardown.
export async function compactWarmCodexThread(input: {
  canAccountForModel?: ((model: string | null) => boolean) | null
  groupMinThreadTokens?: number
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
    if (input.canAccountForModel && !input.canAccountForModel(vitals.model)) {
      return {
        kind: 'skipped',
        model: vitals.model,
        reason: 'model_not_accountable',
        threadContextTokensBefore: vitals.lastInputTokens,
      } as const
    }
    const minThreadTokens = vitals.groupConversation
      ? input.groupMinThreadTokens ?? input.minThreadTokens
      : input.minThreadTokens
    if (vitals.lastInputTokens < minThreadTokens) {
      return {
        kind: 'skipped',
        reason: 'below_threshold',
        threadContextTokensBefore: vitals.lastInputTokens,
      } as const
    }
    if (processInstance.hasUncheckpointedDetachedWork) {
      return {
        kind: 'skipped',
        reason: 'background_work_pending',
        threadContextTokensBefore: vitals.lastInputTokens,
      } as const
    }

    processInstance.reserveTurn()
    return {
      kind: 'reserved',
      processInstance,
      vitals,
    } as const
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

      const requestId = readCodexRpcServerRequestId(message)
      if (requestId !== null) {
        rejectCodexServerRequest({
          message: 'Server requests during idle Codex compaction are not supported.',
          requestId,
          writeRpcMessage: (payload) => void processInstance.writeRpcMessage(payload),
        })
        return
      }

      const messageThreadId = extractCodexThreadIdFromMessage(message)
      if (messageThreadId !== null && messageThreadId !== vitals.threadId) {
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
        model: vitals.model,
        threadContextTokensBefore: vitals.lastInputTokens,
        threadId: vitals.threadId,
        serviceTier: vitals.serviceTier,
        usage: estimateCodexWarmThreadCompactionUsage(vitals.lastInputTokens),
      }
    }

    await processInstance.poison('idle-compaction-failed')
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
  }
}

function hashCodexRawString(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('hex')
}

function readCodexEventMethod(message: CodexRpcMessage): string | null {
  return typeof message.method === 'string' ? message.method : null
}

function isCodexTurnStartedMethod(method: string | null): boolean {
  return method === 'turn/started'
}

function createCodexSubagentTurnUsageKey(input: {
  threadId: string
  turnId: string
}): string {
  return `${input.threadId}\u0000${input.turnId}`
}

function isCodexTurnCompletedMethod(method: string | null): boolean {
  return method === 'turn/completed'
}

type CodexTransportDiagnosticSource = {
  additionalDetails: string | null
  message: string
  sourceMethod: 'error' | 'warning'
  threadIdPresent: boolean
  turnIdPresent: boolean
  willRetry: boolean | null
}

function buildCodexTransportDiagnosticsTraceEvent(input: {
  codexThreadId: string | null
  message: CodexRpcMessage
  method: string | null
  providerActionCount: number
  turnId: string | null
}): Record<string, unknown> | null {
  const source = readCodexTransportDiagnosticSource(input.message, input.method)
  if (!source) {
    return null
  }

  const diagnosticText = [source.message, source.additionalDetails]
    .filter((value): value is string => typeof value === 'string')
    .join('\n')
    .slice(0, 4096)
  const normalizedText = diagnosticText.toLowerCase()
  const retryProgress = readCodexTransportRetryProgress(diagnosticText)
  const fallbackActivated =
    normalizedText.includes('falling back from websockets to https transport')
  const idleTimeout =
    normalizedText.includes('idle timeout waiting for websocket') ||
    normalizedText.includes('idle timeout waiting for sse')
  const streamDisconnected =
    normalizedText.includes('stream disconnected') ||
    normalizedText.includes('response stream disconnected')

  if (!fallbackActivated && !idleTimeout && !streamDisconnected && !retryProgress) {
    return null
  }

  const transport = normalizedText.includes('websocket')
    ? 'websocket'
    : normalizedText.includes('https') ||
        normalizedText.includes('http') ||
        normalizedText.includes('sse')
      ? 'http'
      : 'unknown'
  const eventKind = fallbackActivated
    ? 'transport-fallback'
    : idleTimeout
      ? 'stream-idle-timeout'
      : retryProgress
        ? 'stream-retry'
        : 'stream-disconnected'
  const terminalStreamFailure =
    source.willRetry === false && (idleTimeout || streamDisconnected)

  return {
    schema: CODEX_TRANSPORT_DIAGNOSTICS_TRACE_SCHEMA,
    type: CODEX_TRANSPORT_DIAGNOSTICS_TRACE_TYPE,
    codexTransportAdditionalDetailsPresent: source.additionalDetails !== null,
    codexTransportErrorMessageLength: diagnosticText.length,
    codexTransportErrorMessagePresent: source.message.length > 0,
    codexTransportEventKind: eventKind,
    codexTransportFallbackActivated: fallbackActivated,
    codexTransportIdleTimeout: idleTimeout,
    codexTransportProviderActionCount: input.providerActionCount,
    codexTransportRetryCount: retryProgress?.retryCount ?? null,
    codexTransportRetryMax: retryProgress?.retryMax ?? null,
    codexTransportRetryExhausted: terminalStreamFailure,
    codexTransportSourceMethod: source.sourceMethod,
    codexTransportStreamDisconnected: streamDisconnected,
    codexTransportTerminalAfterProviderAction:
      terminalStreamFailure && input.providerActionCount > 0,
    codexTransportThreadIdPresent:
      source.threadIdPresent || input.codexThreadId !== null,
    codexTransportTransport: transport,
    codexTransportTurnIdPresent: source.turnIdPresent || input.turnId !== null,
    codexTransportWillRetry: source.willRetry,
  }
}

function readCodexTransportDiagnosticSource(
  message: CodexRpcMessage,
  method: string | null,
): CodexTransportDiagnosticSource | null {
  const params = readCodexRecordField(message, 'params')
  if (method === 'warning') {
    const warningMessage = readCodexStringField(params, 'message')
    if (!warningMessage) {
      return null
    }
    return {
      additionalDetails: null,
      message: warningMessage,
      sourceMethod: 'warning',
      threadIdPresent: readCodexStringField(params, 'threadId') !== null,
      turnIdPresent: false,
      willRetry: null,
    }
  }

  if (method !== 'error') {
    return null
  }

  const error = readCodexRecordField(params, 'error')
  const errorMessage = readCodexStringField(error, 'message')
  if (!errorMessage) {
    return null
  }

  return {
    additionalDetails: readCodexStringField(error, 'additionalDetails'),
    message: errorMessage,
    sourceMethod: 'error',
    threadIdPresent: readCodexStringField(params, 'threadId') !== null,
    turnIdPresent: readCodexStringField(params, 'turnId') !== null,
    willRetry: readCodexBooleanField(params, 'willRetry'),
  }
}

function readCodexTransportRetryProgress(
  value: string,
): { retryCount: number; retryMax: number } | null {
  const match = /\bReconnecting\.\.\.\s+(\d+)\/(\d+)\b/iu.exec(value)
  if (!match) {
    return null
  }

  const retryCount = Number(match[1])
  const retryMax = Number(match[2])
  return Number.isSafeInteger(retryCount) &&
    retryCount >= 0 &&
    Number.isSafeInteger(retryMax) &&
    retryMax >= 0
    ? { retryCount, retryMax }
    : null
}

function readCodexRecordField(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const fieldValue = (value as Record<string, unknown>)[key]
  return fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)
    ? fieldValue as Record<string, unknown>
    : null
}

function readCodexStringField(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const fieldValue = value?.[key]
  if (typeof fieldValue !== 'string') {
    return null
  }

  const normalized = fieldValue.trim()
  return normalized.length > 0 ? normalized : null
}

function readCodexBooleanField(
  value: Record<string, unknown> | null,
  key: string,
): boolean | null {
  const fieldValue = value?.[key]
  return typeof fieldValue === 'boolean' ? fieldValue : null
}

function readCodexDynamicToolKey(message: CodexRpcMessage): string | null {
  const params = readCodexRecordField(message, 'params')
  const namespace = readCodexStringField(params, 'namespace')
  const tool = readCodexStringField(params, 'tool')
  return namespace && tool ? `${namespace}.${tool}` : null
}

async function runCodexAppServerTurnOnProcess(
  codexProcess: CodexAppServerProcess,
  input: CodexAppServerPreparedTurnInput,
): Promise<CodexAppServerTurnResult> {
  const providerStartCriticalPath = stampAssistantProviderStartCriticalPath(
    input.providerStartCriticalPath,
    'codexAppServerProcessTurnStartedAtMonotonicMs',
  )
  const hostedCanonicalWritePort = readHostedCanonicalWritePort()
  let stdout = ''
  let stderr = ''
  let settled = false
  let normalShutdown = false
  let abortRequested = false
  let lifecycleStage = 'spawn_start'
  let terminationSignalSent: NodeJS.Signals | null = null
  const requestedResumeThreadId =
    normalizeNullableString(input.resumeSessionId) ?? null
  const offeredDynamicToolKeys = new Set(
    input.dynamicTools.map((tool) => `${tool.namespace}.${tool.name}`),
  )
  let codexThreadId: string | null = null
  let turnId: string | null = null
  const isReusedWarmProcess = codexProcess.hasCompletedTurn
  // Completed final-phase agent messages that were followed by a steered
  // user-message item and then superseded by a newer response segment in the
  // same turn. A closed segment is held as a candidate until newer text or
  // media appears; if the turn ends at the steer boundary, that segment remains
  // the final reply rather than a preceding duplicate.
  const precedingAgentMessageSegments: CodexAppServerResponseSegment[] = []
  let completedFinalAgentMessage: string | null = null
  let firstAssistantResponseCompleted = false
  let trailingSteerCandidate: CodexAppServerTrailingResponseCandidate | null = null
  let completedUserMessageOrdinal = -1
  let lastEventError: string | null = null
  let lastEventErrorInfo: CodexStructuredErrorInfo | null = null
  let responseMedia: AssistantResponseMedia[] = []
  let responseCard: AssistantResponseCard | null = null
  let responseCardTextFallback: CompactTableWorkoutResponseCardV1 | null = null
  const assistantStyleSettingsOverlay: AssistantStyleTurnSettingsOverlay = {
    settings: {},
  }
  let finalActionPatches: Array<{
    deliveryContextOrdinal: number
    patch: MurphDynamicToolFinalActionPatch
  }> = []
  const acceptedNoReplyDeliveryContextOrdinals: number[] = []
  let noReplySettlementStarted = false
  let reactionPatches: Array<{
    deliveryContextOrdinal: number
    patch: MurphDynamicToolReactionPatch
  }> = []
  let replyTargetPatches: Array<{
    deliveryContextOrdinal: number
    patch: MurphDynamicToolReplyTargetPatch
  }> = []
  const reservedNoReplyDeliveryContextOrdinals = new Set<number>()
  const additionalUsages: AssistantProviderUsageDraft[] = []
  let nextDynamicToolUsageOrdinal = (input.providerRequestOrdinal ?? 0) + 1
  // Trusted turn-scoped provider-call ceilings: one counter per assistant turn,
  // owned here and threaded into the dynamic-tool executor.
  const analyzeVideoTurnState = createAnalyzeVideoTurnState()
  const askGrokTurnState = createAskGrokTurnState()
  const groupSharedReadTurnState = {
    currentSenderDecisionByMessageRef: new Map(),
    invalid: false,
    readProjectionScopeKeyBatches: [],
    roster: null,
  }
  const automationRelativeDateReferenceWindows: Array<
    AssistantAcceptedTurnInputReferenceWindow | null
  > = [
    input.automationRelativeDateReferenceWindow
      ? { ...input.automationRelativeDateReferenceWindow }
      : null,
  ]
  const generateSongTurnState = input.generateSongPolicy
    ? {
        attemptCount: 0,
        policy: input.generateSongPolicy,
      }
    : null
  const subagentTokenUsageByTurn =
    new Map<string, CodexSubagentTurnTokenUsageSample>()
  const trackedSubagentUsageThreadIds = new Set<string>()
  // Thread ids named by this turn's collab tool calls (spawn/sendInput/...),
  // collected live so evidenced subagent threads win buffer slots over
  // stale/unattributed foreign threads when the cap is reached.
  const collabReceiverThreadIds = new Set<string>()
  let rolloutRelativePath: string | null = null
  let providerActionCount = 0
  const providerActionItemIds = new Set<string>()
  const jsonEvents: unknown[] = []
  const runtimeIssueInputs: AssistantRuntimeIssueInput[] = []
  const actionRuntimeIssueTracker = createCodexActionRuntimeIssueTracker()
  let computerToolsLockedAfterUserPause = false
  const requiredVaultFileApprovalUrls: string[] = []
  const requiredAutomationLocalAtClarifications =
    new Map<string, RequiredAutomationLocalAtClarification>()
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
  const codexAppServerTurnStartedAt = lastTimingAt
  const codexAppServerProviderStartTiming: AssistantProviderRequestStartTiming = {}
  let codexProviderRequestStartedAtMs: number | null = null
  let codexTimingTurnStartAckElapsedMs: number | null = null
  let codexTimingTurnStartedNotificationElapsedMs: number | null = null
  let codexTimingTurnCompletedNotificationElapsedMs: number | null = null
  let currentTurnStartedNotificationObserved = false
  let liveInterruptRequested = false
  let terminalNoReplyInterruptRequested = false

  let completeTurn: (() => void) | null = null
  let failTurn: ((error: unknown) => void) | null = null
  let liveTurnOpen = false
  let turnTerminal = false
  let providerRequestStartedNotified = false
  let contextCompactionProgressNotified = false
  let contextCompactionProgressPending = false
  let releaseLiveTurn = () => {}
  const pendingDynamicToolRequests = new Set<Promise<void>>()
  const pendingProgressDeliveries = new Set<Promise<void>>()
  let dynamicToolExecutionChain: Promise<void> = Promise.resolve()
  const dynamicToolAbortController = new AbortController()
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

  const buildRecordedTerminationError = (
    fallback: string | null,
  ): VaultCliError | null => {
    const recordedEndReason = codexProcess.recordedEndReason
    if (
      recordedEndReason !== 'previous-process-exit' &&
      recordedEndReason !== 'previous-turn-abort'
    ) {
      return null
    }

    return buildCodexProcessExitError({
      abortOwnsTermination: recordedEndReason === 'previous-turn-abort',
      code: codexProcess.child.exitCode,
      diagnostics: buildProcessExitDiagnostics(),
      errorInfo: lastEventErrorInfo,
      fallback,
      providerActionCount,
      codexThreadId,
      signal: codexProcess.child.signalCode ?? null,
      stderr,
    })
  }

  // Subagent usage drafts are derived lazily from the buffered per-thread
  // samples so both the success result and the failure context can include
  // whatever child usage was observed before the turn settled.
  const buildSubagentUsageDrafts = (): AssistantProviderUsageDraft[] =>
    extractCodexSubagentUsageDrafts({
      modelProvider: normalizeNullableString(input.modelProvider) ?? null,
      ordinalStart: nextDynamicToolUsageOrdinal,
      parentModel: normalizeNullableString(input.model) ?? null,
      parentRawEvents: jsonEvents,
      serviceTier: input.serviceTier ?? null,
      subagentTokenUsageByTurn,
    })

  const hasNoReplyFinalActionPatch = (): boolean =>
    finalActionPatches.some((entry) => entry.patch.kind === 'none')

  const listNoReplyFinalActionPatchOrdinals = (): number[] =>
    [...new Set(
      finalActionPatches
        .filter((entry) => entry.patch.kind === 'none')
        .map((entry) => entry.deliveryContextOrdinal),
    )].sort((left, right) => left - right)

  const hasRequiredUserVisibleOutput = (): boolean =>
    computerToolsLockedAfterUserPause ||
    requiredAutomationLocalAtClarifications.size > 0 ||
    requiredVaultFileApprovalUrls.length > 0

  const settleNoReplyFinalActions = async (): Promise<void> => {
    if (hasRequiredUserVisibleOutput() || noReplySettlementStarted) {
      return
    }
    noReplySettlementStarted = true
    for (const deliveryContextOrdinal of listNoReplyFinalActionPatchOrdinals()) {
      await input.onFinishWithoutReplyAccepted?.({
        deliveryContextOrdinal,
        // The accepted event settles the cumulative accepted-turn prefix
        // through this ordinal, so a reaction recorded for any covered
        // earlier context must keep terminal suppression evidence deferred
        // until reaction delivery settles.
        messageReactionPending: reactionPatches.some(
          (entry) => entry.deliveryContextOrdinal <= deliveryContextOrdinal,
        ),
      })
      acceptedNoReplyDeliveryContextOrdinals.push(deliveryContextOrdinal)
      await input.onFinishWithoutReplyRecorded?.({
        deliveryContextOrdinal,
      })
    }
  }

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
        [...acceptedNoReplyDeliveryContextOrdinals],
      reactions: reactionPatches.map((entry) => ({
        deliveryContextOrdinal: entry.deliveryContextOrdinal,
        reaction: entry.patch.reaction,
        targetInputId: entry.patch.targetInputId,
      })),
      codexThreadId,
      providerTurnId: turnId,
      rolloutRelativePath,
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
      if (codexProcess.recordedEndReason !== 'previous-process-exit') {
        normalShutdown = true
      }
      rejectOnce(buildInterruptCleanupTimeoutError())
    }, CODEX_APP_SERVER_INTERRUPT_CLEANUP_TIMEOUT_MS)
    interruptCleanupTimer.unref?.()
  }

  const emitAppServerTimingTrace = (stage: string) => {
    const now = Date.now()
    const elapsedMs = Math.max(0, now - lastTimingAt)
    if (stage === 'spawn-ready') {
      codexAppServerProviderStartTiming.codexAppServerSpawnReadyMs = elapsedMs
    } else if (stage === 'initialized') {
      codexAppServerProviderStartTiming.codexAppServerInitializeMs = elapsedMs
    } else if (stage === 'warm-reused') {
      codexAppServerProviderStartTiming.codexAppServerWarmReuseMs = elapsedMs
    } else if (stage === 'thread-resumed') {
      codexAppServerProviderStartTiming.codexAppServerThreadResumeMs = elapsedMs
    } else if (stage === 'thread-started') {
      codexAppServerProviderStartTiming.codexAppServerThreadStartMs = elapsedMs
    }
    lastTimingAt = now
    if (!input.onTraceEvent) {
      return
    }

    try {
      input.onTraceEvent({
        codexThreadId,
        rawEvent: {
          schema: CODEX_APP_SERVER_TIMING_TRACE_SCHEMA,
          type: CODEX_APP_SERVER_TIMING_TRACE_TYPE,
          ...(stage === 'initialized' || stage === 'preinitialized'
            ? {
                codexTimingColdStartReason: codexProcess.coldStartReason,
              }
            : {}),
          codexTimingElapsedMs: elapsedMs,
          codexTimingProviderActionCount: providerActionCount,
          codexTimingThreadIdPresent: codexThreadId !== null,
          codexTimingStage: stage,
          codexTimingTotalElapsedMs: codexProcess.processLifetimeMs,
          codexTimingTurnIdPresent: turnId !== null,
          ...(stage === 'turn-completed' && codexProviderRequestStartedAtMs !== null
            ? {
                // Every cumulative field below is measured from the local
                // turn/start request write. These are App Server/runtime
                // boundaries, not upstream provider request or SSE timing.
                ...(typeof input.providerRequestOrdinal === 'number'
                  ? { codexTimingProviderRequestOrdinal: input.providerRequestOrdinal }
                  : {}),
                // This ends when the completion trace is emitted after local
                // dynamic-tool/progress drains. The outer provider-result
                // boundary is recorded separately by assistant.turn.timing.
                codexTimingTurnCompleteElapsedMs: Math.max(
                  0,
                  now - codexProviderRequestStartedAtMs,
                ),
                ...(codexTimingTurnStartAckElapsedMs === null
                  ? {}
                  : { codexTimingTurnStartAckElapsedMs }),
                ...(codexTimingTurnStartedNotificationElapsedMs === null
                  ? {}
                  : { codexTimingTurnStartedNotificationElapsedMs }),
                ...(codexTimingTurnCompletedNotificationElapsedMs === null
                  ? {}
                  : {
                      codexTimingTurnCompletedNotificationElapsedMs,
                    }),
              }
            : {}),
        },
        updates: [],
      })
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

    const fallback = buildCodexStdinFailureFallback({
      error,
      lastEventError,
      stderr,
    })
    const failure =
      stdinFailure ??
      buildCodexProcessExitError({
        abortOwnsTermination: false,
        code: codexProcess.child.exitCode,
        diagnostics: buildProcessExitDiagnostics(),
        errorInfo: lastEventErrorInfo,
        fallback,
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
      codexProcess.noteTurnAbort()
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

  const removeAssistantTraceUpdateFromFinalFallback = (
    update: AssistantProviderTraceUpdate,
  ): void => {
    if (update.kind !== 'assistant') {
      return
    }

    const streamKey = normalizeAssistantTraceStreamKey(update)
    assistantStreams.delete(streamKey)
    const streamOrderIndex = assistantStreamOrder.indexOf(streamKey)
    if (streamOrderIndex >= 0) {
      assistantStreamOrder.splice(streamOrderIndex, 1)
    }
  }

  // App-server events mutate this state inside the asynchronous message
  // handler, so finalization reads it through an explicitly typed boundary.
  const readTrailingSteerCandidate = (): CodexAppServerTrailingResponseCandidate | null =>
    trailingSteerCandidate

  const promoteTrailingSteerCandidate = (): void => {
    if (!trailingSteerCandidate) {
      return
    }

    const response = trailingSteerCandidate.card
      ? renderAssistantResponseCardText(trailingSteerCandidate.card)
      : trailingSteerCandidate.cardTextFallback
        ? renderAssistantWorkoutResponseCardText(
            trailingSteerCandidate.cardTextFallback,
          )
        : trailingSteerCandidate.response
    const transcriptResponse = trailingSteerCandidate.card
      ? renderAssistantResponseCardTranscriptText(trailingSteerCandidate.card)
      : trailingSteerCandidate.cardTextFallback
        ? renderAssistantWorkoutResponseCardTranscriptText(
            trailingSteerCandidate.cardTextFallback,
          )
        : response
    precedingAgentMessageSegments.push({
      deliveryContextOrdinal: trailingSteerCandidate.deliveryContextOrdinal,
      media: [...trailingSteerCandidate.media],
      response,
      ...(transcriptResponse === response ? {} : { transcriptResponse }),
      ...(trailingSteerCandidate.targetInputId
        ? { targetInputId: trailingSteerCandidate.targetInputId }
        : {}),
    })
    trailingSteerCandidate = null
  }

  const notifyProviderRequestStarted = (
    providedStartedAtMonotonicMs?: number,
  ) => {
    if (providerRequestStartedNotified) {
      return
    }
    providerRequestStartedNotified = true
    const providerStartedAtMonotonicMs = providedStartedAtMonotonicMs
      ?? readAssistantProviderStartMonotonicTickMs()
    const startedAtMs = Date.now()
    codexProviderRequestStartedAtMs = startedAtMs
    const completedProviderStartCriticalPath =
      input.providerRequestOrdinal === 0
        ? completeAssistantProviderStartCriticalPath(
            providerStartCriticalPath,
            providerStartedAtMonotonicMs,
          )
        : null
    notifyCodexAppServerProviderRequestStartedBestEffort({
      hook: input.onProviderRequestStarted ?? null,
      startedAt: new Date(startedAtMs).toISOString(),
      timing: {
        ...codexAppServerProviderStartTiming,
        codexAppServerPreProviderMs: Math.max(
          0,
          startedAtMs - codexAppServerTurnStartedAt,
        ),
        ...(completedProviderStartCriticalPath
          ? { providerStartCriticalPath: completedProviderStartCriticalPath }
          : {}),
      },
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

  const notifyContextCompactionProgress = (
    deliveryContextOrdinal: number,
    text: string,
  ): boolean => {
    const progressDelivery = resolveCodexAppServerProgressDelivery(input)
    if (
      !progressDelivery ||
      contextCompactionProgressNotified ||
      contextCompactionProgressPending
    ) {
      return false
    }

    let progressPromise: Promise<AssistantProgressDeliveryResult>
    try {
      contextCompactionProgressPending = true
      progressPromise = progressDelivery.send(text, {
        deliveryContextOrdinal,
        required: true,
        source: 'system',
      })
    } catch {
      contextCompactionProgressPending = false
      return false
    }
    progressPromise = progressPromise.then((result) => {
      if (result.kind === 'sent') {
        contextCompactionProgressNotified = true
      } else {
        contextCompactionProgressPending = false
      }
      return result
    }, (error: unknown) => {
      contextCompactionProgressPending = false
      throw error
    })
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

  const trackDynamicToolRequest = (promise: Promise<void>): void => {
    const tracked = promise
      .catch((error: unknown) => {
        rejectOnce(error)
      })
      .finally(() => {
        pendingDynamicToolRequests.delete(tracked)
      })
    pendingDynamicToolRequests.add(tracked)
  }

  const drainPendingDynamicToolRequests = async (): Promise<void> => {
    while (pendingDynamicToolRequests.size > 0) {
      await Promise.all([...pendingDynamicToolRequests])
    }
  }

  const drainPendingProgressDeliveries = async (): Promise<void> => {
    while (pendingProgressDeliveries.size > 0) {
      await waitForCodexProgressDrain([
        ...pendingProgressDeliveries,
      ])
    }
  }

  // Stateful dynamic tools run serialized in request order so response media,
  // preference and configuration writes, final-action patches, and computer
  // pause barriers apply deterministically even if Codex overlaps tool requests.
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

  const hasAcceptedNoReplyPatchForDeliveryContext = (
    deliveryContextOrdinal: number,
  ): boolean =>
    finalActionPatches.some((entry) =>
      entry.deliveryContextOrdinal === deliveryContextOrdinal &&
      entry.patch.kind === 'none'
    )

  const applyResponseMediaPatch = (
    patch: {
      media: AssistantResponseMedia[]
      op: 'append' | 'replace'
    },
    deliveryContextOrdinal: number,
  ): void => {
    if (hasAcceptedNoReplyPatchForDeliveryContext(deliveryContextOrdinal)) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_MEDIA_AFTER_NO_REPLY',
        'Response media cannot be attached after finish_without_reply.',
      )
    }
    const nextMedia = patch.op === 'replace'
      ? patch.media
      : normalizeAssistantResponseMediaList([...responseMedia, ...patch.media])
    if (nextMedia.length > ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_MEDIA_LIMIT_EXCEEDED',
        `Assistant responses may attach at most ${ASSISTANT_AUTHORED_RESPONSE_MEDIA_MAX_ITEMS} media items.`,
      )
    }
    if (responseCard !== null && nextMedia.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
        'Response media cannot be combined with a response card.',
      )
    }
    if (responseCardTextFallback !== null && nextMedia.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
        'Response media cannot be combined with response card text recovery.',
      )
    }
    responseMedia = nextMedia
  }

  const applyResponseCardPatch = (
    card: AssistantResponseCard,
    deliveryContextOrdinal: number,
  ): void => {
    if (
      deliveryContextOrdinal !== 0 ||
      currentDeliveryContextOrdinal() !== deliveryContextOrdinal
    ) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_CONTEXT_ADVANCED',
        'A response card cannot attach after accepted input advances the response context.',
      )
    }
    if (hasAcceptedNoReplyPatchForDeliveryContext(deliveryContextOrdinal)) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_AFTER_NO_REPLY',
        'A response card cannot be attached after finish_without_reply.',
      )
    }
    if (responseCard !== null) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_LIMIT_REACHED',
        'Only one response card may be attached to a final response.',
      )
    }
    if (responseCardTextFallback !== null) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_LIMIT_REACHED',
        'Only one response card outcome may be attached to a final response.',
      )
    }
    if (responseMedia.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
        'A response card cannot be combined with response media.',
      )
    }
    if (requiredVaultFileApprovalUrls.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_VAULT_FILE_CONFLICT',
        'A response card cannot replace a required vault-file approval link.',
      )
    }
    responseCard = card
  }

  const applyResponseCardTextFallbackPatch = (
    card: CompactTableWorkoutResponseCardV1,
    deliveryContextOrdinal: number,
  ): void => {
    if (
      deliveryContextOrdinal !== 0 ||
      currentDeliveryContextOrdinal() !== deliveryContextOrdinal
    ) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_CONTEXT_ADVANCED',
        'Response card text recovery cannot attach after accepted input advances the response context.',
      )
    }
    if (hasAcceptedNoReplyPatchForDeliveryContext(deliveryContextOrdinal)) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_AFTER_NO_REPLY',
        'Response card text recovery cannot attach after finish_without_reply.',
      )
    }
    if (responseCard !== null || responseCardTextFallback !== null) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_LIMIT_REACHED',
        'Only one response card outcome may be attached to a final response.',
      )
    }
    if (responseMedia.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
        'Response card text recovery cannot be combined with response media.',
      )
    }
    if (requiredVaultFileApprovalUrls.length > 0) {
      throw new VaultCliError(
        'ASSISTANT_RESPONSE_CARD_VAULT_FILE_CONFLICT',
        'Response card text recovery cannot replace a required vault-file approval link.',
      )
    }
    responseCardTextFallback = card
  }

  const canApplyNoReplyPatch = (deliveryContextOrdinal: number): boolean => {
    const trailingSteerCandidateOrdinal =
      trailingSteerCandidate?.deliveryContextOrdinal
    if (
      externallyVisibleAssistantOutputDeliveryContexts.has(deliveryContextOrdinal) ||
      hasPendingExternallyVisibleAssistantOutput(deliveryContextOrdinal)
    ) {
      return false
    }
    if (
      typeof trailingSteerCandidateOrdinal === 'number' &&
      trailingSteerCandidateOrdinal < deliveryContextOrdinal
    ) {
      return false
    }
    if (responseMedia.length > 0) {
      return false
    }
    if (responseCard !== null) {
      return false
    }
    if (responseCardTextFallback !== null) {
      return false
    }
    if (
      precedingAgentMessageSegments.some((segment) =>
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
    const existingPatch = resolveFinalActionPatch(deliveryContextOrdinal)
    if (patch.kind === 'reply-required') {
      finalActionPatches = [
        ...finalActionPatches.filter(
          (action) => action.deliveryContextOrdinal !== deliveryContextOrdinal,
        ),
        { deliveryContextOrdinal, patch },
      ]
      reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
      return true
    }
    if (patch.owner !== 'vault-file' && existingPatch?.kind === 'reply-required') {
      return false
    }
    if (
      (computerToolsLockedAfterUserPause ||
        !canApplyNoReplyPatch(deliveryContextOrdinal))
    ) {
      return false
    }

    if (existingPatch) {
      if (patch.owner === 'vault-file') {
        finalActionPatches = [
          ...finalActionPatches.filter(
            (action) => action.deliveryContextOrdinal !== deliveryContextOrdinal,
          ),
          { deliveryContextOrdinal, patch },
        ]
        replyTargetPatches = replyTargetPatches.filter(
          (entry) => entry.deliveryContextOrdinal !== deliveryContextOrdinal,
        )
        reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
      }
      return true
    }

    finalActionPatches = [
      ...finalActionPatches,
      {
        deliveryContextOrdinal,
        patch,
      },
    ]
    replyTargetPatches = replyTargetPatches.filter(
      (entry) => entry.deliveryContextOrdinal !== deliveryContextOrdinal,
    )
    reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
    return true
  }

  const applyTerminalExternalEffectNoReplyPatch = (
    patch: Extract<MurphDynamicToolFinalActionPatch, { kind: 'none' }>,
    deliveryContextOrdinal: number,
  ): void => {
    // A host-authorized external effect has crossed its delivery boundary.
    // Its terminal disposition is not a model-requested finish_without_reply
    // and must not depend on trace callback visibility.
    finalActionPatches = [
      ...finalActionPatches.filter(
        (action) => action.deliveryContextOrdinal !== deliveryContextOrdinal,
      ),
      { deliveryContextOrdinal, patch },
    ]
    replyTargetPatches = replyTargetPatches.filter(
      (entry) => entry.deliveryContextOrdinal !== deliveryContextOrdinal,
    )
    reservedNoReplyDeliveryContextOrdinals.delete(deliveryContextOrdinal)
  }

  const resolveFinalActionPatch = (
    deliveryContextOrdinal: number,
  ): MurphDynamicToolFinalActionPatch | null =>
    finalActionPatches.find(
      (action) => action.deliveryContextOrdinal === deliveryContextOrdinal,
    )?.patch ?? null

  const resolveReplyTargetPatch = (
    deliveryContextOrdinal: number,
  ): MurphDynamicToolReplyTargetPatch | null =>
    replyTargetPatches.find(
      (entry) => entry.deliveryContextOrdinal === deliveryContextOrdinal,
    )?.patch ?? null

  const shouldSuppressDeliveryContext = (
    deliveryContextOrdinal: number,
  ): boolean => {
    if (
      reservedNoReplyDeliveryContextOrdinals.has(deliveryContextOrdinal)
    ) {
      return true
    }
    const patch = resolveFinalActionPatch(deliveryContextOrdinal)
    return patch?.kind === 'none'
  }

  const acceptJsonEvent = (message: CodexRpcMessage): void => {
    jsonEvents.push(message)
  }

  const handleAcceptedServerRequest = async (
    message: CodexRpcMessage,
    requestId: CodexRpcId,
  ): Promise<void> => {
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

    if (message.method !== 'item/tool/call') {
      denyUnsupportedCodexServerRequest({
        message,
        requestId,
        writeRpcMessage: (payload) => {
          void tryWriteRpcMessage(payload)
        },
      })
      return
    }

    const dynamicToolRequestDeliveryContextOrdinal =
      currentDeliveryContextOrdinal()
    let dynamicToolRuntime: MurphDynamicToolRuntime
    try {
      dynamicToolRuntime = await loadMurphDynamicToolRuntime()
    } catch {
      void tryWriteRpcMessage({
        id: requestId,
        error: {
          code: -32000,
          message: 'Dynamic tool runtime is unavailable.',
        },
      })
      return
    }
    const {
      claimCurrentSenderTurnDecision,
      executeMurphDynamicToolRequest,
      isComputerDynamicToolRequest,
      readMurphDynamicToolRequest,
    } = dynamicToolRuntime

    const dynamicToolRequest = readMurphDynamicToolRequest(message, {
      automationRelativeDateReferenceWindow:
        automationRelativeDateReferenceWindows[
          dynamicToolRequestDeliveryContextOrdinal
        ] ?? null,
      responseCardAudience: input.groupConversation === true
        ? 'group'
        : input.groupConversation === false
          ? 'private'
          : null,
    })
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

    if (
      isInvocationScopedRootToolRequest(dynamicToolRequest) &&
      (turnId === null || extractCodexTurnIdFromMessage(message) !== turnId)
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'tool is unavailable outside the active root turn',
            },
          ],
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

    const dynamicToolKey = readCodexDynamicToolKey(message)
    if (!dynamicToolKey || !offeredDynamicToolKeys.has(dynamicToolKey)) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'tool was not offered for this turn',
            },
          ],
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

    const currentSenderDecisionClaim = claimCurrentSenderTurnDecision({
      request: dynamicToolRequest,
      turnState: groupSharedReadTurnState,
    })
    if (
      currentSenderDecisionClaim === 'conflict'
      || currentSenderDecisionClaim === 'unavailable'
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [{
            type: 'inputText',
            text: currentSenderDecisionClaim === 'conflict'
              ? 'current-sender request conflicts with an earlier decision for this Message'
              : 'current-sender decision authority is unavailable for this turn',
          }],
        },
      })
      return
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
      dynamicToolRequest.kind === 'finish-without-reply'
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'finish_without_reply is unavailable after pausing a computer run for the user',
            },
          ],
        },
      })
      return
    }

    if (
      requiredVaultFileApprovalUrls.length > 0 &&
      dynamicToolRequest.kind === 'finish-without-reply'
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'finish_without_reply is unavailable while a vault-file approval link must be delivered',
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
      dynamicToolRequest.kind === 'select-reply-target' ||
      dynamicToolRequest.kind === 'send-progress-update'
        ? dynamicToolRequestDeliveryContextOrdinal
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

    if (
      dynamicToolRequest.kind === 'select-reply-target' &&
      shouldSuppressDeliveryContext(dynamicToolDeliveryContextOrdinal ?? 0)
    ) {
      void tryWriteRpcMessage({
        id: requestId,
        result: {
          success: false,
          contentItems: [
            {
              type: 'inputText',
              text: 'reply target unavailable after finish_without_reply',
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
      finalActionPatches = finalActionPatches.filter(
        (entry) =>
          entry.patch.kind !== 'none' ||
          entry.deliveryContextOrdinal !==
            dynamicToolRequestDeliveryContextOrdinal,
      )
      reservedNoReplyDeliveryContextOrdinals.delete(
        dynamicToolRequestDeliveryContextOrdinal,
      )
      computerToolsLockedAfterUserPause = true
      closeLiveTurn()
    }

    let dynamicToolRequestSettled = false
    const runDynamicTool = () => withHostedCanonicalWritePort(
      hostedCanonicalWritePort,
      async () => {
        const existingFinalAction = resolveFinalActionPatch(
          dynamicToolRequestDeliveryContextOrdinal,
        )
        const vaultFileOwnsFinalAction =
          existingFinalAction?.kind === 'none' &&
          existingFinalAction.owner === 'vault-file'
        const vaultFileMayClassifyAfterGenericNoReply =
          dynamicToolRequest.kind === 'send-vault-file' &&
          !vaultFileOwnsFinalAction
        if (
          shouldSuppressDeliveryContext(
            dynamicToolRequestDeliveryContextOrdinal,
          ) &&
          !vaultFileMayClassifyAfterGenericNoReply &&
          isResponseAttachmentDynamicToolRequest(dynamicToolRequest)
        ) {
          return {
            rpcResult: {
              contentItems: [{
                text: dynamicToolRequest.kind === 'send-vault-file'
                  ? 'vault-file sending cannot be combined with other response media'
                  : vaultFileOwnsFinalAction
                    ? 'response media cannot be changed after a vault-file send'
                    : 'response media unavailable after finish_without_reply',
                type: 'inputText' as const,
              }],
              success: false,
            },
          }
        }
        const hostedToolContext = resolveCodexAppServerHostedToolContext(input)
        await hostedToolContext?.beforeToolExecution?.(
          dynamicToolRequestDeliveryContextOrdinal,
        )
        let requestedLocalAtRecovery: {
          recoveryKey: string
          resolvedLocalDate: string
        } | null = null
        if (
          (dynamicToolRequest.kind === 'automation' ||
            dynamicToolRequest.kind === 'invalid-automation-arguments') &&
          dynamicToolRequest.localAtRecovery
        ) {
          requestedLocalAtRecovery = dynamicToolRequest.localAtRecovery
        } else if (
          dynamicToolRequest.kind ===
          'automation-local-at-recovery-dismissal'
        ) {
          requestedLocalAtRecovery = {
            recoveryKey: dynamicToolRequest.recoveryKey,
            resolvedLocalDate: dynamicToolRequest.resolvedLocalDate,
          }
        }
        if (requestedLocalAtRecovery) {
          const clarificationKey =
            buildRequiredAutomationLocalAtClarificationKey({
              resolvedLocalDate:
                requestedLocalAtRecovery.resolvedLocalDate,
              targetKey: requestedLocalAtRecovery.recoveryKey,
            })
          if (!requiredAutomationLocalAtClarifications.has(clarificationKey)) {
            return {
              rpcResult: {
                contentItems: [{
                  text:
                    'local-time recovery key or trusted date is not pending in this active root turn',
                  type: 'inputText' as const,
                }],
                success: false,
              },
            }
          }
          if (
            dynamicToolRequest.kind ===
              'automation-local-at-recovery-dismissal'
          ) {
            requiredAutomationLocalAtClarifications.delete(clarificationKey)
            return {
              rpcResult: {
                contentItems: [{
                  text:
                    'local-time reminder recovery dismissed; no automation was changed',
                  type: 'inputText' as const,
                }],
                success: true,
              },
            }
          }
        }
        if (
          dynamicToolRequest.kind === 'invalid-automation-arguments' &&
          (
            dynamicToolRequest.safeFailureCode === 'local_at_gap' ||
            dynamicToolRequest.safeFailureCode === 'local_at_fold'
          ) &&
          dynamicToolRequest.resolvedLocalDate &&
          dynamicToolRequest.localAtTargetKey &&
          dynamicToolRequest.localAtTargetLabel &&
          !dynamicToolRequest.localAtRecovery
        ) {
          const requirement = {
            code: dynamicToolRequest.safeFailureCode,
            resolvedLocalDate: dynamicToolRequest.resolvedLocalDate,
            targetKey: dynamicToolRequest.localAtTargetKey,
            targetLabel: dynamicToolRequest.localAtTargetLabel,
          }
          requiredAutomationLocalAtClarifications.set(
            buildRequiredAutomationLocalAtClarificationKey(requirement),
            requirement,
          )
        }
        const result = await executeMurphDynamicToolRequest({
          authorizeAcceptedMessageTarget:
            input.authorizeAcceptedMessageTarget ?? null,
          assistantStyleSettingsOverlay,
          assistantStyleSettingsAvailable: input.dynamicTools.some(
            (tool) =>
              tool.namespace === MURPH_ASSISTANT_STYLE_TOOL.namespace &&
              tool.name === MURPH_ASSISTANT_STYLE_TOOL.name,
          ),
          groupRoomModelAvailable: input.dynamicTools.some(
            (tool) =>
              tool.namespace === MURPH_GROUP_ROOM_MODEL_TOOL.namespace &&
              tool.name === MURPH_GROUP_ROOM_MODEL_TOOL.name,
          ),
          groupRoomModelMaintenanceAuthorized:
            input.groupRoomModelMaintenanceAuthorized === true,
          memberMemoryAvailable: input.dynamicTools.some(
            (tool) =>
              tool.namespace === MURPH_MEMBER_MEMORY_TOOL.namespace &&
              tool.name === MURPH_MEMBER_MEMORY_TOOL.name,
          ),
          memberMemoryMaintenanceAuthorized:
            input.memberMemoryMaintenanceAuthorized === true,
          abortSignal: input.abortSignal
            ? AbortSignal.any([input.abortSignal, dynamicToolAbortController.signal])
            : dynamicToolAbortController.signal,
          codexHome: input.codexHome ?? input.env.CODEX_HOME ?? null,
          env: input.env,
          fetchImpl: input.fetchImpl,
          hostedToolContext,
          materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
          currentResponseMedia: responseMedia,
          currentResponseCard: responseCard ?? responseCardTextFallback,
          groupChallengeResponseCardAllowed:
            input.groupConversation === true &&
            input.dynamicTools.some((tool) =>
              tool.namespace === 'murph' &&
              tool.name === 'attach_response_card'
            ),
          groupSharedReadTurnState,
          privateDirectResponseCardAllowed: input.groupConversation === false,
          telegramPresentationResponseCardAllowed:
            input.dynamicTools.some((tool) =>
              tool.namespace === 'murph' &&
              (
                tool.name === 'attach_exercise_routine_card' ||
                tool.name === 'attach_telegram_rich_content'
              )
            ),
          deliveryContextOrdinal: dynamicToolRequestDeliveryContextOrdinal,
          nextUsageOrdinal: () => nextDynamicToolUsageOrdinal++,
          onboardingFirstReadCompletionTransitionAvailable:
            input.onboardingFirstReadCompletionTransitionAvailable ?? false,
          productFeedbackRecorder: input.productFeedbackRecorder ?? null,
          progressDelivery:
            dynamicToolRequest.kind === 'send-progress-update'
              ? dynamicToolProgressDelivery
              : dynamicToolRequest.kind === 'group'
                ? resolveCodexAppServerProgressDelivery(input)
                : null,
          publicFetchImpl: input.publicInternetFetch ?? null,
          request: dynamicToolRequest,
          requireHostedPrivateImageDelivery:
            input.requireHostedPrivateImageDelivery ?? false,
          vaultRoot: input.vaultRoot ?? null,
          voiceMemoPhaseTimingRecorder:
            (dynamicToolRequest.kind === 'generate-voice-memo' ||
              dynamicToolRequest.kind === 'generate-song') &&
            input.onTraceEvent
              ? (timing) => {
                  emitCodexGeneratedAudioPhaseTimingTrace({
                    codexThreadId,
                    onTraceEvent: input.onTraceEvent,
                    timing,
                  })
                }
              : null,
          voiceMemoRuntime:
            dynamicToolRequest.kind === 'generate-voice-memo' ||
            dynamicToolRequest.kind === 'generate-song'
              ? input.voiceMemoRuntime ?? null
              : null,
          analyzeVideoRuntime:
            dynamicToolRequest.kind === 'analyze-video'
              ? input.analyzeVideoRuntime ?? null
              : null,
          analyzeVideoTurnState,
          askGrokRuntime:
            dynamicToolRequest.kind === 'ask-grok'
              ? input.askGrokRuntime ?? null
              : null,
          askGrokTurnState,
          generateSongTurnState,
        })
        return result
      },
    ).then(async (result) => {
      if (dynamicToolRequest.kind === 'send-progress-update') {
        releaseDynamicProgressPending?.()
      }
      for (const runtimeIssueInput of result.runtimeIssueInputs ?? []) {
        pushRuntimeIssueInput(runtimeIssueInput)
      }
      if (result.usageDraft) {
        additionalUsages.push(result.usageDraft)
      }
      if (
        result.requiredVaultFileApprovalUrl &&
        !requiredVaultFileApprovalUrls.includes(result.requiredVaultFileApprovalUrl)
      ) {
        requiredVaultFileApprovalUrls.push(result.requiredVaultFileApprovalUrl)
      }
      if (
        result.finalActionPatch?.kind === 'none' &&
        (
          result.finalActionPatch.owner === 'group-email'
          || result.finalActionPatch.owner === 'current-sender-ask'
        )
      ) {
        if (result.externallyVisibleOutput) {
          markExternallyVisibleAssistantOutput(
            dynamicToolRequestDeliveryContextOrdinal,
          )
        }
        applyTerminalExternalEffectNoReplyPatch(
          result.finalActionPatch,
          dynamicToolRequestDeliveryContextOrdinal,
        )
        // Interrupt while the app-server is still waiting on this dynamic
        // tool request. Returning the tool result first lets Codex start a
        // follow-up provider request before the interrupt is processed, and
        // an interrupt racing that continuation can leave the turn open.
        // TurnAborted resolves the pending server request structurally, so a
        // terminal external effect must not also write a tool response.
        dynamicToolRequestSettled = true
        await interruptLiveTurnForTerminalNoReply()
        return
      }
      if (result.externallyVisibleOutput) {
        markExternallyVisibleAssistantOutput(
          dynamicToolRequestDeliveryContextOrdinal,
        )
      }
      if (result.responseCardPatch) {
        try {
          applyResponseCardPatch(
            result.responseCardPatch.card,
            dynamicToolRequestDeliveryContextOrdinal,
          )
        } catch {
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: false,
              contentItems: [{
                type: 'inputText',
                text: 'response card unavailable for this final response',
              }],
            },
          })
          return
        }
      }
      if (result.responseCardTextFallbackPatch) {
        try {
          applyResponseCardTextFallbackPatch(
            result.responseCardTextFallbackPatch.card,
            dynamicToolRequestDeliveryContextOrdinal,
          )
        } catch {
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: false,
              contentItems: [{
                type: 'inputText',
                text: 'response card unavailable for this final response',
              }],
            },
          })
          return
        }
      }
      if (result.responseMediaPatch) {
        try {
          applyResponseMediaPatch(
            result.responseMediaPatch,
            dynamicToolRequestDeliveryContextOrdinal,
          )
        } catch (error) {
          const text = error instanceof VaultCliError &&
            error.code === 'ASSISTANT_RESPONSE_MEDIA_AFTER_NO_REPLY'
            ? 'response media unavailable after finish_without_reply'
            : 'response media limit reached'
          void tryWriteRpcMessage({
            id: requestId,
            result: {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text,
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
          dynamicToolRequestDeliveryContextOrdinal,
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
      if (result.replyTargetPatch && dynamicToolDeliveryContextOrdinal !== null) {
        replyTargetPatches = [
          ...replyTargetPatches.filter(
            (entry) =>
              entry.deliveryContextOrdinal !== dynamicToolDeliveryContextOrdinal,
          ),
          {
            deliveryContextOrdinal: dynamicToolDeliveryContextOrdinal,
            patch: result.replyTargetPatch,
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
      if (
        dynamicToolRequest.kind === 'automation' &&
        result.rpcResult.success &&
        dynamicToolRequest.localAtRecovery
      ) {
        const recoveryKey = buildRequiredAutomationLocalAtClarificationKey({
          resolvedLocalDate:
            dynamicToolRequest.localAtRecovery.resolvedLocalDate,
          targetKey: dynamicToolRequest.localAtRecovery.recoveryKey,
        })
        if (requiredAutomationLocalAtClarifications.has(recoveryKey)) {
          requiredAutomationLocalAtClarifications.delete(recoveryKey)
        }
      }
      const writeFailure = tryWriteRpcMessage({
        id: requestId,
        result: result.rpcResult,
      })
      if (writeFailure) {
        return
      }
      dynamicToolRequestSettled = true
    }).catch((error: unknown) => {
      if (dynamicToolRequest.kind === 'send-progress-update') {
        releaseDynamicProgressPending?.()
      }
      if (dynamicToolRequestSettled) {
        rejectOnce(error)
        return
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
    const providerRequestStartedAtMs = codexProviderRequestStartedAtMs
    const isTurnStartedNotification = isCodexTurnStartedMethod(method)
    const isTurnCompletedNotification = isCodexTurnCompletedMethod(method)
    if (isTurnStartedNotification) {
      currentTurnStartedNotificationObserved =
        turnId !== null && extractCodexTurnIdFromMessage(message) === turnId
    }
    const shouldCaptureTurnStartedNotification =
      providerRequestStartedAtMs !== null &&
      isTurnStartedNotification &&
      codexTimingTurnStartedNotificationElapsedMs === null
    const shouldCaptureTurnCompletedNotification =
      providerRequestStartedAtMs !== null &&
      isTurnCompletedNotification &&
      codexTimingTurnCompletedNotificationElapsedMs === null
    if (
      providerRequestStartedAtMs !== null &&
      (shouldCaptureTurnStartedNotification ||
        shouldCaptureTurnCompletedNotification)
    ) {
      const observedAtMs = Date.now()
      if (shouldCaptureTurnStartedNotification) {
        codexTimingTurnStartedNotificationElapsedMs = Math.max(
          0,
          observedAtMs - providerRequestStartedAtMs,
        )
      }
      if (shouldCaptureTurnCompletedNotification) {
        codexTimingTurnCompletedNotificationElapsedMs = Math.max(
          0,
          observedAtMs - providerRequestStartedAtMs,
        )
      }
    }
    for (const receiverThreadId of readCodexCollabReceiverThreadIds(message)) {
      collabReceiverThreadIds.add(receiverThreadId)
    }
    lastEventError = extractCodexErrorMessage(message) ?? lastEventError
    lastEventErrorInfo = extractCodexErrorInfo(message) ?? lastEventErrorInfo

    const normalizedEvent = normalizeCodexEvent(message)
    const runtimeIssueInput = actionRuntimeIssueTracker.recordEvent({
      activeTurnId: turnId,
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
    const transportDiagnosticsTraceEvent = input.onTraceEvent
      ? buildCodexTransportDiagnosticsTraceEvent({
          codexThreadId,
          message,
          method,
          providerActionCount,
          turnId,
        })
      : null
    if (transportDiagnosticsTraceEvent) {
      try {
        input.onTraceEvent?.({
          codexThreadId: null,
          rawEvent: transportDiagnosticsTraceEvent,
          updates: [],
        })
      } catch {
        // Transport diagnostics are metadata-only and must not block turns.
      }
    }
    const transportDiagnosticSource =
      readCodexTransportDiagnosticSource(message, method)
    if (transportDiagnosticSource?.willRetry === true) {
      input.productFeedbackRecorder?.discardProductFeedback()
    }
    const providerActionKey = extractCodexProviderActionKey(
      normalizedEvent,
      message,
    )
    if (providerActionKey && !providerActionItemIds.has(providerActionKey)) {
      providerActionItemIds.add(providerActionKey)
      providerActionCount += 1
    }

    const deliveryContextOrdinal = currentDeliveryContextOrdinal()
    const suppressDeliveryContext =
      shouldSuppressDeliveryContext(deliveryContextOrdinal)
    const isCommentaryAssistantMessage =
      normalizedEvent.kind === 'assistant_message' &&
      normalizedEvent.messagePhase === 'commentary'
    const rawUpdates = extractCodexTraceUpdatesFromNormalized(normalizedEvent)
    const updates = rawUpdates
      .filter((update) => !(suppressDeliveryContext && update.kind === 'assistant'))
    for (const update of updates) {
      recordAssistantTraceUpdate(update, deliveryContextOrdinal)
    }
    if (isCommentaryAssistantMessage) {
      // Commentary is internal progress, not a member-facing message. Remove
      // its stream, including any earlier deltas for the same item, so a
      // media-only response cannot reuse it as final reply text.
      for (const update of rawUpdates) {
        removeAssistantTraceUpdateFromFinalFallback(update)
      }
    }

    if (
      normalizedEvent.kind !== 'status_item' ||
      normalizedEvent.itemType !== 'contextCompaction'
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

    const contextCompactionProgressText =
      extractCodexContextCompactionProgressTextFromNormalized(normalizedEvent)
    if (
      contextCompactionProgressText &&
      input.groupConversation !== true &&
      !suppressDeliveryContext
    ) {
      notifyContextCompactionProgress(
        deliveryContextOrdinal,
        contextCompactionProgressText,
      )
    }

    const completedFinalAgentMessageText =
      extractCodexCompletedFinalAgentMessageTextFromNormalized(normalizedEvent)
    const completedFinalAgentResponse =
      isCodexCompletedFinalAgentMessageItemFromNormalized(normalizedEvent) &&
      (
        completedFinalAgentMessageText !== null ||
        responseMedia.length > 0
      )
    if (completedFinalAgentResponse && !suppressDeliveryContext) {
      promoteTrailingSteerCandidate()
      completedFinalAgentMessage = completedFinalAgentMessageText ?? ''
      if (!firstAssistantResponseCompleted) {
        firstAssistantResponseCompleted = true
        input.onFirstAssistantResponseCompleted?.()
      }
    } else if (isCodexCompletedUserMessageItemFromNormalized(normalizedEvent)) {
      if (completedFinalAgentMessage !== null) {
        const completedResponseDeliveryContextOrdinal = Math.max(
          0,
          completedUserMessageOrdinal,
        )
        const completedResponseTargetInputId = resolveReplyTargetPatch(
          completedResponseDeliveryContextOrdinal,
        )?.targetInputId ?? null
        trailingSteerCandidate = {
          deliveryContextOrdinal: completedResponseDeliveryContextOrdinal,
          response: completedFinalAgentMessage,
          media: [...responseMedia],
          card: responseCard,
          cardTextFallback: responseCardTextFallback,
          ...(completedResponseTargetInputId
            ? { targetInputId: completedResponseTargetInputId }
            : {}),
        }
        completedFinalAgentMessage = null
        assistantStreams.clear()
        assistantStreamOrder.length = 0
        responseMedia = []
      }
      responseCard = null
      responseCardTextFallback = null
      completedUserMessageOrdinal += 1
    }

    const progressEvent = extractCodexProgressEventFromNormalized(normalizedEvent)
    if (progressEvent) {
      if (suppressDeliveryContext && progressEvent.kind === 'message') {
        // A completed no-reply context must not leak later text progress.
      } else {
        if (progressEvent.kind === 'message') {
          if (
            input.onProgress &&
            normalizeStreamingText(progressEvent.text)
          ) {
            markExternallyVisibleAssistantOutput(deliveryContextOrdinal)
          }
        }
        input.onProgress?.(progressEvent)
      }
    }

    if (isTurnStartedNotification) {
      notifyProviderRequestStarted()
      registerLiveTurn()
    }

    if (!isTurnCompletedNotification) {
      return
    }

    const status = extractCodexTurnStatus(message)
    if (
      status === 'interrupted' &&
      terminalNoReplyInterruptRequested
    ) {
      turnTerminal = true
      completeTurn?.()
      return
    }
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

  const handleSubagentThreadMessage = (
    threadId: string,
    message: CodexRpcMessage,
  ): void => {
    const requestId = readCodexRpcServerRequestId(message)
    if (requestId !== null) {
      // Dynamic tools and approvals stay parent-thread-scoped; answer the
      // child so it does not hang, without involving the parent turn.
      rejectCodexServerRequest({
        message: 'Server requests from codex subagent threads are not supported.',
        requestId,
        writeRpcMessage: tryWriteRpcMessage,
      })
      return
    }

    const eventMethod = readCodexEventMethod(message)
    const messageTurnId = extractCodexTurnIdFromMessage(message)
    if (isCodexTurnStartedMethod(eventMethod)) {
      if (!messageTurnId) {
        return
      }
      const usageKey = createCodexSubagentTurnUsageKey({
        threadId,
        turnId: messageTurnId,
      })
      if (subagentTokenUsageByTurn.has(usageKey)) {
        return
      }
      if (
        !trackedSubagentUsageThreadIds.has(threadId)
        && trackedSubagentUsageThreadIds.size >= MAX_CODEX_SUBAGENT_USAGE_THREADS
      ) {
        const evictableThreadId = collabReceiverThreadIds.has(threadId)
          ? [...trackedSubagentUsageThreadIds].find(
            (trackedThreadId) => !collabReceiverThreadIds.has(trackedThreadId),
          )
          : undefined
        if (evictableThreadId === undefined) {
          return
        }
        trackedSubagentUsageThreadIds.delete(evictableThreadId)
        for (const [trackedUsageKey, sample] of subagentTokenUsageByTurn) {
          if (sample.threadId === evictableThreadId) {
            subagentTokenUsageByTurn.delete(trackedUsageKey)
          }
        }
      }
      trackedSubagentUsageThreadIds.add(threadId)
      subagentTokenUsageByTurn.set(usageKey, {
        firstEvent: null,
        lastEvent: null,
        occurredAt: new Date().toISOString(),
        threadId,
        turnId: messageTurnId,
      })
      return
    }
    if (
      !isAssistantCodexTokenUsageEventType(eventMethod)
      || !messageTurnId
    ) {
      return
    }

    const usageKey = createCodexSubagentTurnUsageKey({
      threadId,
      turnId: messageTurnId,
    })
    const sample = subagentTokenUsageByTurn.get(usageKey)
    if (!sample) {
      // A child token sample without an observed start has no safe accounting
      // timestamp. Parent collab evidence authorizes the child but cannot
      // establish when its provider operation began.
      return
    }
    sample.firstEvent ??= message
    sample.lastEvent = message
  }

  const handleStaleParentTurnMessage = (message: CodexRpcMessage): void => {
    const requestId = readCodexRpcServerRequestId(message)
    if (requestId === null) {
      return
    }

    rejectCodexServerRequest({
      message: 'Codex message turn id does not match the active turn.',
      requestId,
      writeRpcMessage: tryWriteRpcMessage,
    })
  }

  const rejectUnscopedParentTurnRequest = (requestId: CodexRpcId): void => {
    rejectCodexServerRequest({
      message: 'Codex parent-thread request did not include the active turn id.',
      requestId,
      writeRpcMessage: tryWriteRpcMessage,
    })
  }

  const rejectPreStartParentTurnRequest = (requestId: CodexRpcId): void => {
    rejectCodexServerRequest({
      message: 'Codex parent-thread request arrived before the active turn id was known.',
      requestId,
      writeRpcMessage: tryWriteRpcMessage,
    })
  }

  const acceptTurnStartResultTurnId = (resultTurnId: string | null): void => {
    if (resultTurnId === null) {
      return
    }
    if (turnId === null) {
      turnId = resultTurnId
      return
    }
    if (turnId !== resultTurnId) {
      rejectOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_APP_SERVER_TURN_ID_MISMATCH',
          'Codex app-server turn/start returned a different turn id than the active turn.',
          {
            retryable: true,
          },
        ),
      )
    }
  }

  function handleParsedMessage(message: CodexRpcMessage): void {
    const responseId = readCodexRpcResponseId(message)
    if (responseId !== null) {
      const pending = codexProcess.pendingRequests.get(responseId)
      const resolveResult = resolvePendingCodexRpcRequest({
        message,
        pendingRequests: codexProcess.pendingRequests,
        responseId,
      })
      if (resolveResult === 'unknown_response_id') {
        codexProcess.consumeIgnoredResponseId(responseId)
        return
      }
      acceptJsonEvent(message)
      if (message.error) {
        return
      }
      if (pending?.method === 'turn/start') {
        if (
          codexProviderRequestStartedAtMs !== null &&
          codexTimingTurnStartAckElapsedMs === null
        ) {
          codexTimingTurnStartAckElapsedMs = Math.max(
            0,
            Date.now() - codexProviderRequestStartedAtMs,
          )
        }
        const resultTurnId = extractCodexTurnIdFromResult(message.result)
        acceptTurnStartResultTurnId(resultTurnId)
      }
      return
    }

    // Codex owns subagent/thread lifecycle. Murph only keeps foreign thread
    // traffic away from the active parent turn: token usage is buffered for
    // billing, server requests are denied, and other child events are dropped.
    // Before a fresh thread/start response produces this turn's thread id, the
    // previous bound thread id is enough to distinguish late child traffic.
    const messageThreadId = extractCodexThreadIdFromMessage(message)
    const knownParentThreadId =
      codexThreadId ?? requestedResumeThreadId ?? codexProcess.lastBoundThreadId
    if (
      messageThreadId !== null &&
      knownParentThreadId !== null &&
      messageThreadId !== knownParentThreadId
    ) {
      handleSubagentThreadMessage(messageThreadId, message)
      return
    }

    const messageTurnId = extractCodexTurnIdFromMessage(message)
    const method = readCodexEventMethod(message)
    const requestId = readCodexRpcServerRequestId(message)
    if (messageTurnId !== null) {
      if (turnId === null) {
        // Only the turn/start response or turn/started may establish the
        // active turn. A server request must never authenticate itself by
        // supplying the first turn id seen on the process.
        if (isCodexTurnStartedMethod(method)) {
          turnId = messageTurnId
        } else {
          if (requestId !== null) {
            rejectPreStartParentTurnRequest(requestId)
          }
          return
        }
      } else if (messageTurnId !== turnId) {
        handleStaleParentTurnMessage(message)
        return
      }
    }

    if (requestId !== null) {
      if (isReusedWarmProcess && messageTurnId === null) {
        rejectUnscopedParentTurnRequest(requestId)
        return
      }
      if (turnId === null) {
        rejectPreStartParentTurnRequest(requestId)
        return
      }
      trackDynamicToolRequest(
        handleAcceptedServerRequest(message, requestId),
      )
      return
    }

    if (
      messageTurnId === null &&
      method === 'model/rerouted' &&
      !currentTurnStartedNotificationObserved
    ) {
      return
    }

    if (
      isReusedWarmProcess &&
      messageTurnId === null &&
      method !== 'model/rerouted'
    ) {
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
    const preparedSteerImages = await materializeCodexImages({
      images: normalizeCodexAppServerImageDetails({
        images: steerInput.images,
        model: input.model,
        modelProvider: input.modelProvider,
        turnKind: 'steer',
      }),
      tempRoot: input.tempRoot,
    })
    const deliveryContextOrdinal = automationRelativeDateReferenceWindows.length
    automationRelativeDateReferenceWindows.push(
      mergeAutomationRelativeDateReferenceWindows(
        automationRelativeDateReferenceWindows.at(-1) ?? null,
        steerInput.relativeDateReferenceWindow ?? null,
      ),
    )
    try {
      await withCodexRpcTimeout(
        sendRequest(
          'turn/steer',
          buildCodexTurnSteerParams({
            ...liveTurn,
            images: preparedSteerImages,
            prompt: steerInput.prompt,
          }),
        ),
        CODEX_RPC_STEER_TIMEOUT_MS,
        'turn/steer',
      )
    } catch (error) {
      if (
        automationRelativeDateReferenceWindows.length ===
          deliveryContextOrdinal + 1
      ) {
        automationRelativeDateReferenceWindows.pop()
      }
      throw error
    }
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

  const interruptLiveTurnForTerminalNoReply = async (): Promise<void> => {
    if (!codexThreadId || !turnId || turnTerminal) {
      throw buildLiveTurnInactiveError()
    }
    terminalNoReplyInterruptRequested = true
    scheduleInterruptCleanupTimeout()
    await withCodexRpcTimeout(
      sendRequest('turn/interrupt', buildCodexTurnInterruptParams({
        threadId: codexThreadId,
        turnId,
      })),
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
          abortOwnsTermination: false,
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
      emitAppServerTimingTrace(
        codexProcess.wasPreinitialized ? 'preinitialized' : 'initialized',
      )
    } else if (!codexProcess.hasCompletedTurn) {
      lifecycleStage = 'initialized'
      emitAppServerTimingTrace('preinitialized')
    } else {
      lifecycleStage = 'initialized'
      emitAppServerTimingTrace('warm-reused')
    }

    const resumeThreadId = requestedResumeThreadId
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
    } else if (normalizeNullableString(input.permissions)) {
      assertCodexThreadStartPermissionAttestation({
        input,
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
    codexProcess.noteBoundThreadGroupConversation(
      input.groupConversation === true,
    )
    codexProcess.noteBoundThreadModel(input.model ?? null)
    codexProcess.noteBoundThreadServiceTier(input.serviceTier ?? null)
    const turnStartRequest = sendRequest(
      'turn/start',
      buildCodexTurnStartParams({
        input,
        images: input.preparedImages,
        codexThreadId,
      }),
    )
    const providerStartedAtMonotonicMs =
      readAssistantProviderStartMonotonicTickMs()
    // The child can begin executing (including side-effecting commands) as
    // soon as the turn/start request is written, so the provider-start
    // barrier arms here rather than at the acknowledgement. A death between
    // write and response must never be classified as pre-provider work.
    notifyProviderRequestStarted(providerStartedAtMonotonicMs)
    const turnResult = await withCodexRpcTimeout(
      turnStartRequest,
      CODEX_RPC_DEFAULT_TIMEOUT_MS,
      'turn/start',
    )
    acceptTurnStartResultTurnId(extractCodexTurnIdFromResult(turnResult))
    lifecycleStage = 'turn_started'
    emitAppServerTimingTrace('turn-started')

    lifecycleStage = 'turn_running'
    await turnCompleted
    clearInterruptCleanupTimer()
    await drainPendingDynamicToolRequests()
    await drainPendingDynamicToolExecutions()
    await drainPendingProgressDeliveries()
    emitActionDiagnosticsTrace()
    lifecycleStage = 'turn_completed'
    codexProcess.noteTurnCompleted()
    emitAppServerTimingTrace('turn-completed')
    closeLiveTurn()
    if (stdinFailure) {
      throw stdinFailure
    }
    await settleNoReplyFinalActions()
    if (abortRequested || terminationSignalSent) {
      normalShutdown = true
      lifecycleStage = 'abort_cleanup'
      await codexProcess.poison('turn-completed-after-abort')
      lifecycleStage = 'shutdown_complete'
      emitAppServerTimingTrace(
        input.processLifetime === 'one-shot'
          ? 'one-shot-abort-stopped'
          : 'warm-abort-poisoned',
      )
    } else {
      lifecycleStage = 'idle'
      codexProcess.releaseTurn(activeTurnBinding)
      emitAppServerTimingTrace(
        input.processLifetime === 'one-shot'
          ? 'one-shot-complete'
          : 'warm-idle',
      )
    }
  } catch (error) {
    const recordedEndReason = codexProcess.recordedEndReason
    const preserveInterruptCleanupTimeout =
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_CODEX_APP_SERVER_INTERRUPT_TIMEOUT' &&
      recordedEndReason !== 'previous-process-exit'
    const preserveMissingCodexStartupFailure =
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_CODEX_NOT_FOUND'
    const failureMatchesRecordedOwner =
      error instanceof VaultCliError &&
      ((recordedEndReason === 'previous-process-exit' &&
        error.context?.codexFailureStage === 'process_exit') ||
        (recordedEndReason === 'previous-turn-abort' &&
          error.code === 'ASSISTANT_CODEX_INTERRUPTED'))
    const shouldApplyRecordedOwner =
      !preserveInterruptCleanupTimeout &&
      !preserveMissingCodexStartupFailure &&
      !failureMatchesRecordedOwner &&
      (recordedEndReason === 'previous-turn-abort' ||
        (recordedEndReason === 'previous-process-exit' &&
          providerRequestStartedNotified))
    let turnFailure = shouldApplyRecordedOwner
      ? (buildRecordedTerminationError(lastEventError) ?? error)
      : error
    emitActionDiagnosticsTrace()
    await drainPendingDynamicToolRequests()
    dynamicToolAbortController.abort()
    await drainPendingDynamicToolExecutions()
    await drainPendingProgressDeliveries()
    try {
      await settleNoReplyFinalActions()
    } catch (settlementError) {
      turnFailure = settlementError
    }
    annotateTurnFailureContext(turnFailure)
    closeLiveTurn()
    normalShutdown = true
    lifecycleStage = 'error_cleanup'
    await codexProcess.poison(
      abortRequested ? 'turn-completed-after-abort' : 'turn-failure',
    ).catch(() => undefined)
    throw turnFailure
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
    }) ?? ''
  const latestDeliveryContextOrdinal = Math.max(0, completedUserMessageOrdinal)
  const latestFinalActionPatch = resolveFinalActionPatch(
    latestDeliveryContextOrdinal,
  )
  let finalTrailingSteerCandidate = readTrailingSteerCandidate()
  const trailingSteerCandidateDeliveryContextOrdinal =
    finalTrailingSteerCandidate?.deliveryContextOrdinal ?? null
  const trailingSteerCandidateFinalActionPatch =
    trailingSteerCandidateDeliveryContextOrdinal !== null
      ? resolveFinalActionPatch(trailingSteerCandidateDeliveryContextOrdinal)
      : null
  const suppressTrailingSteerCandidateForEarlierNoReply =
    latestFinalActionPatch === null &&
    finalTrailingSteerCandidate !== null &&
    trailingSteerCandidateFinalActionPatch?.kind === 'none'
  const shouldPromoteTrailingSteerCandidate =
    finalTrailingSteerCandidate !== null &&
    (
      latestFinalActionPatch?.kind === 'none' ||
      (
        !suppressTrailingSteerCandidateForEarlierNoReply &&
        (
          normalizeNullableString(extractedFinalMessage) !== null ||
          responseMedia.length > 0 ||
          responseCard !== null ||
          responseCardTextFallback !== null
        )
      )
    )
  if (shouldPromoteTrailingSteerCandidate) {
    promoteTrailingSteerCandidate()
    finalTrailingSteerCandidate = null
  }
  const selectedFinalMessage =
    finalTrailingSteerCandidate?.response ?? extractedFinalMessage
  const finalResponseMedia =
    latestFinalActionPatch?.kind === 'none'
      ? responseMedia
      : suppressTrailingSteerCandidateForEarlierNoReply
        ? responseMedia
        : finalTrailingSteerCandidate?.media ?? responseMedia
  const finalResponseCard =
    latestFinalActionPatch?.kind === 'none'
      ? responseCard
      : suppressTrailingSteerCandidateForEarlierNoReply
        ? responseCard
        : finalTrailingSteerCandidate?.card ?? responseCard
  if (finalResponseCard !== null && finalResponseMedia.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
      'A response card cannot be combined with response media.',
    )
  }
  const finalDeliveryContextOrdinal =
    latestFinalActionPatch?.kind === 'none'
      ? latestDeliveryContextOrdinal
      : suppressTrailingSteerCandidateForEarlierNoReply
        ? latestDeliveryContextOrdinal
        : finalTrailingSteerCandidate?.deliveryContextOrdinal ??
          latestDeliveryContextOrdinal
  const finalResponseCardTextFallback =
    latestFinalActionPatch?.kind === 'none'
      ? responseCardTextFallback
      : suppressTrailingSteerCandidateForEarlierNoReply
        ? responseCardTextFallback
        : finalTrailingSteerCandidate?.cardTextFallback
          ?? responseCardTextFallback
  if (finalResponseCardTextFallback !== null && finalResponseMedia.length > 0) {
    throw new VaultCliError(
      'ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT',
      'Response card text recovery cannot be combined with response media.',
    )
  }
  const finalActionPatch = resolveFinalActionPatch(finalDeliveryContextOrdinal)
  const requiredUserVisibleOutput = hasRequiredUserVisibleOutput()
  const noReplySelected =
    finalActionPatch?.kind === 'none' && !requiredUserVisibleOutput
  const finalAction: AssistantNoReplyDisposition | null = noReplySelected
    ? { kind: 'none' }
    : null
  const modelFinalMessage =
    noReplySelected || suppressTrailingSteerCandidateForEarlierNoReply
      ? ''
      : selectedFinalMessage
  const semanticFinalMessage = finalResponseCard
    ? renderAssistantResponseCardText(finalResponseCard)
    : finalResponseCardTextFallback
      ? renderAssistantWorkoutResponseCardText(finalResponseCardTextFallback)
      : modelFinalMessage
  const requiredAutomationLocalAtClarificationsInOrder =
    [...requiredAutomationLocalAtClarifications.values()]
  const deliveredFinalResponseCard =
    requiredAutomationLocalAtClarificationsInOrder.length === 0
      ? finalResponseCard
      : null
  const finalMessage = appendRequiredVaultFileApprovalUrls(
    appendRequiredAutomationLocalAtClarification(
      semanticFinalMessage,
      requiredAutomationLocalAtClarificationsInOrder,
    ),
    requiredVaultFileApprovalUrls,
  )
  const transcriptMessage = appendRequiredAutomationLocalAtClarification(
    finalResponseCard
      ? requiredAutomationLocalAtClarificationsInOrder.length === 0
        ? renderAssistantResponseCardTranscriptText(finalResponseCard)
        : renderAssistantResponseCardText(finalResponseCard)
      : finalResponseCardTextFallback
        ? renderAssistantWorkoutResponseCardTranscriptText(
            finalResponseCardTextFallback,
          )
        : normalizeNullableString(modelFinalMessage) ??
          (finalResponseMedia.length > 0 ? '' : null),
    requiredAutomationLocalAtClarificationsInOrder,
  )
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
  const filteredPrecedingAgentMessageSegments = precedingAgentMessageSegments
    .filter((segment) => !shouldSuppressDeliveryContext(
      segment.deliveryContextOrdinal,
    ))
  const finalHasDeliverableOutput =
    normalizeNullableString(finalMessage) !== null ||
    (!noReplySelected && (
      finalResponseMedia.length > 0 ||
      deliveredFinalResponseCard !== null ||
      finalResponseCardTextFallback !== null
    ))

  return {
    acceptedNoReplyDeliveryContextOrdinals:
      acceptedNoReplyDeliveryContextOrdinals,
    finalAction,
    finalActionExplicit:
      finalActionPatch?.kind === 'none' && !requiredUserVisibleOutput,
    finalMessage,
    providerAuthoredFinalMessage: modelFinalMessage,
    transcriptMessage,
    reactions: reactionPatches.map((entry) => ({
      deliveryContextOrdinal: entry.deliveryContextOrdinal,
      reaction: entry.patch.reaction,
      targetInputId: entry.patch.targetInputId,
    })),
    precedingAgentMessageSegments: filteredPrecedingAgentMessageSegments.map((segment) => ({
      deliveryContextOrdinal: segment.deliveryContextOrdinal,
      response: segment.response,
      ...(segment.transcriptResponse === undefined
        ? {}
        : { transcriptResponse: segment.transcriptResponse }),
      media: [...segment.media],
      ...(segment.targetInputId
        ? { targetInputId: segment.targetInputId }
        : {}),
    })),
    responseDeliveryContextOrdinal: finalDeliveryContextOrdinal,
    targetInputId:
      resolveReplyTargetPatch(finalDeliveryContextOrdinal)?.targetInputId ?? null,
    additionalUsages: [...additionalUsages, ...buildSubagentUsageDrafts()],
    responseMedia: finalHasDeliverableOutput ? [...finalResponseMedia] : [],
    responseCard: finalHasDeliverableOutput ? deliveredFinalResponseCard : null,
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

function mergeAutomationRelativeDateReferenceWindows(
  preceding: AssistantAcceptedTurnInputReferenceWindow | null,
  current: AssistantAcceptedTurnInputReferenceWindow | null,
): AssistantAcceptedTurnInputReferenceWindow | null {
  if (current === null) {
    return null
  }
  if (preceding === null) {
    return { ...current }
  }

  const earliestAtMs = Math.min(
    Date.parse(preceding.earliestAt),
    Date.parse(current.earliestAt),
  )
  const latestAtMs = Math.max(
    Date.parse(preceding.latestAt),
    Date.parse(current.latestAt),
  )
  if (!Number.isFinite(earliestAtMs) || !Number.isFinite(latestAtMs)) {
    return null
  }
  return {
    earliestAt: new Date(earliestAtMs).toISOString(),
    latestAt: new Date(latestAtMs).toISOString(),
  }
}

function assertCodexThreadStartPermissionAttestation(input: {
  input: CodexAppServerPreparedTurnInput
  threadResult: unknown
}): void {
  const result = asCodexRecord(input.threadResult)
  const activePermissionProfile = asCodexRecord(result?.activePermissionProfile)
  const actualCwd = normalizeNullableString(asCodexString(result?.cwd))
  const actualRoots = asCodexStringArray(result?.runtimeWorkspaceRoots)
  const instructionSources = Array.isArray(result?.instructionSources)
    ? result.instructionSources
    : null
  const expectedRoots = input.input.runtimeWorkspaceRoots ?? []
  const mismatchedFields: string[] = []

  const permissionProfileMismatch =
    normalizeNullableString(asCodexString(activePermissionProfile?.id)) !==
      normalizeNullableString(input.input.permissions) ||
    normalizeNullableString(asCodexString(activePermissionProfile?.extends)) !== null
  if (permissionProfileMismatch) {
    mismatchedFields.push('activePermissionProfile')
  }
  if (
    !actualRoots ||
    actualRoots.length !== expectedRoots.length ||
    actualRoots.some((root, index) => path.resolve(root) !== path.resolve(expectedRoots[index] ?? ''))
  ) {
    mismatchedFields.push('runtimeWorkspaceRoots')
  }
  if (!actualCwd || path.resolve(actualCwd) !== input.input.workingDirectory) {
    mismatchedFields.push('cwd')
  }
  if (
    input.input.processLifetime === 'one-shot' &&
    (instructionSources === null || instructionSources.length !== 0)
  ) {
    mismatchedFields.push('instructionSources')
  }
  if (
    asCodexString(result?.approvalPolicy) !==
    mapCodexAppServerApprovalPolicy(input.input.approvalPolicy)
  ) {
    mismatchedFields.push('approvalPolicy')
  }
  if (mismatchedFields.length === 0) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_CODEX_APP_SERVER_PERMISSION_ATTESTATION_FAILED',
    'Codex app-server did not attest the requested named-permission execution context.',
    {
      mismatchedFields,
      retryable: false,
    },
  )
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

function emitCodexGeneratedAudioPhaseTimingTrace(input: {
  codexThreadId: string | null
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  timing: VoiceMemoPhaseTiming
}): void {
  if (!input.onTraceEvent) {
    return
  }

  try {
    input.onTraceEvent({
      codexThreadId: input.codexThreadId,
      rawEvent: {
        schema: CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_SCHEMA,
        type: CODEX_GENERATED_AUDIO_PHASE_TIMING_TRACE_TYPE,
        generatedAudioDeliveryMode: input.timing.deliveryMode,
        ...(input.timing.generationDurationMs === undefined
          ? {}
          : {
              generatedAudioGenerationDurationMs:
                input.timing.generationDurationMs,
            }),
        generatedAudioKind: input.timing.mediaKind,
        generatedAudioOutcome: input.timing.outcome,
        generatedAudioTerminalPhase: input.timing.terminalPhase,
        ...(input.timing.uploadDurationMs === undefined
          ? {}
          : { generatedAudioUploadDurationMs: input.timing.uploadDurationMs }),
      },
      updates: [],
    })
  } catch {
    // Phase timing is diagnostic-only and must not block assistant turns.
  }
}

function notifyCodexAppServerProviderRequestStartedBestEffort(input: {
  hook?: ((event: AssistantProviderRequestStartedEvent) => Promise<void> | void) | null
  startedAt: string
  timing?: AssistantProviderRequestStartTiming
}): void {
  if (!input.hook) {
    return
  }

  try {
    void Promise.resolve(input.hook({
      ...(input.timing ?? {}),
      startedAt: input.startedAt,
    })).catch(() => {
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
      | 'invalid-automation-arguments'
      | 'invalid-assistant-style-arguments'
      | 'invalid-computer-arguments'
      | 'invalid-device-arguments'
      | 'invalid-generate-voice-memo-arguments'
      | 'invalid-pending-vault-files-arguments'
      | 'invalid-finish-without-reply-arguments'
      | 'invalid-progress-arguments'
      | 'invalid-reaction-arguments'
      | 'invalid-reply-target-arguments'
      | 'invalid-product-feedback-arguments'
      | 'invalid-response-card-arguments'
      | 'invalid-response-media-arguments'
  }
> {
  return (
    request.kind === 'invalid-generate-image-arguments' ||
    request.kind === 'invalid-automation-arguments' ||
    request.kind === 'invalid-assistant-style-arguments' ||
    request.kind === 'invalid-computer-arguments' ||
    request.kind === 'invalid-device-arguments' ||
    request.kind === 'invalid-generate-voice-memo-arguments' ||
    request.kind === 'invalid-pending-vault-files-arguments' ||
    request.kind === 'invalid-finish-without-reply-arguments' ||
    request.kind === 'invalid-progress-arguments' ||
    request.kind === 'invalid-reaction-arguments' ||
    request.kind === 'invalid-reply-target-arguments' ||
    request.kind === 'invalid-product-feedback-arguments' ||
    request.kind === 'invalid-response-card-arguments' ||
    request.kind === 'invalid-response-media-arguments'
  )
}

function isSerializedDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  return request.kind === 'automation' ||
    request.kind === 'automation-local-at-recovery-dismissal' ||
    request.kind === 'invalid-automation-arguments' ||
    request.kind === 'device' ||
    request.kind === 'generate-image' ||
    request.kind === 'generate-voice-memo' ||
    request.kind === 'generate-song' ||
    request.kind === 'attach-group-challenge-response-card' ||
    request.kind === 'attach-response-card' ||
    request.kind === 'response-card-envelope-too-large' ||
    request.kind === 'attach-response-media' ||
    request.kind === 'send-vault-file' ||
    request.kind === 'pending-vault-files-list' ||
    request.kind === 'pending-vault-files-cancel' ||
    request.kind === 'assistant-configuration' ||
    request.kind === 'assistant-style' ||
    request.kind === 'personalization' ||
    request.kind === 'subscription' ||
    (request.kind === 'group' &&
      request.request.action === 'ask_current_sender' &&
      request.request.mode !== 'new') ||
    request.kind === 'react-to-message' ||
    request.kind === 'select-reply-target' ||
    request.kind === 'computer-open' ||
    request.kind === 'computer-act' ||
    request.kind === 'computer-os-control' ||
    request.kind === 'computer-pause-for-user' ||
    request.kind === 'computer-finish-run' ||
    request.kind === 'invalid-computer-arguments'
}

function isResponseAttachmentDynamicToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  return request.kind === 'attach-group-challenge-response-card' ||
    request.kind === 'attach-response-card' ||
    request.kind === 'response-card-envelope-too-large' ||
    request.kind === 'attach-response-media' ||
    request.kind === 'generate-image' ||
    request.kind === 'generate-song' ||
    request.kind === 'generate-voice-memo' ||
    request.kind === 'send-vault-file'
}

function isInvocationScopedRootToolRequest(
  request: MurphDynamicToolRequest,
): boolean {
  return request.kind === 'automation' ||
    request.kind === 'automation-local-at-recovery-dismissal' ||
    request.kind === 'invalid-automation-arguments' ||
    request.kind === 'device' ||
    request.kind === 'invalid-device-arguments' ||
    request.kind === 'pending-vault-files-list' ||
    request.kind === 'pending-vault-files-cancel' ||
    request.kind === 'invalid-pending-vault-files-arguments' ||
    request.kind === 'react-to-message' ||
    request.kind === 'select-reply-target' ||
    request.kind === 'invalid-reaction-arguments' ||
    request.kind === 'invalid-reply-target-arguments'
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
// Fields with no requested value are skipped; requested immutable execution
// fields must echo back. Model is intentionally excluded because turn/start
// applies its sticky model override atomically with the next user input.
function assertCodexResumeContextMatches(input: {
  input: CodexAppServerPreparedTurnInput
  requestedThreadId: string
  threadResult: unknown
}): void {
  const result = asCodexRecord(input.threadResult)
  const actualCwd = normalizeNullableString(asCodexString(result?.cwd))
  const expectedPermissions = normalizeNullableString(input.input.permissions)
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
      'modelProvider',
      normalizeNullableString(input.input.modelProvider),
      normalizeNullableString(asCodexString(result?.modelProvider)),
    ],
    [
      'sandbox',
      expectedPermissions
        ? null
        : mapCodexAppServerSandboxMode(input.input.sandbox) ?? null,
      readCodexResumeSandboxMode(result?.sandbox),
    ],
  ]

  const mismatchedFields = checks
    .filter(([, expected, actual]) => expected !== null && actual !== expected)
    .map(([field]) => field)
  if (expectedPermissions) {
    const activePermissionProfile = asCodexRecord(result?.activePermissionProfile)
    const actualRoots = asCodexStringArray(result?.runtimeWorkspaceRoots)
    const expectedRoots = input.input.runtimeWorkspaceRoots ?? []
    if (
      normalizeNullableString(asCodexString(activePermissionProfile?.id)) !==
        expectedPermissions ||
      normalizeNullableString(asCodexString(activePermissionProfile?.extends)) !== null
    ) {
      mismatchedFields.push('activePermissionProfile')
    }
    if (
      !actualRoots ||
      actualRoots.length !== expectedRoots.length ||
      actualRoots.some(
        (root, index) =>
          path.resolve(root) !== path.resolve(expectedRoots[index] ?? ''),
      )
    ) {
      mismatchedFields.push('runtimeWorkspaceRoots')
    }
  }
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

function asCodexStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : null
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
  rawEvent: CodexRpcMessage,
): string | null {
  if (isCodexProductFeedbackDynamicToolEvent(rawEvent)) {
    return null
  }
  if (normalizedEvent.kind === 'status_item') {
    if (
      normalizedEvent.itemType !== 'commandExecution' &&
      normalizedEvent.itemType !== 'dynamicToolCall' &&
      normalizedEvent.itemType !== 'fileChange'
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

function isCodexProductFeedbackDynamicToolEvent(
  event: CodexRpcMessage,
): boolean {
  const item = readCodexRecord(readCodexRecord(event.params)?.item)
  return (
    item?.type === 'dynamicToolCall' &&
    item.namespace === 'murph' &&
    item.tool === 'submit_product_feedback'
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
