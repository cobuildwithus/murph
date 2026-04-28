import type {
  ResolvedAssistantFailoverRoute,
} from '../failover.js'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import {
  appendAssistantTurnReceiptEvent,
} from '../turns.js'

export async function recordProviderAttemptStarted(input: {
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

export async function recordProviderAttemptSucceeded(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  route: ResolvedAssistantFailoverRoute
  turnId: string
  vault: string
}): Promise<void> {
  const activityLabels = input.activityLabels ?? []
  const metadata: Record<string, string> = {
    attempt: String(input.attemptCount),
    provider: input.route.provider,
    model: input.route.providerOptions.model ?? 'default',
    routeId: input.route.routeId,
  }
  if (activityLabels.length > 0) {
    metadata.activityCount = String(activityLabels.length)
    metadata.activities = activityLabels.join(', ')
  }

  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.succeeded',
    detail: input.route.label,
    metadata,
  })
}

export async function recordProviderAttemptFailed(input: {
  activityLabels?: readonly string[]
  attemptCount: number
  cooldownUntil: string | null
  detail: string
  errorCode: string | null
  route: ResolvedAssistantFailoverRoute
  sessionId: string
  turnId: string
  vault: string
}): Promise<void> {
  const activityLabels = input.activityLabels ?? []
  const metadata: Record<string, string> = {
    attempt: String(input.attemptCount),
    provider: input.route.provider,
    model: input.route.providerOptions.model ?? 'default',
    routeId: input.route.routeId,
    code: input.errorCode ?? 'unknown',
  }
  if (activityLabels.length > 0) {
    metadata.activityCount = String(activityLabels.length)
    metadata.activities = activityLabels.join(', ')
  }

  await appendAssistantTurnReceiptEvent({
    vault: input.vault,
    turnId: input.turnId,
    kind: 'provider.attempt.failed',
    detail: input.detail,
    metadata,
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
