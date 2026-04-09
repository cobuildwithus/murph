import type { AssistantAutomationCursor } from '@murphai/operator-config/assistant-cli-contracts'

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
    | 'reply.scan.primed'
    | 'reply.scan.started'
    | 'scan.started'
}

export interface AssistantInboxScanResult {
  considered: number
  failed: number
  noAction: number
  routed: number
  skipped: number
}

export interface AssistantAutoReplyScanResult {
  considered: number
  failed: number
  replied: number
  skipped: number
}

export interface AssistantAutomationStateProgress {
  cursor: AssistantAutomationCursor | null
  backlogChannels?: readonly string[]
  primed: boolean
}

export interface AssistantAutomationScanStateProgress {
  autoReplyBacklogChannels: string[]
  autoReplyPrimed: boolean
  autoReplyScanCursor: AssistantAutomationCursor | null
  inboxScanCursor: AssistantAutomationCursor | null
}

export interface AssistantAutomationScanResult {
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
  waitForWakeOrTimeout(signal: AbortSignal, timeoutMs: number): Promise<void>
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
    async waitForWakeOrTimeout(signal, timeoutMs) {
      if (signal.aborted || pendingWake) {
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
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, timeoutMs)

        const cleanup = () => {
          clearTimeout(timer)
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

export function normalizeScanInterval(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 5000
  }

  return Math.min(Math.max(Math.trunc(value), 250), 60000)
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
    noAction: 0,
    routed: 0,
    skipped: 0,
  }
}

export function createEmptyAutoReplyScanResult(): AssistantAutoReplyScanResult {
  return {
    considered: 0,
    failed: 0,
    replied: 0,
    skipped: 0,
  }
}
