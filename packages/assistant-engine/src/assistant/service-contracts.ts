import type {
  AssistantApprovalPolicy,
  AssistantAskResult,
  AssistantChatProvider,
  AssistantBindingDeliveryKind,
  AssistantDeliveryError,
  AssistantOnboardingCompletionReason,
  AssistantDeliverySource,
  AssistantProviderFailoverRoute,
  AssistantProviderSessionOptions,
  AssistantSandbox,
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import type { AssistantUsageAttribution } from './usage-attribution.js'
import type {
  AssistantProviderProgressEvent,
  AssistantProviderTurnExecutionResult,
} from '../assistant-provider.js'
import type { AssistantUserMessageContentPart } from '../model-harness.js'
import type { AssistantCliAccessContext } from '../assistant-cli-access.js'
import type { AssistantOutboxDispatchMode } from './outbox.js'
import type {
  ResolvedAssistantSession,
} from './store.js'
import type {
  AssistantOperatorAuthority,
} from './operator-authority.js'
import type { ConversationRef } from './conversation-ref.js'
import type { AssistantExecutionContext } from './execution-context.js'
import type { AssistantTurnBeforeDeliveryHook } from './turn-input.js'
import type {
  ResolvedAssistantFailoverRoute,
  readAssistantFailoverState,
} from './failover.js'
import type { recordAssistantDiagnosticEvent } from './diagnostics.js'
import type { finalizeAssistantTurnReceipt } from './turns.js'

export interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  allowBindingRebind?: boolean
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  channel?: string | null
  codexHome?: string | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  conversation?: ConversationRef | null
  gatewayOnlyProviders?: readonly string[] | null
  headers?: Record<string, string> | null
  identityId?: string | null
  maxSessionAgeMs?: number | null
  model?: string | null
  oss?: boolean
  participantId?: string | null
  presetId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  webSearch?: string | null
  sandbox?: AssistantSandbox | null
  zeroDataRetention?: boolean | null
  sessionId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  abortSignal?: AbortSignal
  beforeDelivery?: AssistantTurnBeforeDeliveryHook
  codexCommand?: string
  deliverResponse?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryIdempotencyKey?: string | null
  deliveryReplyToMessageId?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliverySubject?: string | null
  deliveryTarget?: string | null
  executionContext?: AssistantExecutionContext | null
  failoverRoutes?: readonly AssistantProviderFailoverRoute[] | null
  includeEarlySessionOnboarding?: boolean
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  operatorAuthority?: AssistantOperatorAuthority
  persistUserPromptOnFailure?: boolean
  prompt: string
  userMessageContent?: AssistantUserMessageContentPart[] | null
  receiptMetadata?: Record<string, string> | null
  showThinkingTraces?: boolean
  turnTrigger?: AssistantTurnTrigger
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'deliverResponse' | 'deliveryTarget' | 'prompt'> {
  initialPrompt?: string | null
}

export interface AssistantTurnSharedPlan {
  allowSensitiveHealthContext: boolean
  cliAccess: AssistantCliAccessContext
  conversationPolicy: import('./conversation-policy.js').AssistantConversationPolicy
  onboardingGuidanceOpen: boolean
  firstContactStateDocIds: string[]
  operatorAuthority: AssistantOperatorAuthority
  persistUserPromptOnFailure: boolean
  requestedWorkingDirectory: string
}

export interface AssistantRouteTurnPlan {
  cliEnv: NodeJS.ProcessEnv
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  continuityContext: string | null
  provider: AssistantChatProvider
  providerOptions: AssistantSession['providerOptions']
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  systemPrompt: string | null
  workingDirectory: string
}

export interface PersistedUserTurn {
  turnCreatedAt: string
  turnId: string
  userPersisted: boolean
}

export interface ExecutedAssistantProviderTurnResult extends AssistantProviderTurnExecutionResult {
  attemptCount: number
  onboardingCompletionFallbackReason?: AssistantOnboardingCompletionReason | null
  onboardingGuidanceInjected?: boolean
  providerOptions: AssistantProviderSessionOptions
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  usageAttribution?: AssistantUsageAttribution | null
  workingDirectory: string
}

export type AssistantProviderFailoverState = Awaited<
  ReturnType<typeof readAssistantFailoverState>
>

export interface AssistantProviderTurnExecutionPlan {
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  primaryRoute: ResolvedAssistantFailoverRoute | null
  routes: readonly ResolvedAssistantFailoverRoute[]
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}

export interface AssistantProviderAttemptPlan {
  attemptCount: number
  primaryRouteCooldownFailover: boolean
  remainingRoutes: readonly ResolvedAssistantFailoverRoute[]
  route: ResolvedAssistantFailoverRoute
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

export type AssistantProviderAttemptOutcome =
  | {
      kind: 'failed_terminal'
      error: unknown
      failoverState: AssistantProviderFailoverState
      session: AssistantSession
    }
  | {
      kind: 'retry_next_route'
      error: unknown
      failoverState: AssistantProviderFailoverState
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      failoverState: AssistantProviderFailoverState
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'failed_terminal'
      error: unknown
      route?: ResolvedAssistantFailoverRoute | null
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      providerTurn: ExecutedAssistantProviderTurnResult
    }

export type AssistantDeliveryOutcome =
  | {
      kind: 'failed'
      error: AssistantDeliveryError
      intentId: string | null
      session: AssistantSession
    }
  | {
      kind: 'not-requested'
      session: AssistantSession
    }
  | {
      kind: 'queued'
      error: AssistantDeliveryError | null
      intentId: string
      session: AssistantSession
    }
  | {
      kind: 'sent'
      delivery: NonNullable<AssistantAskResult['delivery']>
      intentId: string | null
      session: AssistantSession
    }

export interface AssistantTurnDeliveryFinalizationPlan {
  diagnostic: Omit<Parameters<typeof recordAssistantDiagnosticEvent>[0], 'vault'>
  receipt: Omit<Parameters<typeof finalizeAssistantTurnReceipt>[0], 'vault'>
}

export type { ResolvedAssistantSession }
export type {
  AssistantChannelTypingDependencies,
  AssistantExecutionContext,
  AssistantHostedExecutionContext,
} from './execution-context.js'
