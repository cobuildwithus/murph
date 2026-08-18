import { createHash, randomUUID } from 'node:crypto'
import { access, readdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantOutboxIntentIdSchema,
  assistantOutboxIntentSchema,
  assistantResponseMediaSchema,
  type AssistantOutboxIntent,
  type AssistantResponseMedia,
} from '@murphai/operator-config/assistant-cli-contracts'
import * as z from '@murphai/contracts/zod-runtime'
import { parseHostedEmailThreadTarget } from '@murphai/runtime-state'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  adoptAssistantStateFile,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  withImmediateTransaction,
  writeSqliteRuntimeUserVersion,
} from '@murphai/runtime-state/node'
import { recordAssistantDiagnosticEvent } from '../diagnostics.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import { hasAssistantOutboxDeliveryEvidence } from '../response-media.js'
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
const ASSISTANT_OUTBOX_DEDUPE_DATABASE_NAME = 'outbox-dedupe.sqlite'
const ASSISTANT_OUTBOX_DEDUPE_DATABASE_VERSION = 1
const ASSISTANT_OUTBOX_LEGACY_DEDUPE_FALLBACK_LIMIT = 100
const ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT = 100

type AssistantOutboxDedupeRouteKind =
  | 'dedupe-key'
  | 'delivery-idempotency-key'
type AssistantOutboxDedupeDatabase = import('node:sqlite').DatabaseSync

class AssistantOutboxDedupeDatabaseValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssistantOutboxDedupeDatabaseValidationError'
  }
}

const assistantOutboxDedupeMediaListSchema = z
  .array(assistantResponseMediaSchema)
  .max(40)

export interface AssistantOutboxInventoryScanMetrics {
  bytesRead: number
  filesRead: number
}

export interface AssistantOutboxAutoReplyRouteQuery {
  actorId?: string | null
  channel: string
  deliveryTarget: string
  identityId?: string | null
  providerMessageId?: string | null
  threadId?: string | null
  vault: string
}

export interface AssistantOutboxPrivateCompletionRouteQuery {
  actorId: string | null
  bindingDeliveryKind: string
  bindingDeliveryTarget: string
  channel: string | null
  identityId: string | null
  threadId: string | null
  vault: string
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
    return await persistAssistantOutboxIntentAtPath({
      intent: parsed,
      intentPath: resolveAssistantOutboxIntentPath(
        paths.outboxDirectory,
        parsed.intentId,
      ),
      paths,
    })
  })
}

export async function persistAssistantOutboxIntentAtPath(input: {
  dedupeIdentityOrigin?: 'current' | 'unknown'
  intent: AssistantOutboxIntent
  intentPath: string
  paths: AssistantStatePaths
}): Promise<AssistantOutboxIntent> {
  const parsed = assistantOutboxIntentSchema.parse(
    sanitizeAssistantOutboxIntentForPersistence(input.intent),
  )
  const persisted = sanitizeAssistantOutboxIntentForPersistence(parsed)

  if (isActiveAssistantOutboxIntent(parsed)) {
    await synchronizeAssistantOutboxDedupeProjection(
      input.paths,
      parsed,
      input.dedupeIdentityOrigin ?? 'unknown',
    )
    await writeJsonFileAtomic(input.intentPath, persisted)
  } else {
    await writeJsonFileAtomic(input.intentPath, persisted)
    await synchronizeAssistantOutboxDedupeProjection(
      input.paths,
      parsed,
      input.dedupeIdentityOrigin ?? 'unknown',
    )
  }
  return parsed
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
    await rm(entry.intentPath, {
      force: true,
    })
    await removeAssistantOutboxDedupeProjectionIntent(
      input.paths,
      entry.intent.intentId,
    )
    pruned += 1
  }

  return pruned
}

export async function findAssistantOutboxIntentByDedupeIdentity(input: {
  dedupeKey: string
  dedupeToken?: string | null
  deliveryIdempotencyKey?: string | null
  legacyDedupeKey?: string | null
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const routes = [
    {
      kind: 'dedupe-key' as const,
      key: input.dedupeKey,
      matches: (intent: AssistantOutboxIntent) =>
        intent.dedupeKey === input.dedupeKey,
    },
    ...(normalizeNullableString(input.deliveryIdempotencyKey)
      ? [{
          kind: 'delivery-idempotency-key' as const,
          key: normalizeNullableString(input.deliveryIdempotencyKey)!,
          matches: (intent: AssistantOutboxIntent) =>
            normalizeNullableString(intent.deliveryIdempotencyKey) ===
            normalizeNullableString(input.deliveryIdempotencyKey),
        }]
      : []),
    ...(normalizeNullableString(input.legacyDedupeKey)
      ? [{
          kind: 'dedupe-key' as const,
          key: normalizeNullableString(input.legacyDedupeKey)!,
          matches: (intent: AssistantOutboxIntent) =>
            intent.dedupeKey === normalizeNullableString(input.legacyDedupeKey),
        }]
      : []),
  ]
  const projectedMatch = await findAssistantOutboxIntentByProjectedRoutes({
    paths,
    rebuildOnStale: true,
    routes,
    vault: input.vault,
  })
  if (projectedMatch) {
    return projectedMatch
  }

  return await findAssistantOutboxIntentByLegacyMediaIdentity({
    dedupeToken: input.dedupeToken,
    paths,
    vault: input.vault,
  })
}

export async function listAssistantOutboxIntentsForAutoReplyRoute(
  input: AssistantOutboxAutoReplyRouteQuery,
): Promise<AssistantOutboxIntent[]> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const routeTags = resolveAssistantOutboxAutoReplyQueryTags(input)
  const providerMessageId = normalizeNullableString(input.providerMessageId)
  const providerTags = providerMessageId
    ? [resolveAssistantOutboxForegroundTagDigest(
        'auto-provider-message',
        { providerMessageId },
      )]
    : []
  const intentIds = new Set([
    ...await readAssistantOutboxForegroundTagIntentIds({
      limit: ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT + 1,
      newestFirst: true,
      paths,
      tagDigests: routeTags,
    }),
    ...await readAssistantOutboxForegroundTagIntentIds({
      limit: ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT + 1,
      newestFirst: true,
      paths,
      tagDigests: providerTags,
    }),
  ])
  if (intentIds.size > ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT) {
    throw new VaultCliError(
      'ASSISTANT_AUTO_REPLY_ROUTE_BOUND_EXCEEDED',
      `Assistant auto-reply history exceeded its fixed ${ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT}-intent route bound.`,
    )
  }
  return await readAssistantOutboxProjectedIntents({
    intentIds: [...intentIds],
    paths,
    vault: input.vault,
  })
}

