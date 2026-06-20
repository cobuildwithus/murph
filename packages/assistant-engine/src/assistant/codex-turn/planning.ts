import type {
  AssistantSession,
  AssistantTurnTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  normalizeIanaTimeZone,
  resolveSystemTimeZone,
  toLocalDayKey,
} from '@murphai/contracts'
import { loadVault } from '@murphai/core'
import {
  listGeneratedAssistantProtocolIndexEntries,
} from '@murphai/health-commons/runtime'
import {
  resolveCodexAssistantTargetCapabilities,
} from '../codex-runtime.js'
import {
  readAssistantCliSurfaceBootstrapContext,
} from '../cli-surface-bootstrap.js'
import {
  readAssistantContextSnapshotPrompt,
} from '../context-snapshot.js'
import {
  normalizeAssistantExecutionContext,
  type AssistantHostedDeviceConnectProvider,
} from '../execution-context.js'
import {
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../codex-thread-route.js'
import {
  buildAssistantCodexContractFingerprint,
} from '../codex-contract-fingerprint.js'
import {
  resolveAssistantDiagnosticsPolicy,
  type AssistantDiagnosticsPolicy,
} from '../issue-reporting.js'
import { resolveAssistantModelBehaviorProfile } from '../model-behavior.js'
import {
  resolveAssistantCodexResumeThreadId,
  resolveAssistantRouteResumeBinding,
} from '../codex-resume-binding.js'
import {
  readAssistantCodexResume,
} from '../conversation-persistence.js'
import {
  listAssistantTranscriptEntries,
} from '../store.js'
import {
  ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
  ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX,
} from '../turn-finalizer.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from '../service-contracts.js'
import type {
  AssistantActiveTurnLiveProviderSteering,
} from '../turn-input.js'
import type {
  AssistantProgressDelivery,
} from '../turn-progress.js'
import {
  buildAssistantNotificationDecisionSystemPromptWithCacheMetadata,
  buildAssistantSystemPromptWithCacheMetadata,
  resolveAssistantMurphProductBaseUrl,
  type AssistantPromptCacheMetadata,
} from '../system-prompt.js'
import type {
  AssistantCodexContinuation,
} from '../active-turn-input-journal.js'
import type {
  AssistantProviderConversationMessage,
} from '../providers/types.js'
import { normalizeNullableString } from '../shared.js'
import {
  supportsAssistantCurrentAudienceMessageReaction,
} from '../delivery-service.js'
import { resolveMurphDynamicTools } from '../../assistant-codex/dynamic-tools.js'

export interface AssistantRouteTurnPlan {
  assistantContractFingerprint: string
  assistantCliContract: string | null
  cliEnv: NodeJS.ProcessEnv
  developerInstructions: string | null
  conversationHistoryMessages?: readonly AssistantProviderConversationMessage[]
  diagnosticsPolicy: AssistantDiagnosticsPolicy
  onboardingGuidanceInjected: boolean
  codexContinuation: AssistantCodexContinuation
  planningDiagnostics: AssistantRoutePlanningDiagnostics
  resume: AssistantRouteCodexResumePlan | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  promptCacheMetadata: AssistantPromptCacheMetadata | null
  systemPrompt: string | null
  turnContextPrompt: string | null
  workingDirectory: string
}

export interface AssistantRoutePlanningDiagnostics {
  assistantContextSnapshotElapsedMs: number | null
  cliBootstrapElapsedMs: number | null
  dynamicToolCount: number
  messageReactionsAvailable: boolean
  primarySystemPromptElapsedMs: number | null
  reactionDynamicToolAvailable: boolean
  routePlanningElapsedMs: number
  routePlanningMeasuredElapsedMs: number
  routePlanningSlowestStage: AssistantRoutePlanningStage | null
  routePlanningSlowestStageElapsedMs: number | null
  routePlanningUnaccountedElapsedMs: number
  routeResumeBindingElapsedMs: number | null
  routeTargetCapabilitiesElapsedMs: number | null
  shouldPrepareBootstrapContext: boolean
  supportedExperimentProtocolsElapsedMs: number | null
}

type AssistantRoutePlanningSpanKey =
  | 'assistantContextSnapshotElapsedMs'
  | 'cliBootstrapElapsedMs'
  | 'primarySystemPromptElapsedMs'
  | 'routeResumeBindingElapsedMs'
  | 'routeTargetCapabilitiesElapsedMs'
  | 'supportedExperimentProtocolsElapsedMs'

type AssistantRoutePlanningSpanMetrics = Partial<
  Record<AssistantRoutePlanningSpanKey, number>
>

export type AssistantRoutePlanningStage =
  | 'assistant_context_snapshot'
  | 'cli_bootstrap'
  | 'primary_instructions'
  | 'resume_binding'
  | 'supported_experiment_protocols'
  | 'target_capabilities'

const ASSISTANT_ROUTE_PLANNING_SPAN_STAGES: readonly {
  key: AssistantRoutePlanningSpanKey
  stage: AssistantRoutePlanningStage
}[] = [
  {
    key: 'assistantContextSnapshotElapsedMs',
    stage: 'assistant_context_snapshot',
  },
  {
    key: 'cliBootstrapElapsedMs',
    stage: 'cli_bootstrap',
  },
  {
    key: 'primarySystemPromptElapsedMs',
    stage: 'primary_instructions',
  },
  {
    key: 'routeResumeBindingElapsedMs',
    stage: 'resume_binding',
  },
  {
    key: 'routeTargetCapabilitiesElapsedMs',
    stage: 'target_capabilities',
  },
  {
    key: 'supportedExperimentProtocolsElapsedMs',
    stage: 'supported_experiment_protocols',
  },
]
const ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_LIMIT = 24
const ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_MESSAGE_BYTES = 4_000
const ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_TOTAL_BYTES = 12_000
const assistantConversationHistoryTextEncoder = new TextEncoder()

export interface AssistantRouteCodexResumePlan {
  codexThreadId: string
  prepareFreshThreadFallback: () => Promise<AssistantRouteFreshThreadFallbackPlan>
}

export interface AssistantRouteFreshThreadFallbackPlan {
  conversationHistoryMessages?: readonly AssistantProviderConversationMessage[]
  developerInstructions: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  turnContextPrompt: string | null
}

export interface AssistantPromptCapabilityAvailability {
  assistantHostedDeviceConnectAvailable: boolean
  assistantHostedDeviceConnectProviders: readonly AssistantHostedDeviceConnectProvider[]
  assistantKnowledgeToolsAvailable: boolean
}

export interface AssistantPromptTimeContext {
  currentLocalDate: string
  currentTimeZone: string
}

export type AssistantCodexTurnPromptProfile =
  | 'conversation'
  | 'notification-decision'

export type AssistantCodexTurnToolProfile =
  | 'provider-turn'
  | 'notification-turn'

export type AssistantCodexThreadScope =
  | 'session-thread'
  | 'isolated-thread'

export type AssistantCodexTurnNativeResumePolicy =
  | 'default'
  | 'disabled'

export interface AssistantCodexTurnExecutionProfile {
  nativeResumePolicy?: AssistantCodexTurnNativeResumePolicy
  promptProfile?: AssistantCodexTurnPromptProfile
  threadScope?: AssistantCodexThreadScope
  toolProfile?: AssistantCodexTurnToolProfile
}

export interface AssistantCodexTurnThreadScopeProfile
  extends AssistantCodexTurnExecutionProfile {}

export type AssistantCodexTurnResolvedExecutionProfile =
  Required<Omit<AssistantCodexTurnExecutionProfile, 'nativeResumePolicy'>>

export interface AssistantCodexTurnExecutionPlan {
  activeTurnSteering: AssistantActiveTurnLiveProviderSteering | null
  allowFinishWithoutReply?: boolean | null
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext>
  input: AssistantMessageInput
  onCodexThreadHistoryUnsafe?: ((event?: {
    deliveryContextOrdinal?: number
  }) => Promise<void> | void) | null
  onFinishWithoutReplyAccepted?: ((event: {
    deliveryContextOrdinal: number
  }) => Promise<void> | void) | null
  profile: AssistantCodexTurnResolvedExecutionProfile
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  sharedPlan: AssistantTurnSharedPlan
  progressDelivery?: AssistantProgressDelivery | null
  turnId: string
}

export interface AssistantCodexAttemptPlan {
  attemptCount: number
  route: CodexThreadIdentity
  routePlan: AssistantRouteTurnPlan
  session: AssistantSession
}

function resolveAssistantCodexTurnExecutionProfile(
  input: {
    profile: AssistantCodexTurnThreadScopeProfile | null | undefined
    turnTrigger: AssistantTurnTrigger | null | undefined
  },
): AssistantCodexTurnResolvedExecutionProfile {
  const threadScope = resolveAssistantCodexThreadScope({
    profile: input.profile,
    turnTrigger: input.turnTrigger,
  })

  return {
    promptProfile: input.profile?.promptProfile ?? 'conversation',
    threadScope,
    toolProfile: input.profile?.toolProfile ?? 'provider-turn',
  }
}

export function resolveAssistantCodexThreadScope(input: {
  profile?: AssistantCodexTurnThreadScopeProfile | null
  turnTrigger?: AssistantTurnTrigger | null
}): AssistantCodexThreadScope {
  if (
    input.profile?.threadScope === 'isolated-thread' ||
    input.profile?.nativeResumePolicy === 'disabled'
  ) {
    return 'isolated-thread'
  }

  if (input.profile?.threadScope === 'session-thread') {
    return 'session-thread'
  }

  if (input.turnTrigger === 'automation-cron') {
    return 'isolated-thread'
  }

  if (input.profile?.promptProfile === 'notification-decision') {
    return 'isolated-thread'
  }

  return 'session-thread'
}

export async function buildCodexTurnExecutionPlan(input: {
  activeTurnSteering?: AssistantActiveTurnLiveProviderSteering | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  profile?: AssistantCodexTurnThreadScopeProfile | null
  resolvedSession: AssistantSession
  route: CodexThreadIdentity
  progressDelivery?: AssistantProgressDelivery | null
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantCodexTurnExecutionPlan> {
  const executionContext = normalizeAssistantExecutionContext(input.input.executionContext)
  const profile = resolveAssistantCodexTurnExecutionProfile({
    profile: input.profile,
    turnTrigger: input.input.turnTrigger,
  })
  const promptTimeContext = await resolveAssistantPromptTimeContext(input.input.vault)

  return {
    activeTurnSteering: input.activeTurnSteering ?? null,
    executionContext,
    input: input.input,
    profile,
    promptTimeContext,
    route: input.route,
    sharedPlan: input.plan,
    progressDelivery: input.progressDelivery ?? null,
    turnId: input.turnId,
  }
}

export async function buildCodexTurnAttemptPlan(input: {
  attemptCount: number
  executionPlan: AssistantCodexTurnExecutionPlan
  session: AssistantSession
}): Promise<AssistantCodexAttemptPlan> {
  const route = input.executionPlan.route
  return {
    attemptCount: input.attemptCount,
    route,
    routePlan: await resolveAssistantRouteTurnPlan({
      executionContext: input.executionPlan.executionContext,
      input: input.executionPlan.input,
      profile: input.executionPlan.profile,
      promptTimeContext: input.executionPlan.promptTimeContext,
      route,
      session: input.session,
      sharedPlan: input.executionPlan.sharedPlan,
      progressDelivery: input.executionPlan.progressDelivery ?? null,
    }),
    session: input.session,
  }
}

export async function resolveAssistantRouteTurnPlan(input: {
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
  input: AssistantMessageInput
  profile: AssistantCodexTurnResolvedExecutionProfile
  promptTimeContext: AssistantPromptTimeContext
  route: CodexThreadIdentity
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  progressDelivery?: AssistantProgressDelivery | null
}): Promise<AssistantRouteTurnPlan> {
  const routePlanningStartedAt = Date.now()
  const routePlanningSpans: AssistantRoutePlanningSpanMetrics = {}
  const workingDirectory = input.sharedPlan.requestedWorkingDirectory
  const resumeBinding = measureRoutePlanningSync(
    routePlanningSpans,
    'routeResumeBindingElapsedMs',
    () => resolveAssistantRouteResumeBinding({
      route: input.route,
      sessionResumeState: readAssistantCodexResume(input.session),
    }),
  )
  const routeProviderCapabilities = measureRoutePlanningSync(
    routePlanningSpans,
    'routeTargetCapabilitiesElapsedMs',
    () => resolveCodexAssistantTargetCapabilities({
      ...input.route.providerOptions,
    }),
  )
  const routeFingerprint = readCodexThreadRouteFingerprint(input.route)
  const shouldUseCommittedTranscriptHistory =
    input.profile.threadScope === 'session-thread'
  const resolveCommittedTranscriptHistoryMessages = async () =>
    shouldUseCommittedTranscriptHistory
      ? await resolveAssistantCommittedTranscriptHistoryMessages({
          currentUserPrompt: input.input.prompt,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        })
      : []
  const resolvedChannel = input.input.channel ?? input.session.binding.channel
  const diagnosticsPolicy = resolveAssistantDiagnosticsPolicy({
    channel: resolvedChannel,
    executionContext: input.input.executionContext,
  })
  const shouldInjectOnboardingGuidance =
    input.profile.promptProfile === 'conversation' &&
    input.sharedPlan.onboardingGuidanceOpen
  const assistantToolNameAliases = null
  const promptCapabilityAvailability = resolveAssistantPromptCapabilityAvailability({
    executionContext: input.executionContext,
  })
  const shouldPrepareConversationThreadInstructions =
    input.profile.promptProfile === 'conversation'
  let cliBootstrapElapsedMs: number | null = null
  const bootstrapAssistantCliContract = shouldPrepareConversationThreadInstructions
    ? await measureRoutePlanningAsync(
        routePlanningSpans,
        'cliBootstrapElapsedMs',
        () => readAssistantCliSurfaceBootstrapContext({
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        }),
        (elapsedMs) => {
          cliBootstrapElapsedMs = elapsedMs
        },
      )
    : null
  const assistantSupportedExperimentProtocols =
    input.profile.promptProfile === 'conversation'
      ? measureRoutePlanningSync(
          routePlanningSpans,
          'supportedExperimentProtocolsElapsedMs',
          () => resolveAssistantSupportedExperimentProtocols(),
        )
      : []
  let assistantContextSnapshotElapsedMs: number | null = null
  const assistantContextSnapshotPrompt =
    await measureRoutePlanningAsync(
      routePlanningSpans,
      'assistantContextSnapshotElapsedMs',
      () => readAssistantContextSnapshotPrompt({
        vaultRoot: input.input.vault,
      }),
      (elapsedMs) => {
        assistantContextSnapshotElapsedMs = elapsedMs
      },
    )
  const modelBehaviorProfile = resolveAssistantModelBehaviorProfile(
    input.route.providerOptions,
  )
  const toolSchemaHash = null
  const buildRouteSystemPromptResult = (options: {
    assistantCliContract: string | null
    injectOnboardingGuidance: boolean
  }) =>
    input.profile.promptProfile === 'notification-decision'
      ? buildAssistantNotificationDecisionSystemPromptWithCacheMetadata({
            assistantContextSnapshotPrompt,
            assistantHostedDeviceConnectAvailable:
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantToolNameAliases,
            channel: resolvedChannel,
            currentLocalDate: input.promptTimeContext.currentLocalDate,
            currentTimeZone: input.promptTimeContext.currentTimeZone,
          }, {
            toolSchemaHash,
          })
      : buildAssistantSystemPromptWithCacheMetadata({
            assistantCliContract: options.assistantCliContract,
            assistantContextSnapshotPrompt,
            assistantHostedDeviceConnectAvailable:
              promptCapabilityAvailability.assistantHostedDeviceConnectAvailable,
            assistantHostedDeviceConnectProviders:
              promptCapabilityAvailability.assistantHostedDeviceConnectProviders,
            assistantKnowledgeToolsAvailable:
              promptCapabilityAvailability.assistantKnowledgeToolsAvailable,
            assistantSupportedExperimentProtocols,
            assistantToolNameAliases,
            cliAccess: input.sharedPlan.cliAccess,
            channel: resolvedChannel,
            currentLocalDate: input.promptTimeContext.currentLocalDate,
            currentTimeZone: input.promptTimeContext.currentTimeZone,
            murphProductBaseUrl: resolveAssistantMurphProductBaseUrl(
              input.sharedPlan.cliAccess.env,
            ),
            onboardingGuidance: options.injectOnboardingGuidance,
            modelBehaviorProfile,
            turnTrigger: input.input.turnTrigger ?? null,
          }, {
            toolSchemaHash,
          })
  const buildDeveloperInstructions = (
    promptResult: ReturnType<typeof buildAssistantSystemPromptWithCacheMetadata>,
  ) =>
    [
      promptResult.layers.staticCacheableCorePrompt,
      promptResult.layers.stableRouteCapabilityPrompt,
      promptResult.layers.threadContextPrompt,
    ]
      .filter((section): section is string =>
        Boolean(normalizeNullableString(section)),
      )
      .join('\n\n')
  const threadStartPromptResult = measureRoutePlanningSync(
    routePlanningSpans,
    'primarySystemPromptElapsedMs',
    () => buildRouteSystemPromptResult({
      assistantCliContract: bootstrapAssistantCliContract,
      injectOnboardingGuidance: shouldInjectOnboardingGuidance,
    }),
  )
  const threadStartDeveloperInstructions = normalizeNullableString(
    buildDeveloperInstructions(threadStartPromptResult),
  )
  const messageReactionsAvailable = supportsAssistantCurrentAudienceMessageReaction({
    input: input.input,
    session: input.session,
    sharedPlan: input.sharedPlan,
  })
  const dynamicTools = resolveMurphDynamicTools({
    allowFinishWithoutReply: input.profile.toolProfile === 'provider-turn',
    allowMessageReactions: messageReactionsAvailable,
    computerToolsAvailable:
      input.progressDelivery?.hostedComputerToolsAvailable === true,
  })
  const reactionDynamicToolAvailable = dynamicTools.some(
    (tool) => tool.namespace === 'murph' && tool.name === 'react_to_message',
  )
  const assistantContractFingerprint = buildAssistantCodexContractFingerprint({
    developerInstructions: threadStartDeveloperInstructions,
    dynamicTools,
    routeFingerprint,
  })
  const nativeResumeEnabled =
    input.profile.threadScope === 'session-thread'
  const candidateResumeCodexThreadId =
    nativeResumeEnabled &&
    routeProviderCapabilities.supportsNativeResume &&
    resumeBinding !== null &&
    normalizeNullableString(resumeBinding.assistantContractFingerprint) ===
      assistantContractFingerprint
      ? resolveAssistantEffectiveCodexResumeThreadId({
          resumeCodexThreadId: resolveAssistantCodexResumeThreadId({
            resumeState: resumeBinding,
          }),
        })
      : null
  const resumeCodexThreadId = candidateResumeCodexThreadId
  const conversationHistoryMessages = resumeCodexThreadId === null
    ? await resolveCommittedTranscriptHistoryMessages()
    : []
  const shouldInjectBootstrapContext = resumeCodexThreadId === null
  const shouldPrepareBootstrapContext = shouldInjectBootstrapContext
  const actualAssistantCliContract = shouldPrepareBootstrapContext
    ? bootstrapAssistantCliContract
    : null
  const buildFreshThreadFallbackPlan = async () => {
    const fallbackConversationHistoryMessages =
      await resolveCommittedTranscriptHistoryMessages()

    return {
      conversationHistoryMessages:
        fallbackConversationHistoryMessages.length > 0
          ? fallbackConversationHistoryMessages
          : undefined,
      developerInstructions: threadStartDeveloperInstructions,
      sessionContext: {
        binding: input.session.binding,
      },
      turnContextPrompt: normalizeNullableString(
        threadStartPromptResult.layers.dynamicTurnContextPrompt,
      ),
    }
  }
  const resume = resumeCodexThreadId !== null
    ? {
        codexThreadId: resumeCodexThreadId,
        prepareFreshThreadFallback: buildFreshThreadFallbackPlan,
      }
    : null
  const systemPromptResult = threadStartPromptResult
  const systemPrompt = systemPromptResult.prompt
  const developerInstructions =
    resumeCodexThreadId === null
      ? threadStartDeveloperInstructions
      : null
  const turnContextPrompt = normalizeNullableString(
    systemPromptResult.layers.dynamicTurnContextPrompt,
  )
  const routePlanningElapsedMs = elapsedSince(routePlanningStartedAt)
  const routePlanningMeasuredElapsedMs = sumRoutePlanningSpanMetrics(
    routePlanningSpans,
  )
  const routePlanningUnaccountedElapsedMs = Math.max(
    0,
    routePlanningElapsedMs - routePlanningMeasuredElapsedMs,
  )
  const routePlanningSlowestSpan =
    resolveRoutePlanningSlowestSpan(routePlanningSpans)

  return {
    assistantContractFingerprint,
    assistantCliContract: actualAssistantCliContract,
    cliEnv: input.sharedPlan.cliAccess.env,
    developerInstructions: normalizeNullableString(developerInstructions),
    conversationHistoryMessages:
      conversationHistoryMessages.length > 0
        ? conversationHistoryMessages
        : undefined,
    diagnosticsPolicy,
    onboardingGuidanceInjected: shouldInjectOnboardingGuidance,
    codexContinuation: resolveAssistantCodexContinuation({
      resumeCodexThreadId,
    }),
    planningDiagnostics: {
      assistantContextSnapshotElapsedMs,
      cliBootstrapElapsedMs,
      dynamicToolCount: dynamicTools.length,
      messageReactionsAvailable,
      primarySystemPromptElapsedMs:
        routePlanningSpans.primarySystemPromptElapsedMs ?? null,
      reactionDynamicToolAvailable,
      routePlanningElapsedMs,
      routePlanningMeasuredElapsedMs,
      routePlanningSlowestStage: routePlanningSlowestSpan?.stage ?? null,
      routePlanningSlowestStageElapsedMs:
        routePlanningSlowestSpan?.elapsedMs ?? null,
      routePlanningUnaccountedElapsedMs,
      routeResumeBindingElapsedMs:
        routePlanningSpans.routeResumeBindingElapsedMs ?? null,
      routeTargetCapabilitiesElapsedMs:
        routePlanningSpans.routeTargetCapabilitiesElapsedMs ?? null,
      shouldPrepareBootstrapContext,
      supportedExperimentProtocolsElapsedMs:
        routePlanningSpans.supportedExperimentProtocolsElapsedMs ?? null,
    },
    resume,
    sessionContext: shouldPrepareBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    promptCacheMetadata: systemPromptResult.cacheMetadata,
    workingDirectory,
    systemPrompt,
    turnContextPrompt,
  }
}

async function resolveAssistantCommittedTranscriptHistoryMessages(input: {
  currentUserPrompt: string
  sessionId: string
  vault: string
}): Promise<readonly AssistantProviderConversationMessage[]> {
  let entries: Awaited<ReturnType<typeof listAssistantTranscriptEntries>>
  try {
    entries = await listAssistantTranscriptEntries(input.vault, input.sessionId)
  } catch {
    return []
  }

  type TranscriptHistoryCandidate = {
    message: AssistantProviderConversationMessage
    userPromptKey: string | null
  }

  const messages = entries.flatMap((entry): TranscriptHistoryCandidate[] => {
    if (
      entry.kind === 'status' &&
      entry.text.startsWith(ASSISTANT_NO_REPLY_TRANSCRIPT_MARKER_PREFIX)
    ) {
      return [{
        message: {
          content: ASSISTANT_NO_REPLY_TRANSCRIPT_HISTORY_TEXT,
          role: 'assistant',
        },
        userPromptKey: null,
      }]
    }
    if (entry.kind !== 'assistant' && entry.kind !== 'user') {
      return []
    }
    const rawContent = normalizeNullableString(entry.text)
    const content = limitAssistantConversationHistoryTextBytes(
      rawContent,
      ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_MESSAGE_BYTES,
    )
    return content
      ? [{
          message: {
            content,
            role: entry.kind,
          },
          userPromptKey: entry.kind === 'user' && rawContent
            ? normalizeAssistantConversationHistoryText(rawContent)
            : null,
        }]
      : []
  })

  const currentPromptKey = normalizeAssistantConversationHistoryText(input.currentUserPrompt)

  while (messages.length > 0) {
    const lastMessage = messages[messages.length - 1]
    if (
      !lastMessage ||
      lastMessage.message.role !== 'user' ||
      typeof lastMessage.message.content !== 'string'
    ) {
      break
    }
    const lastUserPromptKey =
      lastMessage.userPromptKey ??
      normalizeAssistantConversationHistoryText(lastMessage.message.content)
    if (!lastUserPromptKey || shouldDropTrailingCurrentUserPrompt({
      currentPromptKey,
      lastUserPromptKey,
    })) {
      messages.pop()
      continue
    }
    break
  }

  return limitAssistantConversationHistoryMessages(
    messages.map(({ message }) => message),
  )
}

function normalizeAssistantConversationHistoryText(value: string): string | null {
  const normalized = normalizeNullableString(value)
  return normalized?.replace(/\s+/gu, ' ') ?? null
}

function shouldDropTrailingCurrentUserPrompt(input: {
  currentPromptKey: string | null
  lastUserPromptKey: string
}): boolean {
  if (!input.currentPromptKey) {
    return false
  }
  if (input.lastUserPromptKey === input.currentPromptKey) {
    return true
  }
  return (
    input.lastUserPromptKey.length >= 32 &&
    input.currentPromptKey.includes(input.lastUserPromptKey)
  )
}

function limitAssistantConversationHistoryMessages(
  messages: readonly AssistantProviderConversationMessage[],
): AssistantProviderConversationMessage[] {
  const countLimited = messages.slice(-ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_LIMIT)
  const retained: AssistantProviderConversationMessage[] = []
  let retainedBytes = 0

  for (const message of [...countLimited].reverse()) {
    if (typeof message.content !== 'string') {
      continue
    }
    const messageBytes = assistantConversationHistoryUtf8Bytes(message.content)
    if (messageBytes === 0) {
      continue
    }
    if (
      retainedBytes + messageBytes >
      ASSISTANT_ROUTE_COMMITTED_TRANSCRIPT_HISTORY_TOTAL_BYTES
    ) {
      break
    }
    retained.push(message)
    retainedBytes += messageBytes
  }

  return retained.reverse()
}

function limitAssistantConversationHistoryTextBytes(
  value: string | null,
  maxBytes: number,
): string | null {
  if (!value) {
    return null
  }
  if (assistantConversationHistoryUtf8Bytes(value) <= maxBytes) {
    return value
  }

  const codePoints = Array.from(value)
  let low = 0
  let high = codePoints.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = codePoints.slice(0, mid).join('').trimEnd()
    if (assistantConversationHistoryUtf8Bytes(candidate) <= maxBytes) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return normalizeNullableString(codePoints.slice(0, low).join('').trimEnd())
}

function assistantConversationHistoryUtf8Bytes(value: string): number {
  return assistantConversationHistoryTextEncoder.encode(value).byteLength
}

async function measureRoutePlanningAsync<TResult>(
  spans: AssistantRoutePlanningSpanMetrics,
  key: AssistantRoutePlanningSpanKey,
  work: () => Promise<TResult>,
  record?: (elapsedMs: number) => void,
): Promise<TResult> {
  const startedAt = Date.now()
  try {
    return await work()
  } finally {
    const elapsedMs = elapsedSince(startedAt)
    spans[key] = elapsedMs
    record?.(elapsedMs)
  }
}

function measureRoutePlanningSync<TResult>(
  spans: AssistantRoutePlanningSpanMetrics,
  key: AssistantRoutePlanningSpanKey,
  work: () => TResult,
): TResult {
  const startedAt = Date.now()
  try {
    return work()
  } finally {
    spans[key] = elapsedSince(startedAt)
  }
}

function sumRoutePlanningSpanMetrics(
  spans: AssistantRoutePlanningSpanMetrics,
): number {
  return Object.values(spans).reduce(
    (total, value) => total + (Number.isFinite(value) ? value : 0),
    0,
  )
}

function resolveRoutePlanningSlowestSpan(
  spans: AssistantRoutePlanningSpanMetrics,
): {
  elapsedMs: number
  stage: AssistantRoutePlanningStage
} | null {
  let slowest: {
    elapsedMs: number
    stage: AssistantRoutePlanningStage
  } | null = null

  for (const candidate of ASSISTANT_ROUTE_PLANNING_SPAN_STAGES) {
    const elapsedMs = spans[candidate.key]
    if (
      typeof elapsedMs !== 'number'
      || !Number.isFinite(elapsedMs)
      || elapsedMs <= 0
    ) {
      continue
    }

    if (!slowest || elapsedMs > slowest.elapsedMs) {
      slowest = {
        elapsedMs,
        stage: candidate.stage,
      }
    }
  }

  return slowest
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function resolveAssistantSupportedExperimentProtocols() {
  try {
    return listGeneratedAssistantProtocolIndexEntries()
  } catch {
    return []
  }
}

export async function resolveAssistantPromptTimeContext(
  vaultRoot: string,
): Promise<AssistantPromptTimeContext> {
  const fallbackTimeZone = resolveSystemTimeZone()
  let currentTimeZone = fallbackTimeZone

  try {
    const loadedVault = await loadVault({
      vaultRoot,
    })
    currentTimeZone =
      normalizeIanaTimeZone(loadedVault.metadata.timezone) ?? fallbackTimeZone
  } catch {
    // Prompt time context is best-effort and should not block the turn.
  }

  return {
    currentLocalDate: toLocalDayKey(new Date(), currentTimeZone),
    currentTimeZone,
  }
}

export function resolveAssistantPromptCapabilityAvailability(input: {
  executionContext: ReturnType<typeof normalizeAssistantExecutionContext> | null
}): AssistantPromptCapabilityAvailability {
  const assistantHostedDeviceConnectProviders =
    input.executionContext?.hosted?.deviceConnectProviders ?? []
  const assistantHostedDeviceConnectAvailable =
    assistantHostedDeviceConnectProviders.length > 0 &&
    typeof input.executionContext?.hosted?.issueDeviceConnectLink === 'function'

  return {
    assistantHostedDeviceConnectAvailable,
    assistantHostedDeviceConnectProviders: assistantHostedDeviceConnectAvailable
      ? assistantHostedDeviceConnectProviders
      : [],
    assistantKnowledgeToolsAvailable: false,
  }
}

function resolveAssistantCodexContinuation(input: {
  resumeCodexThreadId: string | null
}): AssistantCodexContinuation {
  if (input.resumeCodexThreadId) {
    return {
      kind: 'provider-state-optimization',
    }
  }

  return {
    kind: 'thread-start',
  }
}

function resolveAssistantEffectiveCodexResumeThreadId(input: {
  resumeCodexThreadId: string | null
}): string | null {
  return normalizeNullableString(input.resumeCodexThreadId)
}
