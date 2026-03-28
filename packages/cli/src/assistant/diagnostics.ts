import { appendFile, readFile } from 'node:fs/promises'
import {
  assistantDiagnosticEventSchema,
  assistantDiagnosticsCountersSchema,
  assistantDiagnosticsSnapshotSchema,
  type AssistantDiagnosticComponent,
  type AssistantDiagnosticEvent,
  type AssistantDiagnosticLevel,
  type AssistantDiagnosticsCounters,
  type AssistantDiagnosticsSnapshot,
} from '../assistant-cli-contracts.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError, writeJsonFileAtomic } from './shared.js'

const ASSISTANT_DIAGNOSTIC_EVENT_SCHEMA = 'murph.assistant-diagnostic-event.v1'
const ASSISTANT_DIAGNOSTIC_SNAPSHOT_SCHEMA = 'murph.assistant-diagnostics.v1'
const RECENT_WARNING_LIMIT = 12

export function createEmptyAssistantDiagnosticsCounters(): AssistantDiagnosticsCounters {
  return {
    turnsStarted: 0,
    turnsCompleted: 0,
    turnsDeferred: 0,
    turnsFailed: 0,
    providerAttempts: 0,
    providerFailures: 0,
    providerFailovers: 0,
    deliveriesQueued: 0,
    deliveriesSent: 0,
    deliveriesFailed: 0,
    deliveriesRetryable: 0,
    outboxDrains: 0,
    outboxRetries: 0,
    automationScans: 0,
  }
}

export async function readAssistantDiagnosticsSnapshot(
  vault: string,
): Promise<AssistantDiagnosticsSnapshot> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  try {
    const raw = await readFile(paths.diagnosticSnapshotPath, 'utf8')
    return assistantDiagnosticsSnapshotSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return assistantDiagnosticsSnapshotSchema.parse({
    schema: ASSISTANT_DIAGNOSTIC_SNAPSHOT_SCHEMA,
    updatedAt: new Date(0).toISOString(),
    lastEventAt: null,
    lastErrorAt: null,
    counters: createEmptyAssistantDiagnosticsCounters(),
    recentWarnings: [],
  })
}

export async function saveAssistantDiagnosticsSnapshot(
  vault: string,
  snapshot: AssistantDiagnosticsSnapshot,
): Promise<AssistantDiagnosticsSnapshot> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantDiagnosticsSnapshotSchema.parse(snapshot)
    await writeJsonFileAtomic(paths.diagnosticSnapshotPath, parsed)
    return parsed
  })
}

export async function recordAssistantDiagnosticEvent(input: {
  at?: string
  code?: string | null
  component: AssistantDiagnosticComponent
  counterDeltas?: Partial<AssistantDiagnosticsCounters>
  data?: Record<string, unknown> | null
  intentId?: string | null
  kind: string
  level?: AssistantDiagnosticLevel
  message: string
  sessionId?: string | null
  turnId?: string | null
  vault: string
}): Promise<AssistantDiagnosticEvent> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const at = input.at ?? new Date().toISOString()
    const event = assistantDiagnosticEventSchema.parse({
      schema: ASSISTANT_DIAGNOSTIC_EVENT_SCHEMA,
      at,
      level: input.level ?? 'info',
      component: input.component,
      kind: input.kind,
      message: input.message,
      code: input.code ?? null,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      intentId: input.intentId ?? null,
      dataJson: input.data ? JSON.stringify(input.data) : null,
    })

    await appendFile(paths.diagnosticEventsPath, `${JSON.stringify(event)}\n`, 'utf8')

    const snapshot = await readAssistantDiagnosticsSnapshotAtPath(paths.diagnosticSnapshotPath)
    const nextSnapshot = assistantDiagnosticsSnapshotSchema.parse({
      ...snapshot,
      updatedAt: at,
      lastEventAt: at,
      lastErrorAt: event.level === 'error' ? at : snapshot.lastErrorAt,
      counters: applyCounterDeltas(snapshot.counters, input.counterDeltas),
      recentWarnings: trimRecentWarnings([
        ...snapshot.recentWarnings,
        ...(event.level === 'warn' || event.level === 'error'
          ? [`${event.at} ${event.component}/${event.kind}: ${event.message}`]
          : []),
      ]),
    })
    await writeJsonFileAtomic(paths.diagnosticSnapshotPath, nextSnapshot)

    return event
  })
}

async function readAssistantDiagnosticsSnapshotAtPath(
  snapshotPath: string,
): Promise<AssistantDiagnosticsSnapshot> {
  try {
    const raw = await readFile(snapshotPath, 'utf8')
    return assistantDiagnosticsSnapshotSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  return assistantDiagnosticsSnapshotSchema.parse({
    schema: ASSISTANT_DIAGNOSTIC_SNAPSHOT_SCHEMA,
    updatedAt: new Date(0).toISOString(),
    lastEventAt: null,
    lastErrorAt: null,
    counters: createEmptyAssistantDiagnosticsCounters(),
    recentWarnings: [],
  })
}

function applyCounterDeltas(
  current: AssistantDiagnosticsCounters,
  deltas: Partial<AssistantDiagnosticsCounters> | undefined,
): AssistantDiagnosticsCounters {
  if (!deltas) {
    return current
  }

  return assistantDiagnosticsCountersSchema.parse({
    turnsStarted: current.turnsStarted + (deltas.turnsStarted ?? 0),
    turnsCompleted: current.turnsCompleted + (deltas.turnsCompleted ?? 0),
    turnsDeferred: current.turnsDeferred + (deltas.turnsDeferred ?? 0),
    turnsFailed: current.turnsFailed + (deltas.turnsFailed ?? 0),
    providerAttempts: current.providerAttempts + (deltas.providerAttempts ?? 0),
    providerFailures: current.providerFailures + (deltas.providerFailures ?? 0),
    providerFailovers: current.providerFailovers + (deltas.providerFailovers ?? 0),
    deliveriesQueued: current.deliveriesQueued + (deltas.deliveriesQueued ?? 0),
    deliveriesSent: current.deliveriesSent + (deltas.deliveriesSent ?? 0),
    deliveriesFailed: current.deliveriesFailed + (deltas.deliveriesFailed ?? 0),
    deliveriesRetryable:
      current.deliveriesRetryable + (deltas.deliveriesRetryable ?? 0),
    outboxDrains: current.outboxDrains + (deltas.outboxDrains ?? 0),
    outboxRetries: current.outboxRetries + (deltas.outboxRetries ?? 0),
    automationScans: current.automationScans + (deltas.automationScans ?? 0),
  })
}

function trimRecentWarnings(values: readonly string[]): string[] {
  return [...values].slice(-RECENT_WARNING_LIMIT)
}
