import {
  assistantAskResultSchema,
  type AssistantSession,
  type AssistantApprovalPolicy,
  type AssistantAskResult,
  type AssistantChatProvider,
  type AssistantDeliveryError,
  type AssistantProviderFailoverRoute,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
  type AssistantTurnTrigger,
} from '../assistant-cli-contracts.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  buildAssistantCronMcpConfig,
  buildAssistantMemoryMcpConfig,
  buildAssistantCliGuidanceText,
  resolveAssistantCliAccessContext,
} from '../assistant-cli-access.js'
import {
  executeAssistantProviderTurn,
  resolveAssistantProviderCapabilities,
  resolveAssistantProviderOptions,
  type AssistantProviderProgressEvent,
  type AssistantProviderTurnResult,
} from '../chat-provider.js'
import {
  resolveAssistantOperatorDefaults,
  type AssistantOperatorDefaults,
} from '../operator-config.js'
import {
  deliverAssistantOutboxMessage,
  type AssistantOutboxDispatchMode,
  normalizeAssistantDeliveryError,
} from './outbox.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import {
  buildAssistantFailoverRoutes,
  getAssistantFailoverCooldownUntil,
  isAssistantFailoverRouteCoolingDown,
  readAssistantFailoverState,
  recordAssistantFailoverRouteFailure,
  recordAssistantFailoverRouteSuccess,
  shouldAttemptAssistantProviderFailover,
  type ResolvedAssistantFailoverRoute,
} from './failover.js'
import { maybeThrowInjectedAssistantFault } from './fault-injection.js'
import { refreshAssistantStatusSnapshot } from './status.js'
import {
  appendAssistantTranscriptEntries,
  isAssistantSessionNotFoundError,
  listAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
  type ResolveAssistantSessionInput,
  type ResolvedAssistantSession,
} from './store.js'
import {
  createAssistantMemoryTurnContextEnv,
  loadAssistantMemoryPromptBlock,
} from './memory.js'
import {
  type AssistantOnboardingSummary,
  updateAssistantOnboardingSummary,
} from './onboarding.js'
import type { ConversationRef } from './conversation-ref.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
} from './turns.js'
import {
  attachRecoveredAssistantSession,
  recoverAssistantSessionAfterProviderFailure,
} from './provider-turn-recovery.js'
import { executeWithCanonicalWriteGuard } from './canonical-write-guard.js'
import { errorMessage, normalizeNullableString } from './shared.js'

// Bump this when changing the durable Codex bootstrap prompt text so existing
// Codex provider sessions re-bootstrap cleanly on their next turn.
export const CURRENT_CODEX_PROMPT_VERSION = '2026-03-26.4'

interface AssistantSessionResolutionFields {
  actorId?: string | null
  alias?: string | null
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  channel?: string | null
  conversation?: ConversationRef | null
  identityId?: string | null
  model?: string | null
  maxSessionAgeMs?: number | null
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
  deliveryTarget?: string | null
  enableFirstTurnOnboarding?: boolean
  failoverRoutes?: readonly AssistantProviderFailoverRoute[] | null
  maxSessionAgeMs?: number | null
  onProviderEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  persistUserPromptOnFailure?: boolean
  prompt: string
  sessionSnapshot?: AssistantSession | null
  showThinkingTraces?: boolean
  turnTrigger?: AssistantTurnTrigger
  workingDirectory?: string
}

export interface AssistantChatInput
  extends Omit<AssistantMessageInput, 'deliverResponse' | 'deliveryTarget' | 'prompt'> {
  initialPrompt?: string | null
}

interface AssistantTurnSharedPlan {
  allowSensitiveHealthContext: boolean
  cliAccess: ReturnType<typeof resolveAssistantCliAccessContext>
  onboardingSummary: AssistantOnboardingSummary | null
  persistUserPromptOnFailure: boolean
  workingDirectory: string
}

interface AssistantRouteTurnPlan {
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
}

interface PersistedUserTurn {
  turnCreatedAt: string
  turnId: string
  userPersisted: boolean
}

interface ExecutedAssistantProviderTurnResult extends AssistantProviderTurnResult {
  attemptCount: number
  providerOptions: AssistantProviderSessionOptions
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
}

type AssistantDeliveryOutcome =
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

interface AssistantTurnDeliveryFinalizationPlan {
  diagnostic: Parameters<typeof recordAssistantDiagnosticEvent>[0]
  receipt: Parameters<typeof finalizeAssistantTurnReceipt>[0]
}

export function buildResolveAssistantSessionInput(
  input: AssistantSessionResolutionFields,
  defaults: AssistantOperatorDefaults | null,
): ResolveAssistantSessionInput {
  const sessionId = input.conversation?.sessionId ?? input.sessionId
  const alias = input.conversation?.alias ?? input.alias
  const channel = input.conversation?.channel ?? input.channel
  const identityId =
    input.conversation?.identityId ??
    input.identityId ??
    defaults?.identityId ??
    null
  const participantId =
    input.conversation?.participantId ??
    input.actorId ??
    input.participantId ??
    null
  const threadId =
    input.conversation?.threadId ?? input.threadId ?? input.sourceThreadId ?? null
  const directness =
    typeof input.threadIsDirect === 'boolean'
      ? input.threadIsDirect
        ? 'direct'
        : 'group'
      : input.conversation?.directness ?? null

  return {
    vault: input.vault,
    sessionId,
    alias,
    channel,
    identityId,
    actorId: participantId,
    threadId,
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean'
        ? input.threadIsDirect
        : directness === 'direct'
          ? true
          : directness === 'group'
            ? false
            : undefined,
    provider: input.provider ?? defaults?.provider ?? undefined,
    model: input.model ?? defaults?.model ?? null,
    sandbox: input.sandbox ?? defaults?.sandbox ?? 'workspace-write',
    approvalPolicy:
      input.approvalPolicy ?? defaults?.approvalPolicy ?? 'on-request',
    oss: input.oss ?? defaults?.oss ?? false,
    profile: input.profile ?? defaults?.profile ?? null,
    baseUrl: input.baseUrl ?? defaults?.baseUrl ?? null,
    apiKeyEnv: input.apiKeyEnv ?? defaults?.apiKeyEnv ?? null,
    providerName: input.providerName ?? defaults?.providerName ?? null,
    reasoningEffort:
      input.reasoningEffort ??
      defaults?.reasoningEffort ??
      null,
    maxSessionAgeMs: input.maxSessionAgeMs ?? null,
  }
}

export async function openAssistantConversation(
  input: AssistantSessionResolutionFields,
) {
  const defaults = await resolveAssistantOperatorDefaults()
  return resolveAssistantSession(buildResolveAssistantSessionInput(input, defaults))
}

