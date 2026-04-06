import {
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import { createDefaultLocalAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import {
  type ResolvedAssistantSession,
  appendAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './store.js'
import { resolveAssistantOperatorDefaults } from '@murphai/operator-config/operator-config'
import {
  normalizeAssistantDeliveryError,
} from './outbox.js'
import { recordAssistantDiagnosticEvent } from './diagnostics.js'
import { refreshAssistantStatusSnapshotLocal } from './status.js'
import {
  resolveAssistantTurnSharedPlan as buildAssistantTurnSharedPlan,
} from './turn-plan.js'
import {
  buildResolveAssistantSessionInput,
  resolveAssistantSessionForMessage as resolveAssistantMessageSession,
} from './session-resolution.js'
import {
  deliverAssistantReply as dispatchAssistantReply,
  finalizeAssistantTurnFromDeliveryOutcome as finalizeDeliveredAssistantTurn,
} from './delivery-service.js'
import {
  persistAssistantTurnAndSession as finalizeAssistantTurnArtifacts,
} from './turn-finalizer.js'
import {
  appendAssistantTurnReceiptEvent,
  createAssistantTurnReceipt,
  finalizeAssistantTurnReceipt,
} from './turns.js'
import {
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from './provider-config.js'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import {
  extractRecoveredAssistantSession,
} from './provider-turn-recovery.js'
import {
  executeProviderTurnWithRecovery,
} from './provider-turn-runner.js'
import {
  normalizeAssistantAskResultForReturn,
  serializeAssistantSessionForResult,
} from './service-result.js'
import { persistFailedAssistantPromptAttempt } from './prompt-attempts.js'
import { resolveAssistantTurnRoutes } from './service-turn-routes.js'
import { persistPendingAssistantUsageEvent } from './service-usage.js'
import {
  getAssistantChannelAdapter,
  type AssistantChannelActivityHandle,
} from './channel-adapters.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
  AssistantTurnSharedPlan,
  PersistedUserTurn,
} from './service-contracts.js'
import { withAssistantTurnLock } from './turn-lock.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'
export {
  queueAssistantFirstContactWelcomeLocal,
  sendAssistantFirstContactWelcomeLocal,
} from './first-contact-welcome-delivery.js'

async function persistUserTurn(
  input: AssistantMessageInput,
  resolved: ResolvedAssistantSession,
  plan: {
    persistUserPromptOnFailure: boolean
  },
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

export async function openAssistantConversationLocal(
  input: AssistantSessionResolutionFields,
) {
  const defaults = await resolveAssistantOperatorDefaults()
  return resolveAssistantSession(
    buildResolveAssistantSessionInput(
      input,
      defaults,
      createDefaultLocalAssistantModelTarget(),
    ),
  )
}

export async function sendAssistantMessageLocal(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const executionContext = normalizeAssistantExecutionContext(input.executionContext)
  const defaults = await resolveAssistantOperatorDefaults()
  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const resolved = await resolveAssistantMessageSession({
        boundaryDefaultTarget: createDefaultLocalAssistantModelTarget(),
        defaults,
        message: input,
      })
      const sharedPlan = await buildAssistantTurnSharedPlan(input, resolved)
      const routes = resolveAssistantTurnRoutes(input, defaults, resolved)
      const primaryRoute = routes[0] ?? null
      const receipt = await createAssistantTurnReceipt({
        vault: input.vault,
        sessionId: resolved.session.sessionId,
        provider: primaryRoute?.provider ?? resolved.session.provider,
        providerModel: primaryRoute?.providerOptions.model ?? null,
        metadata: input.receiptMetadata ?? null,
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
      let userTurn: PersistedUserTurn | null = null
      const typingIndicator = startAssistantChannelTypingIndicator({
        input,
        session: resolved.session,
        sharedPlan,
      })

      try {
        userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
        const providerOutcome = await executeProviderTurnWithRecovery({
          input,
          routes,
          plan: sharedPlan,
          resolvedSession: resolved.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        if (providerOutcome.kind === 'failed_terminal') {
          throw providerOutcome.error
        }

        const providerResult = providerOutcome.providerTurn
        responseText = providerResult.response
        await persistPendingAssistantUsageEvent({
          executionContext,
          providerResult,
          turnId: userTurn.turnId,
          vault: input.vault,
        })
        const session = await finalizeAssistantTurnArtifacts({
          input,
          plan: sharedPlan,
          providerResult,
          session: providerResult.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        const deliveryOutcome = await dispatchAssistantReply({
          input,
          response: providerResult.response,
          session,
          sharedPlan,
          turnId: userTurn.turnId,
        })

        await finalizeDeliveredAssistantTurn({
          firstTurnCheckInInjected: providerResult.firstTurnCheckInInjected,
          firstTurnCheckInStateDocIds: sharedPlan.firstTurnCheckInStateDocIds,
          outcome: deliveryOutcome,
          response: providerResult.response,
          turnId: userTurn.turnId,
          vault: input.vault,
        })

        return normalizeAssistantAskResultForReturn({
          vault: redactAssistantDisplayPath(input.vault),
          status: 'completed',
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
        const failedSession =
          extractRecoveredAssistantSession(error) ?? resolved.session

        await runAssistantTurnBestEffort(() =>
          persistFailedAssistantPromptAttempt({
            persistUserPromptOnFailure: sharedPlan.persistUserPromptOnFailure,
            prompt: input.prompt,
            session: failedSession,
            turnCreatedAt: userTurn?.turnCreatedAt ?? failedAt,
            turnTrigger: input.turnTrigger ?? 'manual-ask',
            vault: input.vault,
          }),
        )

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
            sessionId: failedSession.sessionId,
            turnId: receipt.turnId,
            counterDeltas: {
              turnsFailed: 1,
            },
            at: failedAt,
          }),
        )

        throw error
      } finally {
        await stopAssistantChannelTypingIndicator(typingIndicator)
        await runAssistantTurnBestEffort(() =>
          refreshAssistantStatusSnapshotLocal(input.vault),
        )
      }
    },
  })
}

export async function updateAssistantSessionOptionsLocal(input: {
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

  const providerConfig = mergeAssistantProviderConfigsForProvider(
    session.session.provider,
    {
      provider: session.session.provider,
      ...session.session.providerOptions,
    },
    {
      provider: session.session.provider,
      ...input.providerOptions,
    },
  )

  return saveAssistantSession(input.vault, {
    ...session.session,
    providerOptions: serializeAssistantProviderSessionOptions(providerConfig),
    updatedAt: new Date().toISOString(),
  })
}

async function runAssistantTurnBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  try {
    await task()
  } catch {}
}

function startAssistantChannelTypingIndicator(input: {
  input: AssistantMessageInput
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
}): AssistantChannelActivityHandle | null {
  if (input.input.deliverResponse !== true) {
    return null
  }

  if ((input.input.deliveryDispatchMode ?? 'immediate') === 'queue-only') {
    return null
  }

  const audience = input.sharedPlan.conversationPolicy.audience
  const channel = audience.channel ?? input.session.binding.channel ?? null
  const adapter = getAssistantChannelAdapter(channel)
  if (!adapter?.startTypingIndicator) {
    return null
  }
  const startTypingIndicator = adapter.startTypingIndicator

  let activeIndicator: AssistantChannelActivityHandle | null = null
  let stopRequested = false
  const indicatorReady = Promise.resolve()
    .then(() =>
      startTypingIndicator(
        {
          bindingDelivery:
            audience.bindingDelivery ?? input.session.binding.delivery ?? null,
          explicitTarget: audience.explicitTarget,
          identityId:
            audience.identityId ?? input.session.binding.identityId ?? null,
        },
        {},
      ),
    )
    .then(async (indicator) => {
      if (!indicator) {
        return null
      }

      if (stopRequested) {
        await runAssistantTurnBestEffort(() => indicator.stop())
        return null
      }

      activeIndicator = indicator
      return indicator
    })
    .catch(() => null)

  return {
    async stop() {
      stopRequested = true
      if (activeIndicator) {
        const indicator = activeIndicator
        activeIndicator = null
        void runAssistantTurnBestEffort(() => indicator.stop())
        return
      }

      void indicatorReady.then((indicator) => {
        if (indicator) {
          activeIndicator = null
          return runAssistantTurnBestEffort(() => indicator.stop())
        }

        return undefined
      })
    },
  }
}

async function stopAssistantChannelTypingIndicator(
  indicator: AssistantChannelActivityHandle | null,
): Promise<void> {
  if (!indicator) {
    return
  }

  await indicator.stop()
}
