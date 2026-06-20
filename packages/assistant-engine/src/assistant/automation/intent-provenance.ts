import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  ensureAssistantStateDir,
  writeAssistantStateJson,
} from '@murphai/runtime-state/node/assistant-state-fs'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { isMissingFileError, normalizeNullableString } from '../shared.js'

const ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA =
  'murph.assistant-auto-reply-intent-provenance.v1'

export interface AssistantAutoReplyIntentProvenance {
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
  const provenance: AssistantAutoReplyIntentProvenance = {
    intentId: input.intentId,
    recordedAt: input.recordedAt,
    schema: ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA,
    turnId: input.turnId,
  }
  const filePath = resolveAssistantAutoReplyIntentProvenancePath({
    intentId: input.intentId,
    vault: input.vault,
  })
  await ensureAssistantStateDir(path.dirname(filePath))
  await writeAssistantStateJson(filePath, provenance)
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
    intentId,
    recordedAt,
    schema: ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA,
    turnId,
  }
}

function normalizeUnknownString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