export async function listAssistantOutboxIntentsForPrivateCompletionRoute(
  input: AssistantOutboxPrivateCompletionRouteQuery,
): Promise<AssistantOutboxIntent[]> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)
  const tagDigest = resolveAssistantOutboxForegroundTagDigest(
    'private-completion-route',
    {
      actorId: input.actorId,
      bindingDeliveryKind: input.bindingDeliveryKind,
      bindingDeliveryTarget: input.bindingDeliveryTarget,
      channel: input.channel,
      identityId: input.identityId,
      threadId: input.threadId,
    },
  )
  const intentIds = await readAssistantOutboxForegroundTagIntentIds({
    limit: ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT + 1,
    newestFirst: false,
    paths,
    tagDigests: [tagDigest],
  })
  if (intentIds.length > ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT) {
    throw new VaultCliError(
      'ASSISTANT_PRIVATE_COMPLETION_ROUTE_BOUND_EXCEEDED',
      `Assistant private completion recovery exceeded its fixed ${ASSISTANT_OUTBOX_FOREGROUND_ROUTE_LIMIT}-intent route bound.`,
    )
  }
  return await readAssistantOutboxProjectedIntents({
    intentIds,
    paths,
    vault: input.vault,
  })
}

async function findAssistantOutboxIntentByProjectedRoutes(input: {
  paths: AssistantStatePaths
  rebuildOnStale: boolean
  routes: readonly {
    kind: AssistantOutboxDedupeRouteKind
    key: string
    matches: (intent: AssistantOutboxIntent) => boolean
  }[]
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const intentIds = await readAssistantOutboxDedupeRoutes(
    input.paths,
    input.routes,
  )
  for (const [index, route] of input.routes.entries()) {
    const intentId = intentIds[index]
    if (!intentId) {
      continue
    }
    const intent = await readAssistantOutboxIntentAtPath(
      resolveAssistantOutboxIntentPath(input.paths.outboxDirectory, intentId),
      { vault: input.vault },
    )
    if (
      intent &&
      isActiveAssistantOutboxIntent(intent) &&
      route.matches(intent)
    ) {
      return intent
    }
    if (input.rebuildOnStale) {
      await rebuildAssistantOutboxDedupeDatabaseWithWriteLock(input.paths)
      return await findAssistantOutboxIntentByProjectedRoutes({
        ...input,
        rebuildOnStale: false,
      })
    }
    await removeAssistantOutboxDedupeProjectionRouteIfOwned({
      intentId,
      kind: route.kind,
      key: route.key,
      paths: input.paths,
    })
  }
  return null
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
  skipDedupeProjectionUpdate?: boolean
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

  if (input.skipDedupeProjectionUpdate !== true) {
    await removeAssistantOutboxDedupeProjectionIntent(paths, basename)
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

async function readAssistantOutboxDedupeRoutes(
  paths: AssistantStatePaths,
  routes: readonly {
    kind: AssistantOutboxDedupeRouteKind
    key: string
  }[],
): Promise<Array<string | null>> {
  const read = async () => await withAssistantOutboxDedupeDatabase(
    paths,
    (database) => {
      const readRoute = database.prepare(`
        SELECT intent_id AS intentId
        FROM assistant_outbox_dedupe_routes
        WHERE kind = ? AND key_digest = ?
        ORDER BY created_at_ms ASC, intent_id ASC
        LIMIT 1
      `)
      return routes.map((route) => {
        const row = readRoute.get(
          route.kind,
          resolveAssistantOutboxDedupeKeyDigest(route.kind, route.key),
        ) as { intentId?: unknown } | undefined
        if (!row) {
          return null
        }
        try {
          return assistantOutboxIntentIdSchema.parse(row.intentId)
        } catch (error) {
          throw new AssistantOutboxDedupeDatabaseValidationError(
            'Assistant outbox dedupe database contains an invalid intent id.',
            { cause: error },
          )
        }
      })
    },
  )
  try {
    return await read()
  } catch (error) {
    if (!(error instanceof AssistantOutboxDedupeDatabaseValidationError)) {
      throw error
    }
    await rebuildAssistantOutboxDedupeDatabaseWithWriteLock(paths)
    return await read()
  }
}

async function readAssistantOutboxForegroundTagIntentIds(input: {
  limit: number
  newestFirst: boolean
  paths: AssistantStatePaths
  tagDigests: readonly string[]
}): Promise<string[]> {
  const tagDigests = [...new Set(input.tagDigests)]
  if (tagDigests.length === 0) {
    return []
  }
  return await withAssistantOutboxDedupeDatabase(input.paths, (database) => {
    const placeholders = tagDigests.map(() => '?').join(', ')
    const rows = database.prepare(`
      SELECT intent_id AS intentId
      FROM assistant_outbox_foreground_tags
      WHERE tag_digest IN (${placeholders})
      GROUP BY intent_id
      ORDER BY
        ${input.newestFirst ? 'max' : 'min'}(created_at_ms)
          ${input.newestFirst ? 'DESC' : 'ASC'},
        intent_id ${input.newestFirst ? 'DESC' : 'ASC'}
      LIMIT ?
    `).all(...tagDigests, input.limit) as Array<{ intentId?: unknown }>
    return rows.map((row) => {
      try {
        return assistantOutboxIntentIdSchema.parse(row.intentId)
      } catch (error) {
        throw new AssistantOutboxDedupeDatabaseValidationError(
          'Assistant outbox dedupe database contains an invalid foreground route intent id.',
          { cause: error },
        )
      }
    })
  })
}

async function readAssistantOutboxProjectedIntents(input: {
  intentIds: readonly string[]
  paths: AssistantStatePaths
  vault: string
}): Promise<AssistantOutboxIntent[]> {
  const intents: AssistantOutboxIntent[] = []
  for (const intentId of input.intentIds) {
    const intent = await readAssistantOutboxIntentAtPath(
      resolveAssistantOutboxIntentPath(input.paths.outboxDirectory, intentId),
      { vault: input.vault },
    )
    if (intent) {
      intents.push(intent)
      continue
    }
    await removeAssistantOutboxDedupeProjectionIntent(input.paths, intentId)
  }
  return intents.sort((left, right) =>
    compareAssistantTimestampsAscending(left.createdAt, right.createdAt) ||
    compareAssistantOutboxDeliverySequenceOrder(left, right),
  )
}

async function findAssistantOutboxIntentByLegacyMediaIdentity(input: {
  dedupeToken?: string | null
  paths: AssistantStatePaths
  vault: string
}): Promise<AssistantOutboxIntent | null> {
  const dedupeToken = normalizeNullableString(input.dedupeToken)
  if (!dedupeToken) {
    return null
  }
  const candidates = await readAssistantOutboxLegacyDedupeCandidates(
    input.paths,
  )
  if (candidates === null) {
    return null
  }
  const boundedCandidates = candidates.slice(
    0,
    ASSISTANT_OUTBOX_LEGACY_DEDUPE_FALLBACK_LIMIT,
  )
  const routes = boundedCandidates.map((candidate) => {
    const legacyDedupeKey = hashAssistantOutboxLegacyMediaDedupeIdentity({
      dedupeToken,
      media: candidate.media,
    })
    if (!legacyDedupeKey) {
      throw new Error('Expected a normalized legacy dedupe key.')
    }
    return {
      kind: 'dedupe-key' as const,
      key: legacyDedupeKey,
      matches: (intent: AssistantOutboxIntent) =>
        intent.dedupeKey === legacyDedupeKey,
    }
  })
  const projectedMatch = await findAssistantOutboxIntentByProjectedRoutes({
    paths: input.paths,
    rebuildOnStale: true,
    routes,
    vault: input.vault,
  })
  if (projectedMatch) {
    return projectedMatch
  }
  if (candidates.length > ASSISTANT_OUTBOX_LEGACY_DEDUPE_FALLBACK_LIMIT) {
    throw new VaultCliError(
      'ASSISTANT_OUTBOX_LEGACY_DEDUPE_BOUND_EXCEEDED',
      `Assistant outbox legacy dedupe recovery exceeded its fixed ${ASSISTANT_OUTBOX_LEGACY_DEDUPE_FALLBACK_LIMIT}-media-identity bound.`,
    )
  }
  return null
}

async function readAssistantOutboxLegacyDedupeCandidates(
  paths: AssistantStatePaths,
): Promise<null | Array<{
  media: readonly AssistantResponseMedia[]
}>> {
  const read = async () => await withAssistantOutboxDedupeDatabase(
    paths,
    (database) => {
      const metadata = database.prepare(`
        SELECT legacy_fallback_required AS legacyFallbackRequired
        FROM assistant_outbox_dedupe_metadata
        WHERE singleton = 1
      `).get() as { legacyFallbackRequired?: unknown } | undefined
      if (metadata?.legacyFallbackRequired === 0) {
        return null
      }
      if (metadata?.legacyFallbackRequired !== 1) {
        throw new AssistantOutboxDedupeDatabaseValidationError(
          'Assistant outbox dedupe database has invalid fallback metadata.',
        )
      }
      const rows = database.prepare(`
        SELECT
          media_json AS mediaJson
        FROM assistant_outbox_legacy_candidates
        WHERE media_json IS NOT NULL
        GROUP BY media_json
        ORDER BY min(created_at_ms) ASC, min(intent_id) ASC
        LIMIT ?
      `).all(ASSISTANT_OUTBOX_LEGACY_DEDUPE_FALLBACK_LIMIT + 1) as Array<{
        mediaJson?: unknown
      }>
      return rows.map((row) => {
        try {
          const mediaValue = JSON.parse(String(row.mediaJson)) as unknown
          assistantOutboxDedupeMediaListSchema.parse(mediaValue)
          return {
            media: mediaValue as readonly AssistantResponseMedia[],
          }
        } catch (error) {
          throw new AssistantOutboxDedupeDatabaseValidationError(
            'Assistant outbox dedupe database contains an invalid legacy candidate.',
            { cause: error },
          )
        }
      })
    },
  )
  try {
    return await read()
  } catch (error) {
    if (!(error instanceof AssistantOutboxDedupeDatabaseValidationError)) {
      throw error
    }
    await rebuildAssistantOutboxDedupeDatabaseWithWriteLock(paths)
    return await read()
  }
}

async function synchronizeAssistantOutboxDedupeProjection(
  paths: AssistantStatePaths,
  intent: AssistantOutboxIntent,
  dedupeIdentityOrigin: 'current' | 'unknown',
): Promise<void> {
  await withAssistantOutboxDedupeDatabase(paths, (database) => {
    withImmediateTransaction(database, () => {
      const previousCandidate = database.prepare(`
        SELECT
          dedupe_key AS dedupeKey,
          media_json AS mediaJson
        FROM assistant_outbox_legacy_candidates
        WHERE intent_id = ?
      `).get(intent.intentId) as {
        dedupeKey?: unknown
        mediaJson?: unknown
      } | undefined
      const legacyIdentityPossible =
        typeof previousCandidate?.dedupeKey === 'string'
          ? previousCandidate.dedupeKey !== intent.dedupeKey
          : dedupeIdentityOrigin === 'unknown' &&
            /^[a-f0-9]{40}$/u.test(intent.dedupeKey)
      database.prepare(`
        DELETE FROM assistant_outbox_dedupe_routes
        WHERE intent_id = ?
      `).run(intent.intentId)
      database.prepare(`
        DELETE FROM assistant_outbox_legacy_candidates
        WHERE intent_id = ?
      `).run(intent.intentId)
      database.prepare(`
        DELETE FROM assistant_outbox_foreground_tags
        WHERE intent_id = ?
      `).run(intent.intentId)
      const insertForegroundTag = database.prepare(`
        INSERT INTO assistant_outbox_foreground_tags (
          tag_digest,
          intent_id,
          created_at_ms
        ) VALUES (?, ?, ?)
      `)
      for (const tagDigest of resolveAssistantOutboxForegroundTagDigests(
        intent,
      )) {
        insertForegroundTag.run(
          tagDigest,
          intent.intentId,
          Date.parse(intent.createdAt),
        )
      }
      if (!isActiveAssistantOutboxIntent(intent)) {
        return
      }
      const insertRoute = database.prepare(`
        INSERT INTO assistant_outbox_dedupe_routes (
          kind,
          key_digest,
          intent_id,
          created_at_ms
        ) VALUES (?, ?, ?, ?)
      `)
      for (const route of resolveAssistantOutboxDedupeRoutes(intent)) {
        insertRoute.run(
          route.kind,
          resolveAssistantOutboxDedupeKeyDigest(route.kind, route.key),
          intent.intentId,
          Date.parse(intent.createdAt),
        )
      }
      database.prepare(`
        INSERT INTO assistant_outbox_legacy_candidates (
          intent_id,
          dedupe_key,
          media_json,
          created_at_ms
        ) VALUES (?, ?, ?, ?)
      `).run(
        intent.intentId,
        intent.dedupeKey,
        legacyIdentityPossible || typeof previousCandidate?.mediaJson === 'string'
          ? JSON.stringify(intent.media)
          : null,
        Date.parse(intent.createdAt),
      )
      if (legacyIdentityPossible) {
        database.prepare(`
          UPDATE assistant_outbox_dedupe_metadata
          SET legacy_fallback_required = 1
          WHERE singleton = 1
        `).run()
      }
    })
  })
}

async function removeAssistantOutboxDedupeProjectionIntent(
  paths: AssistantStatePaths,
  intentId: string,
): Promise<void> {
  await withAssistantOutboxDedupeDatabase(paths, (database) => {
    withImmediateTransaction(database, () => {
      database.prepare(`
        DELETE FROM assistant_outbox_dedupe_routes
        WHERE intent_id = ?
      `).run(intentId)
      database.prepare(`
        DELETE FROM assistant_outbox_legacy_candidates
        WHERE intent_id = ?
      `).run(intentId)
      database.prepare(`
        DELETE FROM assistant_outbox_foreground_tags
        WHERE intent_id = ?
      `).run(intentId)
    })
  })
}

async function removeAssistantOutboxDedupeProjectionRouteIfOwned(input: {
  intentId: string
  kind: AssistantOutboxDedupeRouteKind
  key: string
  paths: AssistantStatePaths
}): Promise<void> {
  await withAssistantOutboxDedupeDatabase(input.paths, (database) => {
    database.prepare(`
      DELETE FROM assistant_outbox_dedupe_routes
      WHERE kind = ? AND key_digest = ? AND intent_id = ?
    `).run(
      input.kind,
      resolveAssistantOutboxDedupeKeyDigest(input.kind, input.key),
      input.intentId,
    )
  })
}

function resolveAssistantOutboxDedupeRoutes(
  intent: AssistantOutboxIntent,
): Array<{
  kind: AssistantOutboxDedupeRouteKind
  key: string
}> {
  const deliveryIdempotencyKey = normalizeNullableString(
    intent.deliveryIdempotencyKey,
  )
  return [
    {
      kind: 'dedupe-key',
      key: intent.dedupeKey,
    },
    ...(deliveryIdempotencyKey
      ? [{
          kind: 'delivery-idempotency-key' as const,
          key: deliveryIdempotencyKey,
        }]
      : []),
  ]
}

function resolveAssistantOutboxForegroundTagDigests(
  intent: AssistantOutboxIntent,
): string[] {
  const tags = new Set<string>()
  const bindingDelivery = intent.bindingDelivery
  if (
    isActiveAssistantOutboxIntent(intent) &&
    bindingDelivery
    && intent.threadIsDirect === true
    && intent.privateCompletionContinuitySessionId !== undefined
    && intent.privateCompletionContinuity?.status !== 'applied'
  ) {
    tags.add(resolveAssistantOutboxForegroundTagDigest(
      'private-completion-route',
      {
        actorId: intent.actorId,
        bindingDeliveryKind: bindingDelivery.kind,
        bindingDeliveryTarget: bindingDelivery.target,
        channel: intent.channel,
        identityId: intent.identityId,
        threadId: intent.threadId,
      },
    ))
  }

  if (!hasAssistantOutboxDeliveryEvidence(intent, true)) {
    return [...tags]
  }

  const delivery = intent.delivery
  if (!delivery || delivery.kind === 'message-reaction') {
    return [...tags]
  }
  const channel = normalizeNullableString(delivery.channel)
  if (!channel) {
    return [...tags]
  }
  const targets = [...new Set([
    normalizeNullableString(delivery.target),
    normalizeNullableString(delivery.providerThreadId),
  ].filter((value): value is string => value !== null))]
  const constraintVariants = resolveAssistantOutboxAutoReplyConstraintVariants({
    actorId: intent.actorId,
    identityId: intent.identityId,
    threadId: intent.threadId,
  })
  for (const constraints of constraintVariants) {
    for (const deliveryTarget of targets) {
      tags.add(resolveAssistantOutboxForegroundTagDigest(
        'auto-conversation-target',
        { channel, deliveryTarget, ...constraints },
      ))
    }
    const threadId = normalizeNullableString(intent.threadId)
    if (channel === 'email' && threadId) {
      tags.add(resolveAssistantOutboxForegroundTagDigest(
        'auto-email-thread',
        { channel, threadId, ...constraints },
      ))
    }
  }
  if (channel === 'linq') {
    for (const deliveryTarget of targets) {
      tags.add(resolveAssistantOutboxForegroundTagDigest(
        'auto-linq-target',
        { channel, deliveryTarget },
      ))
    }
  }
  for (const providerMessageId of resolveAssistantOutboxProviderMessageIds(
    delivery,
  )) {
    tags.add(resolveAssistantOutboxForegroundTagDigest(
      'auto-provider-message',
      { providerMessageId },
    ))
  }
  return [...tags]
}

function resolveAssistantOutboxAutoReplyQueryTags(
  input: AssistantOutboxAutoReplyRouteQuery,
): string[] {
  const channel = normalizeNullableString(input.channel)
  const deliveryTarget = normalizeNullableString(input.deliveryTarget)
  if (!channel || !deliveryTarget) {
    return []
  }
  const constraints = resolveAssistantOutboxAutoReplyQueryConstraints(input)
  const tags = [resolveAssistantOutboxForegroundTagDigest(
    'auto-conversation-target',
    { channel, deliveryTarget, ...constraints },
  )]
  const threadId = normalizeNullableString(input.threadId)
  if (channel === 'email' && threadId) {
    tags.push(resolveAssistantOutboxForegroundTagDigest(
      'auto-email-thread',
      { channel, threadId, ...constraints },
    ))
  }
  if (channel === 'linq') {
    tags.push(resolveAssistantOutboxForegroundTagDigest(
      'auto-linq-target',
      { channel, deliveryTarget },
    ))
  }
  return [...new Set(tags)]
}

function resolveAssistantOutboxAutoReplyQueryConstraints(input: {
  actorId?: string | null
  identityId?: string | null
  threadId?: string | null
}): Record<string, string> {
  const constraints: Record<string, string> = {}
  const actorId = normalizeNullableString(input.actorId)
  const identityId = normalizeNullableString(input.identityId)
  const threadId = normalizeNullableString(input.threadId)
  if (actorId) {
    constraints.actorId = actorId
  }
  if (identityId) {
    constraints.identityId = identityId
  }
  if (threadId) {
    constraints.threadId = threadId
  }
  return constraints
}

function resolveAssistantOutboxAutoReplyConstraintVariants(input: {
  actorId?: string | null
  identityId?: string | null
  threadId?: string | null
}): Array<Record<string, string>> {
  let variants: Array<Record<string, string>> = [{}]
  for (const [key, value] of Object.entries(
    resolveAssistantOutboxAutoReplyQueryConstraints(input),
  )) {
    variants = variants.flatMap((variant) => [
      variant,
      { ...variant, [key]: value },
    ])
  }
  return variants
}

function resolveAssistantOutboxProviderMessageIds(
  delivery: Exclude<AssistantOutboxIntent['delivery'], null>,
): string[] {
  if (delivery.kind === 'message-reaction') {
    return []
  }
  return [...new Set([
    ...(Array.isArray(delivery.providerMessageIds)
      ? delivery.providerMessageIds
      : []),
    delivery.providerMessageId,
  ].map(normalizeNullableString)
    .filter((value): value is string => value !== null))]
}

function resolveAssistantOutboxForegroundTagDigest(
  kind: string,
  value: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind, value }))
    .digest('hex')
}

