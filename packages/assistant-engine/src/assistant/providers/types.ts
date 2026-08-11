import type {
  AssistantChatProvider,
  AssistantMessageReaction,
  AssistantResponseMedia,
  AssistantSessionBinding,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantProviderTraceEvent,
} from '../provider-traces.js'
import type {
  AssistantProviderConfig,
  AssistantProviderConfigLike,
} from '@murphai/operator-config/assistant/provider-config'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import type {
  AssistantProviderProgressEvent as SharedAssistantProviderProgressEvent,
} from '../provider-progress.js'
import type {
  AssistantUserMessageContentPart,
} from '../content-types.js'
import type { AssistantUsageAttribution } from '../usage-attribution.js'
import type { AssistantActiveTurnLiveProviderSteering } from '../turn-input.js'
import type {
  AssistantProgressDelivery,
  AssistantTurnProductFeedbackRecorder,
} from '../turn-progress.js'
import type {
  AssistantHostedToolContext,
} from '../hosted-tool-context.js'
import type {
  AssistantWorkspaceArtifactMaterializer,
} from '../execution-context.js'
import type {
  AssistantRuntimeIssueInput,
} from '../issue-reporting.js'
import type {
  AssistantAcceptedMessageTargetAuthorizer,
} from '../message-target-selection.js'
import type {
  AssistantUsageTokenPricingBasis,
} from '@murphai/hosted-execution/assistant-usage'
import type {
  HostedRuntimeProductFeedbackRecord,
} from '@murphai/hosted-execution/runtime-control'
import type {
  AssistantProviderStartCriticalPathContext,
  AssistantProviderStartCriticalPathTiming,
} from '../provider-start-critical-path.js'

export type AssistantProviderProgressEvent = SharedAssistantProviderProgressEvent
export type AssistantUserMessageContentType = AssistantUserMessageContentPart['type']

export function supportsAnyAssistantRichUserMessageContent(
  supportedTypes: readonly AssistantUserMessageContentType[],
): boolean {
  return supportedTypes.some((type) => type !== 'text')
}

export interface AssistantModelCapabilities {
  images: boolean
  pdf: boolean
  reasoning: boolean
  streaming: boolean
  tools: boolean
}

export interface AssistantCatalogModel {
  capabilities: AssistantModelCapabilities
  description: string
  id: string
  label: string
  source: 'current' | 'static'
}

export interface AssistantProviderCapabilities {
  supportedUserMessageContentTypes: readonly AssistantUserMessageContentType[]
  supportsNativeResume: boolean
  supportsReasoningEffort: boolean
  supportsRichUserMessageContent: boolean
}

export interface AssistantProviderConversationMessage {
  content: string | AssistantUserMessageContentPart[]
  role: 'assistant' | 'user'
}

export interface AssistantProviderRequestStartTiming {
  codexAppServerInitializeMs?: number
  codexAppServerPreProviderMs?: number
  codexAppServerSpawnReadyMs?: number
  codexAppServerThreadResumeMs?: number
  codexAppServerThreadStartMs?: number
  codexAppServerWarmReuseMs?: number
  providerStartCriticalPath?: AssistantProviderStartCriticalPathTiming
}

export interface AssistantProviderRequestStartedEvent
  extends AssistantProviderRequestStartTiming {
  startedAt: string
}

export interface AssistantProviderFinishWithoutReplyAcceptedEvent {
  deliveryContextOrdinal: number
  messageReactionPending: boolean
}

/**
 * Per-turn OpenAI processing tier. This is turn execution policy only: it must
 * never enter `CodexThreadIdentity`/route fingerprints or persisted session
 * target config, because tier changes must not fork thread continuity.
 */
export type AssistantProviderServiceTier = 'flex'

export interface AssistantProviderDynamicTool {
  readonly deferLoading?: boolean
  readonly description: string
  readonly inputSchema: object
  readonly name: string
  readonly namespace: string
}

/**
 * Trusted per-turn limits for generated songs. This is execution policy only:
 * prompts and model-supplied tool arguments cannot relax it.
 */
export interface AssistantGenerateSongTurnPolicy {
  readonly maxAttempts: number
  readonly requiredDurationSeconds: number
}

