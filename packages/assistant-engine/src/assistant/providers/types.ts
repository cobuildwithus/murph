import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
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
import type { AssistantTurnProgress } from '../turn-progress.js'

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

export interface AssistantProviderTurnInput {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  activeTurnId?: string | null
  activeTurnMessages?: ReadonlyArray<{
    content: string | AssistantUserMessageContentPart[]
    role: 'assistant' | 'user'
  }>
  activeTurnSessionId?: string | null
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy | null
  codexCommand?: string | null
  codexHome?: string | null
  developerInstructions?: string | null
  env?: NodeJS.ProcessEnv
  model?: string | null
  modelProvider?: string | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean | null
  profile?: string | null
  prompt?: string | null
  provider?: AssistantChatProvider | null
  reasoningEffort?: string | null
  refreshThreadInstructions?: boolean
  resumeCodexThreadId?: string | null
  freshThreadFallback?: AssistantProviderFreshThreadFallbackInput | null
  sandbox?: AssistantSandbox | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  turnProgress?: AssistantTurnProgress | null
  turnContextPrompt?: string | null
  userPrompt?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
  usageAttribution?: AssistantUsageAttribution | null
  workingDirectory: string
}

export interface AssistantProviderFreshThreadFallbackInput {
  developerInstructions?: string | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  turnContextPrompt?: string | null
}

export interface AssistantProviderTurnExecutionInput {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  activeTurnId?: string | null
  activeTurnMessages?: ReadonlyArray<{
    content: string | AssistantUserMessageContentPart[]
    role: 'assistant' | 'user'
  }>
  activeTurnSessionId?: string | null
  abortSignal?: AbortSignal
  env?: NodeJS.ProcessEnv
  developerInstructions?: string | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  prompt?: string | null
  providerConfig: AssistantProviderConfig
  refreshThreadInstructions?: boolean
  resumeCodexThreadId?: string | null
  freshThreadFallback?: AssistantProviderFreshThreadFallbackInput | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  turnProgress?: AssistantTurnProgress | null
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
  totalTokens: number | null
  usageExtractionSourcePath?: string | null
  usageExtractionVersion?: string | null
}

export type AssistantProviderRequestOutcome =
  | 'aborted'
  | 'failed'
  | 'partial'
  | 'succeeded'

export interface AssistantProviderTurnExecutionResult {
  codexRolloutRelativePath?: string | null
  provider: AssistantChatProvider
  codexContinuation?: AssistantCodexContinuation
  codexThreadId: string | null
  rawEvents: unknown[]
  response: string
  stderr: string
  stdout: string
  usage?: AssistantProviderUsage | null
}

export interface AssistantProviderAttemptMetadata {
  activityLabels: readonly string[]
  executedToolCount: number
  providerActionCount: number
  rawToolEvents: readonly unknown[]
}

export type AssistantProviderTurnAttemptResult =
  | {
      ok: true
      metadata: AssistantProviderAttemptMetadata
      result: AssistantProviderTurnExecutionResult
    }
  | {
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
