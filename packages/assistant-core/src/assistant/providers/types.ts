import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSessionBinding,
} from '../../assistant-cli-contracts.js'
import type {
  CodexProgressEvent,
} from '../../assistant-codex.js'
import type {
  AssistantProviderTraceEvent,
} from '../provider-traces.js'
import type {
  AssistantProviderConfig,
} from '../provider-config.js'
import type { AssistantToolCatalog } from '../../model-harness.js'

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
  /**
   * @deprecated Use `supportsHostToolRuntime` instead.
   */
  supportsBoundTools: boolean
  supportsHostToolRuntime: boolean
  supportsDirectCliExecution: boolean
  supportsModelDiscovery: boolean
  supportsReasoningEffort: boolean
}

export interface AssistantProviderTraits {
  resumeKeyMode: 'none' | 'provider-session-id'
  sessionMode: 'stateful' | 'stateless'
  transcriptContextMode: 'local-transcript' | 'provider-session'
  workspaceMode: 'direct-cli' | 'none'
}

export interface AssistantProviderProgressEvent extends CodexProgressEvent {}

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
  configOverrides?: readonly string[]
  continuityContext?: string | null
  conversationMessages?: ReadonlyArray<{
    content: string
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
  workingDirectory: string
}

export interface AssistantProviderTurnExecutionInput {
  abortSignal?: AbortSignal
  configOverrides?: readonly string[]
  continuityContext?: string | null
  conversationMessages?: ReadonlyArray<{
    content: string
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
  capabilities: AssistantProviderCapabilities
  traits: AssistantProviderTraits
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
