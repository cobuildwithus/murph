import { readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantProviderRouteRecoverySchema,
  assistantRuntimeBudgetSnapshotSchema,
  type AssistantRuntimeBudgetSnapshot,
} from '../assistant-cli-contracts.js'
import {
  clearAssistantAutomationRunLock,
  inspectAssistantAutomationRunLock,
} from './automation/runtime-lock.js'
import { ensureAssistantState } from './store/persistence.js'
import {
  clearAssistantRuntimeWriteLock,
  inspectAssistantRuntimeWriteLock,
  withAssistantRuntimeWriteLock,
} from './runtime-write-lock.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import {
  listAssistantRuntimeCacheSnapshots,
  pruneAssistantRuntimeCaches,
} from './runtime-cache.js'
import {
  createAssistantBoundedRuntimeCache,
} from './runtime-budget-policy.js'
import {
  isJsonSyntaxError,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { quarantineAssistantStateFile } from './quarantine.js'
import { resolveAssistantStatePaths, type AssistantStatePaths } from './store/paths.js'

const ASSISTANT_RUNTIME_BUDGET_SCHEMA = 'murph.assistant-runtime-budget.v1'
const ASSISTANT_RUNTIME_MAINTENANCE_MIN_INTERVAL_MS = 5 * 60 * 1000
const ASSISTANT_QUARANTINE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const ASSISTANT_PROVIDER_ROUTE_RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export async function maybeRunAssistantRuntimeMaintenance(input: {
  now?: Date
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  const current = await readAssistantRuntimeBudgetStatus(input.vault)
  const now = input.now ?? new Date()
  const lastRunAt = current.maintenance.lastRunAt
  const lastRunMs = lastRunAt ? Date.parse(lastRunAt) : Number.NaN
  if (Number.isFinite(lastRunMs) && now.getTime() - lastRunMs < ASSISTANT_RUNTIME_MAINTENANCE_MIN_INTERVAL_MS) {
    return current
  }

  return await runAssistantRuntimeMaintenance({
    now,
    vault: input.vault,
  })
}

export async function runAssistantRuntimeMaintenance(input: {
  now?: Date
  vault: string
}): Promise<AssistantRuntimeBudgetSnapshot> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const now = input.now ?? new Date()
    const nowIso = now.toISOString()
    const notes: string[] = []
    const expiredCacheEntries = pruneAssistantRuntimeCaches(now.getTime())
    if (expiredCacheEntries > 0) {
      notes.push(`${expiredCacheEntries} expired runtime cache entr${expiredCacheEntries === 1 ? 'y was' : 'ies were'} pruned.`)
    }
    const staleProviderRecoveryPruned = await pruneAssistantProviderRouteRecoveryFiles(paths, now)
    if (staleProviderRecoveryPruned > 0) {
      notes.push(`${staleProviderRecoveryPruned} stale provider recovery file(s) were removed.`)
    }
    const staleQuarantinePruned = await pruneAssistantQuarantineFiles(paths, now)
    if (staleQuarantinePruned > 0) {
      notes.push(`${staleQuarantinePruned} expired quarantine artifact(s) were removed.`)
    }
    const staleLocksCleared = await clearStaleAssistantLocks({
      paths,
      vault: input.vault,
    })
    if (staleLocksCleared > 0) {
      notes.push(`${staleLocksCleared} stale runtime lock(s) were cleared.`)
    }

    const snapshot = assistantRuntimeBudgetSnapshotSchema.parse({
      schema: ASSISTANT_RUNTIME_BUDGET_SCHEMA,
      updatedAt: nowIso,
      caches: listAssistantRuntimeCacheSnapshots(),
      maintenance: {
        lastRunAt: nowIso,
        staleProviderRecoveryPruned,
        staleQuarantinePruned,
        staleLocksCleared,
        notes,
      },
    })
    await writeJsonFileAtomic(paths.resourceBudgetPath, snapshot)
    await appendAssistantRuntimeEventAtPaths(paths, {
      at: nowIso,
      component: 'runtime',
      kind: 'runtime.maintenance',
      level: 'info',
      message: notes.length > 0 ? notes.join(' ') : 'Assistant runtime maintenance ran with no corrective actions.',
      data: {
        staleProviderRecoveryPruned,
        staleQuarantinePruned,
        staleLocksCleared,
      },
    }).catch(() => undefined)
    return snapshot
  })
}

