import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantResponseMedia,
  AssistantSandbox,
  AssistantSessionBinding,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantProviderTraceEvent,
} from '../provider-traces.js'
import type {
  AssistantProviderConfig,
} from '@murphai/operator-config/assistant/provider-config'
import type {
  AssistantProviderProgressEvent as SharedAssistantProviderProgressEvent,
} from '../provider-progress.js'
import type {
  AssistantUserMessageContentPart,
} from '../content-types.js'
import type { AssistantUsageAttribution } from '../usage-attribution.js'
import type { AssistantCodexContinuation } from '../active-turn-input-journal.js'
import type { AssistantActiveTurnLiveProviderSteering } from '../turn-input.js'
import type { AssistantProgressDelivery } from '../turn-progress.js'
import type {
  AssistantHostedGeneratedImageUploader,
} from '../execution-context.js'
import type {
  AssistantRuntimeIssueInput,
} from '../issue-reporting.js'
import type {
  AssistantUsageTokenPricingBasis,
} from '@murphai/hosted-execution/assistant-usage'

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

/**
 * Per-turn OpenAI processing tier. This is turn execution policy only: it must
 * never enter `CodexThreadIdentity`/route fingerprints or persisted session
 * target config, because tier changes must not fork thread continuity.
 */
export type AssistantProviderServiceTier = 'flex'

export interface AssistantProviderTurnInput {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  activeTurnId?: string | null
  activeTurnSessionId?: string | null
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy | null
  codexCommand?: string | null
  codexHome?: string | null
  conversationHistoryMessages?: ReadonlyArray<AssistantProviderConversationMessage>
  developerInstructions?: string | null
  env?: NodeJS.ProcessEnv
  generatedImageUploader?: AssistantHostedGeneratedImageUploader | null
  model?: string | null
  modelProvider?: string | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: ((event: { startedAt: string }) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean | null
  profile?: string | null
  providerFetch?: typeof fetch | null
  providerRequestOrdinal?: number | null
  prompt?: string | null
  provider?: AssistantChatProvider | null
  reasoningEffort?: string | null
  requireGeneratedImageUploader?: boolean | null
  resume?: AssistantProviderCodexResume | null
  sandbox?: AssistantSandbox | null
  serviceTier?: AssistantProviderServiceTier | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  progressDelivery?: AssistantProgressDelivery | null
  turnContextPrompt?: string | null
  userPrompt?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
  usageAttribution?: AssistantUsageAttribution | null
  workingDirectory: string
}

export interface AssistantProviderFreshThreadFallbackInput {
  conversationHistoryMessages?: ReadonlyArray<AssistantProviderConversationMessage>
  developerInstructions?: string | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  turnContextPrompt?: string | null
}

export type AssistantProviderFreshThreadFallbackResolver =
  () => Promise<AssistantProviderFreshThreadFallbackInput>

export interface AssistantProviderCodexResume {
  codexThreadId: string
  prepareFreshThreadFallback: AssistantProviderFreshThreadFallbackResolver
}

export interface AssistantProviderTurnExecutionInput {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  activeTurnId?: string | null
  activeTurnSessionId?: string | null
  abortSignal?: AbortSignal
  conversationHistoryMessages?: ReadonlyArray<AssistantProviderConversationMessage>
  env?: NodeJS.ProcessEnv
  developerInstructions?: string | null
  generatedImageUploader?: AssistantHostedGeneratedImageUploader | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: ((event: { startedAt: string }) => Promise<void> | void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  prompt?: string | null
  providerConfig: AssistantProviderConfig
  providerFetch?: typeof fetch | null
  providerRequestOrdinal?: number | null
  requireGeneratedImageUploader?: boolean | null
  resume?: AssistantProviderCodexResume | null
  serviceTier?: AssistantProviderServiceTier | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  progressDelivery?: AssistantProgressDelivery | null
  turnContextPrompt?: string | null
  userPrompt?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
  usageAttribution?: AssistantUsageAttribution | null
  workingDirectory: string
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

export type AssistantFinalAction =
  | {
      kind: 'message'
      media: readonly AssistantResponseMedia[]
      response: string
    }
  | {
      kind: 'none'
    }

export interface AssistantProviderTurnExecutionResult {
  codexRolloutRelativePath?: string | null
  additionalUsages?: readonly AssistantProviderUsageDraft[] | null
  provider: AssistantChatProvider
  codexContinuation?: AssistantCodexContinuation
  codexThreadHistoryUnsafe?: boolean | null
  codexThreadId: string | null
  rawEvents: unknown[]
  finalAction?: AssistantFinalAction
  response: string
  // Completed final answers that were followed by a steered user message and
  // later superseded by another final answer in the same provider turn, in
  // completion order. Delivered ahead of `response` because Codex frontends
  // render every completed agent message.
  precedingResponseSegments?: readonly AssistantProviderResponseSegment[]
  responseMedia?: readonly AssistantResponseMedia[] | null
  stderr: string
  stdout: string
  usage?: AssistantProviderUsage | null
}

export interface AssistantProviderResponseSegment {
  deliveryContextOrdinal?: number
  media?: readonly AssistantResponseMedia[] | null
  response: string
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
      codexContinuation?: AssistantCodexContinuation
      codexThreadId?: string | null
      providerTurnId?: string | null
      rawEvents?: unknown[]
      usage?: AssistantProviderUsage | null
    }
