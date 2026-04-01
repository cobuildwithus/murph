import type { AssistantProviderProgressEvent } from '../provider-registry.js'
import { normalizeNullableString } from '../shared.js'
import type { AssistantRunEvent } from './shared.js'

export const AUTO_REPLY_PROVIDER_HEARTBEAT_MS = 2 * 60 * 1000
export const AUTO_REPLY_PROVIDER_STALL_TIMEOUT_MS = 10 * 60 * 1000
export const AUTO_REPLY_PROVIDER_LONG_RUNNING_COMMAND_STALL_TIMEOUT_MS =
  150 * 60 * 1000
export const AUTO_REPLY_PROVIDER_STALLED_DETAIL =
  'assistant provider stalled without progress; will retry this capture.'

interface AssistantAutoReplyLongRunningOperation {
  key: string
  label: string
  startedAtMs: number
}

export interface AssistantProviderWatchdog {
  dispose: () => void
  normalizeError: (error: unknown) => unknown
  onProviderEvent: (event: AssistantProviderProgressEvent) => void
  signal: AbortSignal
}

export function createAssistantProviderWatchdog(input: {
  onEvent?: (event: AssistantRunEvent) => void
  providerHeartbeatMs?: number | null
  providerLongRunningCommandStallTimeoutMs?: number | null
  providerStallTimeoutMs?: number | null
  replyCaptureId: string
  signal?: AbortSignal
}): AssistantProviderWatchdog {
  const abortController = new AbortController()
  const cleanupAbortBridge = bridgeUpstreamAbortSignal(
    abortController,
    input.signal,
  )
  const startedAtMs = Date.now()
  const heartbeatMs = normalizeAutoReplyWatchdogMs(
    input.providerHeartbeatMs,
    AUTO_REPLY_PROVIDER_HEARTBEAT_MS,
  )
  const stallTimeoutMs = normalizeAutoReplyWatchdogMs(
    input.providerStallTimeoutMs,
    AUTO_REPLY_PROVIDER_STALL_TIMEOUT_MS,
  )
  const longRunningCommandStallTimeoutMs = Math.max(
    stallTimeoutMs,
    normalizeAutoReplyWatchdogMs(
      input.providerLongRunningCommandStallTimeoutMs,
      AUTO_REPLY_PROVIDER_LONG_RUNNING_COMMAND_STALL_TIMEOUT_MS,
    ),
  )
  let lastProgressAtMs = startedAtMs
  let stalled = false
  let activeLongRunningOperation: AssistantAutoReplyLongRunningOperation | null =
    null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = () => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }

  const resetStallTimer = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
    }
    const currentStallTimeoutMs = resolveAutoReplyProviderStallTimeoutMs({
      defaultTimeoutMs: stallTimeoutMs,
      longRunningCommandTimeoutMs: longRunningCommandStallTimeoutMs,
      operation: activeLongRunningOperation,
    })
    stallTimer = setTimeout(() => {
      if (abortController.signal.aborted) {
        return
      }

      stalled = true
      const stalledDetailSuffix = activeLongRunningOperation
        ? ` during ${activeLongRunningOperation.label}`
        : ''
      input.onEvent?.({
        type: 'capture.reply-progress',
        captureId: input.replyCaptureId,
        details: `assistant provider stalled after ${formatAutoReplyDuration(
          Date.now() - startedAtMs,
        )}${stalledDetailSuffix}; last provider activity ${formatAutoReplyDuration(
          Date.now() - lastProgressAtMs,
        )} ago; aborting and scheduling retry`,
        providerKind: 'status',
        providerState: 'running',
      })
      abortController.abort()
    }, currentStallTimeoutMs)
  }

  heartbeatTimer = setInterval(() => {
    if (abortController.signal.aborted) {
      return
    }

    const now = Date.now()
    if (now - lastProgressAtMs < heartbeatMs) {
      return
    }
    const longRunningDetail = formatAutoReplyLongRunningHeartbeatDetail(
      activeLongRunningOperation,
      now,
    )
    input.onEvent?.({
      type: 'capture.reply-progress',
      captureId: input.replyCaptureId,
      details: `assistant still running after ${formatAutoReplyDuration(
        now - startedAtMs,
      )}${longRunningDetail}; last provider activity ${formatAutoReplyDuration(
        now - lastProgressAtMs,
      )} ago`,
      providerKind: 'status',
      providerState: 'running',
    })
  }, heartbeatMs)
  resetStallTimer()

  return {
    signal: abortController.signal,
    onProviderEvent: (event) => {
      const eventReceivedAtMs = Date.now()
      lastProgressAtMs = eventReceivedAtMs
      activeLongRunningOperation = applyAssistantAutoReplyLongRunningOperationEvent(
        activeLongRunningOperation,
        event,
        eventReceivedAtMs,
      )
      resetStallTimer()

      const runEvent = createAssistantAutoReplyProgressEvent(
        input.replyCaptureId,
        event,
      )
      if (runEvent) {
        input.onEvent?.(runEvent)
      }
    },
    normalizeError: (error) =>
      stalled ? markAssistantProviderStalled(error) : error,
    dispose: () => {
      clearTimers()
      cleanupAbortBridge()
    },
  }
}

