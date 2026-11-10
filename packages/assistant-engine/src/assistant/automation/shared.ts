import { compareAssistantTimestampsAscending } from '../shared.js'


export const DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT = 50

export interface AssistantRunEvent {
  captureId?: string
  details?: string
  errorCode?: string
  failureContext?: Record<string, boolean | number | string | null>
  inputId?: string
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
  safeErrorMessage?: string
  tools?: string[]
  type:
    | 'capture.failed'
    | 'capture.noop'
    | 'assistant.reply.intent_created'
    | 'assistant.delivery.foreground_started'
    | 'assistant.delivery.sent'
    | 'input.reply-progress'
    | 'input.reply-started'
    | 'input.replied'
    | 'input.reply-failed'
    | 'input.reply-skipped'
    | 'capture.routed'
    | 'capture.skipped'
    | 'daemon.failed'
    | 'cron.job.completed'
    | 'cron.delivery.reconciled'
    | 'cron.occurrence.expired'
    | 'onboarding.followup.completed'
    | 'cron.scan.job'
    | 'cron.scan.started'
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

export interface AssistantAutoReplyTerminalNonReply {
  inputIds: string[]
  recordedAt: string
  source: string
}

export type AssistantAutoReplyTerminalNonReplyHook = (
  event: AssistantAutoReplyTerminalNonReply,
) => void

export function emitAssistantAutoReplyTerminalNonReplyBestEffort(input: {
  event: AssistantAutoReplyTerminalNonReply
  hook?: AssistantAutoReplyTerminalNonReplyHook | null
}): void {
  try {
    input.hook?.(input.event)
  } catch {
    // Observability projection must never affect canonical reply handling.
  }
}

export interface AssistantAutoReplyScanResult {
  checkpointRequired?: true
  considered: number
  failed: number
  nextWakeAt: string | null
  replied: number
  skipped: number
  terminalLinqCleanup?: string[]
}

export interface AssistantAutomationScanResult {
  currentTurnDeliveryIntentIds: string[]
  replies: AssistantAutoReplyScanResult
  routing: AssistantInboxScanResult
}

export interface AssistantAutomationPassResult {
  cronProcessed: number
  currentTurnDeliveryIntentIds: string[]
  nextWakeAt: string | null
  autonomousNextWakeAt?: string | null
  outboxOnlyNextWakeAt?: string
  outboxAttempted: number
  passTiming?: AssistantAutomationPassTiming
  progressed: boolean
  replies: AssistantAutoReplyScanResult
  routing: AssistantInboxScanResult
}

export interface AssistantAutomationPassTiming {
  cronStatusDeferred: boolean
  cronStatusElapsedMs: number | null
  postScanTailElapsedMs: number
  scanElapsedMs: number
}

export function compareAssistantCaptureOrder(
  left: { captureId: string; createdAt?: string | null; occurredAt: string },
  right: { captureId: string; createdAt?: string | null; occurredAt: string },
): number {
  const leftTimestamp =
    left.createdAt && right.createdAt ? left.createdAt : left.occurredAt
  const rightTimestamp =
    left.createdAt && right.createdAt ? right.createdAt : right.occurredAt

  return leftTimestamp === rightTimestamp
    ? left.captureId.localeCompare(right.captureId)
    : compareAssistantTimestampsAscending(leftTimestamp, rightTimestamp)
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

export function normalizeScanLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT
  }

  return Math.max(Math.trunc(value), 1)
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