export async function readAssistantRuntimeBudgetStatus(
  vault: string,
): Promise<AssistantRuntimeBudgetSnapshot> {
  const paths = resolveAssistantStatePaths(vault)
  const existing = await readAssistantRuntimeBudgetSnapshotAtPath(paths.resourceBudgetPath)
  return assistantRuntimeBudgetSnapshotSchema.parse({
    ...existing,
    updatedAt: existing.updatedAt,
    caches: listAssistantRuntimeCacheSnapshots(),
  })
}

async function readAssistantRuntimeBudgetSnapshotAtPath(
  filePath: string,
): Promise<AssistantRuntimeBudgetSnapshot> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return assistantRuntimeBudgetSnapshotSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error) && !isJsonSyntaxError(error)) {
      throw error
    }
  }

  return assistantRuntimeBudgetSnapshotSchema.parse({
    schema: ASSISTANT_RUNTIME_BUDGET_SCHEMA,
    updatedAt: new Date(0).toISOString(),
    caches: listAssistantRuntimeCacheSnapshots(),
    maintenance: {
      lastRunAt: null,
      staleProviderRecoveryPruned: 0,
      staleQuarantinePruned: 0,
      staleLocksCleared: 0,
      notes: [],
    },
  })
}

async function pruneAssistantProviderRouteRecoveryFiles(
  paths: AssistantStatePaths,
  now: Date,
): Promise<number> {
  const entries = await readDirectoryFiles(paths.providerRouteRecoveryDirectory)
  const cutoffMs = now.getTime() - ASSISTANT_PROVIDER_ROUTE_RECOVERY_RETENTION_MS
  let removed = 0

  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue
    }
    const filePath = path.join(paths.providerRouteRecoveryDirectory, entry)
    try {
      const raw = await readFile(filePath, 'utf8')
      const parsed = assistantProviderRouteRecoverySchema.parse(JSON.parse(raw) as unknown)
      const updatedAtMs = Date.parse(parsed.updatedAt)
      if (!Number.isFinite(updatedAtMs) || updatedAtMs > cutoffMs) {
        continue
      }
      await rm(filePath, {
        force: true,
      })
      removed += 1
    } catch (error) {
      await quarantineAssistantStateFile({
        artifactKind: 'provider-route-recovery',
        error,
        filePath,
        paths,
      })
    }
  }

  return removed
}

async function pruneAssistantQuarantineFiles(
  paths: AssistantStatePaths,
  now: Date,
): Promise<number> {
  const directories = [paths.quarantineDirectory, paths.outboxQuarantineDirectory]
  const cutoffMs = now.getTime() - ASSISTANT_QUARANTINE_RETENTION_MS
  let removed = 0

  for (const directory of directories) {
    for (const entry of await readDirectoryEntries(directory)) {
      const targetPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        removed += await pruneAssistantQuarantineFilesAtDirectory(targetPath, cutoffMs)
        continue
      }
      if (!entry.isFile()) {
        continue
      }
      const timestampMs = await readAssistantQuarantineTimestampMs(targetPath)
      if (timestampMs === null || timestampMs > cutoffMs) {
        continue
      }
      await rm(targetPath, {
        force: true,
      })
      removed += 1
    }
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
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    const timestampMs = await readAssistantQuarantineTimestampMs(targetPath)
    if (timestampMs === null || timestampMs > cutoffMs) {
      continue
    }
    await rm(targetPath, {
      force: true,
    })
    removed += 1
  }
  return removed
}

async function readAssistantQuarantineTimestampMs(filePath: string): Promise<number | null> {
  if (!filePath.endsWith('.meta.json')) {
    return null
  }
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { quarantinedAt?: unknown }
    return typeof parsed.quarantinedAt === 'string' ? Date.parse(parsed.quarantinedAt) : null
  } catch {
    return null
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

async function readDirectoryFiles(directory: string): Promise<string[]> {
  return (await readDirectoryEntries(directory))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
}
