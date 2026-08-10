import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantTurnReceiptSchema,
  assistantTurnTimelineEventSchema,
  type AssistantChatProvider,
  type AssistantDeliveryError,
  type AssistantTurnReceipt,
  type AssistantTurnTimelineEvent,
  type AssistantTurnTimelineEventKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import { quarantineAssistantStateFile } from './quarantine.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import { resolveAssistantOpaqueStateFilePath } from './state-ids.js'
import { ensureAssistantState } from './store/persistence.js'
import {
  type AssistantStatePaths,
} from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  compareAssistantTimestampsAscending,
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'
import {
  sanitizeAssistantDeliveryErrorForPersistence,
  sanitizeAssistantPortableMetadata,
  sanitizeAssistantPortableStateString,
  sanitizeAssistantTurnReceiptForPersistence,
  sanitizeAssistantTurnTimelineEventForPersistence,
} from './redaction.js'

const ASSISTANT_TURN_RECEIPT_SCHEMA = 'murph.assistant-turn-receipt.v1'
const ASSISTANT_TURN_RECEIPT_READ_CONCURRENCY = 4
const PROVIDER_MODEL_PREVIEW_LIMIT = 240
const TURN_TEXT_PREVIEW_HASH_LENGTH = 12

export function createAssistantTurnId(): string {
  return `turn_${randomUUID().replace(/-/gu, '')}`
}

export async function createAssistantTurnReceipt(input: {
  deliveryRequested: boolean
  metadata?: Record<string, string> | null
  prompt: string
  provider: AssistantChatProvider
  providerModel: string | null
  sessionId: string
  startedAt?: string
  turnId?: string
  vault: string
}): Promise<AssistantTurnReceipt> {
  const startedAt = input.startedAt ?? new Date().toISOString()
  const receipt = assistantTurnReceiptSchema.parse({
    schema: ASSISTANT_TURN_RECEIPT_SCHEMA,
    turnId: input.turnId ?? createAssistantTurnId(),
    sessionId: input.sessionId,
    provider: input.provider,
    providerModel: normalizePreview(input.providerModel, PROVIDER_MODEL_PREVIEW_LIMIT),
    promptPreview: buildRedactedTurnTextPreview(input.prompt),
    responsePreview: null,
    status: 'running',
    deliveryRequested: input.deliveryRequested,
    deliveryDisposition: input.deliveryRequested ? 'queued' : 'not-requested',
    deliveryIntentId: null,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    lastError: null,
    timeline: [
      assistantTurnTimelineEventSchema.parse({
        at: startedAt,
        kind: 'turn.started',
        detail: null,
        metadata: sanitizeAssistantPortableMetadata(input.metadata),
      }),
    ],
  })

  await saveAssistantTurnReceipt(input.vault, receipt)
  return receipt
}

export async function readAssistantTurnReceipt(
  vault: string,
  turnId: string,
): Promise<AssistantTurnReceipt | null> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    return readAssistantTurnReceiptAtPath(
      paths,
      resolveAssistantTurnReceiptPath(paths, turnId),
    )
  })
}

export async function saveAssistantTurnReceipt(
  vault: string,
  receipt: AssistantTurnReceipt,
): Promise<AssistantTurnReceipt> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantTurnReceiptSchema.parse(
      sanitizeAssistantTurnReceiptForPersistence(receipt),
    )
    await writeAssistantTurnReceiptAtPath(paths, parsed)
    return parsed
  })
}

export async function appendAssistantTurnReceiptEvent(input: {
  at?: string
  detail?: string | null
  kind: AssistantTurnTimelineEventKind
  metadata?: Record<string, string>
  turnId: string
  vault: string
}): Promise<AssistantTurnReceipt | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const receiptPath = resolveAssistantTurnReceiptPath(paths, input.turnId)
    const existing = await readAssistantTurnReceiptAtPath(paths, receiptPath)
    if (!existing) {
      return null
    }

    const at = input.at ?? new Date().toISOString()
    const updated = assistantTurnReceiptSchema.parse({
      ...existing,
      updatedAt: at,
      timeline: [
        ...existing.timeline,
        sanitizeAssistantTurnTimelineEventForPersistence(
          assistantTurnTimelineEventSchema.parse({
            at,
            kind: input.kind,
            detail: input.detail ?? null,
            metadata: input.metadata ?? {},
          }),
        ),
      ],
    })
    await writeAssistantTurnReceiptAtPath(paths, updated)
    return updated
  })
}

export async function updateAssistantTurnReceipt(input: {
  mutate: (receipt: AssistantTurnReceipt) => AssistantTurnReceipt
  turnId: string
  vault: string
}): Promise<AssistantTurnReceipt | null> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const receiptPath = resolveAssistantTurnReceiptPath(paths, input.turnId)
    const existing = await readAssistantTurnReceiptAtPath(paths, receiptPath)
    if (!existing) {
      return null
    }

    const updated = assistantTurnReceiptSchema.parse(
      sanitizeAssistantTurnReceiptForPersistence(input.mutate(existing)),
    )
    await writeAssistantTurnReceiptAtPath(paths, updated)
    return updated
  })
}

