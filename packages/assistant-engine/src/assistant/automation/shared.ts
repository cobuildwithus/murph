import type {
  AssistantAutomationCursor,
  AssistantAutomationState,
} from '@murphai/operator-config/assistant-cli-contracts'

type ShutdownTimer = ReturnType<typeof setTimeout> | number

export interface AssistantRunEvent {
  captureId?: string
  details?: string
  errorCode?: string
  providerKind?:
    | 'command'
    | 'file'
    | 'message'
    | 'plan'
    | 'reasoning'
    | 'search'
    | 'status'
    | 'tool'
  providerState?: 'completed' | 'running'
  safeDetails?: string
  tools?: string[]
  type:
    | 'capture.failed'
    | 'capture.noop'
    | 'capture.reply-progress'
    | 'capture.reply-started'
    | 'capture.replied'
    | 'capture.reply-failed'
    | 'capture.reply-skipped'
    | 'capture.routed'
    | 'capture.skipped'
    | 'daemon.failed'
    | 'reply.scan.started'
    | 'scan.started'
}

export interface AssistantInboxScanResult {
  considered: number
  failed: number
  nextWakeAt: string | null
  noAction: number
  routed: number
  skipped: number
}

export interface AssistantAutoReplyScanResult {
  considered: number
  failed: number
  nextWakeAt: string | null
  replied: number
  skipped: number
}

export interface AssistantAutomationStateProgress {
  autoReply: AssistantAutomationState['autoReply']
  cursor?: AssistantAutomationCursor | null
}

export interface AssistantAutomationScanStateProgress {
  autoReply: AssistantAutomationState['autoReply']
  inboxScanCursor: AssistantAutomationCursor | null
}

export interface AssistantAutomationScanResult {
  replies: AssistantAutoReplyScanResult
  routing: AssistantInboxScanResult
}

export interface AssistantAutomationPassResult {
  cronProcessed: number
  nextWakeAt: string | null
  outboxAttempted: number
  progressed: boolean
  replies: AssistantAutoReplyScanResult
  routing: AssistantInboxScanResult
}

export function cursorFromCapture(capture: {
  captureId: string
  occurredAt: string
}): AssistantAutomationCursor {
  return {
    occurredAt: capture.occurredAt,
    captureId: capture.captureId,
  }
}

export function compareAssistantAutomationCursor(
  left: AssistantAutomationCursor,
  right: AssistantAutomationCursor,
): number {
  return left.occurredAt === right.occurredAt
    ? left.captureId.localeCompare(right.captureId)
    : left.occurredAt.localeCompare(right.occurredAt)
}

export function compareAssistantCaptureOrder(
  left: { captureId: string; occurredAt: string },
  right: { captureId: string; occurredAt: string },
): number {
  return compareAssistantAutomationCursor(
    cursorFromCapture(left),
    cursorFromCapture(right),
  )
}

export function isAssistantCaptureAfterCursor(
  capture: { captureId: string; occurredAt: string },
  cursor?: AssistantAutomationCursor | null,
): boolean {
  if (!cursor) {
    return true
  }

  return compareAssistantCaptureOrder(capture, cursor) > 0
}

export function normalizeEnabledChannels(channels: readonly string[]): string[] {
  return [...new Set(channels.map((channel) => channel.trim()).filter(Boolean))]
}

export function computeAssistantAutomationRetryAt(
  delayMs: number,
  nowMs = Date.now(),
): string {
  const normalizedDelayMs = Number.isFinite(delayMs)
    ? Math.max(0, Math.trunc(delayMs))
    : 0
  return new Date(nowMs + normalizedDelayMs).toISOString()
}

export function earliestAssistantAutomationWakeAt(
  ...values: Array<string | null | undefined>
): string | null {
  return values
    .map((value) => normalizeAssistantAutomationWakeAt(value ?? null))
    .filter((value): value is string => value !== null)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null
}

export function normalizeAssistantAutomationWakeAt(
  value: string | null,
): string | null {
  if (!value) {
    return null
  }

  const parsedMs = Date.parse(value)
  if (!Number.isFinite(parsedMs)) {
    return null
  }

  return new Date(parsedMs).toISOString()
}

