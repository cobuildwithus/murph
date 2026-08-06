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

const ASSISTANT_TERMINAL_OUTBOX_RETENTION_LIMIT = 100
const ASSISTANT_TERMINAL_OUTBOX_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const ASSISTANT_OUTBOX_INVENTORY_READ_CONCURRENCY = 4

export interface AssistantOutboxInventoryScanMetrics {
  bytesRead: number
  filesRead: number
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
    const persisted = sanitizeAssistantOutboxIntentForPersistence(parsed)
    await writeJsonFileAtomic(
      resolveAssistantOutboxIntentPath(paths.outboxDirectory, parsed.intentId),
      persisted,
    )
    return parsed
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
  const protectedNewsletterOccurrencePrefixes =
    await readProtectedNewsletterOccurrencePrefixes(input.paths)

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
        protectedNewsletterOccurrencePrefixes,
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
  for (const [index, entry] of terminalIntents.entries()) {
    const pruneByCount = index >= ASSISTANT_TERMINAL_OUTBOX_RETENTION_LIMIT
    const pruneByAge =
      Number.isFinite(entry.terminalAtMs) && entry.terminalAtMs < cutoffMs
    if (!pruneByCount && !pruneByAge) {
      continue
    }
    await rm(entry.intentPath, {
      force: true,
    })
    pruned += 1
  }

  return pruned
}

export async function findAssistantOutboxIntentByDedupeIdentity(input: {
  dedupeKey: string
  deliveryIdempotencyKey?: string | null
  dedupeToken?: string | null
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const intents = await listAssistantOutboxIntentsLocal(input.vault)
  const activeIntents = intents.filter(isActiveAssistantOutboxIntent)
  const exactMatch = activeIntents.find((intent) => intent.dedupeKey === input.dedupeKey)
  if (exactMatch) {
    return exactMatch
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
      return transportKeyMatch
    }
  }

  return (
    activeIntents.find((intent) => {
      const legacyDedupeKey = hashAssistantOutboxLegacyMediaDedupeIdentity({
        dedupeToken,
        media: intent.media,
      })
      return legacyDedupeKey !== null && intent.dedupeKey === legacyDedupeKey
    }) ?? null
  )
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
    options?.onBytesRead?.(Buffer.byteLength(raw, 'utf8'))
    return assistantOutboxIntentSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    if (options?.vault) {
      await quarantineAssistantOutboxIntentFile({
        error,
        intentPath,
        vault: options.vault,
      })
      return null
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
}): Promise<void> {
  const paths = resolveAssistantStatePaths(input.vault)
  const quarantineDirectory = resolveAssistantOutboxQuarantineDirectory(
    paths.outboxDirectory,
  )
  const basename = path.basename(input.intentPath, '.json')
  const quarantinePath = path.join(
    quarantineDirectory,
    `${basename}.${Date.now()}.invalid.json`,
  )

  try {
    await ensureAssistantStateDirectory(quarantineDirectory)
    await rename(input.intentPath, quarantinePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
    throw error
  }

  try {
    const deliveryError = normalizeAssistantDeliveryError(input.error)
    await recordAssistantDiagnosticEvent({
      vault: input.vault,
      code: deliveryError.code ?? 'ASSISTANT_OUTBOX_INTENT_INVALID',
      component: 'outbox',
      kind: 'outbox.intent.quarantined',
      level: 'warn',
      message: deliveryError.message,
    })
  } catch {}
}

function isTerminalAssistantOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return (
    intent.status === 'sent' ||
    intent.status === 'failed' ||
    intent.status === 'abandoned'
  )
}

function isPruneProtectedAssistantOutboxIntent(
  intent: AssistantOutboxIntent,
  protectedNewsletterOccurrencePrefixes: readonly string[],
): boolean {
  const deliveryIdempotencyKey = intent.deliveryIdempotencyKey
  if (
    !deliveryIdempotencyKey
    || !protectedNewsletterOccurrencePrefixes.some((prefix) =>
      deliveryIdempotencyKey.startsWith(prefix)
    )
  ) {
    return false
  }
  const target = parseHostedEmailThreadTarget(intent.explicitTarget)
  return target?.targetKind === 'group'
}

async function readProtectedNewsletterOccurrencePrefixes(
  paths: AssistantStatePaths,
): Promise<string[]> {
  const store = await readAssistantCronCanonicalRuntimeStore(paths, {
    reclaimStaleRunningClaims: false,
  })
  return store.jobs.flatMap((record) =>
    record.state.pendingOccurrenceAt
      ? [
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
