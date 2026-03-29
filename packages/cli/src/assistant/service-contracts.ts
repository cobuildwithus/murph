import type {
  AssistantApprovalPolicy,
  AssistantAskResult,
  AssistantChatProvider,
  AssistantDeliveryError,
  AssistantProviderFailoverRoute,
  AssistantProviderSessionOptions,
  AssistantSandbox,
  AssistantSession,
  AssistantTurnTrigger,
} from '../assistant-cli-contracts.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import type {
  AssistantProviderProgressEvent,
  AssistantProviderTurnExecutionResult,
} from '../assistant-provider.js'
import type { AssistantCliAccessContext } from '../assistant-cli-access.js'
import type { AssistantOutboxDispatchMode } from './outbox.js'
import type {
  AssistantTranscriptEntryInput,
  ResolvedAssistantSession,
} from './store.js'
import type {
  AssistantOnboardingSummary,
} from './onboarding.js'
import type { ConversationRef } from './conversation-ref.js'
import type {
  ResolvedAssistantFailoverRoute,
  readAssistantFailoverState,
} from './failover.js'
import type { recordAssistantDiagnosticEvent } from './diagnostics.js'
import type { finalizeAssistantTurnReceipt } from './turns.js'
import type { readAssistantProviderRouteRecovery } from './provider-turn-recovery.js'

export interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  headers?: Record<string, string> | null
  identityId?: string | null
  maxSessionAgeMs?: number | null
  model?: string | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  abortSignal?: AbortSignal
  codexCommand?: string
  deliverResponse?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryReplyToMessageId?: string | null
  deliveryTarget?: string | null
  enableFirstTurnOnboarding?: boolean
  failoverRoutes?: readonly AssistantProviderFailoverRoute[] | null
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  persistUserPromptOnFailure?: boolean
  prompt: string
  receiptMetadata?: Record<string, string> | null
  sessionSnapshot?: AssistantSession | null
  showThinkingTraces?: boolean
  transcriptSnapshot?: readonly AssistantTranscriptEntryInput[] | null
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
  onboardingSummary: AssistantOnboardingSummary | null
  persistUserPromptOnFailure: boolean
  requestedWorkingDirectory: string
}

export interface AssistantRouteTurnPlan {
  cliEnv: NodeJS.ProcessEnv
  configOverrides?: readonly string[]
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
  providerOptions: AssistantProviderSessionOptions
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  workingDirectory: string
}

export type AssistantProviderFailoverState = Awaited<
  ReturnType<typeof readAssistantFailoverState>
>
export type AssistantProviderRouteRecoveryState = Awaited<
  ReturnType<typeof readAssistantProviderRouteRecovery>
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
      kind: 'blocked'
      error: unknown
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      session: AssistantSession
    }
  | {
      kind: 'failed_terminal'
      error: unknown
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      session: AssistantSession
    }
  | {
      kind: 'retry_next_route'
      error: unknown
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      session: AssistantSession
    }
  | {
      kind: 'succeeded'
      failoverState: AssistantProviderFailoverState
      providerRecovery: AssistantProviderRouteRecoveryState
      result: ExecutedAssistantProviderTurnResult
    }

export type AssistantProviderTurnRecoveryOutcome =
  | {
      kind: 'blocked'
      error: unknown
      session: AssistantSession
    }
  | {
      kind: 'failed_terminal'
      error: unknown
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
  diagnostic: Parameters<typeof recordAssistantDiagnosticEvent>[0]
  receipt: Parameters<typeof finalizeAssistantTurnReceipt>[0]
}

export type { ResolvedAssistantSession }