function resolveAssistantOutboxDedupeKeyDigest(
  kind: AssistantOutboxDedupeRouteKind,
  key: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ kind, key }))
    .digest('hex')
}

async function withAssistantOutboxDedupeDatabase<T>(
  paths: AssistantStatePaths,
  operation: (database: AssistantOutboxDedupeDatabase) => T,
): Promise<T> {
  const database = await openOrRebuildAssistantOutboxDedupeDatabase(paths)
  try {
    const result = operation(database)
    database.close()
    return result
  } catch (error) {
    try {
      database.close()
    } catch {
      // Preserve the operation or close error for the shared recovery policy.
    }
    if (isAssistantOutboxDedupeProjectionRecoveryError(error)) {
      // Never replay a callback that may have reached a write with an ambiguous
      // commit outcome. The next ordinary attempt rebuilds before its operation.
      await withAssistantOutboxDedupeRecoveryWriteLock(
        paths,
        async (lockedPaths) => {
          if (await assistantOutboxDedupePathExists(
            resolveAssistantOutboxDedupeDatabasePath(lockedPaths),
          )) {
            await quarantineAssistantOutboxDedupeDatabase(lockedPaths, error)
          }
        },
      )
    }
    throw error
  }
}

async function openOrRebuildAssistantOutboxDedupeDatabase(
  paths: AssistantStatePaths,
): Promise<AssistantOutboxDedupeDatabase> {
  const databasePath = resolveAssistantOutboxDedupeDatabasePath(paths)
  if (await assistantOutboxDedupePathExists(databasePath)) {
    try {
      return openAssistantOutboxDedupeDatabase(paths)
    } catch (error) {
      if (!isAssistantOutboxDedupeProjectionRecoveryError(error)) {
        throw error
      }
    }
  }
  return await withAssistantOutboxDedupeRecoveryWriteLock(
    paths,
    async (lockedPaths) => {
      const lockedDatabasePath = resolveAssistantOutboxDedupeDatabasePath(
        lockedPaths,
      )
      if (await assistantOutboxDedupePathExists(lockedDatabasePath)) {
        try {
          return openAssistantOutboxDedupeDatabase(lockedPaths)
        } catch (error) {
          if (!isAssistantOutboxDedupeProjectionRecoveryError(error)) {
            throw error
          }
          await quarantineAssistantOutboxDedupeDatabase(lockedPaths, error)
        }
      }
      return await rebuildAssistantOutboxDedupeDatabase(lockedPaths)
    },
  )
}

