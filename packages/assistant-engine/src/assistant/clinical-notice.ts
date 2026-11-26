import { clinicalChangeDeliveryKey, CLINICAL_REPLY_DEFERRED } from '@murphai/hosted-execution/clinical-records-boundary'
import { clinicalChangeRunRef } from '@murphai/core'
import type { ClinicalNotificationDecision } from '@murphai/hosted-execution/clinical-records'
import { createAssistantOutboxIntent, saveAssistantOutboxIntentIfUnchanged } from './outbox.js'

export async function queueClinicalNotice(input: {
  vault: string
  runId: string
  occurredAt: string
  decision: ClinicalNotificationDecision
}) {
  const { decision, vault } = input
  if (decision.mode === 'off') return null
  const receiptRef = clinicalChangeRunRef(input.runId)
  const deliveryKey = clinicalChangeDeliveryKey(input.runId)
  const intent = await createAssistantOutboxIntent({
    vault, createdAt: input.occurredAt, channel: 'linq', threadId: decision.threadId, threadIsDirect: true,
    bindingDelivery: { kind: 'thread', target: decision.threadId },
    deliveryIdempotencyKey: deliveryKey, dedupeToken: deliveryKey, turnTrigger: 'automation-cron',
    turnId: `turn_clinical_${receiptRef}`, sessionId: `session_clinical_${receiptRef}`,
    message: 'New records came in. Want me to go through them?',
  })
  const resumed = await resumeClinicalIntent(vault, intent, input.occurredAt)
  return resumed.intentId
}

async function resumeClinicalIntent(vault: string, intent: Awaited<ReturnType<typeof createAssistantOutboxIntent>>, now: string) {
  // A restored sending claim may predate provider entry. Web's dispatch fence
  // either permits the original handoff or retires it without another provider call.
  const deferred = ['failed', 'retryable'].includes(intent.status) && intent.lastError?.code === CLINICAL_REPLY_DEFERRED
  if (!deferred && intent.status !== 'sending') return intent
  const resumed = await saveAssistantOutboxIntentIfUnchanged({ vault, expectedStatus: intent.status,
    expectedDedupeKey: intent.dedupeKey, expectedUpdatedAt: intent.updatedAt,
    intent: { ...intent, status: 'pending', lastError: null, nextAttemptAt: now, updatedAt: now } })
  return resumed.intent
}
