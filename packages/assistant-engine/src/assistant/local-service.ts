import {
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
  createDefaultLocalAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
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
  emitHostedAssistantContextSessionResolvedTrace,
} from './hosted-context-diagnostics.js'
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
  AUTO_REPLY_RECEIPT_RETRY_AT_KEY,
  computeAssistantAutoReplyRetryAt,
} from './automation/auto-reply-retry.js'
import {
  mergeAssistantProviderConfigsForProvider,
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import { normalizeAssistantExecutionContext } from './execution-context.js'
import { resolveAssistantExecutionDefaultTarget } from './execution-context.js'
import { resolveAssistantExecutionOperatorDefaults } from './execution-context.js'
import {
  extractRecoveredAssistantSession,
} from './provider-turn-recovery.js'
import {
  executeProviderTurnWithRecovery,
  resolveAssistantProviderTurnContinuityPolicy,
} from './provider-turn-runner.js'
import {
  normalizeAssistantAskResultForReturn,
  serializeAssistantSessionForResult,
} from './service-result.js'
import {
  prioritizeAssistantRoutesForRichUserMessageContent,
} from './rich-content-routing.js'
import { persistFailedAssistantPromptAttempt } from './prompt-attempts.js'
import { resolveAssistantTurnRoutes } from './service-turn-routes.js'
import { persistPendingAssistantUsageEvent } from './service-usage.js'
import { isAssistantTurnRevisionRequiredError } from './turn-input.js'
import {
  startAssistantChannelTypingIndicator,
  stopAssistantChannelTypingIndicator,
} from './channel-typing.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
  AssistantTurnSharedPlan,
  PersistedUserTurn,
} from './service-contracts.js'
import { withAssistantTurnLock } from './turn-lock.js'

export { buildResolveAssistantSessionInput } from './session-resolution.js'

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
  const boundaryDefaultTarget = resolveAssistantExecutionDefaultTarget({
    executionContext,
    fallbackTarget: createDefaultLocalAssistantModelTarget(),
  })
  const defaults = resolveAssistantExecutionOperatorDefaults({
    defaults: await resolveAssistantOperatorDefaults(),
    executionContext,
  })
  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const resolved = await resolveAssistantMessageSession({
        boundaryDefaultTarget,
        defaults,
        message: input,
      })
      await emitHostedAssistantContextSessionResolvedTrace({
        message: input,
        resolved,
        source: 'assistant-message',
      })
      const sharedPlan = await buildAssistantTurnSharedPlan(input, resolved)
      const routes = prioritizeAssistantRoutesForRichUserMessageContent({
        routes: resolveAssistantTurnRoutes(input, defaults, resolved),
        userMessageContent: input.userMessageContent,
      })
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
        channelDependencies:
          executionContext?.hosted?.channelTypingDependencies ?? null,
        input,
        session: resolved.session,
        sharedPlan,
      })

      try {
        userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
        const turnContinuityPolicy = resolveAssistantProviderTurnContinuityPolicy({
          turnTrigger: input.turnTrigger ?? null,
        })
        const providerOutcome = await executeProviderTurnWithRecovery({
          input,
          routes,
          plan: sharedPlan,
          profile: {
            turnContinuityPolicy,
          },
          resolvedSession: resolved.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        if (providerOutcome.kind === 'failed_terminal') {
          throw providerOutcome.error
        }

        const providerResult = providerOutcome.providerTurn
        responseText = providerResult.response
        const usagePersistenceInput = {
          executionContext,
          providerResult,
          turnId: userTurn.turnId,
          vault: input.vault,
        }
        await input.beforeDelivery?.({
          response: providerResult.response,
          sessionId: providerResult.session.sessionId,
          turnId: userTurn.turnId,
          vault: input.vault,
        })
        await persistPendingAssistantUsageEvent(usagePersistenceInput)
        const session = await finalizeAssistantTurnArtifacts({
          input,
          plan: sharedPlan,
          providerResult,
          turnContinuityPolicy,
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
          onboardingCompletionFallbackReason:
            providerResult.onboardingCompletionFallbackReason,
          onboardingGuidanceInjected:
            providerResult.onboardingGuidanceInjected,
          firstContactStateDocIds: sharedPlan.firstContactStateDocIds,
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
        if (isAssistantTurnRevisionRequiredError(error)) {
          const blockedAt = new Date().toISOString()
          const blockedSession =
            extractRecoveredAssistantSession(error) ?? resolved.session

          await runAssistantTurnBestEffort(() =>
            finalizeAssistantTurnReceipt({
              vault: input.vault,
              turnId: receipt.turnId,
              status: 'blocked',
              deliveryDisposition:
                input.deliverResponse === true ? 'blocked' : 'not-requested',
              completedAt: blockedAt,
            }),
          )

          await runAssistantTurnBestEffort(() =>
            recordAssistantDiagnosticEvent({
              vault: input.vault,
              component: 'assistant',
              kind: 'turn.blocked',
              level: 'info',
              message: error.message,
              sessionId: blockedSession.sessionId,
              turnId: receipt.turnId,
              at: blockedAt,
            }),
          )

          throw error
        }

        const normalizedError = normalizeAssistantDeliveryError(error)
        const failedAt = new Date().toISOString()
        const retryAt =
          input.turnTrigger === 'automation-auto-reply'
            ? computeAssistantAutoReplyRetryAt(
                error,
                Date.parse(failedAt),
              )
            : null
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
            metadata:
              retryAt === null
                ? null
                : {
                    [AUTO_REPLY_RECEIPT_RETRY_AT_KEY]: retryAt,
                  },
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
  providerOptions: Pick<AssistantSession['providerOptions'], 'provider'> &
    Partial<Omit<AssistantSession['providerOptions'], 'provider'>>
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
    input.providerOptions.provider,
    // Persisted targets carry the full durable provider config. Session
    // providerOptions are a derived runtime projection and omit target-only
    // fields such as the Codex executable path.
    assistantBackendTargetToProviderConfigInput(session.session.target),
    input.providerOptions,
  )
  const nextTarget =
    createAssistantModelTarget(providerConfig) ?? session.session.target
  const nextProviderOptions = serializeAssistantProviderSessionOptions(providerConfig)
  const continuityChanged =
    session.session.providerOptions.continuityFingerprint !==
    nextProviderOptions.continuityFingerprint

  return saveAssistantSession(input.vault, {
    ...session.session,
    provider: nextTarget.adapter,
    providerOptions: nextProviderOptions,
    resumeState: continuityChanged ? null : session.session.resumeState,
    target: nextTarget,
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
