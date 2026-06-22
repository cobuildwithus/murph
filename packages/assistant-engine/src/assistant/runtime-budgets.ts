import { readdir, readFile, rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantQuarantineEntrySchema,
  assistantRuntimeBudgetSnapshotSchema,
  type AssistantQuarantineEntry,
  type AssistantRuntimeBudgetSnapshot,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  clearAssistantAutomationRunLock,
  inspectAssistantAutomationRunLock,
} from './automation/runtime-lock.js'
import {
  ensureAssistantState,
  pruneAssistantTranscriptRetention,
} from './store/persistence.js'
import { pruneAssistantTerminalOutboxIntents } from './outbox/store.js'
import { pruneAssistantRuntimeResidueAtPaths } from './runtime-residue.js'
import { pruneAssistantCronRunHistory } from './cron/store.js'
import {
  clearAssistantRuntimeWriteLock,
  inspectAssistantRuntimeWriteLock,
  withAssistantRuntimeWriteLock,
} from './runtime-write-lock.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import { compactAssistantEventLogsAtPaths } from './event-log-retention.js'
import {
  listAssistantRuntimeCacheSnapshots,
  pruneAssistantRuntimeCaches,
} from './runtime-cache.js'
import {
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { quarantineAssistantStateFile } from './quarantine.js'
import type { AssistantStatePaths } from './store/paths.js'

const ASSISTANT_RUNTIME_BUDGET_SCHEMA = 'murph.assistant-runtime-budget.v1'
const ASSISTANT_RUNTIME_MAINTENANCE_MIN_INTERVAL_MS = 5 * 60 * 1000
const ASSISTANT_QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const QUARANTINE_METADATA_SUFFIX = '.meta.json'

export async function maybeRunAssistantRuntimeMaintenance(input: {
  now?: Date
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  const now = input.now ?? new Date()
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAssistantRuntimeBudgetStatusAtPaths({
      paths,
      vault: input.vault,
    })
    const lastRunAt = current.maintenance.lastRunAt
    const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : Number.NaN
    if (
      Number.isFinite(lastRunMs) &&
      now.getTime() - lastRunMs < ASSISTANT_RUNTIME_MAINTENANCE_MIN_INTERVAL_MS
    ) {
      return current
    }

    return await runAssistantRuntimeMaintenanceAtPaths({
      now,
      paths,
      vault: input.vault,
    })
  })
}

export async function runAssistantRuntimeMaintenance(input: {
  now?: Date
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    return await runAssistantRuntimeMaintenanceAtPaths({
      now: input.now ?? new Date(),
      paths,
      vault: input.vault,
    })
  })
}

export async function readAssistantRuntimeBudgetStatus(
  vault: string,
): Promise<AssistantRuntimeBudgetSnapshot> {
  return await withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    return await readAssistantRuntimeBudgetStatusAtPaths({
      paths,
      vault,
    })
  })
}

