import { readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantOutboxIntentSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import { ensureAssistantState } from '../store/persistence.js'
import { resolveAssistantStatePaths } from '../store.js'
import {
  compareAssistantTimestampsAscending,
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  writeJsonFileAtomic,
} from '../shared.js'
import { sanitizeAssistantOutboxIntentForPersistence } from '../redaction.js'
import {
  hashAssistantOutboxLegacyMediaDedupeIdentity,
  resolveAssistantOutboxIntentPath,
  resolveAssistantOutboxQuarantineDirectory,
} from './intents.js'
import { normalizeAssistantDeliveryError } from './retry-policy.js'
import { compareAssistantOutboxDeliverySequenceOrder } from './ordering.js'
import type { AssistantStatePaths } from '../store/paths.js'
import { readAssistantCronCanonicalRuntimeStore } from '../cron/runtime-state.js'
import {
  invalidateAssistantOutboxLookupProjectionAtPaths,
  persistAssistantOutboxLookupAwareCanonicalMutationAtPaths,
  readAssistantOutboxDedupeLookupAtPaths,
  type AssistantOutboxLookupReadMetrics,
} from './lookup-projection.js'

const ASSISTANT_TERMINAL_OUTBOX_RETENTION_LIMIT = 100
const ASSISTANT_TERMINAL_OUTBOX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const ASSISTANT_OUTBOX_INVENTORY_READ_CONCURRENCY = 4

export interface AssistantOutboxInventoryScanMetrics {
  bytesRead: number
  filesRead: number
}

export type AssistantOutboxDedupeResolution =
  | {
      intent: AssistantOutboxIntent
      kind: 'found'
      legacyDedupeLookupKeyUpgrade?: string
    }
  | { kind: 'not-found' }

export interface AssistantOutboxDedupeReadObservation {
  fallbackReason?: string
  lookup: AssistantOutboxLookupReadMetrics
  outboxScan?: AssistantOutboxInventoryScanMetrics & { elapsedMs: number }
}

export async function readAssistantOutboxIntent(
  vault: string,
  intentId: string,
): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  return readAssistantOutboxIntentAtPath(
    resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId),
    { vault },
  )
}

export async function saveAssistantOutboxIntent(
  vault: string,
  intent: AssistantOutboxIntent,
): Promise<AssistantOutboxIntent> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantOutboxIntentSchema.parse(
      sanitizeAssistantOutboxIntentForPersistence(intent),
    )
    const previous = await readAssistantOutboxIntentAtPath(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, parsed.intentId),
      { vault },
    )
    return persistAssistantOutboxIntentAtPaths({
      intent: parsed,
      paths,
      previous,
    })
  })
}

export async function persistAssistantOutboxIntentAtPaths(input: {
  intent: AssistantOutboxIntent
  paths: AssistantStatePaths
  previous: AssistantOutboxIntent | null
}): Promise<AssistantOutboxIntent> {
  const parsed = assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence(input.intent),
  )
  if (input.previous && input.previous.intentId !== parsed.intentId) {
    throw new TypeError(
      'Assistant outbox canonical mutation cannot change intent identity.',
    )
  }
  const persisted = sanitizeAssistantOutboxIntentForPersistence(parsed)
  await persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
    next: parsed,
    paths: input.paths,
    previous: input.previous,
    writeCanonical: async () => {
      await writeJsonFileAtomic(
        resolveAssistantOutboxIntentPath(
          input.paths.outboxDirectory,
          parsed.intentId,
        ),
        persisted,
      )
    },
  })
  return parsed
}

export async function removeAssistantOutboxIntentAtPaths(input: {
  intent: AssistantOutboxIntent
  intentPath?: string
  paths: AssistantStatePaths
}): Promise<void> {
  const canonicalPath = resolveAssistantOutboxIntentPath(
    input.paths.outboxDirectory,
    input.intent.intentId,
  )
  const intentPath = input.intentPath ?? canonicalPath
  if (path.resolve(intentPath) !== path.resolve(canonicalPath)) {
    throw new TypeError(
      'Assistant outbox canonical removal path does not match intent identity.',
    )
  }
  await persistAssistantOutboxLookupAwareCanonicalMutationAtPaths({
    next: null,
    paths: input.paths,
    previous: input.intent,
    writeCanonical: async () => {
      await rm(intentPath, { force: true })
    },
  })
}