function createAssistantAutoReplyProgressEvent(
  captureId: string,
  event: AssistantProviderProgressEvent,
): AssistantRunEvent | null {
  if (event.kind === 'message') {
    return null
  }

  return {
    type: 'capture.reply-progress',
    captureId,
    details: event.text,
    providerKind: event.kind,
    providerState: event.state,
  }
}

function bridgeUpstreamAbortSignal(
  controller: AbortController,
  signal?: AbortSignal,
): () => void {
  if (!signal) {
    return () => {}
  }

  const abort = () => controller.abort()
  if (signal.aborted) {
    controller.abort()
    return () => {}
  }

  signal.addEventListener('abort', abort, { once: true })
  return () => {
    signal.removeEventListener('abort', abort)
  }
}

function markAssistantProviderStalled(error: unknown): unknown {
  if (!error || typeof error !== 'object') {
    return error
  }

  const currentContext =
    'context' in error &&
    (error as { context?: unknown }).context &&
    typeof (error as { context?: unknown }).context === 'object' &&
    !Array.isArray((error as { context?: unknown }).context)
      ? ((error as { context?: Record<string, unknown> }).context ?? {})
      : {}

  ;(error as { context?: Record<string, unknown> }).context = {
    ...currentContext,
    providerStalled: true,
    retryable: true,
  }
  return error
}

function formatAutoReplyDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes <= 0) {
    return `${seconds}s`
  }

  if (seconds === 0) {
    return `${minutes}m`
  }

  return `${minutes}m ${seconds}s`
}

function resolveAutoReplyProviderStallTimeoutMs(input: {
  defaultTimeoutMs: number
  longRunningCommandTimeoutMs: number
  operation: AssistantAutoReplyLongRunningOperation | null
}): number {
  return input.operation
    ? input.longRunningCommandTimeoutMs
    : input.defaultTimeoutMs
}

function formatAutoReplyLongRunningHeartbeatDetail(
  operation: AssistantAutoReplyLongRunningOperation | null,
  nowMs: number,
): string {
  if (!operation) {
    return ''
  }

  return `; ${operation.label} active for ${formatAutoReplyDuration(
    nowMs - operation.startedAtMs,
  )}`
}

function normalizeAutoReplyWatchdogMs(
  value: number | null | undefined,
  fallback: number,
): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return fallback
  }

  return Math.max(1, Math.trunc(value))
}

function applyAssistantAutoReplyLongRunningOperationEvent(
  current: AssistantAutoReplyLongRunningOperation | null,
  event: AssistantProviderProgressEvent,
  eventReceivedAtMs: number,
): AssistantAutoReplyLongRunningOperation | null {
  const matchedOperation = matchAssistantAutoReplyLongRunningOperation(event)
  if (!matchedOperation) {
    return current
  }

  if (event.state === 'completed') {
    if (!current) {
      return null
    }

    return current.key === matchedOperation.key || current.label === matchedOperation.label
      ? null
      : current
  }

  return {
    ...matchedOperation,
    startedAtMs: eventReceivedAtMs,
  }
}

function matchAssistantAutoReplyLongRunningOperation(
  event: AssistantProviderProgressEvent,
): Omit<AssistantAutoReplyLongRunningOperation, 'startedAtMs'> | null {
  if (event.kind === 'command') {
    return matchAssistantAutoReplyLongRunningCommand(event)
  }

  if (event.kind === 'tool') {
    return matchAssistantAutoReplyLongRunningTool(event)
  }

  return null
}

function matchAssistantAutoReplyLongRunningCommand(
  event: Pick<AssistantProviderProgressEvent, 'id' | 'text'>,
): Omit<AssistantAutoReplyLongRunningOperation, 'startedAtMs'> | null {
  const commandText = normalizeNullableString(
    event.text.replace(/^\$\s*/u, ''),
  )
  if (!commandText) {
    return null
  }

  const cliCommandMatch = /(?:^|\s)(?:[^\s]+\/)?(?:vault-cli|murph)\s+(research|deepthink)(?:\s|$)/iu.exec(
    commandText,
  )
  if (cliCommandMatch) {
    const commandName = cliCommandMatch[1]!.toLowerCase()
    return {
      key: event.id ?? `command:${commandName}`,
      label: `${commandName} command`,
    }
  }

  if (/(?:^|\s)(?:[^\s]+\/)?(?:pnpm|npm|yarn)\s+review:gpt(?:\s|$)/iu.test(commandText)) {
    return {
      key: event.id ?? 'command:review:gpt',
      label: 'review:gpt run',
    }
  }

  return /\breview:gpt\b/iu.test(commandText)
    ? {
        key: event.id ?? 'command:review:gpt',
        label: 'review:gpt run',
      }
    : null
}

function matchAssistantAutoReplyLongRunningTool(
  event: Pick<AssistantProviderProgressEvent, 'id' | 'text'>,
): Omit<AssistantAutoReplyLongRunningOperation, 'startedAtMs'> | null {
  const toolText = normalizeNullableString(event.text)
  if (!toolText || !/^tool\b/iu.test(toolText)) {
    return null
  }

  if (/\bdeepthink\b/iu.test(toolText)) {
    return {
      key: event.id ?? 'tool:deepthink',
      label: 'deepthink tool',
    }
  }

  return /\bresearch\b/iu.test(toolText)
    ? {
        key: event.id ?? 'tool:research',
        label: 'research tool',
      }
    : null
}