export async function sendAssistantMessage(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const defaults = await resolveAssistantOperatorDefaults()
  const resolved = await resolveAssistantSessionForMessage(input, defaults)
  const sharedPlan = await resolveAssistantTurnSharedPlan(input, resolved)
  const routes = resolveAssistantTurnRoutes(input, defaults, resolved)
  const primaryRoute = routes[0] ?? null
  const receipt = await createAssistantTurnReceipt({
    vault: input.vault,
    sessionId: resolved.session.sessionId,
    provider: primaryRoute?.provider ?? resolved.session.provider,
    providerModel: primaryRoute?.providerOptions.model ?? null,
    prompt: input.prompt,
    deliveryRequested: input.deliverResponse === true,
  })

  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'assistant',
    kind: 'turn.started',
    message: `Started assistant turn for session ${resolved.session.sessionId}.`,
    sessionId: resolved.session.sessionId,
    turnId: receipt.turnId,
    counterDeltas: {
      turnsStarted: 1,
    },
  })

  let responseText: string | null = null

  try {
    const userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
    const providerResult = await executeProviderTurnWithRecovery({
      defaults,
      input,
      routes,
      plan: sharedPlan,
      resolvedSession: resolved.session,
      turnCreatedAt: userTurn.turnCreatedAt,
      turnId: userTurn.turnId,
    })
    responseText = providerResult.response
    const session = await persistAssistantTurnAndSession({
      input,
      plan: sharedPlan,
      providerResult,
      session: providerResult.session,
      turnCreatedAt: userTurn.turnCreatedAt,
      turnId: userTurn.turnId,
    })
    const deliveryOutcome = await deliverAssistantReply({
      input,
      response: providerResult.response,
      session,
      turnId: userTurn.turnId,
    })

    await finalizeAssistantTurnFromDeliveryOutcome({
      outcome: deliveryOutcome,
      response: providerResult.response,
      turnId: userTurn.turnId,
      vault: input.vault,
    })

    return assistantAskResultSchema.parse({
      vault: redactAssistantDisplayPath(input.vault),
      prompt: input.prompt,
      response: providerResult.response,
      session: deliveryOutcome.session,
      delivery: deliveryOutcome.kind === 'sent' ? deliveryOutcome.delivery : null,
      deliveryDeferred: deliveryOutcome.kind === 'queued',
      deliveryIntentId:
        deliveryOutcome.kind === 'sent' ||
        deliveryOutcome.kind === 'queued' ||
        deliveryOutcome.kind === 'failed'
          ? deliveryOutcome.intentId
          : null,
      deliveryError:
        deliveryOutcome.kind === 'queued' || deliveryOutcome.kind === 'failed'
          ? deliveryOutcome.error
          : null,
    })
  } catch (error) {
    const normalizedError = normalizeAssistantDeliveryError(error)
    const failedAt = new Date().toISOString()

    await runAssistantTurnBestEffort(() =>
      finalizeAssistantTurnReceipt({
        vault: input.vault,
        turnId: receipt.turnId,
        status: 'failed',
        deliveryDisposition:
          input.deliverResponse === true ? 'failed' : 'not-requested',
        error: normalizedError,
        response: responseText,
        completedAt: failedAt,
      }),
    )

    await runAssistantTurnBestEffort(() =>
      recordAssistantDiagnosticEvent({
        vault: input.vault,
        component: 'assistant',
        kind: 'turn.failed',
        level: 'error',
        message: normalizedError.message,
        code: normalizedError.code,
        sessionId: resolved.session.sessionId,
        turnId: receipt.turnId,
        counterDeltas: {
          turnsFailed: 1,
        },
        at: failedAt,
      }),
    )

    throw error
  } finally {
    await runAssistantTurnBestEffort(() =>
      refreshAssistantStatusSnapshot(input.vault),
    )
  }
}

export async function updateAssistantSessionOptions(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}): Promise<AssistantSession> {
  const session = await resolveAssistantSession({
    vault: input.vault,
    conversation: {
      sessionId: input.sessionId,
    },
    createIfMissing: false,
  })

  return saveAssistantSession(input.vault, {
    ...session.session,
    providerOptions: {
      ...session.session.providerOptions,
      ...input.providerOptions,
    },
    updatedAt: new Date().toISOString(),
  })
}