export async function listAssistantOutboxIntentsLocal(
  vault: string,
  onScan?: (metrics: AssistantOutboxInventoryScanMetrics) => void,
): Promise<AssistantOutboxIntent[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  const entries = await readdir(paths.outboxDirectory, {
    withFileTypes: true,
  })
  const inventoryEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json'),
  )
  const intents: AssistantOutboxIntent[] = []
  let bytesRead = 0
  let filesRead = 0

  for (
    let index = 0;
    index < inventoryEntries.length;
    index += ASSISTANT_OUTBOX_INVENTORY_READ_CONCURRENCY
  ) {
    const batch = inventoryEntries.slice(
      index,
      index + ASSISTANT_OUTBOX_INVENTORY_READ_CONCURRENCY,
    )
    const batchIntents = await Promise.all(
      batch.map((entry) =>
        readAssistantOutboxIntentInventoryEntry(
          vault,
          path.join(paths.outboxDirectory, entry.name),
          (bytes) => {
            bytesRead += bytes
            filesRead += 1
          },
        ),
      ),
    )
    for (const intent of batchIntents) {
      if (intent) {
        intents.push(intent)
      }
    }
  }

  onScan?.({ bytesRead, filesRead })

  return intents.sort((left, right) =>
    compareAssistantTimestampsAscending(left.createdAt, right.createdAt) ||
    compareAssistantOutboxDeliverySequenceOrder(left, right),
  )
}

export async function pruneAssistantTerminalOutboxIntents(input: {
  now: Date
  paths: AssistantStatePaths
  vault: string
}): Promise<number> {
  await ensureAssistantState(input.paths)
  const entries = await readdir(input.paths.outboxDirectory, {
    withFileTypes: true,
  })
  const cutoffMs = input.now.getTime() - ASSISTANT_TERMINAL_OUTBOX_RETENTION_MS
  const terminalIntents: Array<{
    intent: AssistantOutboxIntent
    intentPath: string
    terminalAtMs: number
  }> = []
  const protectedGroupEmailOccurrencePrefixes =
    await readProtectedGroupEmailOccurrencePrefixes(input.paths)

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const intentPath = path.join(input.paths.outboxDirectory, entry.name)
    const intent = await readAssistantOutboxIntentInventoryEntry(input.vault, intentPath)
    if (
      !intent
      || !isTerminalAssistantOutboxIntent(intent)
      || isPruneProtectedAssistantOutboxIntent(
        intent,
        protectedGroupEmailOccurrencePrefixes,
      )
    ) {
      continue
    }

    terminalIntents.push({
      intent,
      intentPath,
      terminalAtMs: resolveAssistantOutboxTerminalTimestampMs(intent),
    })
  }

  terminalIntents.sort((left, right) => {
    const timeDelta = right.terminalAtMs - left.terminalAtMs
    if (Number.isFinite(timeDelta) && timeDelta !== 0) {
      return timeDelta
    }
    return compareAssistantTimestampsAscending(
      right.intent.createdAt,
      left.intent.createdAt,
    )
  })

  let pruned = 0
  let countPrunableIntentCount = 0
  for (const entry of terminalIntents) {
    const preserveUntilAgeCutoff = isGeneratedImageDeliveryEvidenceIntent(
      entry.intent,
    )
    const pruneByCount =
      !preserveUntilAgeCutoff
      && countPrunableIntentCount >= ASSISTANT_TERMINAL_OUTBOX_RETENTION_LIMIT
    if (!preserveUntilAgeCutoff) {
      countPrunableIntentCount += 1
    }
    const pruneByAge =
      Number.isFinite(entry.terminalAtMs) && entry.terminalAtMs < cutoffMs
    if (!pruneByCount && !pruneByAge) {
      continue
    }
    await removeAssistantOutboxIntentAtPaths({
      intent: entry.intent,
      intentPath: entry.intentPath,
      paths: input.paths,
    })
    pruned += 1
  }

  return pruned
}

