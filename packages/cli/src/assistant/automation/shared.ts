import type { AssistantAutomationCursor } from '../../assistant-cli-contracts.js'

type ShutdownTimer = ReturnType<typeof setTimeout> | number

export interface AssistantRunEvent {
  captureId?: string
  details?: string
  tools?: string[]
  type:
    | 'capture.failed'
    | 'capture.noop'
    | 'capture.replied'
    | 'capture.reply-failed'
    | 'capture.reply-skipped'
    | 'capture.routed'
    | 'capture.skipped'
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
  primed: boolean
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