export function bridgeAbortSignals(
  controller: AbortController,
  upstream?: AbortSignal,
  options?: {
    clearTimer?: (timer: ShutdownTimer) => void
    exitProcess?: (code: number) => void
    forceExitGraceMs?: number
    setTimer?: (callback: () => void, delayMs: number) => ShutdownTimer
  },
): () => void {
  const forceExitGraceMs = Math.max(
    0,
    Math.trunc(options?.forceExitGraceMs ?? 2000),
  )
  const clearTimer = options?.clearTimer ?? clearTimeout
  const setTimer = options?.setTimer ?? setTimeout
  const exitProcess = options?.exitProcess ?? ((code: number) => process.exit(code))
  const abort = () => controller.abort()
  let forcedExitTimer: ShutdownTimer | null = null

  const cancelForcedExit = () => {
    if (forcedExitTimer !== null) {
      clearTimer(forcedExitTimer)
      forcedExitTimer = null
    }
  }

  const armLocalSignalAbort = (exitCode: number) => {
    if (!controller.signal.aborted) {
      controller.abort()
      forcedExitTimer = setTimer(() => {
        forcedExitTimer = null
        exitProcess(exitCode)
      }, forceExitGraceMs)
      return
    }

    cancelForcedExit()
    exitProcess(exitCode)
  }

  const onSigint = () => armLocalSignalAbort(130)
  const onSigterm = () => armLocalSignalAbort(143)

  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)

  if (upstream) {
    if (upstream.aborted) {
      controller.abort()
    } else {
      upstream.addEventListener('abort', abort, { once: true })
    }
  }

  return () => {
    cancelForcedExit()
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    upstream?.removeEventListener('abort', abort)
  }
}

export interface AssistantAutomationWakeController {
  consumePendingWake(): boolean
  requestWake(): void
  waitForWakeOrDeadline(
    signal: AbortSignal,
    nextWakeAt: string | null,
  ): Promise<void>
}

export function createAssistantAutomationWakeController(): AssistantAutomationWakeController {
  let pendingWake = false
  const waiters = new Set<() => void>()

  const notifyWaiters = () => {
    for (const waiter of waiters) {
      waiter()
    }
    waiters.clear()
  }

  return {
    consumePendingWake() {
      const hadPendingWake = pendingWake
      pendingWake = false
      return hadPendingWake
    },
    requestWake() {
      pendingWake = true
      notifyWaiters()
    },
    async waitForWakeOrDeadline(signal, nextWakeAt) {
      if (signal.aborted || pendingWake) {
        return
      }

      const timeoutMs = resolveAssistantAutomationWakeDelayMs(nextWakeAt)
      if (timeoutMs === 0) {
        return
      }

      await new Promise<void>((resolve) => {
        const onWake = () => {
          cleanup()
          resolve()
        }
        const onAbort = () => {
          cleanup()
          resolve()
        }
        const timer =
          timeoutMs === null
            ? null
            : setTimeout(() => {
                cleanup()
                resolve()
              }, timeoutMs)

        const cleanup = () => {
          if (timer !== null) {
            clearTimeout(timer)
          }
          waiters.delete(onWake)
          signal.removeEventListener('abort', onAbort)
        }

        waiters.add(onWake)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },
  }
}

export async function waitForAbortOrTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (signal.aborted) {
    return
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, timeoutMs)

    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function resolveAssistantAutomationWakeDelayMs(
  nextWakeAt: string | null,
): number | null {
  const normalizedWakeAt = normalizeAssistantAutomationWakeAt(nextWakeAt)
  if (!normalizedWakeAt) {
    return null
  }

  return Math.max(0, Date.parse(normalizedWakeAt) - Date.now())
}

export function normalizeScanLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 50
  }

  return Math.min(Math.max(Math.trunc(value), 1), 200)
}

export function createEmptyInboxScanResult(): AssistantInboxScanResult {
  return {
    considered: 0,
    failed: 0,
    nextWakeAt: null,
    noAction: 0,
    routed: 0,
    skipped: 0,
  }
}

export function createEmptyAutoReplyScanResult(): AssistantAutoReplyScanResult {
  return {
    considered: 0,
    failed: 0,
    nextWakeAt: null,
    replied: 0,
    skipped: 0,
  }
}