export async function findAssistantOutboxIntentByDedupeIdentity(input: {
  dedupeKey: string
  deliveryIdempotencyKey?: string | null
  dedupeToken?: string | null
  onLookup?: (observation: AssistantOutboxDedupeReadObservation) => void
  vault: string
}): Promise<AssistantOutboxDedupeResolution> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const lookup = await readAssistantOutboxDedupeLookupAtPaths({
    dedupeKey: input.dedupeKey,
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    dedupeToken: input.dedupeToken,
    paths,
    reader: {
      readIntent: async (intentId, onBytesRead) =>
        readAssistantOutboxIntentAtPath(
          resolveAssistantOutboxIntentPath(paths.outboxDirectory, intentId),
          { onBytesRead, vault: input.vault },
        ),
    },
  })
  if (lookup.kind === 'found') {
    observeAssistantOutboxDedupeLookup(input.onLookup, {
      lookup: lookup.metrics,
    })
    return {
      intent: lookup.intent,
      kind: 'found',
      ...(lookup.legacyDedupeLookupKeyUpgrade
        ? {
            legacyDedupeLookupKeyUpgrade:
              lookup.legacyDedupeLookupKeyUpgrade,
          }
        : {}),
    }
  }
  if (lookup.kind === 'not-found') {
    observeAssistantOutboxDedupeLookup(input.onLookup, {
      lookup: lookup.metrics,
    })
    return { kind: 'not-found' }
  }

  let scanMetrics: AssistantOutboxInventoryScanMetrics = {
    bytesRead: 0,
    filesRead: 0,
  }
  const scanStartedAt = Date.now()
  const intents = await listAssistantOutboxIntentsLocal(input.vault, (metrics) => {
    scanMetrics = metrics
  })
  observeAssistantOutboxDedupeLookup(input.onLookup, {
    fallbackReason: lookup.reason,
    lookup: lookup.metrics,
    outboxScan: {
      ...scanMetrics,
      elapsedMs: Math.max(0, Date.now() - scanStartedAt),
    },
  })
  const activeIntents = intents.filter(isActiveAssistantOutboxIntent)
  const exactMatch = activeIntents.find((intent) => intent.dedupeKey === input.dedupeKey)
  if (exactMatch) {
    return { intent: exactMatch, kind: 'found' }
  }

  const dedupeToken = normalizeNullableString(input.dedupeToken)
  const deliveryIdempotencyKey = normalizeNullableString(input.deliveryIdempotencyKey)
  if (dedupeToken && dedupeToken === deliveryIdempotencyKey) {
    const transportKeyMatch = activeIntents.find(
      (intent) =>
        normalizeNullableString(intent.deliveryIdempotencyKey) ===
        deliveryIdempotencyKey,
    )
    if (transportKeyMatch) {
      return { intent: transportKeyMatch, kind: 'found' }
    }
  }

  const legacyMatch = activeIntents.find((intent) => {
    const legacyDedupeKey = hashAssistantOutboxLegacyMediaDedupeIdentity({
      dedupeToken,
      media: intent.media,
    })
    return legacyDedupeKey !== null && intent.dedupeKey === legacyDedupeKey
  }) ?? null
  return legacyMatch
    ? {
        intent: legacyMatch,
        kind: 'found',
        ...(legacyMatch.legacyDedupeLookupKey === undefined
          ? { legacyDedupeLookupKeyUpgrade: input.dedupeKey }
          : {}),
      }
    : { kind: 'not-found' }
}

function observeAssistantOutboxDedupeLookup(
  observer:
    | ((observation: AssistantOutboxDedupeReadObservation) => void)
    | undefined,
  observation: AssistantOutboxDedupeReadObservation,
): void {
  try {
    observer?.(observation)
  } catch {}
}

export async function readAssistantOutboxIntentAtPath(
  intentPath: string,
  options?: {
    onBytesRead?: (bytes: number) => void
    vault?: string
  },
): Promise<AssistantOutboxIntent | null> {
  try {
    const raw = await readFile(intentPath, 'utf8')
    try {
      options?.onBytesRead?.(Buffer.byteLength(raw, 'utf8'))
    } catch {}
    return assistantOutboxIntentSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    if (options?.vault) {
      return await quarantineAssistantOutboxIntentFile({
        error,
        intentPath,
        vault: options.vault,
      })
    }

    throw error
  }
}

export async function readAssistantOutboxIntentInventoryEntry(
  vault: string,
  intentPath: string,
  onBytesRead?: (bytes: number) => void,
): Promise<AssistantOutboxIntent | null> {
  return readAssistantOutboxIntentAtPath(intentPath, {
    ...(onBytesRead ? { onBytesRead } : {}),
    vault,
  })
}