async function withAssistantOutboxDedupeRecoveryWriteLock<T>(
  paths: AssistantStatePaths,
  operation: (lockedPaths: AssistantStatePaths) => Promise<T>,
): Promise<T> {
  return await withAssistantRuntimeWriteLock(
    paths.absoluteVaultRoot,
    operation,
  )
}

async function rebuildAssistantOutboxDedupeDatabaseWithWriteLock(
  paths: AssistantStatePaths,
): Promise<void> {
  await withAssistantOutboxDedupeRecoveryWriteLock(
    paths,
    async (lockedPaths) => {
      const rebuilt = await rebuildAssistantOutboxDedupeDatabase(lockedPaths)
      rebuilt.close()
    },
  )
}

function openAssistantOutboxDedupeDatabase(
  paths: AssistantStatePaths,
): AssistantOutboxDedupeDatabase {
  const database = openSqliteRuntimeDatabase(
    resolveAssistantOutboxDedupeDatabasePath(paths),
    {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    },
  )
  try {
    const version = readSqliteRuntimeUserVersion(database)
    if (version !== ASSISTANT_OUTBOX_DEDUPE_DATABASE_VERSION) {
      throw new AssistantOutboxDedupeDatabaseValidationError(
        `Unsupported assistant outbox dedupe database version: ${version}.`,
      )
    }
    assertAssistantOutboxDedupeDatabaseShape(database)
    return database
  } catch (error) {
    try {
      database.close()
    } catch {
      // Preserve the validation or SQLite error for the recovery boundary.
    }
    throw error
  }
}

