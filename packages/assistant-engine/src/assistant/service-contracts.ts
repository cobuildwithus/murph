import type {
  AssistantApprovalPolicy,
  AssistantAskResult,
  AssistantChatProvider,
  AssistantBindingDeliveryKind,
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantDeliverySource,
  AssistantProviderSessionOptions,
  AssistantSandbox,
  AssistantSession,
  AssistantTurnTrigger,
  AssistantVaultImageResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import type { AssistantProviderProgressEvent } from './provider-progress.js'
import type { AssistantUsageAttribution } from './usage-attribution.js'
import type {
  AssistantProviderRequestStartTiming,
  AssistantProviderServiceTier,
  AssistantProviderFinishWithoutReplyAcceptedEvent,
  AssistantProviderTurnExecutionResult,
} from './providers/types.js'
import type { ResolvedAssistantPromptTimeContext } from './prompt-time.js'
import type {
  AssistantProviderStartCriticalPathContext,
} from './provider-start-critical-path.js'
import type {
  AutomationAssistantTargetOverride,
} from '@murphai/contracts'
import type { AssistantUserMessageContentPart } from './content-types.js'
import type { AssistantMaintenanceProfile } from './maintenance-evidence.js'
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
import type {
  HostedRuntimeGroupEmailScheduledAuthority,
  HostedRuntimeScheduledAutomationAuthority,
} from '@murphai/hosted-execution/runtime-control'
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

export interface AssistantHostedImageCompletionEffectRestriction {
  authorizedOriginAssistantInputId: string | null
  completionAssistantInputId: string
  exactMedia: readonly [AssistantVaultImageResponseMedia] | null
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
} & AssistantProviderRequestStartTiming) => Promise<void> | void

export type AssistantFinishWithoutReplyAcceptedHook = (event: {
  acceptedInputIds: readonly string[]
} & AssistantProviderFinishWithoutReplyAcceptedEvent) => Promise<void> | void

export type AssistantProviderAcceptedInputsRelease = () => Promise<void> | void

export type AssistantBeforeProviderAcceptedInputsHook = (event: {
  acceptedInputs: readonly AssistantAcceptedTurnInputItemInput[]
}) =>
  | AssistantProviderAcceptedInputsRelease
  | Promise<AssistantProviderAcceptedInputsRelease | void>
  | void

export interface AssistantTurnEnvironment {
  /** Null means the caller has no safe per-turn process cwd and ambient process.cwd() must not decide hosted provider cwd. */
  currentWorkingDirectory?: string | null
  env?: NodeJS.ProcessEnv
}

export interface AssistantMessageInput extends AssistantSessionResolutionFields {
  abortSignal?: AbortSignal
  // Exact-turn authorization for private assistant style settings. Email
  // ingress must opt in after authenticating the current member sender.
  assistantStyleSettingsAuthorized?: boolean
  acceptedTurnInput?: {
    initialInputs?: readonly AssistantAcceptedTurnInputItemInput[] | null
  } | null
  activeTurnCheckpoint?: AssistantActiveTurnInputCheckpointHook
  activeTurnInput?: AssistantActiveTurnInputAdmissionHook
  beforeProviderAcceptedInputs?: AssistantBeforeProviderAcceptedInputsHook | null
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null
  // Automation-owned per-turn provider route override. It is execution input,
  // not durable session target state.
  assistantTargetOverride?: AutomationAssistantTargetOverride | null
  // Codex --config overrides for this turn only; never part of route identity.
  codexConfigOverrides?: readonly string[] | null
  codexCommand?: string
  deliverResponse?: boolean
  deliveryDispatchMode?: AssistantOutboxDispatchMode
  deliveryIdempotencyKey?: string | null
  answeredMailboxItemIds?: readonly string[] | null
  reviewedAssistantAskCompletionExpiresAt?: string | null
  deliveryMessageReactionsAvailable?: boolean | null
  deliveryNativeReplyRequested?: true
  deliveryReplyToMessageId?: string | null
  deliverySource?: AssistantDeliverySource | null
  deliverySubject?: string | null
  deliveryTarget?: string | null
  executionContext?: AssistantExecutionContext | null
  expectedActiveTurnId?: string | null
  hostedDeliveryIdempotency?: AssistantHostedDeliveryIdempotencyContext | null
  // Engine-owned and turn-local. It preserves a trusted completion's provider
  // contract while preventing the system input from becoming user authority.
  hostedImageCompletionEffectRestriction?:
    AssistantHostedImageCompletionEffectRestriction | null
  includeEarlySessionOnboarding?: boolean
  // Engine-owned silent-maintenance policy. It selects trusted prompt/evidence
  // boundaries and is never supplied by a model or persisted automation.
  maintenanceProfile?: AssistantMaintenanceProfile | null
  onFinishWithoutReplyAccepted?: AssistantFinishWithoutReplyAcceptedHook | null
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onProviderRequestStarted?: AssistantProviderRequestStartHook | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  operatorAuthority?: AssistantOperatorAuthority
  outboxAutomationAuthority?: AssistantOutboxIntent['automationAuthority']
  outboxExternalThreadRouteAuthority?: AssistantOutboxIntent['externalThreadRouteAuthority']
  persistUserPromptOnFailure?: boolean
  /** Engine-resolved once for this turn so every prompt layer shares one time authority. */
  promptTimeContext?: ResolvedAssistantPromptTimeContext
  // Existing App Server per-turn thread option. Never enters session identity
  // or persisted provider config.
  providerThreadEphemeral?: boolean | null
  prompt: string
  suppressProviderFailureTranscriptAudit?: boolean
  turnContext?: string | null
  userMessageContent?: AssistantUserMessageContentPart[] | null
  receiptMetadata?: Record<string, string> | null
  scheduledAutomationAuthority?: HostedRuntimeGroupEmailScheduledAuthority | null
  // Generic engine-owned invocation identity. This grants no side effect by
  // itself and is never model supplied.
  scheduledInvocationAuthority?: HostedRuntimeScheduledAutomationAuthority | null
  // Exact engine-owned occurrence for this scheduled turn. This is ephemeral
  // decision context, not persisted automation or session state.
  scheduledOccurrenceAt?: string | null
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
  userContentReceivedAt?: string | null
  userTranscriptRef: AssistantAcceptedTurnInputItemInput['transcriptRef'] | null
  userPersisted: boolean
}

export interface ExecutedAssistantProviderTurnResult extends AssistantProviderTurnExecutionResult {
  assistantContractFingerprint: string
  attemptCount: number
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
  AssistantHostedExecutionContext,
  AssistantHostedProgressDeliveryDependencies,
} from './execution-context.js'
