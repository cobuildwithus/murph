import { readFile } from 'node:fs/promises'
import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
} from '@murphai/runtime-state/node'
import {
  assistantStatusResultSchema,
  type AssistantStatusResult,
  type AssistantTurnReceipt,
  type AssistantTurnReceiptSummary,
} from '@murphai/operator-config/assistant-cli-contracts'
import { buildAssistantOutboxSummary } from './outbox.js'
import { readAssistantDiagnosticsSnapshot } from './diagnostics.js'
import { inspectAssistantAutomationRunLock } from './automation/runtime-lock.js'
import { summarizeAssistantQuarantines, quarantineAssistantStateFile } from './quarantine.js'
import { readAssistantRuntimeBudgetStatus } from './runtime-budgets.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  ensureAssistantState,
  readAutomationState,
} from './store/persistence.js'
import {
  redactAssistantDisplayPath,
  resolveAssistantStatePaths,
} from './store.js'
import {
  listRecentAssistantTurnReceipts,
  listRecentAssistantTurnReceiptsForSession,
} from './turns.js'
import {
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { sanitizeAssistantPortableStateString } from './redaction.js'

const ASSISTANT_STATUS_SNAPSHOT_SCHEMA = 'murph.assistant-status-snapshot.v1'
const ASSISTANT_STATUS_SNAPSHOT_SCHEMA_VERSION = 1
const ASSISTANT_STATUS_TIMELINE_DETAIL_MAX_LENGTH = 160

export async function getAssistantStatus(
  input:
    | string
    | {
        limit?: number
        sessionId?: string | null
        vault: string
      },
): Promise<AssistantStatusResult> {
  return getAssistantStatusLocal(input)
}

export async function getAssistantStatusLocal(
  input:
    | string
    | {
        limit?: number
        sessionId?: string | null
        vault: string
      },
): Promise<AssistantStatusResult> {
  const normalizedInput = typeof input === 'string' ? { vault: input } : input
  const vault = normalizedInput.vault
  const paths = resolveAssistantStatePaths(vault)
  const [
    automation,
    runLock,
    outbox,
    diagnostics,
    runtimeBudget,
    recentTurns,
  ] = await Promise.all([
    readAutomationState(paths),
    inspectAssistantAutomationRunLock(paths),
    buildAssistantOutboxSummary(vault),
    readAssistantDiagnosticsSnapshot(vault),
    readAssistantRuntimeBudgetStatus(vault),
    resolveRecentTurns(vault, typeof input === 'string' ? undefined : input),
  ])
  const quarantine = await summarizeAssistantQuarantines({ paths })
  const warnings = buildAssistantStatusWarnings({
    diagnostics,
    outbox,
    quarantine,
    runLock,
  })

  return assistantStatusResultSchema.parse({
    vault: redactAssistantDisplayPath(paths.absoluteVaultRoot),
    stateRoot: redactAssistantDisplayPath(paths.assistantStateRoot),
    statusPath: redactAssistantDisplayPath(paths.statusPath),
    outboxRoot: redactAssistantDisplayPath(paths.outboxDirectory),
    diagnosticsPath: redactAssistantDisplayPath(paths.diagnosticSnapshotPath),
    turnsRoot: redactAssistantDisplayPath(paths.turnsDirectory),
    generatedAt: new Date().toISOString(),
    runLock,
    automation: {
      autoReply: automation.autoReply,
      updatedAt: automation.updatedAt,
    },
    outbox,
    diagnostics,
    quarantine,
    runtimeBudget,
    recentTurns,
    warnings,
  })
}

export async function refreshAssistantStatusSnapshot(
  vault: string,
): Promise<AssistantStatusResult> {
  const status = await getAssistantStatusLocal(vault)
  await withAssistantRuntimeWriteLock(vault, async (paths) => {
    await writeJsonFileAtomic(
      paths.statusPath,
      createVersionedJsonStateEnvelope({
        schema: ASSISTANT_STATUS_SNAPSHOT_SCHEMA,
        schemaVersion: ASSISTANT_STATUS_SNAPSHOT_SCHEMA_VERSION,
        value: status,
      }),
    )
    await appendAssistantRuntimeEventAtPaths(paths, {
      at: status.generatedAt,
      component: 'status',
      entityId: 'assistant-status',
      entityType: 'status-snapshot',
      kind: 'status.snapshot.refreshed',
      level: 'info',
      message: 'Assistant status snapshot was refreshed.',
      data: {
        warningCount: status.warnings.length,
        quarantineCount: status.quarantine.total,
      },
    }).catch(() => undefined)
  })
  return status
}

export async function refreshAssistantStatusSnapshotLocal(
  vault: string,
): Promise<AssistantStatusResult> {
  return refreshAssistantStatusSnapshot(vault)
}

export async function readAssistantStatusSnapshot(
  vault: string,
): Promise<AssistantStatusResult | null> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  let raw: string | null = null
  try {
    raw = await readFile(paths.statusPath, 'utf8')
    return parseVersionedJsonStateEnvelope(JSON.parse(raw), {
      label: 'Assistant status snapshot',
      parseValue(value) {
        return assistantStatusResultSchema.parse(value)
      },
      schema: ASSISTANT_STATUS_SNAPSHOT_SCHEMA,
      schemaVersion: ASSISTANT_STATUS_SNAPSHOT_SCHEMA_VERSION,
    })
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    await quarantineAssistantStateFile({
      artifactKind: 'status',
      error,
      ...(raw === null ? {} : { expectedContent: raw }),
      filePath: paths.statusPath,
      paths,
    }).catch(() => undefined)
    return null
  }
}