async function resolveAssistantTurnSharedPlan(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnSharedPlan> {
  const cliAccess = resolveAssistantCliAccessContext()
  return {
    allowSensitiveHealthContext: shouldExposeSensitiveHealthContext(
      resolved.session.binding,
    ),
    cliAccess,
    onboardingSummary:
      input.enableFirstTurnOnboarding === true
        ? await updateAssistantOnboardingSummary({
            prompt: input.prompt,
            vault: input.vault,
          })
        : null,
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    workingDirectory: input.workingDirectory ?? input.vault,
  }
}

function resolveAssistantTurnRoutes(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): ResolvedAssistantFailoverRoute[] {
  const provider = input.provider ?? resolved.session.provider ?? defaults?.provider
  const providerOptions = resolveAssistantProviderOptions({
    model: input.model ?? resolved.session.providerOptions.model ?? defaults?.model,
    reasoningEffort:
      input.reasoningEffort ??
      resolved.session.providerOptions.reasoningEffort ??
      defaults?.reasoningEffort,
    sandbox:
      input.sandbox ??
      resolved.session.providerOptions.sandbox ??
      defaults?.sandbox,
    approvalPolicy:
      input.approvalPolicy ??
      resolved.session.providerOptions.approvalPolicy ??
      defaults?.approvalPolicy,
    profile:
      input.profile ??
      resolved.session.providerOptions.profile ??
      defaults?.profile,
    oss:
      input.oss ??
      resolved.session.providerOptions.oss ??
      defaults?.oss,
    baseUrl:
      input.baseUrl ??
      resolved.session.providerOptions.baseUrl ??
      defaults?.baseUrl,
    apiKeyEnv:
      input.apiKeyEnv ??
      resolved.session.providerOptions.apiKeyEnv ??
      defaults?.apiKeyEnv,
    providerName:
      input.providerName ??
      resolved.session.providerOptions.providerName ??
      defaults?.providerName,
  })
  return buildAssistantFailoverRoutes({
    backups: input.failoverRoutes ?? defaults?.failoverRoutes ?? null,
    codexCommand: input.codexCommand ?? defaults?.codexCommand ?? null,
    defaults,
    provider,
    providerOptions,
  })
}

async function resolveAssistantRouteTurnPlan(input: {
  input: AssistantMessageInput
  route: ResolvedAssistantFailoverRoute
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): Promise<AssistantRouteTurnPlan> {
  const shouldResetCodexProviderSession =
    shouldResetCodexProviderSessionForPromptVersion({
      provider: input.route.provider,
      session: input.session,
    })
  const shouldInjectBootstrapContext =
    input.session.turnCount === 0 ||
    input.route.provider === 'openai-compatible' ||
    input.route.provider !== input.session.provider ||
    input.session.providerSessionId === null ||
    shouldResetCodexProviderSession
  const shouldInjectFirstTurnOnboarding =
    input.input.enableFirstTurnOnboarding === true && input.session.turnCount === 0
  const conversationMessages = shouldUseLocalTranscriptContext(input.route.provider)
    ? removeTrailingCurrentUserPrompt(
        await loadAssistantConversationMessages({
          limit: 20,
          sessionId: input.session.sessionId,
          vault: input.input.vault,
        }),
        input.input.prompt,
      )
    : undefined
  const assistantMemoryPrompt = shouldInjectBootstrapContext
    ? await loadAssistantMemoryPromptBlock({
        includeSensitiveHealthContext: input.sharedPlan.allowSensitiveHealthContext,
        vault: input.input.vault,
      })
    : null
  const continuityContext = shouldResetCodexProviderSession
    ? await buildCodexPromptResetContinuityContext({
        sessionId: input.session.sessionId,
        vault: input.input.vault,
      })
    : null
  const providerCapabilities = resolveAssistantProviderCapabilities(input.route.provider)
  const supportsDirectCliExecution = providerCapabilities.supportsDirectCliExecution
  const memoryMcpConfig = buildAssistantMemoryMcpConfig(
    input.sharedPlan.workingDirectory,
  )
  const cronMcpConfig = buildAssistantCronMcpConfig(
    input.sharedPlan.workingDirectory,
  )
  const assistantMemoryMcpAvailable =
    supportsDirectCliExecution && memoryMcpConfig !== null
  const assistantCronMcpAvailable =
    supportsDirectCliExecution && cronMcpConfig !== null
  const configOverrides = supportsDirectCliExecution
    ? [
        ...(memoryMcpConfig?.configOverrides ?? []),
        ...(cronMcpConfig?.configOverrides ?? []),
      ]
    : []

  return {
    cliEnv: input.sharedPlan.cliAccess.env,
    configOverrides: configOverrides.length > 0 ? configOverrides : undefined,
    conversationMessages,
    continuityContext,
    provider: input.route.provider,
    providerOptions: normalizeAssistantProviderOptions(input.route.providerOptions),
    resumeProviderSessionId:
      input.route.provider === input.session.provider &&
      !shouldResetCodexProviderSession
        ? input.session.providerSessionId
        : null,
    sessionContext: shouldInjectBootstrapContext
      ? {
          binding: input.session.binding,
        }
      : undefined,
    systemPrompt: shouldInjectBootstrapContext
      ? buildAssistantSystemPrompt({
          assistantCronMcpAvailable,
          cliAccess: input.sharedPlan.cliAccess,
          assistantMemoryMcpAvailable,
          assistantMemoryPrompt,
          channel: input.input.channel ?? input.session.binding.channel,
          onboardingSummary:
            shouldInjectFirstTurnOnboarding
              ? input.sharedPlan.onboardingSummary
              : null,
          supportsDirectCliExecution,
        })
      : null,
  }
}

async function persistUserTurn(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
  plan: AssistantTurnSharedPlan,
  turnId: string,
): Promise<PersistedUserTurn> {
  let turnCreatedAt = new Date().toISOString()
  let userPersisted = false
  if (plan.persistUserPromptOnFailure) {
    const userEntries = await appendAssistantTranscriptEntries(
      input.vault,
      resolved.session.sessionId,
      [
        {
          kind: 'user',
          text: input.prompt,
        },
      ],
    )
    turnCreatedAt = userEntries[0]?.createdAt ?? turnCreatedAt
    userPersisted = true
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId,
      kind: 'user.persisted',
      detail: 'user prompt persisted before provider execution',
      at: turnCreatedAt,
    })
  }

  return {
    turnCreatedAt,
    turnId,
    userPersisted,
  }
}

async function recordProviderCooldownFailoverApplied(input: {
  primaryRoute: ResolvedAssistantFailoverRoute
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.failover.applied',
    detail: `${input.primaryRoute.label} -> ${input.route.label}`,
    metadata: {
      from: input.primaryRoute.label,
      to: input.route.label,
      fromRouteId: input.primaryRoute.routeId,
      toRouteId: input.route.routeId,
      reason: 'cooldown',
    },
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.failover.applied',
    level: 'warn',
    message: `Primary assistant provider route ${input.primaryRoute.label} is cooling down; using ${input.route.label}.`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      from: input.primaryRoute.label,
      to: input.route.label,
      fromRouteId: input.primaryRoute.routeId,
      toRouteId: input.route.routeId,
    },
    counterDeltas: {
      providerFailovers: 1,
    },
  })
}

async function recordProviderAttemptStarted(input: {
  attemptCount: number
  at: string
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.started',
    detail: input.route.label,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeId: input.route.routeId,
    },
    at: input.at,
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.attempt.started',
    message: `Assistant provider attempt ${input.attemptCount} started with ${input.route.label}.`,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      attempt: input.attemptCount,
      routeId: input.route.routeId,
      provider: input.route.provider,
      model: input.route.providerOptions.model,
    },
    counterDeltas: {
      providerAttempts: 1,
    },
    at: input.at,
  })
}

async function recordProviderAttemptSucceeded(input: {
  attemptCount: number
  route: ResolvedAssistantFailoverRoute
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.succeeded',
    detail: input.route.label,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeId: input.route.routeId,
    },
  })
}

async function recordProviderAttemptFailed(input: {
  attemptCount: number
  cooldownUntil: string | null
  detail: string
  errorCode: string | null
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.failed',
    detail: input.detail,
    metadata: {
      attempt: String(input.attemptCount),
      provider: input.route.provider,
      model: input.route.providerOptions.model ?? 'default',
      routeId: input.route.routeId,
      code: input.errorCode ?? 'unknown',
    },
  })
  if (input.cooldownUntil) {
    await appendAssistantTurnReceiptEvent({
      vault: input.vault,
      turnId: input.turnId,
      kind: 'provider.cooldown.started',
      detail: `${input.route.label} cooling down until ${input.cooldownUntil}`,
      metadata: {
        routeId: input.route.routeId,
        cooldownUntil: input.cooldownUntil,
      },
    })
  }
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.attempt.failed',
    level: 'warn',
    message: input.detail,
    code: input.errorCode,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      attempt: input.attemptCount,
      routeId: input.route.routeId,
      provider: input.route.provider,
      model: input.route.providerOptions.model,
      cooldownUntil: input.cooldownUntil,
    },
    counterDeltas: {
      providerFailures: 1,
    },
  })
}

async function recordProviderFailoverApplied(input: {
  errorCode: string | null
  fromRoute: ResolvedAssistantFailoverRoute
  sessionId: string
  toRoute: ResolvedAssistantFailoverRoute
  turnId: string
  vault: string
}): Promise<void> {
  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.failover.applied',
    detail: `${input.fromRoute.label} -> ${input.toRoute.label}`,
    metadata: {
      from: input.fromRoute.label,
      to: input.toRoute.label,
      fromRouteId: input.fromRoute.routeId,
      toRouteId: input.toRoute.routeId,
    },
  })
  await recordAssistantDiagnosticEvent({
    vault: input.vault,
    component: 'provider',
    kind: 'provider.failover.applied',
    level: 'warn',
    message: `Failing over assistant provider from ${input.fromRoute.label} to ${input.toRoute.label}.`,
    code: input.errorCode,
    sessionId: input.sessionId,
    turnId: input.turnId,
    data: {
      from: input.fromRoute.label,
      to: input.toRoute.label,
      fromRouteId: input.fromRoute.routeId,
      toRouteId: input.toRoute.routeId,
    },
    counterDeltas: {
      providerFailovers: 1,
    },
  })
}

