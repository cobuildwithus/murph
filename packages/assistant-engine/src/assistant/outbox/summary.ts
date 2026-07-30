import type { AssistantStatusOutboxSummary } from '@murphai/operator-config/assistant-cli-contracts'
import { listAssistantOutboxIntentsLocal } from './store.js'
import {
  resolveAssistantOutboxRequiredBeforeFinalDependencies,
} from './ordering.js'

export async function buildAssistantOutboxSummary(
  vault: string,
): Promise<AssistantStatusOutboxSummary> {
  const intents = await listAssistantOutboxIntentsLocal(vault)
  const requiredDependencyState =
    resolveAssistantOutboxRequiredBeforeFinalDependencies(intents)
  let oldestPendingAt: string | null = null
  let nextAttemptAt: string | null = null

  for (const intent of intents) {
    if (
      (
        intent.status === 'awaiting_approval' ||
        intent.status === 'pending' ||
        intent.status === 'retryable' ||
        intent.status === 'sending'
      ) &&
      (!oldestPendingAt || intent.createdAt < oldestPendingAt)
    ) {
      oldestPendingAt = intent.createdAt
    }
    if (
      (
        intent.status === 'awaiting_approval' ||
        intent.status === 'pending' ||
        intent.status === 'retryable'
      ) &&
      (
        !requiredDependencyState.blockedIntentIds.has(intent.intentId) ||
        requiredDependencyState.unavailableFinalIntentIds.has(intent.intentId)
      ) &&
      intent.nextAttemptAt &&
      (!nextAttemptAt || intent.nextAttemptAt < nextAttemptAt)
    ) {
      nextAttemptAt = intent.nextAttemptAt
    }
  }

  return {
    total: intents.length,
    pending: intents.filter(
      (intent) => intent.status === 'awaiting_approval' || intent.status === 'pending',
    ).length,
    sending: intents.filter((intent) => intent.status === 'sending').length,
    retryable: intents.filter((intent) => intent.status === 'retryable').length,
    sent: intents.filter((intent) => intent.status === 'sent').length,
    failed: intents.filter((intent) => intent.status === 'failed').length,
    abandoned: intents.filter((intent) => intent.status === 'abandoned').length,
    oldestPendingAt,
    nextAttemptAt,
  }
}
