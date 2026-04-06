import { randomUUID } from 'node:crypto'
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
} from '../assistant-cli-contracts.js'
import { quarantineAssistantStateFile } from './quarantine.js'
import { appendAssistantRuntimeEventAtPaths } from './runtime-events.js'
import { resolveAssistantOpaqueStateFilePath } from './state-ids.js'
import { ensureAssistantState } from './store/persistence.js'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  isMissingFileError,
  writeJsonFileAtomic,
} from './shared.js'

const ASSISTANT_TURN_RECEIPT_SCHEMA = 'murph.assistant-turn-receipt.v1'
const PROMPT_PREVIEW_LIMIT = 240
const RESPONSE_PREVIEW_LIMIT = 320

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
    providerModel: normalizePreview(input.providerModel, PROMPT_PREVIEW_LIMIT),
    promptPreview: normalizePreview(input.prompt, PROMPT_PREVIEW_LIMIT),
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
        metadata: input.metadata ?? {},
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
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return readAssistantTurnReceiptAtPath(
    paths,
    resolveAssistantTurnReceiptPath(paths, turnId),
  )
}

export async function saveAssistantTurnReceipt(
  vault: string,
  receipt: AssistantTurnReceipt,
): Promise<AssistantTurnReceipt> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantTurnReceiptSchema.parse(receipt)
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
        assistantTurnTimelineEventSchema.parse({
          at,
          kind: input.kind,
          detail: input.detail ?? null,
          metadata: input.metadata ?? {},
        }),
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

    const updated = assistantTurnReceiptSchema.parse(input.mutate(existing))
    await writeAssistantTurnReceiptAtPath(paths, updated)
    return updated
  })
}

export async function finalizeAssistantTurnReceipt(input: {
  completedAt?: string
  deliveryDisposition?: AssistantTurnReceipt['deliveryDisposition']
  deliveryIntentId?: string | null
  error?: AssistantDeliveryError | null
  response?: string | null
  status: AssistantTurnReceipt['status']
  turnId: string
  vault: string
}): Promise<AssistantTurnReceipt | null> {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const statusEvent: AssistantTurnTimelineEvent = assistantTurnTimelineEventSchema.parse({
    at: completedAt,
    kind:
      input.status === 'deferred'
        ? 'turn.deferred'
        : 'turn.completed',
    detail:
      input.status === 'failed'
        ? input.error?.message ?? 'assistant turn failed'
        : null,
    metadata: {},
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
            ? normalizePreview(input.response, RESPONSE_PREVIEW_LIMIT)
            : receipt.responsePreview,
        updatedAt: completedAt,
        completedAt,
        lastError: input.error ?? receipt.lastError,
        timeline: [...receipt.timeline, statusEvent],
      })
    },
  })
}

export async function listRecentAssistantTurnReceipts(
  vault: string,
  limit = 10,
): Promise<AssistantTurnReceipt[]> {
  return await listRecentAssistantTurnReceiptsInternal(vault, {
    limit,
  })
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
    sessionId?: string | null
  },
): Promise<AssistantTurnReceipt[]> {
  const normalizedLimit =
    typeof input.limit === 'number' && Number.isFinite(input.limit)
      ? Math.max(0, Math.trunc(input.limit))
      : 0
  if (normalizedLimit === 0) {
    return []
  }

  const sessionFilter = input.sessionId?.trim() || null
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  const entries = await readdir(paths.turnsDirectory, {
    withFileTypes: true,
  })
  const receipts: AssistantTurnReceipt[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const receipt = await readAssistantTurnReceiptAtPath(
      paths,
      path.join(paths.turnsDirectory, entry.name),
    )
    if (!receipt || (sessionFilter && receipt.sessionId !== sessionFilter)) {
      continue
    }

    insertRecentAssistantTurnReceipt(receipts, receipt, normalizedLimit)
  }

  return receipts
}

function insertRecentAssistantTurnReceipt(
  receipts: AssistantTurnReceipt[],
  receipt: AssistantTurnReceipt,
  limit: number,
): void {
  const insertAt = receipts.findIndex(
    (existing) => receipt.updatedAt.localeCompare(existing.updatedAt) > 0,
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
): Promise<AssistantTurnReceipt | null> {
  try {
    const raw = await readFile(receiptPath, 'utf8')
    return assistantTurnReceiptSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    await quarantineAssistantStateFile({
      artifactKind: 'turn-receipt',
      error,
      filePath: receiptPath,
      paths,
    }).catch(() => undefined)
    return null
  }
}

async function writeAssistantTurnReceiptAtPath(
  paths: AssistantStatePaths,
  receipt: AssistantTurnReceipt,
): Promise<void> {
  const receiptPath = resolveAssistantTurnReceiptPath(paths, receipt.turnId)
  await writeJsonFileAtomic(receiptPath, receipt)
  await appendAssistantRuntimeEventAtPaths(paths, {
    at: receipt.updatedAt,
    component: 'turns',
    entityId: receipt.turnId,
    entityType: 'turn-receipt',
    kind: 'turn.receipt.upserted',
    level: receipt.status === 'failed' ? 'warn' : 'info',
    message: `Assistant turn receipt ${receipt.turnId} was persisted with status ${receipt.status}.`,
    data: {
      deliveryDisposition: receipt.deliveryDisposition,
      sessionId: receipt.sessionId,
      status: receipt.status,
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
