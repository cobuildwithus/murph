import { readFile } from 'node:fs/promises'
import {
  createVersionedJsonStateEnvelope,
  parseVersionedJsonStateEnvelope,
} from '@murphai/runtime-state/node'
import {
  assistantStatusResultSchema,
  type AssistantFailoverState,
  type AssistantStatusResult,
  type AssistantTurnReceipt,
} from '../assistant-cli-contracts.js'
import { buildAssistantOutboxSummary } from './outbox.js'
import { readAssistantDiagnosticsSnapshot } from './diagnostics.js'
import { readAssistantFailoverState } from './failover.js'
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

const ASSISTANT_STATUS_SNAPSHOT_SCHEMA = 'murph.assistant-status-snapshot.v1'
const ASSISTANT_STATUS_SNAPSHOT_SCHEMA_VERSION = 1

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
    failover,
    runtimeBudget,
    recentTurns,
  ] = await Promise.all([
    readAutomationState(paths),
    inspectAssistantAutomationRunLock(paths),
    buildAssistantOutboxSummary(vault),
    readAssistantDiagnosticsSnapshot(vault),
    readAssistantFailoverState(vault),
    readAssistantRuntimeBudgetStatus(vault),
    resolveRecentTurns(vault, typeof input === 'string' ? undefined : input),
  ])
  const quarantine = await summarizeAssistantQuarantines({ paths })
  const warnings = buildAssistantStatusWarnings({
    diagnostics,
    failover,
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
    failoverStatePath: redactAssistantDisplayPath(paths.failoverStatePath),
    turnsRoot: redactAssistantDisplayPath(paths.turnsDirectory),
    generatedAt: new Date().toISOString(),
    runLock,
    automation: {
      inboxScanCursor: automation.inboxScanCursor,
      autoReplyScanCursor: automation.autoReplyScanCursor,
      autoReplyChannels: automation.autoReplyChannels,
      autoReplyBacklogChannels: automation.autoReplyBacklogChannels,
      autoReplyPrimed: automation.autoReplyPrimed,
      updatedAt: automation.updatedAt,
    },
    outbox,
    diagnostics,
    failover,
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

  try {
    const raw = await readFile(paths.statusPath, 'utf8')
    return parseVersionedJsonStateEnvelope(JSON.parse(raw) as unknown, {
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
      filePath: paths.statusPath,
      paths,
    }).catch(() => undefined)
    return null
  }
}

function buildAssistantStatusWarnings(input: {
  diagnostics: AssistantStatusResult['diagnostics']
  failover: AssistantFailoverState
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
  const coolingDown = input.failover.routes.filter(
    (route) => route.cooldownUntil && Date.parse(route.cooldownUntil) > Date.now(),
  )
  if (coolingDown.length > 0) {
    warnings.push(
      `${coolingDown.length} provider failover route(s) are cooling down`,
    )
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
): Promise<AssistantTurnReceipt[]> {
  const limit = normalizeTurnLimit(input?.limit)
  const sessionFilter = input?.sessionId?.trim() || null
  if (sessionFilter) {
    return await listRecentAssistantTurnReceiptsForSession(
      vault,
      sessionFilter,
      limit,
    )
  }
  return await listRecentAssistantTurnReceipts(vault, limit)
}

function normalizeTurnLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return 10
  }

  return Math.min(Math.max(Math.trunc(value), 1), 50)
}