export async function finalizeAssistantTurnReceipt(input: {
  completedAt?: string
  deliveryDisposition?: AssistantTurnReceipt['deliveryDisposition']
  deliveryIntentId?: string | null
  error?: AssistantDeliveryError | null
  metadata?: Record<string, string> | null
  response?: string | null
  status: AssistantTurnReceipt['status']
  turnId: string
  vault: string
}): Promise<AssistantTurnReceipt | null> {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const statusEvent: AssistantTurnTimelineEvent = assistantTurnTimelineEventSchema.parse({
    at: completedAt,
    kind: assistantTurnTimelineKindForStatus(input.status),
    detail:
      input.status === 'failed'
        ? sanitizeAssistantPortableStateString(
            input.error?.message ?? 'assistant turn failed',
          )
          : input.status === 'blocked'
            ? sanitizeAssistantPortableStateString(
              input.error?.message ?? 'assistant turn blocked before commit',
            )
          : null,
    metadata: sanitizeAssistantPortableMetadata(input.metadata),
  })

  return updateAssistantTurnReceipt({
    vault: input.vault,
    turnId: input.turnId,
    mutate(receipt) {
      return assistantTurnReceiptSchema.parse({
        ...receipt,
        status: input.status,
        deliveryDisposition: input.deliveryDisposition ?? receipt.deliveryDisposition,
        deliveryIntentId:
          input.deliveryIntentId !== undefined
            ? input.deliveryIntentId
            : receipt.deliveryIntentId,
        responsePreview:
          input.response !== undefined
            ? buildRedactedTurnTextPreview(input.response)
            : receipt.responsePreview,
        updatedAt: completedAt,
        completedAt,
        lastError:
          sanitizeAssistantDeliveryErrorForPersistence(input.error) ??
          receipt.lastError,
        timeline: [...receipt.timeline, statusEvent],
      })
    },
  })
}

function assistantTurnTimelineKindForStatus(
  status: AssistantTurnReceipt['status'],
): AssistantTurnTimelineEvent['kind'] {
  if (status === 'deferred') {
    return 'turn.deferred'
  }
  if (status === 'blocked') {
    return 'turn.blocked'
  }
  if (status === 'failed') {
    return 'turn.failed'
  }
  return 'turn.completed'
}

export async function listRecentAssistantTurnReceipts(
  vault: string,
  limit = 10,
  onScan?: (metrics: AssistantTurnReceiptScanMetrics) => void,
): Promise<AssistantTurnReceipt[]> {
  return await listRecentAssistantTurnReceiptsInternal(vault, {
    limit,
    ...(onScan ? { onScan } : {}),
  })
}

export interface AssistantTurnReceiptScanMetrics {
  bytesRead: number
  filesRead: number
  lockWaitMs: number
  scanElapsedMs: number
}

export async function listRecentAssistantTurnReceiptsForSession(
  vault: string,
  sessionId: string,
  limit = 10,
): Promise<AssistantTurnReceipt[]> {
  return await listRecentAssistantTurnReceiptsInternal(vault, {
    limit,
    sessionId,
  })
}

async function listRecentAssistantTurnReceiptsInternal(
  vault: string,
  input: {
    limit: number
    onScan?: (metrics: AssistantTurnReceiptScanMetrics) => void
    sessionId?: string | null
  },
): Promise<AssistantTurnReceipt[]> {
  const scanStartedAt = Date.now()
  const normalizedLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(0, Math.trunc(input.limit))
      : 0
  if (normalizedLimit === 0) {
    input.onScan?.({
      bytesRead: 0,
      filesRead: 0,
      lockWaitMs: 0,
      scanElapsedMs: Math.max(0, Date.now() - scanStartedAt),
    })
    return []
  }

  const sessionFilter = input.sessionId?.trim() || null
  const lockRequestedAt = Date.now()
  const result = await withAssistantRuntimeWriteLock(vault, async (paths) => {
    const lockWaitMs = Math.max(0, Date.now() - lockRequestedAt)
    await ensureAssistantState(paths)
    const entries = await readdir(paths.turnsDirectory, {
      withFileTypes: true,
    })
    let bytesRead = 0
    let filesRead = 0
    const receipts: AssistantTurnReceipt[] = []

    const receiptEntries = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith('.json'),
    )
    for (
      let index = 0;
      index < receiptEntries.length;
      index += ASSISTANT_TURN_RECEIPT_READ_CONCURRENCY
    ) {
      const batch = receiptEntries.slice(
        index,
        index + ASSISTANT_TURN_RECEIPT_READ_CONCURRENCY,
      )
      const rawReceipts = await Promise.all(
        batch.map((entry) =>
          readAssistantTurnReceiptRawAtPath(
            path.join(paths.turnsDirectory, entry.name),
          ),
        ),
      )

      // Parse and quarantine in directory order so parallel reads do not turn
      // quarantine writes or timestamp ties into concurrent side effects.
      for (const rawReceipt of rawReceipts) {
        const receipt = await parseAssistantTurnReceiptRawAtPath(
          paths,
          rawReceipt,
          (bytes) => {
            filesRead += 1
            bytesRead += bytes
          },
        )
        if (!receipt || (sessionFilter && receipt.sessionId !== sessionFilter)) {
          continue
        }

        insertRecentAssistantTurnReceipt(receipts, receipt, normalizedLimit)
      }
    }

    return {
      bytesRead,
      filesRead,
      lockWaitMs,
      receipts,
    }
  })
  input.onScan?.({
    bytesRead: result.bytesRead,
    filesRead: result.filesRead,
    lockWaitMs: result.lockWaitMs,
    scanElapsedMs: Math.max(0, Date.now() - scanStartedAt),
  })
  return result.receipts
}

