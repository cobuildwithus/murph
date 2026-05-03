import type {
  AssistantApprovalPolicy,
  AssistantAskResult,
  AssistantChatProvider,
  AssistantBindingDeliveryKind,
  AssistantDeliveryError,
  AssistantDeliverySource,
  AssistantProviderSessionOptions,
  AssistantSandbox,
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import type { AssistantProviderProgressEvent } from './provider-progress.js'
import type { AssistantUsageAttribution } from './usage-attribution.js'
import type {
  AssistantProviderTurnExecutionResult,
} from './providers/types.js'
import type { AssistantUserMessageContentPart } from './content-types.js'
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
  AssistantActiveTurnInputCheckpointHook,
  AssistantActiveTurnInputAdmissionHook,
} from './turn-input.js'
import type {
  AssistantAcceptedTurnInputItemInput,
  AssistantProviderContinuation,
} from './active-turn-input-journal.js'
import type {
  CodexThreadIdentity,
} from './provider-route.js'
import type { recordAssistantDiagnosticEvent } from './diagnostics.js'
import type { finalizeAssistantTurnReceipt } from './turns.js'

export interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  allowBindingRebind?: boolean
  bindingDeliveryTarget?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  channel?: string | null
  codexHome?: string | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  conversation?: ConversationRef | null
  identityId?: string | null
  maxSessionAgeMs?: number | null
  model?: string | null
  modelProvider?: string | null
  oss?: boolean
  participantId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  sessionId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
  vault: string
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  abortSignal?: AbortSignal
  acceptedTurnInput?: {
    initialInputs?: readonly AssistantAcceptedTurnInputItemInput[] | null
  } | null
  activeTurnCheckpoint?: AssistantActiveTurnInputCheckpointHook
  activeTurnInput?: AssistantActiveTurnInputAdmissionHook
  codexCommand?: string
  deliverResponse?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryIdempotencyKey?: string | null
  deliveryReplyToMessageId?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliverySubject?: string | null
  deliveryTarget?: string | null
  executionContext?: AssistantExecutionContext | null
  expectedActiveTurnId?: string | null
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
  onboardingBootstrapStateDocIds: string[]
  operatorAuthority: AssistantOperatorAuthority
  persistUserPromptOnFailure: boolean
  requestedWorkingDirectory: string
}

export interface AssistantRouteTurnPlan {
  cliEnv: NodeJS.ProcessEnv
  conversationMessages?: ReadonlyArray<{
    content: string | AssistantUserMessageContentPart[]
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
  userTranscriptRef: AssistantAcceptedTurnInputItemInput['transcriptRef'] | null
  userPersisted: boolean
}

export interface ExecutedAssistantProviderTurnResult extends AssistantProviderTurnExecutionResult {
  attemptCount: number
  nonReplayableProviderWork?: boolean
  onboardingGuidanceInjected?: boolean
  providerContinuation: AssistantProviderContinuation
  providerOptions: AssistantProviderSessionOptions
  route: CodexThreadIdentity
  session: AssistantSession
  threadInstructionsFingerprint?: string | null
  usageAttribution?: AssistantUsageAttribution | null
  workingDirectory: string
}

export interface AssistantProviderTurnExecutionPlan {
  input: AssistantMessageInput
  memoryTurnEnv: NodeJS.ProcessEnv
  route: CodexThreadIdentity
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}

export interface AssistantProviderAttemptPlan {
  attemptCount: number
  route: CodexThreadIdentity
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
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
