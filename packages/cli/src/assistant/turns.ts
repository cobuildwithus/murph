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
import { ensureAssistantState } from './store/persistence.js'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import { isMissingFileError, writeJsonFileAtomic } from './shared.js'

const ASSISTANT_TURN_RECEIPT_SCHEMA = 'healthybob.assistant-turn-receipt.v1'
const PROMPT_PREVIEW_LIMIT = 240
const RESPONSE_PREVIEW_LIMIT = 320

export function createAssistantTurnId(): string {
  return `turn_${randomUUID().replace(/-/gu, '')}`
}

export async function createAssistantTurnReceipt(input: {
  deliveryRequested: boolean
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
        metadata: {},
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
  return readAssistantTurnReceiptAtPath(resolveAssistantTurnReceiptPath(paths, turnId))
}

export async function saveAssistantTurnReceipt(
  vault: string,
  receipt: AssistantTurnReceipt,
): Promise<AssistantTurnReceipt> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsed = assistantTurnReceiptSchema.parse(receipt)
    await writeJsonFileAtomic(resolveAssistantTurnReceiptPath(paths, parsed.turnId), parsed)
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
    const existing = await readAssistantTurnReceiptAtPath(receiptPath)
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
    await writeJsonFileAtomic(receiptPath, updated)
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
    const existing = await readAssistantTurnReceiptAtPath(receiptPath)
    if (!existing) {
      return null
    }

    const updated = assistantTurnReceiptSchema.parse(input.mutate(existing))
    await writeJsonFileAtomic(receiptPath, updated)
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
    kind: input.status === 'deferred' ? 'turn.deferred' : 'turn.completed',
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
      path.join(paths.turnsDirectory, entry.name),
    )
    if (receipt) {
      receipts.push(receipt)
    }
  }

  return receipts
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(0, limit))
}

export function resolveAssistantTurnReceiptPath(
  paths: AssistantStatePaths,
  turnId: string,
): string {
  return path.join(paths.turnsDirectory, `${turnId}.json`)
}

async function readAssistantTurnReceiptAtPath(
  receiptPath: string,
): Promise<AssistantTurnReceipt | null> {
  try {
    const raw = await readFile(receiptPath, 'utf8')
    return assistantTurnReceiptSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

function normalizePreview(value: string | null | undefined, limit: number): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }

  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(limit - 3, 0))}...`
}
