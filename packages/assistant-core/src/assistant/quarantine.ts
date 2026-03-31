import { randomUUID } from 'node:crypto'
import { readdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantQuarantineEntrySchema,
  assistantQuarantineSummarySchema,
  type AssistantQuarantineArtifactKind,
  type AssistantQuarantineEntry,
  type AssistantQuarantineSummary,
} from '../assistant-cli-contracts.js'
import {
  ensureAssistantStateDirectory,
  errorMessage,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import { redactAssistantStateString } from './redaction.js'
import type { AssistantStatePaths } from './store/paths.js'
import { resolveAssistantStatePaths } from './store/paths.js'

const ASSISTANT_QUARANTINE_ENTRY_SCHEMA = 'murph.assistant-quarantine-entry.v1'
const QUARANTINE_RECENT_LIMIT = 12

export async function quarantineAssistantStateFile(input: {
  artifactKind: AssistantQuarantineArtifactKind
  error: unknown
  filePath: string
  paths: AssistantStatePaths
  quarantineDirectory?: string
}): Promise<AssistantQuarantineEntry | null> {
  const quarantineRoot = input.quarantineDirectory ?? resolveDefaultQuarantineDirectory({
    artifactKind: input.artifactKind,
    paths: input.paths,
  })
  const basename = path.basename(input.filePath)
  const quarantinedAt = new Date().toISOString()
  const quarantineId = `q_${randomUUID().replace(/-/gu, '')}`
  const quarantinedPath = path.join(
    quarantineRoot,
    `${basename}.${Date.now()}.invalid${path.extname(basename) || '.json'}`,
  )
  const metadataPath = `${quarantinedPath}.meta.json`

  try {
    await ensureAssistantStateDirectory(quarantineRoot)
    await rename(input.filePath, quarantinedPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }

  const parsed = assistantQuarantineEntrySchema.parse({
    schema: ASSISTANT_QUARANTINE_ENTRY_SCHEMA,
    quarantineId,
    artifactKind: input.artifactKind,
    originalPath: input.filePath,
    quarantinedPath,
    metadataPath,
    quarantinedAt,
    errorCode: readErrorCode(input.error),
    message: redactAssistantStateString(errorMessage(input.error)),
  })

  await writeJsonFileAtomic(metadataPath, parsed)
  await appendAssistantRuntimeEventAtPaths(input.paths, {
    at: quarantinedAt,
    component: 'state',
    entityId: path.basename(input.filePath),
    entityType: input.artifactKind,
    kind: mapAssistantQuarantineRuntimeEventKind(input.artifactKind),
    level: 'warn',
    message: parsed.message,
    data: {
      metadataPath,
      originalPath: input.filePath,
      quarantinedPath,
    },
  }).catch(() => undefined)

  return parsed
}

export async function listAssistantQuarantineEntries(input: {
  artifactKind?: AssistantQuarantineArtifactKind | null
  limit?: number
  vault: string
}): Promise<AssistantQuarantineEntry[]> {
  return await listAssistantQuarantineEntriesAtPaths(
    resolveAssistantStatePaths(input.vault),
    input,
  )
}

export async function listAssistantQuarantineEntriesAtPaths(
  paths: AssistantStatePaths,
  input?: {
    artifactKind?: AssistantQuarantineArtifactKind | null
    limit?: number
  },
): Promise<AssistantQuarantineEntry[]> {
  const directories = [
    paths.quarantineDirectory,
    paths.outboxQuarantineDirectory,
  ]
  const entries: AssistantQuarantineEntry[] = []

  for (const directory of directories) {
    for (const filePath of await collectQuarantineMetadataPaths(directory)) {
      try {
        const raw = await readFile(filePath, 'utf8')
        const entry = assistantQuarantineEntrySchema.parse(JSON.parse(raw) as unknown)
        if (input?.artifactKind && entry.artifactKind !== input.artifactKind) {
          continue
        }
        entries.push(entry)
      } catch {
        // Keep summary resilient even when the quarantine metadata itself is malformed.
      }
    }
  }

  return entries
    .sort((left, right) =>
      right.quarantinedAt.localeCompare(left.quarantinedAt),
    )
    .slice(0, normalizeRecentLimit(input?.limit))
}

export async function summarizeAssistantQuarantines(
  input: { vault: string } | { paths: AssistantStatePaths },
): Promise<AssistantQuarantineSummary> {
  const paths = 'paths' in input ? input.paths : resolveAssistantStatePaths(input.vault)
  const entries = await listAssistantQuarantineEntriesAtPaths(paths, {
    limit: QUARANTINE_RECENT_LIMIT,
  })
  const totals = new Map<string, number>()
  for (const entry of await listAssistantQuarantineEntriesAtPaths(paths, {
    limit: Number.MAX_SAFE_INTEGER,
  })) {
    totals.set(entry.artifactKind, (totals.get(entry.artifactKind) ?? 0) + 1)
  }

  return assistantQuarantineSummarySchema.parse({
    total: [...totals.values()].reduce((sum, count) => sum + count, 0),
    byKind: Object.fromEntries([...totals.entries()].sort(([left], [right]) => left.localeCompare(right))),
    recent: entries,
  })
}

function resolveDefaultQuarantineDirectory(input: {
  artifactKind: AssistantQuarantineArtifactKind
  paths: AssistantStatePaths
}): string {
  if (input.artifactKind === 'outbox-intent') {
    return input.paths.outboxQuarantineDirectory
  }
  return path.join(input.paths.quarantineDirectory, input.artifactKind)
}

function mapAssistantQuarantineRuntimeEventKind(
  artifactKind: AssistantQuarantineArtifactKind,
) {
  switch (artifactKind) {
    case 'session':
      return 'session.quarantined' as const
    case 'transcript-distillation':
      return 'transcript-distillation.quarantined' as const
    case 'indexes':
      return 'indexes.quarantined' as const
    case 'automation':
      return 'automation.quarantined' as const
    case 'status':
      return 'status.snapshot.quarantined' as const
    case 'diagnostics-snapshot':
      return 'diagnostics.snapshot.quarantined' as const
    case 'failover':
      return 'failover.state.quarantined' as const
    case 'provider-route-recovery':
      return 'provider-route-recovery.quarantined' as const
    case 'runtime-budget':
      return 'runtime-budget.quarantined' as const
    case 'cron-store':
      return 'cron.store.quarantined' as const
    case 'cron-run':
      return 'cron.run.quarantined' as const
    case 'turn-receipt':
      return 'turn.receipt.quarantined' as const
    case 'outbox-intent':
      return 'outbox.intent.quarantined' as const
  }
}

async function collectQuarantineMetadataPaths(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readDirectoryEntries(directory)) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectQuarantineMetadataPaths(fullPath)))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.meta.json')) {
      continue
    }
    result.push(fullPath)
  }
  return result
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

function normalizeRecentLimit(value?: number): number {
  if (!Number.isFinite(value) || typeof value !== 'number') {
    return QUARANTINE_RECENT_LIMIT
  }
  return Math.min(Math.max(Math.trunc(value), 1), 512)
}

function readErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null
}