async function executeProviderTurnWithRecovery(input: {
  defaults: AssistantOperatorDefaults | null
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  resolvedSession: AssistantSession
  routes: readonly ResolvedAssistantFailoverRoute[]
  turnCreatedAt: string
  turnId: string
}): Promise<ExecutedAssistantProviderTurnResult> {
  const primaryRoute = input.routes[0] ?? null
  let failoverState = await readAssistantFailoverState(input.input.vault)
  let workingSession = input.resolvedSession
  let attemptCount = 0
  let lastError: unknown = null
  const attemptedRouteIds = new Set<string>()
  const memoryTurnEnv = createAssistantMemoryTurnContextEnv({
    allowSensitiveHealthContext: input.plan.allowSensitiveHealthContext,
    sessionId: workingSession.sessionId,
    sourcePrompt: input.input.prompt,
    turnId: `${workingSession.sessionId}:${input.turnCreatedAt}`,
    vault: input.input.vault,
  })

  while (attemptedRouteIds.size < input.routes.length) {
    const remainingRoutes = prioritizeAssistantFailoverRoutes(
      input.routes.filter((route) => !attemptedRouteIds.has(route.routeId)),
      failoverState,
    )
    const route = remainingRoutes[0] ?? null
    if (!route) {
      break
    }

    attemptCount += 1
    attemptedRouteIds.add(route.routeId)

    if (attemptCount === 1 && primaryRoute && route.routeId !== primaryRoute.routeId) {
      await recordProviderCooldownFailoverApplied({
        primaryRoute,
        route,
        sessionId: workingSession.sessionId,
        turnId: input.turnId,
        vault: input.input.vault,
      })
    }

    const attemptAt = new Date().toISOString()
    await recordProviderAttemptStarted({
      attemptCount,
      at: attemptAt,
      route,
      sessionId: workingSession.sessionId,
      turnId: input.turnId,
      vault: input.input.vault,
    })

    try {
      const routePlan = await resolveAssistantRouteTurnPlan({
        input: input.input,
        route,
        session: workingSession,
        sharedPlan: input.plan,
      })
      maybeThrowInjectedAssistantFault({
        component: 'provider',
        fault: 'provider',
        message: 'Injected assistant provider failure.',
      })
      const result = await executeWithCanonicalWriteGuard({
        enabled: route.provider === 'codex-cli',
        vaultRoot: input.input.vault,
        execute: () =>
          executeAssistantProviderTurn({
            abortSignal: input.input.abortSignal,
            provider: route.provider,
            workingDirectory: input.plan.workingDirectory,
            configOverrides: routePlan.configOverrides,
            env: {
              ...routePlan.cliEnv,
              ...memoryTurnEnv,
            },
            userPrompt: input.input.prompt,
            continuityContext: routePlan.continuityContext,
            systemPrompt: routePlan.systemPrompt,
            sessionContext: routePlan.sessionContext
              ? {
                  binding: workingSession.binding,
                }
              : undefined,
            resumeProviderSessionId:
              attemptCount === 1
                ? routePlan.resumeProviderSessionId
                : route.provider === workingSession.provider
                  ? workingSession.providerSessionId
                  : null,
            codexCommand:
              route.codexCommand ??
              input.input.codexCommand ??
              input.defaults?.codexCommand ??
              undefined,
            model: route.providerOptions.model,
            reasoningEffort: route.providerOptions.reasoningEffort,
            sandbox: route.providerOptions.sandbox,
            approvalPolicy: route.providerOptions.approvalPolicy,
            baseUrl: route.providerOptions.baseUrl,
            apiKeyEnv: route.providerOptions.apiKeyEnv,
            providerName: route.providerOptions.providerName,
            conversationMessages: routePlan.conversationMessages,
            onEvent: input.input.onProviderEvent ?? undefined,
            profile: route.providerOptions.profile,
            oss: route.providerOptions.oss,
            onTraceEvent: input.input.onTraceEvent,
            showThinkingTraces: input.input.showThinkingTraces ?? false,
          }),
      })

      failoverState = await recordAssistantFailoverRouteSuccess({
        vault: input.input.vault,
        route,
        at: new Date().toISOString(),
      })
      await recordProviderAttemptSucceeded({
        attemptCount,
        route,
        turnId: input.turnId,
        vault: input.input.vault,
      })

      return {
        ...result,
        attemptCount,
        providerOptions: normalizeAssistantProviderOptions(route.providerOptions),
        route,
        session: workingSession,
      }
    } catch (error) {
      lastError = error
      const errorCode = readAssistantErrorCode(error)
      const recoveredSession = await recoverAssistantSessionAfterProviderFailure({
        codexPromptVersion:
          route.provider === 'codex-cli' ? CURRENT_CODEX_PROMPT_VERSION : null,
        error,
        provider: route.provider,
        providerOptions: route.providerOptions,
        session: workingSession,
        vault: input.input.vault,
      })
      if (recoveredSession) {
        workingSession = recoveredSession
      }
      attachRecoveredAssistantSession(error, recoveredSession)
      const shouldRecordRouteFailure = shouldRecordAssistantRouteFailure(errorCode)
      if (shouldRecordRouteFailure) {
        failoverState = await recordAssistantFailoverRouteFailure({
          error,
          route,
          vault: input.input.vault,
        })
      }
      const cooldownUntil = shouldRecordRouteFailure
        ? getAssistantFailoverCooldownUntil({
            route,
            state: failoverState,
          })
        : null
      const detail = errorMessage(error)

      await recordProviderAttemptFailed({
        attemptCount,
        cooldownUntil,
        detail,
        errorCode,
        route,
        sessionId: workingSession.sessionId,
        turnId: input.turnId,
        vault: input.input.vault,
      })

      if (!shouldAttemptAssistantProviderFailover({
        abortSignal: input.input.abortSignal,
        error,
      })) {
        throw error
      }

      const remainingCandidates = prioritizeAssistantFailoverRoutes(
        input.routes.filter((candidate) => !attemptedRouteIds.has(candidate.routeId)),
        failoverState,
      )
      const nextRoute = remainingCandidates[0] ?? null
      if (!nextRoute) {
        throw error
      }

      await recordProviderFailoverApplied({
        errorCode,
        fromRoute: route,
        sessionId: workingSession.sessionId,
        toRoute: nextRoute,
        turnId: input.turnId,
        vault: input.input.vault,
      })
    }
  }

  throw (lastError ?? new Error('Assistant provider routes were exhausted.'))
}

