import { clinicalChangeDeliveryKey } from '@murphai/hosted-execution/clinical-records-boundary'
import { clinicalChangeRunRef } from '@murphai/core'
import type { ClinicalNotificationDecision } from '@murphai/hosted-execution/clinical-records'
import { assistantCronJobSchema } from '@murphai/operator-config/assistant-cli-contracts'
import { createAssistantOutboxIntent } from '../outbox.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { withAssistantCronWriteLock } from './locking.js'
import { readAssistantCronStore, sortAssistantCronJobs, writeAssistantCronStore } from './store.js'

/** Stages one notice intent or detail job on the verified thread. Staging leaves Web coverage open. */
export async function queueClinicalChange(input: {
  vault: string
  runId: string
  occurredAt: string
  decision: ClinicalNotificationDecision
}) {
  const { decision, vault } = input
  if (decision.mode === 'off') return null
  const receiptRef = clinicalChangeRunRef(input.runId)
  const deliveryKey = clinicalChangeDeliveryKey(input.runId, decision.mode)
  if (decision.mode === 'notice') {
    const intent = await createAssistantOutboxIntent({
      vault, createdAt: input.occurredAt, channel: 'linq', threadId: decision.threadId, threadIsDirect: true,
      bindingDelivery: { kind: 'thread', target: decision.threadId },
      deliveryIdempotencyKey: deliveryKey, dedupeToken: deliveryKey, turnTrigger: 'automation-cron',
      turnId: `turn_clinical_${receiptRef}`, sessionId: `session_clinical_${receiptRef}`,
      message: 'New records came in. Want me to go through them?',
    })
    return { intentId: intent.intentId }
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
      schema: 'murph.assistant-cron-job.v1', jobId, name: 'Daily records update', enabled: true, keepAfterRun: true,
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
  return { intentId: null }
}
