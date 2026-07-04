import path from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  assistantOutboxAnsweredCoverageSchema,
  type AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  ensureAssistantStateDir,
  writeAssistantStateJson,
} from '@murphai/runtime-state/node/assistant-state-fs'
import { resolveAssistantStatePaths } from '../store/paths.js'
import { isMissingFileError, normalizeNullableString } from '../shared.js'

const ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA =
  'murph.assistant-auto-reply-intent-provenance.v1'

export interface AssistantAutoReplyIntentProvenance {
  answeredCoverage: AssistantOutboxIntent['answeredCoverage']
  intentId: string
  recordedAt: string
  schema: typeof ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA
  turnId: string
}

export async function writeAssistantAutoReplyIntentProvenance(input: {
  answeredCoverage?: AssistantOutboxIntent['answeredCoverage']
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
    answeredCoverage: selectHighestAnsweredCoverage(
      existing?.answeredCoverage ?? null,
      input.answeredCoverage ?? null,
    ),
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
    answeredCoverage?: unknown
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
    answeredCoverage: parseAnsweredCoverage(record.answeredCoverage),
    intentId,
    recordedAt,
    schema: ASSISTANT_AUTO_REPLY_INTENT_PROVENANCE_SCHEMA,
    turnId,
  }
}

function parseAnsweredCoverage(
  value: unknown,
): AssistantOutboxIntent['answeredCoverage'] {
  const parsed = assistantOutboxAnsweredCoverageSchema.nullable().safeParse(
    value ?? null,
  )
  return parsed.success ? parsed.data : null
}

function selectHighestAnsweredCoverage(
  left: AssistantOutboxIntent['answeredCoverage'],
  right: AssistantOutboxIntent['answeredCoverage'],
): AssistantOutboxIntent['answeredCoverage'] {
  if (!left) {
    return right
  }
  if (!right) {
    return left
  }
  return compareLaneSeq(left.laneSeq, right.laneSeq) >= 0 ? left : right
}

function compareLaneSeq(left: string, right: string): number {
  try {
    const leftSeq = BigInt(left)
    const rightSeq = BigInt(right)
    return leftSeq < rightSeq ? -1 : leftSeq > rightSeq ? 1 : 0
  } catch {
    return left.localeCompare(right)
  }
}

function normalizeUnknownString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}
