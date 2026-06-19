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
  AssistantProviderServiceTier,
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
  AssistantCodexContinuation,
} from './active-turn-input-journal.js'
import type {
  CodexThreadIdentity,
} from './codex-thread-route.js'
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

export interface AssistantHostedDeliveryIdempotencyContext {
  assistantTurnOrdinal: number | string
  conversationId?: string | null
  inboundMailboxItemIds?: readonly string[] | null
  recipientKey?: string | null
}

export type AssistantProviderRequestStartHook = (event: {
  acceptedInputIds: readonly string[]
  admissionMs?: number
  preProviderSetupMs?: number
  promptBuildMs?: number
  providerRequestOrdinal: number
  sessionResolveMs?: number
  startedAt: string
  turnLockWaitMs?: number
}) => Promise<void> | void

export type AssistantFinishWithoutReplyAcceptedHook = (event: {
  acceptedInputIds: readonly string[]
  deliveryContextOrdinal: number
}) => Promise<void> | void

export interface AssistantTurnEnvironment {
  /** Null means the caller has no safe per-turn process cwd and ambient process.cwd() must not decide hosted provider cwd. */
  currentWorkingDirectory?: string | null
  env?: NodeJS.ProcessEnv
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
  hostedDeliveryIdempotency?: AssistantHostedDeliveryIdempotencyContext | null
  includeEarlySessionOnboarding?: boolean
  onFinishWithoutReplyAccepted?: AssistantFinishWithoutReplyAcceptedHook | null
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: AssistantProviderRequestStartHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  operatorAuthority?: AssistantOperatorAuthority
  persistUserPromptOnFailure?: boolean
  prompt: string
  userMessageContent?: AssistantUserMessageContentPart[] | null
  receiptMetadata?: Record<string, string> | null
  // Per-turn provider processing tier; never part of session/route identity.
  serviceTier?: AssistantProviderServiceTier | null
  showThinkingTraces?: boolean
  turnEnvironment?: AssistantTurnEnvironment | null
  turnTrigger?: AssistantTurnTrigger
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'deliverResponse' | 'deliveryTarget' | 'prompt'> {
  initialPrompt?: string | null
}

export interface AssistantTurnSharedPlan {
  cliAccess: AssistantCliAccessContext
  conversationPolicy: import('./conversation-policy.js').AssistantConversationPolicy
  onboardingGuidanceOpen: boolean
  firstContactStateDocIds: string[]
  operatorAuthority: AssistantOperatorAuthority
  persistUserPromptOnFailure: boolean
  requestedWorkingDirectory: string
}

export interface PersistedUserTurn {
  turnCreatedAt: string
  turnId: string
  userTranscriptRef: AssistantAcceptedTurnInputItemInput['transcriptRef'] | null
  userPersisted: boolean
}

export interface ExecutedAssistantProviderTurnResult extends AssistantProviderTurnExecutionResult {
  assistantContractFingerprint: string
  attemptCount: number
  nonReplayableProviderWork?: boolean
  onboardingGuidanceInjected?: boolean
  codexContinuation: AssistantCodexContinuation
  providerOptions: AssistantProviderSessionOptions
  route: CodexThreadIdentity
  session: AssistantSession
  usageAttribution?: AssistantUsageAttribution | null
  workingDirectory: string
}

export type AssistantDeliveryOutcome =
  | {
      kind: 'failed'
      error: AssistantDeliveryError
      intentId: string | null
      media: AssistantAskResult['media']
      session: AssistantSession
    }
  | {
      kind: 'not-requested'
      media: AssistantAskResult['media']
      session: AssistantSession
    }
  | {
      kind: 'queued'
      error: AssistantDeliveryError | null
      intentId: string
      media: AssistantAskResult['media']
      session: AssistantSession
    }
  | {
      kind: 'sent'
      delivery: NonNullable<AssistantAskResult['delivery']>
      intentId: string | null
      media: AssistantAskResult['media']
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
  AssistantGeneratedImageContentType,
  AssistantHostedGeneratedImageUploadInput,
  AssistantHostedGeneratedImageUploader,
  AssistantHostedExecutionContext,
  AssistantHostedProgressDeliveryDependencies,
} from './execution-context.js'
