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
  createAssistantOutboxIntent,
  dispatchAssistantOutboxIntent,
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
import { errorMessage, normalizeNullableString } from './shared.js'

// Bump this when changing the durable Codex bootstrap prompt text so existing
// Codex provider sessions re-bootstrap cleanly on their next turn.
export const CURRENT_CODEX_PROMPT_VERSION = '2026-03-26.1'

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

interface AssistantTurnPlan {
  allowSensitiveHealthContext: boolean
  cliEnv: NodeJS.ProcessEnv
  configOverrides?: readonly string[]
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  continuityContext: string | null
  persistUserPromptOnFailure: boolean
  provider: AssistantChatProvider
  usedConversationTranscript: boolean
  usedMemoryPrompt: boolean
  providerOptions: ReturnType<typeof resolveAssistantProviderOptions>
  resumeProviderSessionId: string | null
  sessionContext?: {
    binding: AssistantSession['binding']
  }
  systemPrompt: string | null
  workingDirectory: string
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
  const plan = await resolveAssistantTurnPlan(input, defaults, resolved)
  const receipt = await createAssistantTurnReceipt({
    vault: input.vault,
    sessionId: resolved.session.sessionId,
    provider: plan.provider,
    providerModel: plan.providerOptions.model ?? null,
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
    const userTurn = await persistUserTurn(input, resolved, plan, receipt.turnId)
    const providerResult = await executeProviderTurnWithRecovery({
      defaults,
      input,
      plan,
      resolvedSession: resolved.session,
      turnCreatedAt: userTurn.turnCreatedAt,
      turnId: userTurn.turnId,
    })
    responseText = providerResult.response
    const session = await persistAssistantTurnAndSession({
      input,
      plan,
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

    const completedAt = new Date().toISOString()
    switch (deliveryOutcome.kind) {
      case 'not-requested':
        await finalizeAssistantTurnReceipt({
          vault: input.vault,
          turnId: userTurn.turnId,
          status: 'completed',
          deliveryDisposition: 'not-requested',
          response: providerResult.response,
          completedAt,
        })
        await recordAssistantDiagnosticEvent({
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed without outbound delivery.',
          sessionId: session.sessionId,
          turnId: userTurn.turnId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: completedAt,
        })
        break
      case 'sent':
        await finalizeAssistantTurnReceipt({
          vault: input.vault,
          turnId: userTurn.turnId,
          status: 'completed',
          deliveryDisposition: 'sent',
          deliveryIntentId: deliveryOutcome.intentId,
          response: providerResult.response,
          completedAt,
        })
        await recordAssistantDiagnosticEvent({
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.completed',
          message: 'Assistant turn completed and delivered successfully.',
          sessionId: deliveryOutcome.session.sessionId,
          turnId: userTurn.turnId,
          intentId: deliveryOutcome.intentId,
          counterDeltas: {
            turnsCompleted: 1,
          },
          at: completedAt,
        })
        break
      case 'queued':
        await finalizeAssistantTurnReceipt({
          vault: input.vault,
          turnId: userTurn.turnId,
          status: 'deferred',
          deliveryDisposition: 'retryable',
          deliveryIntentId: deliveryOutcome.intentId,
          error: deliveryOutcome.error,
          response: providerResult.response,
          completedAt,
        })
        await recordAssistantDiagnosticEvent({
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.deferred',
          level: 'warn',
          message:
            deliveryOutcome.error?.message ??
            'Assistant turn deferred with a queued outbound delivery retry.',
          code: deliveryOutcome.error?.code ?? null,
          sessionId: deliveryOutcome.session.sessionId,
          turnId: userTurn.turnId,
          intentId: deliveryOutcome.intentId,
          counterDeltas: {
            turnsDeferred: 1,
          },
          at: completedAt,
        })
        break
      case 'failed':
        await finalizeAssistantTurnReceipt({
          vault: input.vault,
          turnId: userTurn.turnId,
          status: 'failed',
          deliveryDisposition: 'failed',
          deliveryIntentId: deliveryOutcome.intentId,
          error: deliveryOutcome.error,
          response: providerResult.response,
          completedAt,
        })
        await recordAssistantDiagnosticEvent({
          vault: input.vault,
          component: 'assistant',
          kind: 'turn.failed',
          level: 'error',
          message: deliveryOutcome.error.message,
          code: deliveryOutcome.error.code,
          sessionId: deliveryOutcome.session.sessionId,
          turnId: userTurn.turnId,
          intentId: deliveryOutcome.intentId,
          counterDeltas: {
            turnsFailed: 1,
          },
          at: completedAt,
        })
        break
    }

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

    await finalizeAssistantTurnReceipt({
      vault: input.vault,
      turnId: receipt.turnId,
      status: 'failed',
      deliveryDisposition: input.deliverResponse === true ? 'failed' : 'not-requested',
      error: normalizedError,
      response: responseText,
      completedAt: failedAt,
    }).catch(() => undefined)

    await recordAssistantDiagnosticEvent({
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
    }).catch(() => undefined)

    throw error
  } finally {
    await refreshAssistantStatusSnapshot(input.vault).catch(() => undefined)
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

async function resolveAssistantTurnPlan(
  input: AssistantMessageInput,
  defaults: AssistantOperatorDefaults | null,
  resolved: ResolvedAssistantSession,
): Promise<AssistantTurnPlan> {
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
  const shouldResetCodexProviderSession =
    shouldResetCodexProviderSessionForPromptVersion({
      provider,
      session: resolved.session,
    })
  const shouldInjectBootstrapContext =
    resolved.created ||
    resolved.session.turnCount === 0 ||
    provider === 'openai-compatible' ||
    provider !== resolved.session.provider ||
    resolved.session.providerSessionId === null ||
    shouldResetCodexProviderSession
  const shouldInjectFirstTurnOnboarding =
    input.enableFirstTurnOnboarding === true &&
    (resolved.created || resolved.session.turnCount === 0)
  const conversationMessages = shouldUseLocalTranscriptContext(provider)
    ? await loadAssistantConversationMessages({
        limit: 20,
        sessionId: resolved.session.sessionId,
        vault: input.vault,
      })
    : undefined
  const onboardingSummary =
    input.enableFirstTurnOnboarding === true
      ? await updateAssistantOnboardingSummary({
          prompt: input.prompt,
          vault: input.vault,
        })
      : null
  const allowSensitiveHealthContext = shouldExposeSensitiveHealthContext(
    resolved.session.binding,
  )
  const assistantMemoryPrompt = shouldInjectBootstrapContext
    ? await loadAssistantMemoryPromptBlock({
        includeSensitiveHealthContext: allowSensitiveHealthContext,
        vault: input.vault,
      })
    : null
  const continuityContext = shouldResetCodexProviderSession
    ? await buildCodexPromptResetContinuityContext({
        sessionId: resolved.session.sessionId,
        vault: input.vault,
      })
    : null
  const cliAccess = resolveAssistantCliAccessContext()
  const workingDirectory = input.workingDirectory ?? input.vault
  const providerCapabilities = resolveAssistantProviderCapabilities(provider)
  const supportsDirectCliExecution = providerCapabilities.supportsDirectCliExecution
  const memoryMcpConfig = buildAssistantMemoryMcpConfig(workingDirectory)
  const cronMcpConfig = buildAssistantCronMcpConfig(workingDirectory)
  const assistantMemoryMcpAvailable =
    supportsDirectCliExecution && memoryMcpConfig !== null
  const assistantCronMcpAvailable =
    supportsDirectCliExecution && cronMcpConfig !== null
  const configOverrides = [
    ...(memoryMcpConfig?.configOverrides ?? []),
    ...(cronMcpConfig?.configOverrides ?? []),
  ]

  return {
    allowSensitiveHealthContext,
    cliEnv: cliAccess.env,
    configOverrides: configOverrides.length > 0 ? configOverrides : undefined,
    conversationMessages,
    continuityContext,
    persistUserPromptOnFailure: input.persistUserPromptOnFailure ?? true,
    provider,
    usedConversationTranscript:
      (conversationMessages?.length ?? 0) > 0 || continuityContext !== null,
    usedMemoryPrompt: assistantMemoryPrompt !== null,
    providerOptions,
    resumeProviderSessionId:
      provider === resolved.session.provider && !shouldResetCodexProviderSession
        ? resolved.session.providerSessionId
        : null,
    sessionContext: shouldInjectBootstrapContext
      ? {
          binding: resolved.session.binding,
        }
      : undefined,
    systemPrompt: shouldInjectBootstrapContext
      ? buildAssistantSystemPrompt({
          assistantCronMcpAvailable,
          cliAccess,
          assistantMemoryMcpAvailable,
          assistantMemoryPrompt,
          channel: input.channel ?? resolved.session.binding.channel,
          onboardingSummary:
            shouldInjectFirstTurnOnboarding && onboardingSummary
              ? onboardingSummary
              : null,
          supportsDirectCliExecution,
        })
      : null,
    workingDirectory,
  }
}

async function persistUserTurn(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
  plan: AssistantTurnPlan,
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

async function executeProviderTurnWithRecovery(input: {
  defaults: AssistantOperatorDefaults | null
  input: AssistantMessageInput
  plan: AssistantTurnPlan
  resolvedSession: AssistantSession
  turnCreatedAt: string
  turnId: string
}): Promise<ExecutedAssistantProviderTurnResult> {
  const routes = buildAssistantFailoverRoutes({
    backups: input.input.failoverRoutes ?? input.defaults?.failoverRoutes ?? null,
    codexCommand: input.input.codexCommand ?? input.defaults?.codexCommand ?? null,
    defaults: input.defaults,
    provider: input.plan.provider,
    providerOptions: input.plan.providerOptions,
  })
  const primaryRoute = routes[0] ?? null
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

  while (attemptedRouteIds.size < routes.length) {
    const remainingRoutes = prioritizeAssistantFailoverRoutes(
      routes.filter((route) => !attemptedRouteIds.has(route.routeId)),
      failoverState,
    )
    const route = remainingRoutes[0] ?? null
    if (!route) {
      break
    }

    attemptCount += 1
    attemptedRouteIds.add(route.routeId)

    if (attemptCount === 1 && primaryRoute && route.routeId !== primaryRoute.routeId) {
      await appendAssistantTurnReceiptEvent({
        vault: input.input.vault,
        turnId: input.turnId,
        kind: 'provider.failover.applied',
        detail: `${primaryRoute.label} -> ${route.label}`,
        metadata: {
          from: primaryRoute.label,
          to: route.label,
          reason: 'cooldown',
        },
      })
      await recordAssistantDiagnosticEvent({
        vault: input.input.vault,
        component: 'provider',
        kind: 'provider.failover.applied',
        level: 'warn',
        message: `Primary assistant provider route ${primaryRoute.label} is cooling down; using ${route.label}.`,
        sessionId: workingSession.sessionId,
        turnId: input.turnId,
        data: {
          from: primaryRoute.label,
          to: route.label,
          fromRouteId: primaryRoute.routeId,
          toRouteId: route.routeId,
        },
        counterDeltas: {
          providerFailovers: 1,
        },
      })
    }

    const attemptAt = new Date().toISOString()
    await appendAssistantTurnReceiptEvent({
      vault: input.input.vault,
      turnId: input.turnId,
      kind: 'provider.attempt.started',
      detail: route.label,
      metadata: {
        attempt: String(attemptCount),
        provider: route.provider,
        model: route.providerOptions.model ?? 'default',
        routeId: route.routeId,
      },
      at: attemptAt,
    })
    await recordAssistantDiagnosticEvent({
      vault: input.input.vault,
      component: 'provider',
      kind: 'provider.attempt.started',
      message: `Assistant provider attempt ${attemptCount} started with ${route.label}.`,
      sessionId: workingSession.sessionId,
      turnId: input.turnId,
      data: {
        attempt: attemptCount,
        routeId: route.routeId,
        provider: route.provider,
        model: route.providerOptions.model,
      },
      counterDeltas: {
        providerAttempts: 1,
      },
      at: attemptAt,
    })

    try {
      const resumeProviderSessionId =
        route.provider === workingSession.provider
          ? attemptCount === 1
            ? input.plan.resumeProviderSessionId
            : workingSession.providerSessionId
          : null
      maybeThrowInjectedAssistantFault({
        component: 'provider',
        fault: 'provider',
        message: 'Injected assistant provider failure.',
      })
      const result = await executeAssistantProviderTurn({
        abortSignal: input.input.abortSignal,
        provider: route.provider,
        workingDirectory: input.plan.workingDirectory,
        configOverrides: input.plan.configOverrides,
        env: {
          ...input.plan.cliEnv,
          ...memoryTurnEnv,
        },
        userPrompt: input.input.prompt,
        continuityContext: input.plan.continuityContext,
        systemPrompt: input.plan.systemPrompt,
        sessionContext: input.plan.sessionContext
          ? {
              binding: workingSession.binding,
            }
          : undefined,
        resumeProviderSessionId,
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
        conversationMessages: shouldUseLocalTranscriptContext(route.provider)
          ? input.plan.conversationMessages
          : undefined,
        onEvent: input.input.onProviderEvent ?? undefined,
        profile: route.providerOptions.profile,
        oss: route.providerOptions.oss,
        onTraceEvent: input.input.onTraceEvent,
        showThinkingTraces: input.input.showThinkingTraces ?? false,
      })

      failoverState = await recordAssistantFailoverRouteSuccess({
        vault: input.input.vault,
        route,
        at: new Date().toISOString(),
      })
      await appendAssistantTurnReceiptEvent({
        vault: input.input.vault,
        turnId: input.turnId,
        kind: 'provider.attempt.succeeded',
        detail: route.label,
        metadata: {
          attempt: String(attemptCount),
          provider: route.provider,
          model: route.providerOptions.model ?? 'default',
          routeId: route.routeId,
        },
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
      failoverState = await recordAssistantFailoverRouteFailure({
        error,
        route,
        vault: input.input.vault,
      })
      const cooldownUntil = getAssistantFailoverCooldownUntil({
        route,
        state: failoverState,
      })
      const detail = errorMessage(error)
      const errorCode = readAssistantErrorCode(error)

      await appendAssistantTurnReceiptEvent({
        vault: input.input.vault,
        turnId: input.turnId,
        kind: 'provider.attempt.failed',
        detail,
        metadata: {
          attempt: String(attemptCount),
          provider: route.provider,
          model: route.providerOptions.model ?? 'default',
          routeId: route.routeId,
          code: errorCode ?? 'unknown',
        },
      })
      if (cooldownUntil) {
        await appendAssistantTurnReceiptEvent({
          vault: input.input.vault,
          turnId: input.turnId,
          kind: 'provider.cooldown.started',
          detail: `${route.label} cooling down until ${cooldownUntil}`,
          metadata: {
            routeId: route.routeId,
            cooldownUntil,
          },
        })
      }
      await recordAssistantDiagnosticEvent({
        vault: input.input.vault,
        component: 'provider',
        kind: 'provider.attempt.failed',
        level: 'warn',
        message: detail,
        code: errorCode,
        sessionId: workingSession.sessionId,
        turnId: input.turnId,
        data: {
          attempt: attemptCount,
          routeId: route.routeId,
          provider: route.provider,
          model: route.providerOptions.model,
          cooldownUntil,
        },
        counterDeltas: {
          providerFailures: 1,
        },
      })

      if (!shouldAttemptAssistantProviderFailover({
        abortSignal: input.input.abortSignal,
        error,
      })) {
        throw error
      }

      const remainingCandidates = prioritizeAssistantFailoverRoutes(
        routes.filter((candidate) => !attemptedRouteIds.has(candidate.routeId)),
        failoverState,
      )
      const nextRoute = remainingCandidates[0] ?? null
      if (!nextRoute) {
        throw error
      }

      await appendAssistantTurnReceiptEvent({
        vault: input.input.vault,
        turnId: input.turnId,
        kind: 'provider.failover.applied',
        detail: `${route.label} -> ${nextRoute.label}`,
        metadata: {
          from: route.label,
          to: nextRoute.label,
          fromRouteId: route.routeId,
          toRouteId: nextRoute.routeId,
        },
      })
      await recordAssistantDiagnosticEvent({
        vault: input.input.vault,
        component: 'provider',
        kind: 'provider.failover.applied',
        level: 'warn',
        message: `Failing over assistant provider from ${route.label} to ${nextRoute.label}.`,
        code: errorCode,
        sessionId: workingSession.sessionId,
        turnId: input.turnId,
        data: {
          from: route.label,
          to: nextRoute.label,
          fromRouteId: route.routeId,
          toRouteId: nextRoute.routeId,
        },
        counterDeltas: {
          providerFailovers: 1,
        },
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
  plan: AssistantTurnPlan
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

  const intent = await createAssistantOutboxIntent({
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
  })

  if (intent.status === 'sent' && intent.delivery) {
    return {
      kind: 'sent',
      delivery: intent.delivery,
      intentId: intent.intentId,
      session: input.session,
    }
  }

  const dispatched = await dispatchAssistantOutboxIntent({
    vault: input.input.vault,
    intentId: intent.intentId,
    force: true,
  })
  const session = dispatched.session ?? input.session

  if (dispatched.intent.status === 'sent' && dispatched.intent.delivery) {
    return {
      kind: 'sent',
      delivery: dispatched.intent.delivery,
      intentId: dispatched.intent.intentId,
      session,
    }
  }

  if (
    dispatched.intent.status === 'pending' ||
    dispatched.intent.status === 'retryable' ||
    dispatched.intent.status === 'sending'
  ) {
    return {
      kind: 'queued',
      error: dispatched.deliveryError,
      intentId: dispatched.intent.intentId,
      session,
    }
  }

  return {
    kind: 'failed',
    error:
      dispatched.deliveryError ??
      normalizeAssistantDeliveryError(new Error('Assistant outbound delivery failed.')),
    intentId: dispatched.intent.intentId,
    session,
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

function readAssistantErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null
  }

  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code.trim().length > 0 ? code : null
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
      'Choose the right mode before acting:',
      '- Vault operator mode (default): inspect or change Healthy Bob vault/runtime state through `vault-cli` semantics and any Healthy Bob assistant tools exposed in this session. This is not repo coding work.',
      '- Repo coding mode: only when the user explicitly asks to change repository code, tests, or docs.',
      `- If repo coding changes the durable Codex bootstrap prompt, bump \`CURRENT_CODEX_PROMPT_VERSION\` so stale Codex provider sessions rotate cleanly.`,
    ].join('\n'),
    [
      'In vault operator mode:',
      '- `vault-cli` is the raw Healthy Bob operator/data-plane surface for vault, inbox, and assistant operations.',
      '- `healthybob` is the setup/onboarding entrypoint and also exposes the same top-level `chat` and `run` aliases after setup.',
      '- `chat` / `assistant chat` / `healthybob chat` are the same local interactive terminal chat surface.',
      '- `run` / `assistant run` / `healthybob run` are the long-lived automation loop for inbox watch, scheduled prompts, and configured channel auto-reply; with a model they can also triage inbox captures into structured vault updates.',
      '- Default to read-only inspection. Only write canonical vault data when the user is clearly asking to log, create, update, or delete something in the vault. Treat capture-style requests like meal logging as explicit permission to use the matching CLI write surface.',
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