function insertRecentAssistantTurnReceipt(
  receipts: AssistantTurnReceipt[],
  receipt: AssistantTurnReceipt,
  limit: number,
): void {
  const insertAt = receipts.findIndex(
    (existing) =>
      compareAssistantTimestampsAscending(receipt.updatedAt, existing.updatedAt) > 0,
  )
  if (insertAt === -1) {
    if (receipts.length < limit) {
      receipts.push(receipt)
    }
    return
  }

  receipts.splice(insertAt, 0, receipt)
  if (receipts.length > limit) {
    receipts.pop()
  }
}

export function resolveAssistantTurnReceiptPath(
  paths: AssistantStatePaths,
  turnId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: paths.turnsDirectory,
    extension: '.json',
    kind: 'turn',
    value: turnId,
  })
}

async function readAssistantTurnReceiptAtPath(
  paths: AssistantStatePaths,
  receiptPath: string,
  onBytesRead?: (bytes: number) => void,
): Promise<AssistantTurnReceipt | null> {
  return await parseAssistantTurnReceiptRawAtPath(
    paths,
    await readAssistantTurnReceiptRawAtPath(receiptPath),
    onBytesRead,
  )
}

type AssistantTurnReceiptRawRead =
  | {
      kind: 'error'
      error: unknown
      receiptPath: string
    }
  | {
      kind: 'missing'
      receiptPath: string
    }
  | {
      kind: 'read'
      raw: string
      receiptPath: string
    }

async function readAssistantTurnReceiptRawAtPath(
  receiptPath: string,
): Promise<AssistantTurnReceiptRawRead> {
  try {
    return {
      kind: 'read',
      raw: await readFile(receiptPath, 'utf8'),
      receiptPath,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        kind: 'missing',
        receiptPath,
      }
    }

    return {
      error,
      kind: 'error',
      receiptPath,
    }
  }
}

async function parseAssistantTurnReceiptRawAtPath(
  paths: AssistantStatePaths,
  input: AssistantTurnReceiptRawRead,
  onBytesRead?: (bytes: number) => void,
): Promise<AssistantTurnReceipt | null> {
  if (input.kind === 'missing') {
    return null
  }

  if (input.kind === 'read') {
    try {
      onBytesRead?.(Buffer.byteLength(input.raw, 'utf8'))
      return assistantTurnReceiptSchema.parse(JSON.parse(input.raw))
    } catch (error) {
      await quarantineAssistantStateFile({
        artifactKind: 'turn-receipt',
        error,
        expectedContent: input.raw,
        filePath: input.receiptPath,
        paths,
      }).catch(() => undefined)
      return null
    }
  }

  await quarantineAssistantStateFile({
    artifactKind: 'turn-receipt',
    error: input.error,
    filePath: input.receiptPath,
    paths,
  }).catch(() => undefined)
  return null
}

async function writeAssistantTurnReceiptAtPath(
  paths: AssistantStatePaths,
  receipt: AssistantTurnReceipt,
): Promise<void> {
  const receiptPath = resolveAssistantTurnReceiptPath(paths, receipt.turnId)
  const safeReceipt = assistantTurnReceiptSchema.parse(
    sanitizeAssistantTurnReceiptForPersistence(receipt),
  )
  await writeJsonFileAtomic(receiptPath, safeReceipt)
  await appendAssistantRuntimeEventAtPaths(paths, {
    at: safeReceipt.updatedAt,
    component: 'turns',
    entityId: safeReceipt.turnId,
    entityType: 'turn-receipt',
    kind: 'turn.receipt.upserted',
    level: safeReceipt.status === 'failed' ? 'warn' : 'info',
    message: `Assistant turn receipt ${safeReceipt.turnId} was persisted with status ${safeReceipt.status}.`,
    data: {
      deliveryDisposition: safeReceipt.deliveryDisposition,
      sessionId: safeReceipt.sessionId,
      status: safeReceipt.status,
    },
  }).catch(() => undefined)
}

function normalizePreview(value: string | null | undefined, limit: number): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }
  if (trimmed.length <= limit) {
    return trimmed
  }

  return `${trimmed.slice(0, limit - 1).trimEnd()}…`
}

function buildRedactedTurnTextPreview(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const digest = createHash('sha256')
    .update(trimmed)
    .digest('hex')
    .slice(0, TURN_TEXT_PREVIEW_HASH_LENGTH)

  return `[redacted ${trimmed.length} chars sha256:${digest}]`
}
