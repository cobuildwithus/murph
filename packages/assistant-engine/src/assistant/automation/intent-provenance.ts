import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  ensureAssistantStateDir,
  writeAssistantStateJson,
} from '@murphai/runtime-state/node/assistant-state-fs'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { isMissingFileError, normalizeNullableString } from '../shared.js'
import { withAssistantRuntimeWriteLock } from '../runtime-write-lock.js'

const ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA =
  'murph.assistant-auto-reply-intent-provenance.v1'

export interface AssistantAutoReplyIntentProvenance {
  foregroundAuthorityChannel?: 'whatsapp'
  intentId: string
  recordedAt: string
  schema: typeof ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA
  turnId: string
}

export async function writeAssistantAutoReplyIntentProvenance(input: {
  intentId: string
  recordedAt: string
  turnId: string
  vault: string
}): Promise<void> {
  const existing = await readAssistantAutoReplyIntentProvenance({
    intentId: input.intentId,
    vault: input.vault,
  })
  const provenance: AssistantAutoReplyIntentProvenance = {
    ...(existing?.intentId === input.intentId && existing.turnId === input.turnId
      && existing.foregroundAuthorityChannel
      ? { foregroundAuthorityChannel: existing.foregroundAuthorityChannel }
      : {}),
    intentId: input.intentId,
    recordedAt: input.recordedAt,
    schema: ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA,
    turnId: input.turnId,
  }
  await persistAssistantAutoReplyIntentProvenance(provenance, input.vault)
}

export async function writeAssistantAutoReplyIntentForegroundAuthority(input: {
  channel: 'whatsapp'
  intentId: string
  vault: string
}): Promise<void> {
  await withAssistantRuntimeWriteLock(input.vault, async () => {
    const existing = await readAssistantAutoReplyIntentProvenance({
      intentId: input.intentId,
      vault: input.vault,
    })
    if (!existing || existing.intentId !== input.intentId) {
      throw new Error(
        'Assistant foreground authority requires existing exact-intent auto-reply provenance.',
      )
    }
    await persistAssistantAutoReplyIntentProvenance({
      ...existing,
      foregroundAuthorityChannel: input.channel,
    }, input.vault)
  })
}

export async function assistantAutoReplyIntentHasForegroundAuthority(input: {
  channel: string
  intentId: string
  turnId: string
  vault: string
}): Promise<boolean> {
  const provenance = await readAssistantAutoReplyIntentProvenance({
    intentId: input.intentId,
    vault: input.vault,
  })
  return (
    provenance?.intentId === input.intentId
    && provenance.turnId === input.turnId
    && provenance.foregroundAuthorityChannel === 'whatsapp'
    && input.channel.trim().toLowerCase() === provenance.foregroundAuthorityChannel
  )
}

export async function readAssistantAutoReplyIntentProvenance(input: {
  intentId: string
  vault: string
}): Promise<AssistantAutoReplyIntentProvenance | null> {
  try {
    const raw = await readFile(
      resolveAssistantAutoReplyIntentProvenancePath(input),
      'utf8',
    )
    return parseAssistantAutoReplyIntentProvenance(JSON.parse(raw))
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) {
      return null
    }
    throw error
  }
}

function resolveAssistantAutoReplyIntentProvenancePath(input: {
  intentId: string
  vault: string
}): string {
  return path.join(
    resolveAssistantStatePaths(input.vault).assistantStateRoot,
    'auto-reply',
    'intent-provenance',
    `${encodeURIComponent(input.intentId)}.json`,
  )
}

function parseAssistantAutoReplyIntentProvenance(
  value: unknown,
): AssistantAutoReplyIntentProvenance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as {
    foregroundAuthorityChannel?: unknown
    intentId?: unknown
    recordedAt?: unknown
    schema?: unknown
    turnId?: unknown
  }
  if (record.schema !== ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA) {
    return null
  }
  const intentId = normalizeUnknownString(record.intentId)
  const recordedAt = normalizeUnknownString(record.recordedAt)
  const turnId = normalizeUnknownString(record.turnId)
  if (!intentId || !recordedAt || !turnId) {
    return null
  }
  return {
    ...(record.foregroundAuthorityChannel === 'whatsapp'
      ? { foregroundAuthorityChannel: record.foregroundAuthorityChannel }
      : {}),
    intentId,
    recordedAt,
    schema: ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA,
    turnId,
  }
}

async function persistAssistantAutoReplyIntentProvenance(
  provenance: AssistantAutoReplyIntentProvenance,
  vault: string,
): Promise<void> {
  const filePath = resolveAssistantAutoReplyIntentProvenancePath({
    intentId: provenance.intentId,
    vault,
  })
  await ensureAssistantStateDir(path.dirname(filePath))
  await writeAssistantStateJson(filePath, provenance)
}

function normalizeUnknownString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