async function runAssistantRuntimeMaintenanceAtPaths(input: {
  now: Date
  paths: AssistantStatePaths
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  const nowIso = input.now.toISOString()
  const notes: string[] = []
  const expiredCacheEntries = pruneAssistantRuntimeCaches(input.now.getTime())
  if (expiredCacheEntries > 0) {
    notes.push(
      `${expiredCacheEntries} expired runtime cache entr${expiredCacheEntries === 1 ? 'y was' : 'ies were'} pruned.`,
    )
  }
  const staleQuarantinePruned = await pruneAssistantQuarantineFiles(
    input.paths,
    input.now,
  )
  if (staleQuarantinePruned > 0) {
    notes.push(
      `${staleQuarantinePruned} expired quarantine artifact(s) were removed.`,
    )
  }
  const transcriptRetention = await pruneAssistantTranscriptRetention(input.paths)
  if (transcriptRetention.entriesTrimmed > 0) {
    notes.push(
      `${transcriptRetention.entriesTrimmed} transcript entr${transcriptRetention.entriesTrimmed === 1 ? 'y was' : 'ies were'} trimmed across ${transcriptRetention.transcriptsTrimmed} session transcript(s).`,
    )
  }
  const terminalOutboxPruned = await pruneAssistantTerminalOutboxIntents({
    now: input.now,
    paths: input.paths,
    vault: input.vault,
  })
  if (terminalOutboxPruned > 0) {
    notes.push(
      `${terminalOutboxPruned} terminal outbox intent(s) were pruned.`,
    )
  }
  const runtimeResidue = await pruneAssistantRuntimeResidueAtPaths({
    now: input.now,
    paths: input.paths,
    pendingInputIds: null,
    vault: input.vault,
  })
  const runtimeResiduePruned =
    countAssistantRuntimeResiduePrunedFiles(runtimeResidue)
  if (runtimeResiduePruned > 0) {
    notes.push(
      `${runtimeResiduePruned} assistant runtime residue file(s) were pruned.`,
    )
  }
  const cronHistory = await pruneAssistantCronRunHistory({
    now: input.now,
    paths: input.paths,
  })
  if (cronHistory.responsesRedacted > 0) {
    notes.push(
      `${cronHistory.responsesRedacted} older cron response(s) were redacted.`,
    )
  }
  if (cronHistory.runsPruned > 0) {
    notes.push(
      `${cronHistory.runsPruned} stale cron run record(s) were pruned.`,
    )
  }
  const staleLocksCleared = await clearStaleAssistantLocks({
    paths: input.paths,
    vault: input.vault,
  })
  if (staleLocksCleared > 0) {
    notes.push(`${staleLocksCleared} stale runtime lock(s) were cleared.`)
  }

  await appendAssistantRuntimeEventAtPaths(input.paths, {
    at: nowIso,
    component: 'runtime',
    kind: 'runtime.maintenance',
    level: 'info',
    message:
      notes.length > 0
        ? notes.join(' ')
        : 'Assistant runtime maintenance ran with no corrective actions.',
    data: {
      assistantRuntimeAcceptedTurnInputJournalsPruned:
        runtimeResidue.acceptedTurnInputJournalsPruned,
      assistantRuntimeAutoReplyEvidenceFilesPruned:
        runtimeResidue.autoReplyEvidenceFilesPruned,
      assistantRuntimeAutoReplyEvidenceGroupsPruned:
        runtimeResidue.autoReplyEvidenceGroupsPruned,
      assistantRuntimeAutoReplyIntentProvenancePruned:
        runtimeResidue.autoReplyIntentProvenancePruned,
      assistantRuntimeInputEventsPruned: runtimeResidue.inputEventsPruned,
      assistantRuntimeReceiptsPruned: runtimeResidue.receiptsPruned,
      assistantRuntimeResiduePruned: runtimeResiduePruned,
      cronResponsesRedacted: cronHistory.responsesRedacted,
      cronRunsPruned: cronHistory.runsPruned,
      staleQuarantinePruned,
      staleLocksCleared,
      terminalOutboxPruned,
      transcriptEntriesTrimmed: transcriptRetention.entriesTrimmed,
      transcriptFilesTrimmed: transcriptRetention.transcriptsTrimmed,
    },
  }).catch(() => undefined)
  try {
    await compactAssistantEventLogsAtPaths({
      now: input.now,
      paths: input.paths,
    })
  } catch {
    notes.push(
      'Assistant event log compaction failed and will be retried by a later maintenance pass.',
    )
  }

  const snapshot = assistantRuntimeBudgetSnapshotSchema.parse({
    schema: ASSISTANT_RUNTIME_BUDGET_SCHEMA,
    updatedAt: nowIso,
    caches: listAssistantRuntimeCacheSnapshots(),
    maintenance: {
      lastRunAt: nowIso,
      staleQuarantinePruned,
      staleLocksCleared,
      notes,
    },
  })
  await writeJsonFileAtomic(input.paths.resourceBudgetPath, snapshot)
  return snapshot
}

async function readAssistantRuntimeBudgetStatusAtPaths(input: {
  paths: AssistantStatePaths
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  const existing = await readAssistantRuntimeBudgetSnapshotAtPaths(input)
  return assistantRuntimeBudgetSnapshotSchema.parse({
    ...existing,
    updatedAt: existing.updatedAt,
    caches: listAssistantRuntimeCacheSnapshots(),
  })
}

async function readAssistantRuntimeBudgetSnapshotAtPaths(input: {
  paths: AssistantStatePaths
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  const defaultSnapshot = buildDefaultAssistantRuntimeBudgetSnapshot()

  let raw: string
  try {
    raw = await readFile(input.paths.resourceBudgetPath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return defaultSnapshot
    }
    throw error
  }

  try {
    return assistantRuntimeBudgetSnapshotSchema.parse(JSON.parse(raw))
  } catch (error) {
    const recoveredAt = new Date().toISOString()
    const recoveredSnapshot =
      buildDefaultAssistantRuntimeBudgetSnapshot(recoveredAt)
    const quarantine = await quarantineAssistantStateFile({
      artifactKind: 'runtime-budget',
      error,
      expectedContent: raw,
      filePath: input.paths.resourceBudgetPath,
      paths: input.paths,
    })
    if (!quarantine) {
      return await readAssistantRuntimeBudgetSnapshotAtPaths(input)
    }
    await writeJsonFileAtomic(input.paths.resourceBudgetPath, recoveredSnapshot)
    await appendAssistantRuntimeEventAtPaths(input.paths, {
      at: recoveredAt,
      component: 'runtime',
      entityId: 'assistant-runtime-budget',
      entityType: 'runtime-budget',
      kind: 'runtime-budget.recovered',
      level: 'warn',
      message:
        'Assistant runtime budget snapshot was recreated after a corrupted snapshot was quarantined.',
      data: {
        quarantineId: quarantine?.quarantineId ?? null,
        quarantinedPath: quarantine?.quarantinedPath ?? null,
      },
    }).catch(() => undefined)
    return recoveredSnapshot
  }
}

function buildDefaultAssistantRuntimeBudgetSnapshot(
  updatedAt = new Date(0).toISOString(),
): AssistantRuntimeBudgetSnapshot {
  return assistantRuntimeBudgetSnapshotSchema.parse({
    schema: ASSISTANT_RUNTIME_BUDGET_SCHEMA,
    updatedAt,
    caches: listAssistantRuntimeCacheSnapshots(),
    maintenance: {
      lastRunAt: null,
      staleQuarantinePruned: 0,
      staleLocksCleared: 0,
      notes: [],
    },
  })
}

function countAssistantRuntimeResiduePrunedFiles(
  result: Awaited<ReturnType<typeof pruneAssistantRuntimeResidueAtPaths>>,
): number {
  return (
    result.acceptedTurnInputJournalsPruned +
    result.autoReplyEvidenceFilesPruned +
    result.autoReplyIntentProvenancePruned +
    result.inputEventsPruned +
    result.receiptsPruned
  )
}

async function pruneAssistantQuarantineFiles(
  paths: AssistantStatePaths,
  now: Date,
): Promise<number> {
  const directories = [paths.quarantineDirectory, paths.outboxQuarantineDirectory]
  const cutoffMs = now.getTime() - ASSISTANT_QUARANTINE_RETENTION_MS
  let removed = 0

  for (const directory of directories) {
    removed += await pruneAssistantQuarantineFilesAtDirectory(directory, cutoffMs)
  }

  return removed
}

async function pruneAssistantQuarantineFilesAtDirectory(
  directory: string,
  cutoffMs: number,
): Promise<number> {
  let removed = 0
  for (const entry of await readDirectoryEntries(directory)) {
    const targetPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      removed += await pruneAssistantQuarantineFilesAtDirectory(targetPath, cutoffMs)
      await removeDirectoryIfEmpty(targetPath)
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    if (entry.name.endsWith(QUARANTINE_METADATA_SUFFIX)) {
      removed += await pruneAssistantQuarantinePair(targetPath, cutoffMs)
      continue
    }
    removed += await pruneAssistantQuarantineOrphanPayload(targetPath, cutoffMs)
  }
  return removed
}

async function pruneAssistantQuarantinePair(
  metadataPath: string,
  cutoffMs: number,
): Promise<number> {
  const metadata = await readAssistantQuarantineMetadata(metadataPath)
  const timestampMs =
    metadata === null
      ? await readFileTimestampMs(metadataPath)
      : Date.parse(metadata.quarantinedAt)

  if (!Number.isFinite(timestampMs) || timestampMs > cutoffMs) {
    return 0
  }

  const payloadPath = metadataPath.slice(0, -QUARANTINE_METADATA_SUFFIX.length)
  await Promise.all([
    rm(metadataPath, {
      force: true,
    }),
    rm(payloadPath, {
      force: true,
    }),
  ])
  return 1
}

async function pruneAssistantQuarantineOrphanPayload(
  payloadPath: string,
  cutoffMs: number,
): Promise<number> {
  if (!path.basename(payloadPath).includes('.invalid')) {
    return 0
  }

  const metadataPath = `${payloadPath}${QUARANTINE_METADATA_SUFFIX}`
  if (await pathExists(metadataPath)) {
    return 0
  }

  const timestampMs = await readFileTimestampMs(payloadPath)
  if (!Number.isFinite(timestampMs) || timestampMs > cutoffMs) {
    return 0
  }

  await rm(payloadPath, {
    force: true,
  })
  return 1
}

async function readAssistantQuarantineMetadata(
  metadataPath: string,
): Promise<AssistantQuarantineEntry | null> {
  try {
    const raw = await readFile(metadataPath, 'utf8')
    return assistantQuarantineEntrySchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

async function readFileTimestampMs(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).mtimeMs
  } catch {
    return Number.NaN
  }
}

async function removeDirectoryIfEmpty(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory)
    if (entries.length > 0) {
      return
    }
    await rmdir(directory)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
    const code =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : null
    if (code === 'ENOTEMPTY') {
      return
    }
    throw error
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

async function clearStaleAssistantLocks(input: {
  paths: AssistantStatePaths
  vault: string
}): Promise<number> {
  let cleared = 0
  const runtimeWriteLock = await inspectAssistantRuntimeWriteLock(input.vault)
  if (runtimeWriteLock.state === 'stale') {
    await clearAssistantRuntimeWriteLock(input.vault)
    cleared += 1
  }
  const automationRunLock = await inspectAssistantAutomationRunLock(input.paths)
  if (automationRunLock.state === 'stale') {
    await clearAssistantAutomationRunLock(input.paths)
    cleared += 1
  }
  return cleared
}

async function readDirectoryEntries(directory: string) {
  try {
    return await readdir(directory, {
      withFileTypes: true,
    })
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }
}
