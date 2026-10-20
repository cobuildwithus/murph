import type { AssistantExecutionContext } from './execution-context.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import type { AssistantProviderFinalResponseCompletion } from './providers/types.js'

export const HOSTED_ASSISTANT_TURN_TIMING_SCHEMA =
  'murph.assistant-turn-timing.v1'

export const HOSTED_ASSISTANT_TURN_TIMING_TYPE =
  'assistant.turn.timing'

export type HostedAssistantTurnTimingStage =
  | 'provider-result-returned'
  | 'usage-recorded'
  | 'turn-artifacts-finalized'
  | 'reply-dispatched'
  | 'scan-state-persisted'
  | 'automation-pass-finished'
  | 'foreground-delivery-phase-started'
  | 'foreground-delivery-phase-finished'

export type HostedAssistantTurnTimingProviderOutcomeKind =
  | 'failed_terminal'
  | 'succeeded'

/**
 * Whether the selected provider result carried a Murph-local observation of
 * Codex's final per-response completion notification. `absent` is never
 * emitted; a missing field means the producer supplied no observation.
 */
export type HostedAssistantTurnTimingFinalResponseCompletion =
  | 'invalid'
  | 'observed'
  | 'superseded'
  | 'unavailable'

export type HostedAssistantTurnTimingDeliveryOutcomeKind =
  | 'failed'
  | 'not-requested'
  | 'queued'
  | 'sent'

export interface HostedAssistantTurnTimingTraceInput {
  currentTurnDeliveryIntentCount?: number | null
  deliveryAttempted?: boolean | null
  deliveryIntentId?: string | null
  deliveryIntentPresent?: boolean | null
  deliveryOutcomeKind?: HostedAssistantTurnTimingDeliveryOutcomeKind | null
  elapsedMs?: number | null
  executionContext?: AssistantExecutionContext | null
  finalReplySelected?: boolean | null
  finalResponseCompletedToProviderResultMs?: number | null
  finalResponseCompletion?: HostedAssistantTurnTimingFinalResponseCompletion | null
  foregroundAssistantPass?: boolean | null
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  providerOutcomeKind?: HostedAssistantTurnTimingProviderOutcomeKind | null
  providerRequestElapsedMs?: number | null
  providerRequestOrdinal?: number | null
  providerResultAtEpochMs?: number | null
  scanStateChanged?: boolean | null
  sinceProviderResultMs?: number | null
  stage: HostedAssistantTurnTimingStage
  stepElapsedMs?: number | null
}

export function emitHostedAssistantTurnTimingTrace(
  input: HostedAssistantTurnTimingTraceInput,
): void {
  const onTraceEvent = input.onTraceEvent
  if (!onTraceEvent || input.executionContext?.hosted == null) {
    return
  }

  try {
    onTraceEvent({
      codexThreadId: null,
      rawEvent: buildHostedAssistantTurnTimingRawEvent(input),
      updates: [],
    })
  } catch {
    // Diagnostic trace hooks must not block assistant turns.
  }
}

function buildHostedAssistantTurnTimingRawEvent(
  input: HostedAssistantTurnTimingTraceInput,
): Record<string, boolean | number | string | null> {
  const rawEvent: Record<string, boolean | number | string | null> = {
    schema: HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
    type: HOSTED_ASSISTANT_TURN_TIMING_TYPE,
    turnTimingStage: input.stage,
  }

  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'currentTurnDeliveryIntentCount',
    input.currentTurnDeliveryIntentCount,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'deliveryAttempted',
    input.deliveryAttempted,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingDeliveryIntentId',
    input.deliveryIntentId,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'deliveryIntentPresent',
    input.deliveryIntentPresent,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'deliveryOutcomeKind',
    input.deliveryOutcomeKind,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'finalReplySelected',
    input.finalReplySelected,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingFinalResponseCompletion',
    input.finalResponseCompletion,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'foregroundAssistantPass',
    input.foregroundAssistantPass,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'providerOutcomeKind',
    input.providerOutcomeKind,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'providerRequestOrdinal',
    input.providerRequestOrdinal,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingProviderResultAtEpochMs',
    input.providerResultAtEpochMs,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'scanStateChanged',
    input.scanStateChanged,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingElapsedMs',
    input.elapsedMs,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingProviderRequestElapsedMs',
    input.providerRequestElapsedMs,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingFinalResponseCompletedToProviderResultMs',
    input.finalResponseCompletedToProviderResultMs,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingSinceProviderResultMs',
    input.sinceProviderResultMs,
  )
  maybeAssignHostedAssistantTurnTimingValue(
    rawEvent,
    'turnTimingStepElapsedMs',
    input.stepElapsedMs,
  )

  return rawEvent
}

/**
 * Reply-dispatch anchors for post-result delivery timing. The epoch anchor is
 * the exact provider-result instant (never clamped). The completion interval is
 * monotonic and ends at the same instant; any non-finite or negative raw value
 * is `invalid`, never rounded to zero.
 */
export function buildHostedAssistantFinalResponseCompletionTiming(input: {
  completion: AssistantProviderFinalResponseCompletion | undefined
  /** Only a selected final reply queues the intent these anchors describe. */
  finalReplySelected: boolean
  providerResultAtEpochMs: number | null
  providerResultAtMonotonicMs: number | null
}): Pick<
  HostedAssistantTurnTimingTraceInput,
  | 'finalResponseCompletedToProviderResultMs'
  | 'finalResponseCompletion'
  | 'providerResultAtEpochMs'
> {
  if (
    !input.finalReplySelected
    || input.providerResultAtEpochMs === null
    || !Number.isSafeInteger(input.providerResultAtEpochMs)
    || input.providerResultAtEpochMs < 0
  ) {
    return {}
  }
  const anchor = { providerResultAtEpochMs: input.providerResultAtEpochMs }
  if (!input.completion) {
    return anchor
  }
  if (input.completion.kind !== 'observed') {
    return { ...anchor, finalResponseCompletion: input.completion.kind }
  }
  const rawElapsedMs = input.providerResultAtMonotonicMs === null
    ? Number.NaN
    : input.providerResultAtMonotonicMs - input.completion.observedAtMonotonicMs
  return Number.isFinite(rawElapsedMs) && rawElapsedMs >= 0
    ? {
        ...anchor,
        finalResponseCompletedToProviderResultMs: Math.round(rawElapsedMs),
        finalResponseCompletion: 'observed',
      }
    : { ...anchor, finalResponseCompletion: 'invalid' }
}

function maybeAssignHostedAssistantTurnTimingValue(
  target: Record<string, boolean | number | string | null>,
  key: string,
  value: boolean | number | string | null | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}