function normalizeAssistantProviderOptions(
  providerOptions: AssistantSession['providerOptions'],
): AssistantSession['providerOptions'] {
  return {
    ...providerOptions,
    baseUrl: providerOptions.baseUrl ?? undefined,
    apiKeyEnv: providerOptions.apiKeyEnv ?? undefined,
    providerName: providerOptions.providerName ?? undefined,
  }
}

async function persistAssistantTurnAndSession(input: {
  input: AssistantMessageInput
  plan: AssistantTurnSharedPlan
  providerResult: ExecutedAssistantProviderTurnResult
  session: AssistantSession
  turnCreatedAt: string
  turnId: string
}): Promise<AssistantSession> {
  if (!input.plan.persistUserPromptOnFailure) {
    await appendAssistantTranscriptEntries(
      input.input.vault,
      input.session.sessionId,
      [
        {
          kind: 'user',
          text: input.input.prompt,
          createdAt: input.turnCreatedAt,
        },
      ],
    )
    await appendAssistantTurnReceiptEvent({
      vault: input.input.vault,
      turnId: input.turnId,
      kind: 'user.persisted',
      detail: 'user prompt persisted after provider completion',
      at: input.turnCreatedAt,
    })
  }

  await appendAssistantTranscriptEntries(
    input.input.vault,
    input.session.sessionId,
    [
      {
        kind: 'assistant',
        text: input.providerResult.response,
      },
    ],
  )

  const updatedAt = new Date().toISOString()
  return saveAssistantSession(input.input.vault, {
    ...input.session,
    provider: input.providerResult.provider,
    providerSessionId: resolveNextProviderSessionId({
      provider: input.providerResult.provider,
      providerSessionId: input.providerResult.providerSessionId,
      previousProvider: input.session.provider,
      previousProviderSessionId: input.session.providerSessionId,
    }),
    codexPromptVersion:
      input.providerResult.provider === 'codex-cli'
        ? CURRENT_CODEX_PROMPT_VERSION
        : null,
    providerOptions: input.providerResult.providerOptions,
    updatedAt,
    lastTurnAt: updatedAt,
    turnCount: input.session.turnCount + 1,
  })
}

async function deliverAssistantReply(input: {
  input: AssistantMessageInput
  response: string
  session: AssistantSession
  turnId: string
}): Promise<AssistantDeliveryOutcome> {
  if (!input.input.deliverResponse) {
    return {
      kind: 'not-requested',
      session: input.session,
    }
  }

  const outcome = await deliverAssistantOutboxMessage({
    vault: input.input.vault,
    turnId: input.turnId,
    sessionId: input.session.sessionId,
    message: sanitizeAssistantOutboundReply(
      input.response,
      input.session.binding.channel,
    ),
    channel: input.session.binding.channel,
    identityId: input.session.binding.identityId,
    actorId: input.session.binding.actorId,
    threadId: input.session.binding.threadId,
    threadIsDirect: input.session.binding.threadIsDirect,
    bindingDelivery: input.session.binding.delivery,
    explicitTarget: input.input.deliveryTarget ?? null,
    dependencies: undefined,
    dispatchMode: input.input.deliveryDispatchMode,
  })
  const session = outcome.session ?? input.session

  switch (outcome.kind) {
    case 'sent':
      return {
        kind: 'sent',
        delivery: outcome.delivery!,
        intentId: outcome.intent.intentId,
        session,
      }
    case 'queued':
      return {
        kind: 'queued',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        session,
      }
    case 'failed':
      return {
        kind: 'failed',
        error: outcome.deliveryError,
        intentId: outcome.intent.intentId,
        session,
      }
    default:
      return {
        kind: 'failed',
        error: normalizeAssistantDeliveryError(
          new Error('Assistant outbound delivery failed.'),
        ),
        intentId: 'unknown',
        session,
      }
  }
}

function prioritizeAssistantFailoverRoutes(
  routes: readonly ResolvedAssistantFailoverRoute[],
  state: Awaited<ReturnType<typeof readAssistantFailoverState>>,
): ResolvedAssistantFailoverRoute[] {
  const ready: ResolvedAssistantFailoverRoute[] = []
  const cooling: ResolvedAssistantFailoverRoute[] = []

  for (const route of routes) {
    if (isAssistantFailoverRouteCoolingDown({ route, state })) {
      cooling.push(route)
    } else {
      ready.push(route)
    }
  }

  return ready.length > 0 ? [...ready, ...cooling] : [...routes]
}

async function finalizeAssistantTurnFromDeliveryOutcome(input: {
  outcome: AssistantDeliveryOutcome
  response: string
  turnId: string
  vault: string
}): Promise<void> {
  const completedAt = new Date().toISOString()
  const plan = buildAssistantTurnDeliveryFinalizationPlan({
    completedAt,
    outcome: input.outcome,
    response: input.response,
    turnId: input.turnId,
    vault: input.vault,
  })
  await finalizeAssistantTurnReceipt(plan.receipt)
  await recordAssistantDiagnosticEvent(plan.diagnostic)
}

function buildAssistantTurnDeliveryFinalizationPlan(input: {
  completedAt: string
  outcome: AssistantDeliveryOutcome
  response: string
  turnId: string
  vault: string
}): AssistantTurnDeliveryFinalizationPlan {
  switch (input.outcome.kind) {
    case 'not-requested':
      return {
        receipt: {
          vault: input.vault,
          turnId: input.turnId,
          status: 'completed',
          deliveryDisposition: 'not-requested',
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed without outbound delivery.',
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: input.completedAt,
        },
      }
    case 'sent':
      return {
        receipt: {
          vault: input.vault,
          turnId: input.turnId,
          status: 'completed',
          deliveryDisposition: 'sent',
          deliveryIntentId: input.outcome.intentId,
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed and delivered successfully.',
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: input.completedAt,
        },
      }
    case 'queued':
      return {
        receipt: {
          vault: input.vault,
          turnId: input.turnId,
          status: 'deferred',
          deliveryDisposition: input.outcome.error ? 'retryable' : 'queued',
          deliveryIntentId: input.outcome.intentId,
          error: input.outcome.error,
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.deferred',
          level: input.outcome.error ? 'warn' : 'info',
          message:
            input.outcome.error?.message ??
            'Assistant turn deferred with a queued outbound delivery.',
          code: input.outcome.error?.code ?? null,
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsDeferred: 1,
          },
          at: input.completedAt,
        },
      }
    case 'failed':
      return {
        receipt: {
          vault: input.vault,
          turnId: input.turnId,
          status: 'failed',
          deliveryDisposition: 'failed',
          deliveryIntentId: input.outcome.intentId,
          error: input.outcome.error,
          response: input.response,
          completedAt: input.completedAt,
        },
        diagnostic: {
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.failed',
          level: 'error',
          message: input.outcome.error.message,
          code: input.outcome.error.code,
          sessionId: input.outcome.session.sessionId,
          turnId: input.turnId,
          intentId: input.outcome.intentId,
          counterDeltas: {
            turnsFailed: 1,
          },
          at: input.completedAt,
        },
      }
  }
}

