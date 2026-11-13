import type { AssistantCronRunRecord } from '@murphai/operator-config/assistant-cli-contracts'
import { sanitizeAssistantAutomationFailureText } from '../automation/failure-observability.js'
import { readAssistantOutboxIntent } from '../outbox.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { readAssistantCronCanonicalRuntimeStore, type AssistantCronCanonicalRuntimeState } from './runtime-state.js'
import { readAssistantCronRuns } from './store.js'

const HISTORY_LIMIT = 10

type ExecutionPhase = 'idle' | 'running' | 'retrying' | 'waiting_occurrence' | 'waiting_delivery'
type RunOutcome = AssistantCronRunRecord['outcome']

// Model-facing and re-sent on every later call: absent fields are null, and
// a reason that only restates its outcome is omitted.
export type AssistantAutomationExecutionInspection =
  | { status: 'unavailable' }
  | {
      status: 'available'
      current: {
        phase: ExecutionPhase
        occurrenceAt?: string
        startedAt?: string
        retryAt?: string
        error?: string
      }
      delivery?: {
        status: string
        attemptCount: number
        lastAttemptAt?: string
        nextAttemptAt?: string
        sentAt?: string
        error?: string
      }
      recentRuns: Array<{
        finishedAt: string
        occurrenceAt?: string
        outcome: RunOutcome
        reason?: string
        error?: string
      }>
      historyTruncated?: true
      nextStep: string
      interpretation: string
    }

type AvailableInspection = Extract<AssistantAutomationExecutionInspection, { status: 'available' }>

// Reasons that only restate a successful or queued outcome carry no extra fact.
const DEFAULT_RUN_REASONS: Partial<Record<RunOutcome, readonly string[]>> = {
  delivered: ['sent', 'delivery_sent'],
  delivery_pending: ['delivery_pending'],
  no_op: ['no_delivery'],
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
    const current: AvailableInspection['current'] = {
      phase,
      ...(state?.pendingOccurrenceAt ? { occurrenceAt: state.pendingOccurrenceAt } : {}),
      ...(state?.runningAt ? { startedAt: state.runningAt } : {}),
      ...(state?.retryAfterAt ? { retryAt: state.retryAfterAt } : {}),
      ...withDetail('error', state?.lastError),
    }
    const delivery = intent ? projectDelivery(intent) : undefined
    const recentRuns = runs.slice(0, HISTORY_LIMIT).map(projectRun)
    return {
      status: 'available',
      current,
      ...(delivery ? { delivery } : {}),
      recentRuns,
      ...(runs.length > HISTORY_LIMIT ? { historyTruncated: true as const } : {}),
      nextStep: readInspectionNextStep(phase, runs[0]?.outcome),
      interpretation: readInspectionInterpretation({ current, delivery, recentRuns }),
    }
  } catch {
    return { status: 'unavailable' }
  }
}

function projectDelivery(
  intent: NonNullable<Awaited<ReturnType<typeof readAssistantOutboxIntent>>>,
): NonNullable<AvailableInspection['delivery']> {
  return {
    status: intent.status,
    attemptCount: intent.attemptCount,
    ...(intent.lastAttemptAt ? { lastAttemptAt: intent.lastAttemptAt } : {}),
    ...(intent.nextAttemptAt ? { nextAttemptAt: intent.nextAttemptAt } : {}),
    ...(intent.sentAt ? { sentAt: intent.sentAt } : {}),
    ...withDetail('error', intent.lastError?.message),
  }
}

function projectRun(run: AssistantCronRunRecord): AvailableInspection['recentRuns'][number] {
  return {
    finishedAt: run.finishedAt,
    ...(run.scheduledOccurrenceAt ? { occurrenceAt: run.scheduledOccurrenceAt } : {}),
    outcome: run.outcome,
    ...(isDefaultRunReason(run.outcome, run.reason) ? {} : withDetail('reason', run.reason)),
    ...withDetail('error', run.error),
  }
}

function withDetail<K extends 'error' | 'reason'>(
  key: K,
  value: string | null | undefined,
): Partial<Record<K, string>> {
  const detail = safeDetail(value)
  const result: Partial<Record<K, string>> = {}
  if (detail !== null) result[key] = detail
  return result
}

function isDefaultRunReason(outcome: RunOutcome, reason: string | null | undefined): boolean {
  return !reason || reason === outcome || DEFAULT_RUN_REASONS[outcome]?.includes(reason) === true
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

function isFailureOutcome(outcome: RunOutcome | undefined): boolean {
  return outcome === 'failed' || outcome === 'expired'
}

function readInspectionNextStep(phase: ExecutionPhase, outcome: RunOutcome | undefined): string {
  if (phase !== 'idle') {
    return 'Explain the current work and any recorded retry time or outstanding delivery status. Do not promise delivery or create a replacement while work is pending.'
  }
  if (isFailureOutcome(outcome)) {
    return 'Explain the recorded failure without inventing a cause. Say it may not have gone out, and include the option to reschedule the missed occurrence if it is still wanted. Do not change or recreate it during inspection.'
  }
  return 'Explain the recorded outcome and use the stored schedule and occurrence projection for future timing.'
}

// Only the rules that apply to the outcomes and state actually returned.
function readInspectionInterpretation(input: Pick<AvailableInspection, 'current' | 'delivery' | 'recentRuns'>): string {
  const { current, delivery, recentRuns } = input
  const outcomes = new Set(recentRuns.map((run) => run.outcome))
  const failure = recentRuns.some((run) => isFailureOutcome(run.outcome))
  const pendingWork = current.phase !== 'idle' || delivery !== undefined
  const sentences = [
    recentRuns.length > 0 && 'This is retained attempt history, newest first, not a complete lifetime history.',
    recentRuns.some((run) => run.outcome !== 'delivered' && run.outcome !== 'delivery_pending')
      && 'A failed, expired, skipped_gate, or no_op run is not delivery confirmation.',
    failure && 'After failure, say the message may not have gone out; failure alone proves neither sending nor that nothing was sent.',
    (outcomes.has('delivery_pending') || delivery !== undefined)
      && 'delivery_pending means execution queued a message; use the outstanding delivery status when present.',
    'Only delivered or delivery.status=sent confirms sending, not reading.',
    (failure || pendingWork)
      && 'A retry is scheduled only when current.retryAt or delivery.nextAttemptAt is present; a running attempt may still finish.',
    current.phase === 'idle' && isFailureOutcome(recentRuns[0]?.outcome)
      && 'For an idle active recurrence, use occurrenceProjection for the next scheduled occurrence.',
    'Do not treat a consumed occurrence, an empty retained history, or a null next occurrence as proof of delivery.',
    (recentRuns.some((run) => run.outcome !== 'delivered' || run.reason || run.error)
      || delivery !== undefined || current.error !== undefined)
      && 'Translate recorded reasons into plain language; do not quote internal codes or diagnostics.',
  ]
  return sentences.filter((sentence) => typeof sentence === 'string').join(' ')
}
