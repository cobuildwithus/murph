import { MAX_ASSISTANT_REPLY_BUBBLES } from '../reply-bubbles.js'
import { clinicalChangeDeliveryKey, CLINICAL_REPLY_DEFERRED } from '@murphai/hosted-execution/clinical-records-boundary'
import { clinicalChangeRunRef } from '@murphai/core'
import type { ClinicalNotificationDecision } from '@murphai/hosted-execution/clinical-records'
import { assistantCronJobSchema, type AssistantOutboxIntent } from '@murphai/operator-config/assistant-cli-contracts'
import { readAssistantOutboxIntentByDeliveryIdempotencyKey, saveAssistantOutboxIntentIfUnchanged } from '../outbox.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { withAssistantCronWriteLock } from './locking.js'
import { readAssistantCronStore, sortAssistantCronJobs, writeAssistantCronStore } from './store.js'

/** Stages one records review job on the verified thread. Staging leaves Web coverage open. */
export async function queueClinicalChange(input: {
  vault: string
  runId: string
  occurredAt: string
  decision: ClinicalNotificationDecision
}) {
  const { decision, vault } = input
  if (decision.mode === 'off') return null
  const receiptRef = clinicalChangeRunRef(input.runId)
  const deliveryKey = clinicalChangeDeliveryKey(input.runId)
  if (decision.savedTurnId) {
    const root = deliveryKey + ':' + decision.savedTurnId
    const lookup = (key: string) => readAssistantOutboxIntentByDeliveryIdempotencyKey({ vault, deliveryIdempotencyKey: key })
    const final = await lookup(root)
    if (!final || final.turnId !== decision.savedTurnId) {
      return { savedReplyResult: { turnId: decision.savedTurnId, status: 'missing' as const } }
    }
    const leading = await Promise.all(Array.from({ length: MAX_ASSISTANT_REPLY_BUBBLES - 1 }, (_, i) => lookup(root + ':bubble:' + i)))
    const deliveryIntentIds = []
    for (const intent of [...leading, final]) {
      if (!intent || intent.turnId !== decision.savedTurnId) continue
      const current = await resumeClinicalIntent(vault, intent, input.occurredAt)
      if (['pending', 'retryable', 'sending', 'awaiting_approval'].includes(current.status)) deliveryIntentIds.push(current.intentId)
    }
    return deliveryIntentIds.length ? { deliveryIntentIds }
      : { savedReplyResult: { turnId: decision.savedTurnId, status: 'drained' as const } }
  }
  const jobId = `cron_clinical_change_${receiptRef}`
  const paths = resolveAssistantStatePaths(vault)
  await withAssistantCronWriteLock(paths, async () => {
    const store = await readAssistantCronStore(paths)
    const existing = store.jobs.find(job => job.jobId === jobId)
    if (existing) {
      if (existing.clinicalChange?.runId !== input.runId || existing.target.threadId !== decision.threadId) {
        throw new Error('Clinical notification occurrence conflicts with its private job.')
      }
      return
    }
    const job = assistantCronJobSchema.parse({
      schema: 'murph.assistant-cron-job.v1', jobId, name: 'Daily records update', enabled: true, keepAfterRun: false,
      clinicalChange: { runId: input.runId, receiptRef },
      prompt: `Review the private clinical change receipts for run reference ${receiptRef}. Use your private vault tools to explain the changes to the member.`,
      schedule: { kind: 'at', at: input.occurredAt },
      target: { alias: null, sessionId: null, channel: 'linq', threadId: decision.threadId, threadIsDirect: true,
        deliveryTarget: null, deliverySource: null, identityId: null, participantId: null },
      createdAt: input.occurredAt, updatedAt: input.occurredAt,
      state: { nextRunAt: input.occurredAt, lastRunAt: null, lastSucceededAt: null, lastFailedAt: null,
        consecutiveFailures: 0, lastError: null, runningAt: null, runningPid: null },
    })
    await writeAssistantCronStore(paths, { ...store, jobs: sortAssistantCronJobs([...store.jobs, job]) })
  })
  return { deliveryIntentIds: [] }
}

async function resumeClinicalIntent(vault: string, intent: AssistantOutboxIntent, now: string) {
  // A restored sending claim may predate provider entry. Web's per-bubble fence
  // either permits the original handoff or retires it without another provider call.
  const deferred = ['failed', 'retryable'].includes(intent.status) && intent.lastError?.code === CLINICAL_REPLY_DEFERRED
  if (!deferred && intent.status !== 'sending') return intent
  const resumed = await saveAssistantOutboxIntentIfUnchanged({ vault, expectedStatus: intent.status,
    expectedDedupeKey: intent.dedupeKey, expectedUpdatedAt: intent.updatedAt,
    intent: { ...intent, status: 'pending', lastError: null, nextAttemptAt: now, updatedAt: now } })
  return resumed.intent
}