function buildAssistantStatusWarnings(input: {
  diagnostics: AssistantStatusResult['diagnostics']
  outbox: AssistantStatusResult['outbox']
  quarantine: AssistantStatusResult['quarantine']
  runLock: AssistantStatusResult['runLock']
}): string[] {
  const warnings = [...input.diagnostics.recentWarnings]

  if (input.runLock.state === 'stale' && input.runLock.reason) {
    warnings.push(`assistant automation lock is stale: ${input.runLock.reason}`)
  }
  if (input.outbox.failed > 0) {
    warnings.push(`${input.outbox.failed} assistant outbox intent(s) failed permanently`)
  }
  if (input.outbox.retryable > 0) {
    warnings.push(`${input.outbox.retryable} assistant outbox intent(s) are waiting for retry`)
  }
  if (input.quarantine.total > 0) {
    warnings.push(`${input.quarantine.total} assistant runtime artifact(s) were quarantined for repair`)
  }
  return warnings.slice(-12)
}

async function resolveRecentTurns(
  vault: string,
  input:
    | {
        limit?: number
        sessionId?: string | null
        vault: string
      }
    | undefined,
): Promise<AssistantTurnReceiptSummary[]> {
  const limit = normalizeTurnLimit(input?.limit)
  const sessionFilter = input?.sessionId?.trim() || null
  const receipts = sessionFilter
    ? await listRecentAssistantTurnReceiptsForSession(
        vault,
        sessionFilter,
        limit,
      )
    : await listRecentAssistantTurnReceipts(vault, limit)
  return receipts.map(toAssistantTurnReceiptSummary)
}

function toAssistantTurnReceiptSummary(
  receipt: AssistantTurnReceipt,
): AssistantTurnReceiptSummary {
  const latestTimelineEvent = receipt.timeline.at(-1) ?? null
  return {
    schema: 'murph.assistant-turn-receipt-summary.v1',
    turnId: receipt.turnId,
    sessionId: receipt.sessionId,
    provider: receipt.provider,
    providerModel: receipt.providerModel,
    promptPreview: receipt.promptPreview,
    responsePreview: receipt.responsePreview,
    status: receipt.status,
    deliveryRequested: receipt.deliveryRequested,
    deliveryDisposition: receipt.deliveryDisposition,
    deliveryIntentId: receipt.deliveryIntentId,
    startedAt: receipt.startedAt,
    updatedAt: receipt.updatedAt,
    completedAt: receipt.completedAt,
    lastError: receipt.lastError,
    timelineEventCount: receipt.timeline.length,
    latestTimelineEvent: latestTimelineEvent
      ? {
          at: latestTimelineEvent.at,
          kind: latestTimelineEvent.kind,
          detail: latestTimelineEvent.detail
            ? sanitizeAssistantPortableStateString(
                latestTimelineEvent.detail,
                ASSISTANT_STATUS_TIMELINE_DETAIL_MAX_LENGTH,
              )
            : null,
        }
      : null,
  }
}

function normalizeTurnLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 10
  }

  return Math.min(Math.max(Math.trunc(value), 1), 50)
}
