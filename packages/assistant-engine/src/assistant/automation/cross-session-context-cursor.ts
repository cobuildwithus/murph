import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ensureAssistantStateDir,
  writeAssistantStateJson,
} from '@murphai/runtime-state/node/assistant-state-fs'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { isMissingFileError, normalizeNullableString } from '../shared.js'

const ASSISTANT_AUTO_REPLY_CROSS_SESSION_CONTEXT_CURSOR_SCHEMA =
  'murph.assistant-auto-reply-cross-session-context-cursor.v1'

export interface AssistantAutoReplyCrossSessionContextCursor {
  intentId: string
  sentAtMs: number
}

export interface AssistantAutoReplyCrossSessionContextCursorRoute {
  channel: string
  key: string
}

export interface AssistantAutoReplyCrossSessionContextCursorRecord {
  latestInjectedDelivery: AssistantAutoReplyCrossSessionContextCursor
  routeKey: string
  schema: typeof ASSISTANT_AUTO_REPLY_CROSS_SESSION_CONTEXT_CURSOR_SCHEMA
  updatedAt: string
}

export async function readAssistantAutoReplyCrossSessionContextCursor(input: {
  route: AssistantAutoReplyCrossSessionContextCursorRoute
  vault: string
}): Promise<AssistantAutoReplyCrossSessionContextCursor | null> {
  const routeKey = hashAssistantAutoReplyCrossSessionContextRoute(input.route)
  const record = await readAssistantAutoReplyCrossSessionContextCursorRecordAtPath(
    resolveAssistantAutoReplyCrossSessionContextCursorPath({
      routeKey,
      vault: input.vault,
    }),
  )
  return record?.routeKey === routeKey ? record.latestInjectedDelivery : null
}

export async function writeAssistantAutoReplyCrossSessionContextCursor(input: {
  intentId: string
  recordedAt?: string
  route: AssistantAutoReplyCrossSessionContextCursorRoute
  sentAtMs: number
  vault: string
}): Promise<void> {
  const routeKey = hashAssistantAutoReplyCrossSessionContextRoute(input.route)

  await withAssistantRuntimeWriteLock(input.vault, async () => {
    const filePath = resolveAssistantAutoReplyCrossSessionContextCursorPath({
      routeKey,
      vault: input.vault,
    })
    const existing = await readAssistantAutoReplyCrossSessionContextCursorRecordAtPath(
      filePath,
    )
    const next = {
      intentId: input.intentId,
      sentAtMs: input.sentAtMs,
    }

    if (
      existing?.routeKey === routeKey &&
      compareAssistantAutoReplyCrossSessionContextCursorOrder(
        existing.latestInjectedDelivery,
        next,
      ) >= 0
    ) {
      return
    }

    await ensureAssistantStateDir(path.dirname(filePath))
    await writeAssistantStateJson(filePath, {
      latestInjectedDelivery: next,
      routeKey,
      schema: ASSISTANT_AUTO_REPLY_CROSS_SESSION_CONTEXT_CURSOR_SCHEMA,
      updatedAt: input.recordedAt ?? new Date().toISOString(),
    } satisfies AssistantAutoReplyCrossSessionContextCursorRecord)
  })
}

export function compareAssistantAutoReplyCrossSessionContextCursorOrder(
  left: AssistantAutoReplyCrossSessionContextCursor,
  right: AssistantAutoReplyCrossSessionContextCursor,
): number {
  return left.sentAtMs === right.sentAtMs
    ? left.intentId.localeCompare(right.intentId)
    : left.sentAtMs - right.sentAtMs
}

export async function readAssistantAutoReplyCrossSessionContextCursorRecordAtPath(
  filePath: string,
): Promise<AssistantAutoReplyCrossSessionContextCursorRecord | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseAssistantAutoReplyCrossSessionContextCursorRecord(
      JSON.parse(raw),
    )
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

export function resolveAssistantAutoReplyCrossSessionContextCursorDirectory(input: {
  assistantStateRoot: string
}): string {
  return path.join(
    input.assistantStateRoot,
    'auto-reply',
    'cross-session-context',
  )
}

function resolveAssistantAutoReplyCrossSessionContextCursorPath(input: {
  routeKey: string
  vault: string
}): string {
  return path.join(
    resolveAssistantAutoReplyCrossSessionContextCursorDirectory(
      resolveAssistantStatePaths(input.vault),
    ),
    `${input.routeKey.slice('sha256:'.length)}.json`,
  )
}

function hashAssistantAutoReplyCrossSessionContextRoute(
  route: AssistantAutoReplyCrossSessionContextCursorRoute,
): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify({
      channel: route.channel,
      key: route.key,
    }))
    .digest('hex')}`
}

function parseAssistantAutoReplyCrossSessionContextCursorRecord(
  value: unknown,
): AssistantAutoReplyCrossSessionContextCursorRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    latestInjectedDelivery?: unknown
    routeKey?: unknown
    schema?: unknown
    updatedAt?: unknown
  }
  if (
    record.schema !==
      ASSISTANT_AUTO_REPLY_CROSS_SESSION_CONTEXT_CURSOR_SCHEMA
  ) {
    return null
  }
  const routeKey = normalizeUnknownString(record.routeKey)
  const updatedAt = normalizeUnknownString(record.updatedAt)
  const latestInjectedDelivery =
    parseAssistantAutoReplyCrossSessionContextCursor(
      record.latestInjectedDelivery,
    )
  if (!routeKey || !updatedAt || !latestInjectedDelivery) {
    return null
  }

  return {
    latestInjectedDelivery,
    routeKey,
    schema: ASSISTANT_AUTO_REPLY_CROSS_SESSION_CONTEXT_CURSOR_SCHEMA,
    updatedAt,
  }
}

function parseAssistantAutoReplyCrossSessionContextCursor(
  value: unknown,
): AssistantAutoReplyCrossSessionContextCursor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    intentId?: unknown
    sentAtMs?: unknown
  }
  const intentId = normalizeUnknownString(record.intentId)
  const sentAtMs =
    typeof record.sentAtMs === 'number' &&
    Number.isFinite(record.sentAtMs)
      ? Math.trunc(record.sentAtMs)
      : null
  return intentId && sentAtMs !== null
    ? {
        intentId,
        sentAtMs,
      }
    : null
}

function normalizeUnknownString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