async function runAssistantTurnBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  await task().catch(() => undefined)
}

function removeTrailingCurrentUserPrompt(
  messages: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>,
  currentPrompt: string,
): ReadonlyArray<{
  content: string
  role: 'assistant' | 'user'
}> {
  const lastMessage = messages.at(-1)
  if (
    lastMessage?.role === 'user' &&
    lastMessage.content === currentPrompt
  ) {
    return messages.slice(0, -1)
  }

  return messages
}

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
}

function shouldRecordAssistantRouteFailure(errorCode: string | null): boolean {
  return errorCode !== 'ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED'
}

function shouldUseLocalTranscriptContext(
  provider: AssistantChatProvider,
): boolean {
  return provider === 'openai-compatible'
}

function shouldResetCodexProviderSessionForPromptVersion(input: {
  provider: AssistantChatProvider
  session: AssistantSession
}): boolean {
  return (
    input.provider === 'codex-cli' &&
    input.session.provider === 'codex-cli' &&
    input.session.providerSessionId !== null &&
    normalizeNullableString(input.session.codexPromptVersion) !==
      CURRENT_CODEX_PROMPT_VERSION
  )
}

async function buildCodexPromptResetContinuityContext(input: {
  sessionId: string
  vault: string
}): Promise<string | null> {
  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    input.sessionId,
  )
  const recentConversation = transcript
    .flatMap((entry) =>
      isAssistantConversationTranscriptEntry(entry)
        ? [
            `${entry.kind === 'user' ? 'User' : 'Assistant'}: ${truncateAssistantContinuityText(
              entry.text,
            )}`,
          ]
        : [],
    )
    .slice(-6)

  if (recentConversation.length === 0) {
    return null
  }

  return [
    'Recent local conversation transcript from this same Healthy Bob session:',
    recentConversation.join('\n\n'),
    'Use this only as continuity context while bootstrapping the fresh Codex provider session.',
  ].join('\n\n')
}

function truncateAssistantContinuityText(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= 400) {
    return normalized
  }

  return `${normalized.slice(0, 397)}...`
}

async function loadAssistantConversationMessages(input: {
  limit: number
  sessionId: string
  vault: string
}): Promise<Array<{
  content: string
  role: 'assistant' | 'user'
}>> {
  const transcript = await listAssistantTranscriptEntries(
    input.vault,
    input.sessionId,
  )

  return transcript
    .slice(-input.limit)
    .flatMap((entry) =>
      isAssistantConversationTranscriptEntry(entry)
        ? [{
            role: entry.kind,
            content: entry.text,
          }]
        : [],
    )
}

function isAssistantConversationTranscriptEntry(entry: {
  kind: string
  text: string
}): entry is {
  kind: 'assistant' | 'user'
  text: string
} {
  return entry.kind === 'assistant' || entry.kind === 'user'
}

function resolveNextProviderSessionId(input: {
  previousProvider: AssistantChatProvider
  previousProviderSessionId: string | null
  provider: AssistantChatProvider
  providerSessionId: string | null
}): string | null {
  if (input.provider !== input.previousProvider) {
    return input.providerSessionId
  }

  return input.providerSessionId ?? input.previousProviderSessionId
}

async function resolveAssistantSessionForMessage(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
) {
  const sessionInput = buildResolveAssistantSessionInput(input, defaults)

  try {
    return await resolveAssistantSession(sessionInput)
  } catch (error) {
    const restored = await restoreMissingAssistantSessionSnapshot({
      error,
      input,
      sessionInput,
    })
    if (!restored) {
      throw error
    }

    return resolveAssistantSession({
      ...sessionInput,
      createIfMissing: false,
    })
  }
}

async function restoreMissingAssistantSessionSnapshot(input: {
  error: unknown
  input: AssistantMessageInput
  sessionInput: ResolveAssistantSessionInput
}): Promise<boolean> {
  if (!isAssistantSessionNotFoundError(input.error)) {
    return false
  }

  const requestedSessionId =
    input.sessionInput.conversation?.sessionId ?? input.sessionInput.sessionId
  const snapshot = input.input.sessionSnapshot
  if (
    typeof requestedSessionId !== 'string' ||
    requestedSessionId.trim().length === 0 ||
    !snapshot ||
    snapshot.sessionId !== requestedSessionId
  ) {
    return false
  }

  // Live Ink chat already has the hydrated session in memory, so recreate the
  // missing local session file and retry the normal resolution path once.
  await saveAssistantSession(
    input.input.vault,
    normalizeRestoredAssistantSessionSnapshot(snapshot),
  )
  return true
}

function normalizeRestoredAssistantSessionSnapshot(
  snapshot: AssistantSession,
): AssistantSession {
  if (
    snapshot.provider === 'codex-cli' &&
    normalizeNullableString(snapshot.codexPromptVersion) === null
  ) {
    return {
      ...snapshot,
      codexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
    }
  }

  return snapshot
}

