import type { AssistantCronRunRecord } from '@murphai/operator-config/assistant-cli-contracts'
import { sanitizeAssistantAutomationFailureText } from '../automation/failure-observability.js'
import { readAssistantOutboxIntent } from '../outbox.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { readAssistantCronCanonicalRuntimeStore, type AssistantCronCanonicalRuntimeState } from './runtime-state.js'
import { readAssistantCronRuns } from './store.js'

const HISTORY_LIMIT = 10

type ExecutionPhase = 'idle' | 'running' | 'retrying' | 'waiting_occurrence' | 'waiting_delivery'

export type AssistantAutomationExecutionInspection =
  | { status: 'unavailable' }
  | {
      status: 'available'
      current: {
        phase: ExecutionPhase
        occurrenceAt: string | null
        startedAt: string | null
        retryAt: string | null
        error: string | null
      }
      delivery: {
        status: string
        attemptCount: number
        lastAttemptAt: string | null
        nextAttemptAt: string | null
        sentAt: string | null
        error: string | null
      } | null
      recentRuns: Array<{
        startedAt: string
        finishedAt: string
        occurrenceAt: string | null
        outcome: AssistantCronRunRecord['outcome']
        reason: string
        error: string | null
      }>
      historyLimit: number
      historyTruncated: boolean
      nextStep: string
      interpretation: string
    }

// Read only this automation's retained journal and its exact outstanding delivery.
// Never return prompts, responses, recipients, runtime paths, or provider diagnostics.
export async function getAssistantCronAutomationInspection(
  vault: string,
  automationId: string,
): Promise<AssistantAutomationExecutionInspection> {
  try {
    const paths = resolveAssistantStatePaths(vault)
    const [runtime, runs] = await Promise.all([
      readAssistantCronCanonicalRuntimeStore(paths, { reclaimStaleRunningClaims: false }),
      readAssistantCronRuns(paths, automationId),
    ])
    const state = runtime.jobs.find((job) => job.jobId === automationId)?.state
    const pendingDeliveryId = state?.pendingDeliveryIntentId
    const intent = pendingDeliveryId
      ? await readAssistantOutboxIntent(vault, pendingDeliveryId)
      : null
    const phase = readExecutionPhase(state)
    return {
      status: 'available',
      current: {
        phase,
        occurrenceAt: state?.pendingOccurrenceAt ?? null,
        startedAt: state?.runningAt ?? null,
        retryAt: state?.retryAfterAt ?? null,
        error: safeDetail(state?.lastError),
      },
      delivery: intent ? {
        status: intent.status,
        attemptCount: intent.attemptCount,
        lastAttemptAt: intent.lastAttemptAt,
        nextAttemptAt: intent.nextAttemptAt,
        sentAt: intent.sentAt,
        error: safeDetail(intent.lastError?.message),
      } : null,
      recentRuns: runs.slice(0, HISTORY_LIMIT).map((run) => ({
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        occurrenceAt: run.scheduledOccurrenceAt ?? null,
        outcome: run.outcome,
        reason: safeDetail(run.reason) ?? run.outcome,
        error: safeDetail(run.error),
      })),
      historyLimit: HISTORY_LIMIT,
      historyTruncated: runs.length > HISTORY_LIMIT,
      nextStep: readInspectionNextStep(phase, runs[0]?.outcome, runs[0]?.reason),
      interpretation: 'This is retained attempt history, newest first, not a complete lifetime history. '
        + 'A failed, expired, skipped_gate, or no_op run is not delivery confirmation. Failure alone proves neither sending nor that nothing was sent. '
        + 'delivery_pending means execution queued a message; use the outstanding delivery status when present. '
        + 'delivered or delivery.status=sent confirms sending, not reading. The bounded latestOccurrence receipt can also confirm complete or partial sending from persisted dispatch evidence; neither confirms receipt on the phone. '
        + 'A retry is scheduled only when current.retryAt or delivery.nextAttemptAt is present; a running attempt may still finish. '

        + 'For an idle active recurrence, use occurrenceProjection for the next scheduled occurrence. '
        + 'Do not treat a consumed occurrence, an empty retained history, or a null next occurrence as proof of delivery. '
        + 'Translate recorded reasons into plain language; do not quote internal codes or diagnostics.',
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function safeDetail(value: string | null | undefined): string | null {
  return value ? sanitizeAssistantAutomationFailureText(value).slice(0, 512) : null
}

function readExecutionPhase(state: AssistantCronCanonicalRuntimeState | undefined): ExecutionPhase {
  if (state?.pendingDeliveryIntentId) return 'waiting_delivery'
  if (state?.runningAt) return 'running'
  if (state?.retryAfterAt) return 'retrying'
  if (state?.pendingOccurrenceAt) return 'waiting_occurrence'
  return 'idle'
}

function readInspectionNextStep(phase: ExecutionPhase, outcome: AssistantCronRunRecord['outcome'] | undefined, reason: string | undefined): string {
  if (phase !== 'idle') {
    return 'Explain the current work and any recorded retry time or outstanding delivery status. Do not promise delivery or create a replacement while work is pending.'
  }
  if (outcome === 'failed' || outcome === 'expired') {
    return reason === 'delivery_failed_partial'
      ? 'Explain that part of the message was sent before the remaining delivery failed. Receipt on the phone cannot be confirmed. Do not change or recreate it during inspection.'
      : 'Explain the recorded failure without inventing a cause. Use latestOccurrence for any known sending evidence, and include the option to reschedule the missed occurrence if it is still wanted. Do not change or recreate it during inspection.'
  }
  return 'Explain the recorded outcome and use the stored schedule and occurrence projection for future timing. Missing retained history is not proof of delivery.'
}
