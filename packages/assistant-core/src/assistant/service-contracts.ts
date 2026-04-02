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
  executionContext?: AssistantExecutionContext | null
  failoverRoutes?: readonly AssistantProviderFailoverRoute[] | null
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
  providerOptions: AssistantProviderSessionOptions
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
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
      kind: 'blocked'
      error: unknown
      failoverState: AssistantProviderFailoverState
      session: AssistantSession
    }
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
  diagnostic: Omit<Parameters<typeof recordAssistantDiagnosticEvent>[0], 'vault'>
  receipt: Omit<Parameters<typeof finalizeAssistantTurnReceipt>[0], 'vault'>
}

export type { ResolvedAssistantSession }
export type { AssistantExecutionContext, AssistantHostedExecutionContext } from './execution-context.js'