function buildAssistantSystemPrompt(input: {
  assistantCronMcpAvailable: boolean
  assistantMemoryMcpAvailable: boolean
  cliAccess: {
    rawCommand: 'vault-cli'
    setupCommand: 'healthybob'
  }
  assistantMemoryPrompt: string | null
  channel: string | null
  onboardingSummary: AssistantOnboardingSummary | null
  supportsDirectCliExecution: boolean
}): string {
  return [
    'You are Healthy Bob, a local-first health assistant bound to one active vault for this session.',
    'The active vault is already selected for this turn. The shell working directory and `VAULT` environment variable both point at it. Unless the user explicitly targets another vault, operate on this bound vault only.',
    [
      'Healthy Bob philosophy:',
      '- Healthy Bob is a calm, observant companion for understanding the body in the context of a life.',
      "- Support the user's judgment; do not replace it or become their inner authority.",
      '- Treat biomarkers and wearables as clues, not verdicts. Context, felt experience, and life-fit matter as much as numbers.',
      '- Default to synthesis over interruption: prefer summaries, weekly readbacks, and lightweight check-ins over constant nudges or micro-instructions.',
      '- Prefer one lightweight, reversible suggestion with burden, tradeoffs, and an off-ramp, or no suggestion at all, over stacks of protocols.',
      '- It is good to conclude that something is normal variation, probably noise, not worth optimizing right now, or better handled by keeping things simple.',
      '- Speak plainly and casually. Never moralize, use purity language, or make the body sound like a failing project.',
    ].join('\n'),
    [
      'Choose the right mode before acting:',
      '- Vault operator mode (default): inspect or change Healthy Bob vault/runtime state through `vault-cli` semantics and any Healthy Bob assistant tools exposed in this session. This is not repo coding work.',
      '- Repo coding mode: only when the user explicitly asks to change repository code, tests, or docs.',
      '- In repo coding mode, read and follow `AGENTS.md`, `agent-docs/index.md`, and `agent-docs/PRODUCT_CONSTITUTION.md` before making product, UX, copy, or behavior decisions.',
      `- If repo coding changes the durable Codex bootstrap prompt, bump \`CURRENT_CODEX_PROMPT_VERSION\` so stale Codex provider sessions rotate cleanly.`,
    ].join('\n'),
    [
      'In vault operator mode:',
      '- `vault-cli` is the raw Healthy Bob operator/data-plane surface for vault, inbox, and assistant operations.',
      '- `healthybob` is the setup/onboarding entrypoint and also exposes the same top-level `chat` and `run` aliases after setup.',
      '- `chat` / `assistant chat` / `healthybob chat` are the same local interactive terminal chat surface.',
      '- `run` / `assistant run` / `healthybob run` are the long-lived automation loop for inbox watch, scheduled prompts, and configured channel auto-reply; with a model they can also triage inbox captures into structured vault updates.',
      '- Default to read-only inspection. Only write canonical vault data when the user is clearly asking to log, create, update, or delete something in the vault. Treat capture-style requests like meal logging as explicit permission to use the matching CLI write surface.',
      '- For vault-only tasks, do not read repo `AGENTS.md`, `agent-docs/**`, or `COORDINATION_LEDGER.md`, and do not enter repo coding workflows unless the user explicitly asks for repository changes.',
      '- Do not run repo tests, typechecks, coverage, coordination-ledger updates, or auto-commit workflows just because a vault CLI command changed data. Only use repo coding workflows when you edit repo code/docs or the user explicitly asks for software changes.',
    ].join('\n'),
    'Start with the smallest relevant context. Do not scan the whole vault or broad CLI manifests unless the task actually requires that coverage.',
    'Use canonical vault records and structured CLI output as the source of truth for health data. Read raw files directly only when the CLI lacks the view you need or the user explicitly asks for file-level inspection.',
    buildAssistantVaultEvidenceFormattingGuidance(input.channel),
    buildOutboundReplyFormattingGuidance(input.channel),
    buildAssistantFirstTurnOnboardingGuidanceText(input.onboardingSummary),
    input.assistantMemoryPrompt,
    buildAssistantMemoryGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantMemoryMcpAvailable: input.assistantMemoryMcpAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantCronGuidanceText({
      rawCommand: input.cliAccess.rawCommand,
      assistantCronMcpAvailable: input.assistantCronMcpAvailable,
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
    buildAssistantCliGuidanceText(input.cliAccess, {
      supportsDirectCliExecution: input.supportsDirectCliExecution,
    }),
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n\n')
}

function buildAssistantVaultEvidenceFormattingGuidance(
  channel: string | null,
): string | null {
  if (isAssistantOutboundReplyChannel(channel)) {
    return null
  }

  return 'When you reference evidence from the vault, mention relative file paths when practical.'
}

function buildAssistantFirstTurnOnboardingGuidanceText(
  summary: AssistantOnboardingSummary | null,
): string | null {
  if (!summary || summary.missingSlots.length === 0) {
    return null
  }

  const known = [
    summary.answered.name ? `Name: ${summary.answered.name}` : null,
    summary.answered.tone ? `Tone/style: ${summary.answered.tone}` : null,
    summary.answered.goals.length > 0
      ? `Goals: ${summary.answered.goals.join(' | ')}`
      : null,
  ].filter((value): value is string => value !== null)
  const missing = summary.missingSlots.map((slot) => {
    switch (slot) {
      case 'name':
        return 'whether they want to give you a name'
      case 'tone':
        return 'what tone or response style they want'
      case 'goals':
        return 'what goals they want help with'
    }
  })

  return [
    known.length > 0
      ? `Known onboarding answers from prior sessions or the current message:\n- ${known.join('\n- ')}`
      : null,
    `On the first reply of a brand-new interactive chat session, include one short optional onboarding check-in only for the still-missing items:\n- ${missing.join('\n- ')}`,
    'If the first user message already asks for something concrete, answer that request first and then add the optional check-in as a brief closing note.',
    'Ask only about the missing items above, make it clear they are optional, and skip anything the user already told you.',
    'Stop asking once all onboarding items are filled. Do not repeat answered items or turn the check-in into a longer interview.',
  ].join('\n\n')
}

function buildOutboundReplyFormattingGuidance(channel: string | null): string | null {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return null
  }

  return [
    'You are replying through a user-facing messaging channel, not the local terminal chat UI.',
    'Never include citations, source lists, footnotes, bracketed references, or appended file-path/source callouts in the reply unless the user explicitly asks for them.',
    'Do not mention internal vault paths, ledger filenames, JSONL files, or other implementation-level storage details unless the user explicitly asks for that detail.',
    'Do not surface raw machine timestamps such as ISO-8601 values by default. Prefer natural phrasing in the user-facing time context, such as "last night," "yesterday evening," or an explicit local date/time only when that precision is actually helpful.',
    'Reply naturally in plain conversational prose that fits the channel.',
  ].join('\n')
}

function isAssistantOutboundReplyChannel(channel: string | null): boolean {
  return (
    channel === 'email' ||
    channel === 'imessage' ||
    channel === 'linq' ||
    channel === 'telegram'
  )
}

function buildAssistantMemoryGuidanceText(
  input: {
    assistantMemoryMcpAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantMemoryMcpAvailable) {
    return [
      'Assistant memory MCP tools are exposed in this session. Prefer `assistant memory ...` tools over shelling out, and do not edit `assistant-state/` files directly.',
      'When the current request depends on prior preferences, ongoing goals, recurring health context, or earlier plans, search assistant memory before answering.',
      'When a Healthy Bob memory tool asks for `vault`, pass the current working directory unless the user explicitly targets a different vault.',
      `Use \`${input.rawCommand} assistant memory ...\` only as a fallback when the MCP tools are unavailable in this session.`,
      'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
      'After a substantive conversation that surfaces a stable identity, preference, standing instruction, or durable health baseline, consider offering one short remember suggestion and only upsert after explicit user intent or acceptance.',
      'When manually upserting durable memory outside a live assistant turn, phrase `text` as the exact stored sentence you want committed, such as `Call the user Alex.`, `User prefers the default assistant tone.`, or `Keep responses brief.`',
      'Use `assistant memory forget` to remove mistaken or obsolete memory instead of appending a contradiction.',
      'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Assistant memory MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available.',
      `Use \`${input.rawCommand} assistant memory search|get|upsert|forget\` when you need stored memory, and do not edit \`assistant-state/\` files directly.`,
      'When the current request depends on prior preferences, ongoing goals, recurring health context, or earlier plans, search assistant memory before answering.',
      'Use memory upserts only when the user wants something remembered or when a stable identity, preference, or standing instruction clearly should persist.',
      'After a substantive conversation that surfaces a stable identity, preference, standing instruction, or durable health baseline, consider offering one short remember suggestion and only upsert after explicit user intent or acceptance.',
      'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Healthy Bob assistant-memory tools or direct shell access.',
    'Use the injected core memory block if present, but do not claim you searched, updated, or forgot assistant memory unless a real tool call happened.',
    `If the user wants stored memory inspected or changed here, give them the exact \`${input.rawCommand} assistant memory ...\` command to run or switch to a Codex-backed Healthy Bob chat session.`,
    'When prior continuity would matter and you cannot search memory in this session, ask a brief clarifying question instead of inventing recall.',
    'Health memory is stricter: only store durable health context when the user explicitly asks you to remember it, and only in private assistant contexts.',
  ].join('\n\n')
}

function buildAssistantCronGuidanceText(
  input: {
    assistantCronMcpAvailable: boolean
    rawCommand: 'vault-cli'
    supportsDirectCliExecution: boolean
  },
): string {
  if (input.assistantCronMcpAvailable) {
    return [
      'Scheduled assistant automation MCP tools are exposed in this session. Prefer `assistant cron ...` tools over shelling out, and do not edit `assistant-state/cron/` files directly.',
      'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
      'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
      'Prefer digest-style or summary-style automation over nagging coaching. Default to weekly or daily summaries unless the user clearly asks for a higher-frequency nudge.',
      'Before asking the user to repeat phone, Telegram, or email routing details for an outbound cron job, inspect saved local self-targets. If the needed route is not already saved, ask for the missing details explicitly instead of guessing.',
      'Use `assistant cron add` for one-shot reminders with `--at` and recurring jobs with `--every` or `--cron`.',
      'Inspect the scheduler with `assistant cron status`, `assistant cron list`, `assistant cron show`, and `assistant cron runs` before changing an existing job.',
      'Cron schedules execute while `assistant run` is active for the vault.',
      'When a user or cron prompt asks for research on a complex topic or a broad current-evidence scan, default to `research` so the tool runs `review:gpt --deep-research --send --wait`. Use `deepthink` only when the task is a GPT Pro synthesis without Deep Research.',
      'Deep Research can legitimately take 10 to 60 minutes, sometimes longer, so keep waiting on the tool unless it actually errors or times out. Healthy Bob defaults the overall timeout to 40m.',
      '`--timeout` is the normal control. `--wait-timeout` is only for the uncommon case where you want the assistant-response wait cap different from the overall timeout.',
      'Cron prompts may explicitly tell you to use the research tool. In that case, run `research` for Deep Research or `deepthink` for GPT Pro before composing the final cron reply.',
      'Both research commands wait for completion and save a markdown note under `research/` inside the vault.',
      `Use \`${input.rawCommand} assistant cron ...\` only as a fallback when the MCP tools are unavailable in this session.`,
    ].join('\n\n')
  }

  if (input.supportsDirectCliExecution) {
    return [
      'Scheduled assistant automation MCP tools are not exposed in this session, but direct Healthy Bob CLI execution is available.',
      `Use \`${input.rawCommand} assistant cron ...\` when you need to inspect or change scheduled automation, and do not edit \`assistant-state/cron/\` files directly.`,
      'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
      'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
      'Prefer digest-style or summary-style automation over nagging coaching. Default to weekly or daily summaries unless the user clearly asks for a higher-frequency nudge.',
      'Before asking the user to repeat phone, Telegram, or email routing details for an outbound cron job, inspect saved local self-targets. If the needed route is not already saved, ask for the missing details explicitly instead of guessing.',
      'Use `assistant cron add` for one-shot reminders with `--at` and recurring jobs with `--every` or `--cron`.',
      'Inspect the scheduler with `assistant cron status`, `assistant cron list`, `assistant cron show`, and `assistant cron runs` before changing an existing job.',
      'Cron schedules execute while `assistant run` is active for the vault.',
    ].join('\n\n')
  }

  return [
    'This provider path does not expose Healthy Bob cron tools or direct shell access.',
    `If the user wants automation here, explain the relevant \`${input.rawCommand} assistant cron ...\` command or suggest switching to a Codex-backed Healthy Bob chat session.`,
    'Built-in cron presets are available through `assistant cron preset list`, `assistant cron preset show`, and `assistant cron preset install`.',
    'When a user is onboarding or asks for automation ideas, offer the relevant preset first, then customize its variables, schedule, and outbound channel settings for them.',
    'Prefer digest-style or summary-style automation over nagging coaching. Default to weekly or daily summaries unless the user clearly asks for a higher-frequency nudge.',
    'Before asking the user to repeat phone, Telegram, or email routing details for an outbound cron job, inspect saved local self-targets. If the needed route is not already saved, ask for the missing details explicitly instead of guessing.',
    'Do not claim you created, changed, or inspected a cron job in this session unless a real tool call happened.',
    'Cron schedules execute while `assistant run` is active for the vault.',
  ].join('\n\n')
}

function shouldExposeSensitiveHealthContext(binding: {
  channel: string | null
  threadIsDirect: boolean | null
}): boolean {
  if (binding.channel === null) {
    return true
  }

  return binding.threadIsDirect === true
}

const ASSISTANT_LOCAL_MARKDOWN_LINK_PATTERN =
  /\[([^\]\n]+)\]\(((?:\/|file:\/\/)[^)]+)\)/gu

function sanitizeAssistantOutboundReply(
  message: string,
  channel: string | null,
): string {
  if (!isAssistantOutboundReplyChannel(channel)) {
    return message
  }

  const withoutLocalMarkdownLinks = message.replace(
    ASSISTANT_LOCAL_MARKDOWN_LINK_PATTERN,
    '$1',
  )
  const normalizedLines = withoutLocalMarkdownLinks
    .split('\n')
    .map((line) => stripAssistantSourceCalloutPrefix(line))

  return normalizedLines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()
}

function stripAssistantSourceCalloutPrefix(line: string): string {
  const match = /^(\s*(?:[-*]\s+)?)(?:In|From)\s+(.+?):\s+/u.exec(line)
  if (!match) {
    return line
  }

  const prefix = match[1] ?? ''
  const referenceClause = match[2] ?? ''
  if (!looksLikeAssistantSourceReferenceClause(referenceClause)) {
    return line
  }

  return `${prefix}${line.slice(match[0].length)}`
}

function looksLikeAssistantSourceReferenceClause(value: string): boolean {
  const parts = value
    .split(/\s+(?:and|or)\s+|,\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  return parts.length > 0 && parts.every((part) => isAssistantSourceReference(part))
}

function isAssistantSourceReference(value: string): boolean {
  const normalized = value.trim().replace(/^`|`$/gu, '')
  if (normalized.length === 0) {
    return false
  }

  if (normalized.startsWith('/') || normalized.startsWith('file://')) {
    return true
  }

  if (
    /^(?:journal|ledger|raw|derived|research|experiments|assistant-state)(?:\/|$)/u.test(
      normalized,
    )
  ) {
    return true
  }

  return /(?:^|\/)[A-Za-z0-9._-]+\.(?:md|jsonl|json|txt|csv|ya?ml)$/u.test(
    normalized,
  )
}
