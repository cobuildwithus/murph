import type { AssistantProviderTraceEvent } from '../provider-traces.js'

export const ASSISTANT_PROVIDER_TURN_TIMING_TRACE_SCHEMA =
  'murph.assistant-provider-turn-timing.v1'
export const ASSISTANT_PROVIDER_TURN_TIMING_TRACE_TYPE =
  'assistant.provider.turn_timing'

export type AssistantProviderTurnTimingStage =
  | 'attempt-env-built'
  | 'attempt-failed-recorded'
  | 'attempt-observability-recorded'
  | 'attempt-plan-built'
  | 'attempt-started-recorded'
  | 'attempt-succeeded-recorded'
  | 'codex-app-server-returned'
  | 'codex-attempt-finished'
  | 'codex-input-built'
  | 'codex-prompt-built'
  | 'codex-result-built'
  | 'codex-usage-extracted'
  | 'execution-plan-built'
  | 'provider-plan-recorded'
  | 'provider-plan-trace-emitted'
  | 'provider-request-planned'
  | 'tool-issues-recorded'

export type AssistantProviderTurnTimingEmitter = (
  stage: AssistantProviderTurnTimingStage,
  details?: {
    providerTurnActionCount?: number | null
    providerTurnOk?: boolean | null
    providerTurnRawEventCount?: number | null
    providerTurnUsagePresent?: boolean | null
  },
) => void

export function createAssistantProviderTurnTimingEmitter(
  onTraceEvent?: ((event: AssistantProviderTraceEvent) => void) | null,
): AssistantProviderTurnTimingEmitter {
  const totalStartedAt = Date.now()
  let stageStartedAt = totalStartedAt

  return (stage, details = {}) => {
    if (!onTraceEvent) {
      return
    }

    const now = Date.now()
    const elapsedMs = Math.max(0, now - stageStartedAt)
    const totalElapsedMs = Math.max(0, now - totalStartedAt)
    stageStartedAt = now

    try {
      onTraceEvent({
        providerSessionId: null,
        rawEvent: {
          schema: ASSISTANT_PROVIDER_TURN_TIMING_TRACE_SCHEMA,
          type: ASSISTANT_PROVIDER_TURN_TIMING_TRACE_TYPE,
          providerTurnActionCount:
            normalizeProviderTurnNonnegativeNumber(details.providerTurnActionCount),
          providerTurnElapsedMs: elapsedMs,
          providerTurnOk: typeof details.providerTurnOk === 'boolean'
            ? details.providerTurnOk
            : undefined,
          providerTurnRawEventCount:
            normalizeProviderTurnNonnegativeNumber(details.providerTurnRawEventCount),
          providerTurnStage: stage,
          providerTurnTotalElapsedMs: totalElapsedMs,
          providerTurnUsagePresent:
            typeof details.providerTurnUsagePresent === 'boolean'
              ? details.providerTurnUsagePresent
              : undefined,
        },
        updates: [],
      })
    } catch {
      // Timing traces are diagnostic-only and must never block assistant turns.
    }
  }
}

function normalizeProviderTurnNonnegativeNumber(
  value: number | null | undefined,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}
