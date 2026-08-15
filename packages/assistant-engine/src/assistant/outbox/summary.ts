import type { AssistantStatusOutboxSummary } from '@murphai/operator-config/assistant-cli-contracts'
import { resolveAssistantOutboxSendingRecoveryAt } from './retry-policy.js'
import { listAssistantOutboxIntentsLocal } from './store.js'

export async function buildAssistantOutboxSummary(
  vault: string,
): Promise<AssistantStatusOutboxSummary> {
  const intents = await listAssistantOutboxIntentsLocal(vault)
  let oldestPendingAt: string | null = null
  let nextAttemptAt: string | null = null
  const now = new Date()

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
      intent.nextAttemptAt &&
      (!nextAttemptAt || intent.nextAttemptAt < nextAttemptAt)
    ) {
      nextAttemptAt = intent.nextAttemptAt
    }
    const sendingRecoveryAt = resolveAssistantOutboxSendingRecoveryAt(
      intent,
      now,
    )
    if (
      sendingRecoveryAt &&
      (!nextAttemptAt || sendingRecoveryAt < nextAttemptAt)
    ) {
      nextAttemptAt = sendingRecoveryAt
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
