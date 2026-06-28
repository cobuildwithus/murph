import type { AssistantExecutionContext } from './execution-context.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'

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

export type HostedAssistantTurnTimingDeliveryOutcomeKind =
  | 'failed'
  | 'not-requested'
  | 'queued'
  | 'sent'

export interface HostedAssistantTurnTimingTraceInput {
  currentTurnDeliveryIntentCount?: number | null
  deliveryAttempted?: boolean | null
  deliveryIntentPresent?: boolean | null
  deliveryOutcomeKind?: HostedAssistantTurnTimingDeliveryOutcomeKind | null
  elapsedMs?: number | null
  executionContext?: AssistantExecutionContext | null
  finalReplySelected?: boolean | null
  foregroundAssistantPass?: boolean | null
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null
  providerOutcomeKind?: HostedAssistantTurnTimingProviderOutcomeKind | null
  providerRequestElapsedMs?: number | null
  providerRequestOrdinal?: number | null
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

function maybeAssignHostedAssistantTurnTimingValue(
  target: Record<string, boolean | number | string | null>,
  key: string,
  value: boolean | number | string | null | undefined,
): void {
  if (value !== undefined) {
    target[key] = value
  }
}
