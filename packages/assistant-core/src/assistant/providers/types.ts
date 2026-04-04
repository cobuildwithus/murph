import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSessionBinding,
} from '../../assistant-cli-contracts.js'
import type {
  AssistantProviderTraceEvent,
} from '../provider-traces.js'
import type {
  AssistantProviderConfig,
} from '../provider-config.js'
import type {
  AssistantProviderProgressEvent as SharedAssistantProviderProgressEvent,
} from '../provider-progress.js'
import type {
  AssistantUserMessageContentPart,
  AssistantToolCatalog,
} from '../../model-harness.js'

export type AssistantProviderProgressEvent = SharedAssistantProviderProgressEvent

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
  source: 'current' | 'discovered' | 'manual' | 'static'
}

export interface AssistantModelDiscoveryResult {
  message?: string | null
  models: readonly AssistantCatalogModel[]
  status: 'ok' | 'unauthorized' | 'unreachable' | 'unsupported'
}

export interface AssistantProviderCapabilities {
  supportsModelDiscovery: boolean
  supportsNativeResume: boolean
  supportsReasoningEffort: boolean
  supportsRichUserMessageContent: boolean
}

export interface AssistantProviderExecutionCapabilities
  extends AssistantProviderCapabilities {
  requestFormat: 'flat-prompt' | 'messages'
  supportsToolRuntime: boolean
}

export interface AssistantProviderToolRuntime {
  allowSensitiveHealthContext?: boolean
  requestId?: string | null
  sessionId?: string | null
  toolCatalog?: AssistantToolCatalog | null
  vault: string
}

export interface AssistantProviderTurnInput {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string | null
  continuityContext?: string | null
  conversationMessages?: ReadonlyArray<{
    content: string | AssistantUserMessageContentPart[]
    role: 'assistant' | 'user'
  }>
  env?: NodeJS.ProcessEnv
  headers?: Record<string, string> | null
  model?: string | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean | null
  profile?: string | null
  prompt?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
  reasoningEffort?: string | null
  resumeProviderSessionId?: string | null
  sandbox?: AssistantSandbox | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  toolRuntime?: AssistantProviderToolRuntime | null
  userPrompt?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
  workingDirectory: string
}

export interface AssistantProviderTurnExecutionInput {
  abortSignal?: AbortSignal
  continuityContext?: string | null
  conversationMessages?: ReadonlyArray<{
    content: string | AssistantUserMessageContentPart[]
    role: 'assistant' | 'user'
  }>
  env?: NodeJS.ProcessEnv
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  prompt?: string | null
  providerConfig: AssistantProviderConfig
  resumeProviderSessionId?: string | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  toolRuntime?: AssistantProviderToolRuntime | null
  userPrompt?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
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
  reasoningTokens: number | null
  requestedModel: string | null
  servedModel: string | null
  totalTokens: number | null
}

export interface AssistantProviderTurnExecutionResult {
  provider: AssistantChatProvider
  providerSessionId: string | null
  rawEvents: unknown[]
  response: string
  stderr: string
  stdout: string
  usage?: AssistantProviderUsage | null
}

export interface AssistantProviderAttemptMetadata {
  activityLabels: readonly string[]
  executedToolCount: number
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
    }

export interface AssistantProviderDefinition {
  capabilities: AssistantProviderExecutionCapabilities
  discoverModels(input: {
    config: AssistantProviderConfig
    env?: NodeJS.ProcessEnv
  }): Promise<AssistantModelDiscoveryResult>
  executeTurn(
    input: AssistantProviderTurnExecutionInput,
  ): Promise<AssistantProviderTurnAttemptResult>
  resolveLabel(config: AssistantProviderConfig): string
  resolveStaticModels(config: AssistantProviderConfig): readonly AssistantCatalogModel[]
}