function assertAssistantOutboxDedupeDatabaseShape(
  database: AssistantOutboxDedupeDatabase,
): void {
  try {
    database.prepare(`
      SELECT kind, key_digest, intent_id, created_at_ms
      FROM assistant_outbox_dedupe_routes
      LIMIT 0
    `).all()
    database.prepare(`
      SELECT intent_id, dedupe_key, media_json, created_at_ms
      FROM assistant_outbox_legacy_candidates
      LIMIT 0
    `).all()
    database.prepare(`
      SELECT tag_digest, intent_id, created_at_ms
      FROM assistant_outbox_foreground_tags
      LIMIT 0
    `).all()
    const metadata = database.prepare(`
      SELECT legacy_fallback_required
      FROM assistant_outbox_dedupe_metadata
      WHERE singleton = 1
    `).get() as { legacy_fallback_required?: unknown } | undefined
    if (
      metadata?.legacy_fallback_required !== 0 &&
      metadata?.legacy_fallback_required !== 1
    ) {
      throw new AssistantOutboxDedupeDatabaseValidationError(
        'Assistant outbox dedupe database has invalid fallback metadata.',
      )
    }
    const legacyOrderIndex = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name = 'assistant_outbox_legacy_candidates_order'
    `).get() as { name?: unknown } | undefined
    if (legacyOrderIndex?.name !== 'assistant_outbox_legacy_candidates_order') {
      throw new AssistantOutboxDedupeDatabaseValidationError(
        'Assistant outbox dedupe database is missing its legacy candidate order index.',
      )
    }
    const routeLookupIndex = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name = 'assistant_outbox_dedupe_routes_lookup'
    `).get() as { name?: unknown } | undefined
    if (routeLookupIndex?.name !== 'assistant_outbox_dedupe_routes_lookup') {
      throw new AssistantOutboxDedupeDatabaseValidationError(
        'Assistant outbox dedupe database is missing its route lookup index.',
      )
    }
    const foregroundTagIndex = database.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND name = 'assistant_outbox_foreground_tags_lookup'
    `).get() as { name?: unknown } | undefined
    if (
      foregroundTagIndex?.name !== 'assistant_outbox_foreground_tags_lookup'
    ) {
      throw new AssistantOutboxDedupeDatabaseValidationError(
        'Assistant outbox dedupe database is missing its foreground tag index.',
      )
    }
  } catch (error) {
    if (error instanceof AssistantOutboxDedupeDatabaseValidationError) {
      throw error
    }
    if (!isAssistantOutboxDedupeDatabaseShapeError(error)) {
      throw error
    }
    throw new AssistantOutboxDedupeDatabaseValidationError(
      'Assistant outbox dedupe database has an invalid schema.',
      { cause: error },
    )
  }
}

function isAssistantOutboxDedupeDatabaseShapeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as {
    code?: unknown
    errcode?: unknown
    message?: unknown
  }
  return (
    candidate.code === 'ERR_SQLITE_ERROR' &&
    candidate.errcode === 1 &&
    typeof candidate.message === 'string' &&
    /^(?:no such (?:column|table)|table .* has no column named)/u.test(
      candidate.message,
    )
  )
}

// This is the single destructive classification for both opening and using the
// projection. All unlisted SQLite failures preserve the active database.
function isAssistantOutboxDedupeProjectionRecoveryError(
  error: unknown,
): boolean {
  if (error instanceof AssistantOutboxDedupeDatabaseValidationError) {
    return true
  }
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as {
    code?: unknown
    errcode?: unknown
  }
  if (
    candidate.code !== 'ERR_SQLITE_ERROR' ||
    typeof candidate.errcode !== 'number'
  ) {
    return false
  }
  const primaryCode = candidate.errcode & 0xff
  return primaryCode === 11 || primaryCode === 26
}

async function rebuildAssistantOutboxDedupeDatabase(
  paths: AssistantStatePaths,
): Promise<AssistantOutboxDedupeDatabase> {
  const intents = await collectAssistantOutboxIntentsForDedupeRebuild(paths)
  const databasePath = resolveAssistantOutboxDedupeDatabasePath(paths)
  const rebuildPath = `${databasePath}.${randomUUID()}.rebuild`
  await removeAssistantOutboxDedupeDatabaseSidecars(rebuildPath)
  await rm(rebuildPath, { force: true })

  let rebuilt: AssistantOutboxDedupeDatabase | null = null
  try {
    rebuilt = openSqliteRuntimeDatabase(rebuildPath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    await adoptAssistantStateFile(rebuildPath)
    initializeAssistantOutboxDedupeDatabase(rebuilt, intents)
    rebuilt.close()
    rebuilt = null

    await removeAssistantOutboxDedupeDatabaseSidecars(databasePath)
    await rename(rebuildPath, databasePath)
  } catch (error) {
    rebuilt?.close()
    await rm(rebuildPath, { force: true }).catch(() => undefined)
    await removeAssistantOutboxDedupeDatabaseSidecars(rebuildPath)
    throw error
  }

  return openAssistantOutboxDedupeDatabase(paths)
}

async function collectAssistantOutboxIntentsForDedupeRebuild(
  paths: AssistantStatePaths,
): Promise<AssistantOutboxIntent[]> {
  const entries = await readdir(paths.outboxDirectory, {
    withFileTypes: true,
  })
  const intents: AssistantOutboxIntent[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const intentPath = path.join(paths.outboxDirectory, entry.name)
    let raw: string
    try {
      raw = await readFile(intentPath, 'utf8')
    } catch (error) {
      if (isMissingFileError(error)) {
        continue
      }
      throw error
    }
    try {
      intents.push(assistantOutboxIntentSchema.parse(JSON.parse(raw)))
    } catch (error) {
      await quarantineAssistantOutboxIntentFile({
        error,
        intentPath,
        skipDedupeProjectionUpdate: true,
        vault: paths.absoluteVaultRoot,
      })
    }
  }
  return intents.sort((left, right) =>
    compareAssistantTimestampsAscending(left.createdAt, right.createdAt) ||
    compareAssistantOutboxDeliverySequenceOrder(left, right),
  )
}

function initializeAssistantOutboxDedupeDatabase(
  database: AssistantOutboxDedupeDatabase,
  intents: readonly AssistantOutboxIntent[],
): void {
  withImmediateTransaction(database, () => {
    database.exec(`
      CREATE TABLE assistant_outbox_dedupe_routes (
        kind TEXT NOT NULL CHECK (
          kind IN ('dedupe-key', 'delivery-idempotency-key')
        ),
        key_digest TEXT NOT NULL CHECK (length(key_digest) = 64),
        intent_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (kind, key_digest, intent_id)
      ) STRICT;
      CREATE INDEX assistant_outbox_dedupe_routes_lookup
      ON assistant_outbox_dedupe_routes (
        kind,
        key_digest,
        created_at_ms,
        intent_id
      );
      CREATE TABLE assistant_outbox_foreground_tags (
        tag_digest TEXT NOT NULL CHECK (length(tag_digest) = 64),
        intent_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (tag_digest, intent_id)
      ) STRICT;
      CREATE INDEX assistant_outbox_foreground_tags_lookup
      ON assistant_outbox_foreground_tags (
        tag_digest,
        created_at_ms,
        intent_id
      );
      CREATE TABLE assistant_outbox_legacy_candidates (
        intent_id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL,
        media_json TEXT,
        created_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX assistant_outbox_legacy_candidates_order
      ON assistant_outbox_legacy_candidates (created_at_ms, intent_id)
      WHERE media_json IS NOT NULL;
      CREATE TABLE assistant_outbox_dedupe_metadata (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        legacy_fallback_required INTEGER NOT NULL CHECK (
          legacy_fallback_required IN (0, 1)
        )
      ) STRICT;
    `)
    database.prepare(`
      INSERT INTO assistant_outbox_dedupe_metadata (
        singleton,
        legacy_fallback_required
      ) VALUES (1, ?)
    `).run(intents.length > 0 ? 1 : 0)
    const insertRoute = database.prepare(`
      INSERT INTO assistant_outbox_dedupe_routes (
        kind,
        key_digest,
        intent_id,
        created_at_ms
      ) VALUES (?, ?, ?, ?)
    `)
    const insertForegroundTag = database.prepare(`
      INSERT INTO assistant_outbox_foreground_tags (
        tag_digest,
        intent_id,
        created_at_ms
      ) VALUES (?, ?, ?)
    `)
    for (const intent of intents) {
      for (const tagDigest of resolveAssistantOutboxForegroundTagDigests(intent)) {
        insertForegroundTag.run(
          tagDigest,
          intent.intentId,
          Date.parse(intent.createdAt),
        )
      }
      if (!isActiveAssistantOutboxIntent(intent)) {
        continue
      }
      for (const route of resolveAssistantOutboxDedupeRoutes(intent)) {
        insertRoute.run(
          route.kind,
          resolveAssistantOutboxDedupeKeyDigest(route.kind, route.key),
          intent.intentId,
          Date.parse(intent.createdAt),
        )
      }
      database.prepare(`
        INSERT INTO assistant_outbox_legacy_candidates (
          intent_id,
          dedupe_key,
          media_json,
          created_at_ms
        ) VALUES (?, ?, ?, ?)
      `).run(
        intent.intentId,
        intent.dedupeKey,
        JSON.stringify(intent.media),
        Date.parse(intent.createdAt),
      )
    }
    writeSqliteRuntimeUserVersion(
      database,
      ASSISTANT_OUTBOX_DEDUPE_DATABASE_VERSION,
    )
  })
}

async function quarantineAssistantOutboxDedupeDatabase(
  paths: AssistantStatePaths,
  _error: unknown,
): Promise<void> {
  const databasePath = resolveAssistantOutboxDedupeDatabasePath(paths)
  const quarantinePath = path.join(
    paths.outboxQuarantineDirectory,
    `${ASSISTANT_OUTBOX_DEDUPE_DATABASE_NAME}.${Date.now()}.${randomUUID()}.invalid.sqlite`,
  )
  await ensureAssistantStateDirectory(paths.outboxQuarantineDirectory)
  try {
    await rename(databasePath, quarantinePath)
  } catch (renameError) {
    if (isMissingFileError(renameError)) {
      return
    }
    throw renameError
  } finally {
    await removeAssistantOutboxDedupeDatabaseSidecars(databasePath)
  }
  await recordAssistantDiagnosticEvent({
    code: 'ASSISTANT_OUTBOX_DEDUPE_PROJECTION_INVALID',
    component: 'outbox',
    kind: 'outbox.dedupe-projection.quarantined',
    level: 'warn',
    message: 'Assistant outbox dedupe projection was invalid and rebuilt.',
    vault: paths.absoluteVaultRoot,
  }).catch(() => undefined)
}

function resolveAssistantOutboxDedupeDatabasePath(
  paths: AssistantStatePaths,
): string {
  return path.join(paths.stateDirectory, ASSISTANT_OUTBOX_DEDUPE_DATABASE_NAME)
}

async function assistantOutboxDedupePathExists(
  candidatePath: string,
): Promise<boolean> {
  try {
    await access(candidatePath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }
    throw error
  }
}

async function removeAssistantOutboxDedupeDatabaseSidecars(
  databasePath: string,
): Promise<void> {
  await Promise.all([
    rm(`${databasePath}-journal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ])
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