export interface AssistantProviderTurn {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  activeTurnId?: string | null
  activeTurnSessionId?: string | null
  allowFinishWithoutReply?: boolean | null
  automationRelativeDateReferenceAt?: string | null
  authorizeAcceptedMessageTarget?: AssistantAcceptedMessageTargetAuthorizer | null
  abortSignal?: AbortSignal
  codexConfigOverrides?: readonly string[] | null
  codexThreadConfig?: Readonly<Record<string, unknown>> | null
  conversationHistoryMessages?: ReadonlyArray<AssistantProviderConversationMessage>
  developerInstructions?: string | null
  dynamicTools: readonly AssistantProviderDynamicTool[]
  environments?: readonly Readonly<Record<string, unknown>>[] | null
  env?: NodeJS.ProcessEnv
  generateSongPolicy?: AssistantGenerateSongTurnPolicy | null
  groupConversation?: boolean | null
  groupRoomModelMaintenanceAuthorized?: boolean | null
  onFinishWithoutReplyAccepted?: ((
    event: AssistantProviderFinishWithoutReplyAcceptedEvent
  ) => Promise<void> | void) | null
  onFinishWithoutReplyRecorded?: ((event: {
    deliveryContextOrdinal: number
  }) => Promise<void> | void) | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: ((event: AssistantProviderRequestStartedEvent) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  providerFetch?: typeof fetch | null
  providerRequestOrdinal?: number | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
  prompt?: string | null
  productFeedbackRecorder?: AssistantTurnProductFeedbackRecorder | null
  providerThreadEphemeral?: boolean | null
  permissions?: string | null
  processLifetime?: 'one-shot' | null
  publicInternetFetch?: typeof fetch | null
  requireHostedPrivateImageDelivery?: boolean | null
  runtimeWorkspaceRoots?: readonly string[] | null
  resume?: AssistantProviderCodexResume | null
  serviceTier?: AssistantProviderServiceTier | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  progressDelivery?: AssistantProgressDelivery | null
  hostedToolContext?: AssistantHostedToolContext | null
  materializeWorkspaceArtifacts?: AssistantWorkspaceArtifactMaterializer | null
  onboardingFirstReadCompletionTransitionAvailable?: boolean | null
  turnContextPrompt?: string | null
  userPrompt?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
  usageAttribution?: AssistantUsageAttribution | null
  assistantPreferredElevenLabsVoiceId?: string | null
  voiceMemoDeliveryChannel?: 'linq' | 'telegram' | null
  vaultRoot?: string | null
  workingDirectory: string
}

export interface AssistantProviderTurnInput {
  providerConfig: AssistantProviderConfigLike
  turn: AssistantProviderTurn
}

export interface AssistantProviderCodexResume {
  codexThreadId: string
}

export type AssistantProviderTurnExecutionInput = AssistantProviderTurn & {
  providerConfig: AssistantProviderConfig
}

export interface AssistantProviderUsage {
  apiKeyEnv: string | null
  baseUrl: string | null
  cacheWriteTokens: number | null
  cachedInputTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  providerMetadataJson: unknown | null
  providerName: string | null
  providerRequestId: string | null
  rawUsageJson: unknown | null
  rawUsageJsonHash?: string | null
  reasoningTokens: number | null
  requestedModel: string | null
  servedModel: string | null
  tokenPricingBasis?: AssistantUsageTokenPricingBasis | null
  totalTokens: number | null
  turnProfileJson?: Record<string, unknown> | null
  usageExtractionSourcePath?: string | null
  usageExtractionVersion?: string | null
}

export interface AssistantProviderUsageDraft {
  occurredAt: string
  provider: string
  providerRequestOrdinal: number
  providerRequestOutcome?: AssistantProviderRequestOutcome
  usage: AssistantProviderUsage
}

export type AssistantProviderRequestOutcome =
  | 'aborted'
  | 'failed'
  | 'partial'
  | 'succeeded'

export type AssistantNoReplyDisposition = {
  kind: 'none'
}

export interface AssistantTargetedMessageReactionAction {
  deliveryContextOrdinal: number
  reaction: AssistantMessageReaction
  targetInputId: string
}

export interface AssistantProviderTurnExecutionResult {
  codexRolloutRelativePath?: string | null
  additionalUsages?: readonly AssistantProviderUsageDraft[] | null
  provider: AssistantChatProvider
  codexThreadId: string | null
  rawEvents: unknown[]
  acceptedNoReplyDeliveryContextOrdinals?: readonly number[] | null
  finalAction?: AssistantNoReplyDisposition
  reactions?: readonly AssistantTargetedMessageReactionAction[] | null
  response: string
  /** Final provider-authored text before runtime-owned presentation transforms. */
  providerAuthoredResponse?: string | null
  /** Capability-free semantic response persisted into model-visible history. */
  transcriptResponse: string | null
  // Completed final answers that were followed by a steered user message and
  // later superseded by another final answer in the same provider turn, in
  // completion order. Delivered ahead of `response` because Codex frontends
  // render every completed agent message.
  precedingResponseSegments?: readonly AssistantProviderResponseSegment[]
  productFeedbackCandidate?: HostedRuntimeProductFeedbackRecord | null
  /** Accepted-input ordinal whose delivery context owns the final response presentation. */
  responseDeliveryContextOrdinal: number
  /** Accepted input selected as the native target for this response, if any. */
  targetInputId?: string | null
  responseMedia?: readonly AssistantResponseMedia[] | null
  responseCard?: AssistantResponseCard | null
  stderr: string
  stdout: string
  usage?: AssistantProviderUsage | null
}

export interface AssistantProviderResponseSegment {
  deliveryContextOrdinal: number
  media?: readonly AssistantResponseMedia[] | null
  /** Capability-free semantic text persisted into model-visible history. */
  transcriptResponse?: string | null
  response: string
  targetInputId?: string | null
}

export interface AssistantProviderAttemptMetadata {
  activityLabels: readonly string[]
  executedToolCount: number
  providerActionCount: number
  rawToolEvents: readonly unknown[]
  runtimeIssueInputs: readonly AssistantRuntimeIssueInput[]
}

export type AssistantProviderTurnAttemptResult =
  | {
      ok: true
      metadata: AssistantProviderAttemptMetadata
      result: AssistantProviderTurnExecutionResult
    }
  | {
      additionalUsages?: readonly AssistantProviderUsageDraft[] | null
      error: unknown
      metadata: AssistantProviderAttemptMetadata
      ok: false
      providerRequestOutcome?: Exclude<AssistantProviderRequestOutcome, 'succeeded'>
      codexRolloutRelativePath?: string | null
      codexThreadId?: string | null
      acceptedNoReplyDeliveryContextOrdinals?: readonly number[] | null
      reactions?: readonly AssistantTargetedMessageReactionAction[] | null
      providerTurnId?: string | null
      rawEvents?: unknown[]
      usage?: AssistantProviderUsage | null
    }