export async function quarantineAssistantOutboxIntentFile(input: {
  error: unknown
  intentPath: string
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const resolvedIntentPath = path.resolve(input.intentPath)
    const resolvedOutboxDirectory = path.resolve(paths.outboxDirectory)
    if (
      path.dirname(resolvedIntentPath) !== resolvedOutboxDirectory ||
      !path.basename(resolvedIntentPath).endsWith('.json')
    ) {
      throw new TypeError(
        'Assistant outbox quarantine target must be a canonical intent file.',
      )
    }

    let currentError = input.error
    try {
      const raw = await readFile(resolvedIntentPath, 'utf8')
      try {
        return assistantOutboxIntentSchema.parse(JSON.parse(raw))
      } catch (error) {
        currentError = error
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }
      currentError = error
    }

    // The lock-owned re-read above prevents an earlier malformed observation
    // from quarantining a concurrently repaired canonical intent. Best-effort
    // invalidation prevents trusted misses after canonical evidence disappears;
    // a failure here cannot make disposable state escape into foreground work.
    await invalidateAssistantOutboxLookupProjectionAtPaths({ paths }).catch(
      () => undefined,
    )

    const quarantineDirectory = resolveAssistantOutboxQuarantineDirectory(
      paths.outboxDirectory,
    )
    const basename = path.basename(resolvedIntentPath, '.json')
    const quarantinePath = path.join(
      quarantineDirectory,
      `${basename}.${Date.now()}.invalid.json`,
    )

    try {
      await ensureAssistantStateDirectory(quarantineDirectory)
      await rename(resolvedIntentPath, quarantinePath)
    } catch (error) {
      if (isMissingFileError(error)) {
        return null
      }
      throw error
    }

    try {
      const deliveryError = normalizeAssistantDeliveryError(currentError)
      await recordAssistantDiagnosticEvent({
        vault: input.vault,
        code: deliveryError.code ?? 'ASSISTANT_OUTBOX_INTENT_INVALID',
        component: 'outbox',
        kind: 'outbox.intent.quarantined',
        level: 'warn',
        message: deliveryError.message,
      })
    } catch {}

    return null
  })
}

function isTerminalAssistantOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return (
    intent.status === 'sent' ||
    intent.status === 'failed' ||
    intent.status === 'abandoned'
  )
}

function isGeneratedImageDeliveryEvidenceIntent(
  intent: AssistantOutboxIntent,
): boolean {
  if (intent.media.length !== 1) {
    return false
  }
  const media = intent.media[0]
  return (
    media?.kind === 'vault_image'
    && media.source === 'gpt-image-2'
    && media.ref.startsWith('raw/captures/')
  )
}

function isPruneProtectedAssistantOutboxIntent(
  intent: AssistantOutboxIntent,
  protectedGroupEmailOccurrencePrefixes: readonly string[],
): boolean {
  if (intent.messageVolumeReceiptRecordedAt === null) {
    return true
  }
  if (
    intent.status === 'sent'
    && intent.privateCompletionContinuitySessionId !== undefined
    && intent.delivery !== null
    && intent.privateCompletionContinuity?.status !== 'applied'
  ) {
    return true
  }
  const deliveryIdempotencyKey = intent.deliveryIdempotencyKey
  if (
    !deliveryIdempotencyKey
    || !protectedGroupEmailOccurrencePrefixes.some((prefix) =>
      deliveryIdempotencyKey.startsWith(prefix)
    )
  ) {
    return false
  }
  const target = parseHostedEmailThreadTarget(intent.explicitTarget)
  return target?.targetKind === 'group'
}

async function readProtectedGroupEmailOccurrencePrefixes(
  paths: AssistantStatePaths,
): Promise<string[]> {
  const store = await readAssistantCronCanonicalRuntimeStore(paths, {
    reclaimStaleRunningClaims: false,
  })
  return store.jobs.flatMap((record) =>
    record.state.pendingOccurrenceAt
      ? [
          `group-email-effect:${record.jobId}:${record.state.pendingOccurrenceAt}:`,
          // Read-only migration support for effects accepted before the
          // generic group-email idempotency key shipped.
          `group-newsletter:${record.jobId}:${record.state.pendingOccurrenceAt}:`,
        ]
      : []
  )
}

function isActiveAssistantOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return intent.status !== 'failed' && intent.status !== 'abandoned'
}

function resolveAssistantOutboxTerminalTimestampMs(
  intent: AssistantOutboxIntent,
): number {
  const timestamp =
    intent.sentAt ?? intent.updatedAt ?? intent.lastAttemptAt ?? intent.createdAt
  const resolved = Date.parse(timestamp)
  return Number.isFinite(resolved) ? resolved : Number.NaN
}
