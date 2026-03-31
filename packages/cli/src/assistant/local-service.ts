import {
  assistantAskResultSchema,
  type AssistantAskResult,
  type AssistantSession,
} from '../assistant-cli-contracts.js'
import {
  type ResolvedAssistantSession,
  appendAssistantTranscriptEntries,
  redactAssistantDisplayPath,
  resolveAssistantSession,
  saveAssistantSession,
} from './store.js'
import { resolveAssistantOperatorDefaults } from '../operator-config.js'
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
import {
  extractRecoveredAssistantSession,
} from './provider-turn-recovery.js'
import {
  executeProviderTurnWithRecovery,
} from './provider-turn-runner.js'
import {
  buildAssistantCanonicalWriteBlockedResult,
  buildBlockedAssistantTurnError,
  clampVaultBoundAssistantSandbox,
  normalizeAssistantAskResultForReturn,
  serializeAssistantSessionForResult,
} from './service-result.js'
import { persistFailedAssistantPromptAttempt } from './prompt-attempts.js'
import { resolveAssistantTurnRoutes } from './service-turn-routes.js'
import { persistPendingAssistantUsageEvent } from './service-usage.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
  PersistedUserTurn,
} from './service-contracts.js'
import { withAssistantTurnLock } from './turn-lock.js'

// Bump this when changing the durable Codex bootstrap prompt text so existing
// Codex provider sessions re-bootstrap cleanly on their next turn.
export const CURRENT_CODEX_PROMPT_VERSION = '2026-03-30.1'
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

async function finalizeBlockedAssistantTurn(input: {
  error: unknown
  prompt: string
  response: string | null
  session: AssistantSession
  turnId: string
  vault: string
}): Promise<AssistantAskResult> {
  const blockedResult = buildAssistantCanonicalWriteBlockedResult({
    error: input.error,
    prompt: input.prompt,
    session: input.session,
    vault: input.vault,
  })
  if (!blockedResult) {
    throw input.error
  }

  const blockedAt = new Date().toISOString()
  const blockedError = buildBlockedAssistantTurnError(blockedResult)

  await runAssistantTurnBestEffort(() =>
    finalizeAssistantTurnReceipt({
      vault: input.vault,
      turnId: input.turnId,
      status: 'blocked',
      deliveryDisposition: 'blocked',
      error: blockedError,
      response: input.response,
      completedAt: blockedAt,
    }),
  )

  await runAssistantTurnBestEffort(() =>
    recordAssistantDiagnosticEvent({
      vault: input.vault,
      component: 'assistant',
      kind: 'turn.blocked',
      level: 'warn',
      message: blockedError.message,
      code: blockedError.code,
      sessionId: blockedResult.session.sessionId,
      turnId: input.turnId,
      data: blockedResult.blocked,
      at: blockedAt,
    }),
  )

  return blockedResult
}

export async function openAssistantConversationLocal(
  input: AssistantSessionResolutionFields,
) {
  const defaults = await resolveAssistantOperatorDefaults()
  return resolveAssistantSession(buildResolveAssistantSessionInput(input, defaults))
}

export async function sendAssistantMessageLocal(
  input: AssistantMessageInput,
): Promise<AssistantAskResult> {
  const defaults = await resolveAssistantOperatorDefaults()
  return withAssistantTurnLock({
    abortSignal: input.abortSignal,
    vault: input.vault,
    run: async () => {
      const resolved = await resolveAssistantMessageSession({
        currentCodexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
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

      try {
        userTurn = await persistUserTurn(input, resolved, sharedPlan, receipt.turnId)
        const providerOutcome = await executeProviderTurnWithRecovery({
          currentCodexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
          input,
          routes,
          plan: sharedPlan,
          resolvedSession: resolved.session,
          turnCreatedAt: userTurn.turnCreatedAt,
          turnId: userTurn.turnId,
        })
        if (providerOutcome.kind === 'blocked') {
          return finalizeBlockedAssistantTurn({
            error: providerOutcome.error,
            prompt: input.prompt,
            response: responseText,
            session: providerOutcome.session,
            turnId: receipt.turnId,
            vault: input.vault,
          })
        }
        if (providerOutcome.kind === 'failed_terminal') {
          throw providerOutcome.error
        }

        const providerResult = providerOutcome.providerTurn
        responseText = providerResult.response
        await persistPendingAssistantUsageEvent({
          providerResult,
          turnId: userTurn.turnId,
          vault: input.vault,
        })
        const session = await finalizeAssistantTurnArtifacts({
          currentCodexPromptVersion: CURRENT_CODEX_PROMPT_VERSION,
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
          outcome: deliveryOutcome,
          response: providerResult.response,
          turnId: userTurn.turnId,
          vault: input.vault,
        })

        return normalizeAssistantAskResultForReturn(assistantAskResultSchema.parse({
          vault: redactAssistantDisplayPath(input.vault),
          status: 'completed',
          prompt: input.prompt,
          response: providerResult.response,
          session: serializeAssistantSessionForResult(deliveryOutcome.session),
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
          blocked: null,
        }))
      } catch (error) {
        const blockedResult = buildAssistantCanonicalWriteBlockedResult({
          error,
          prompt: input.prompt,
          session: extractRecoveredAssistantSession(error) ?? resolved.session,
          vault: input.vault,
        })

        if (blockedResult) {
          return finalizeBlockedAssistantTurn({
            error,
            prompt: input.prompt,
            response: responseText,
            session: blockedResult.session,
            turnId: receipt.turnId,
            vault: input.vault,
          })
        }

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
    providerOptions: serializeAssistantProviderSessionOptions({
      ...providerConfig,
      sandbox: clampVaultBoundAssistantSandbox(providerConfig.sandbox),
    }),
    updatedAt: new Date().toISOString(),
  })
}

async function runAssistantTurnBestEffort(
  task: () => Promise<unknown>,
): Promise<void> {
  await task().catch(() => undefined)
}
