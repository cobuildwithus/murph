import { randomUUID } from 'node:crypto'
import { appendFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantTranscriptDistillationSchema,
  type AssistantTranscriptDistillation,
  type AssistantTranscriptEntry,
} from '../assistant-cli-contracts.js'
import { ensureAssistantState } from './store/persistence.js'
import { resolveAssistantStatePaths } from './store.js'
import {
  isJsonSyntaxError,
  isMissingFileError,
  normalizeNullableString,
  parseAssistantJsonLinesWithTailSalvage,
} from './shared.js'

const MIN_CONVERSATION_ENTRIES_TO_DISTILL = 18
const MIN_NEW_CONVERSATION_ENTRIES_TO_DISTILL = 8
const PRESERVED_RECENT_CONVERSATION_COUNT = 8
const SUMMARY_LINE_LIMIT = 10
const SUMMARY_TEXT_LIMIT = 160

export async function maybeRefreshAssistantTranscriptDistillation(input: {
  sessionId: string
  transcript: readonly AssistantTranscriptEntry[]
  vault: string
}): Promise<{
  created: boolean
  distillation: AssistantTranscriptDistillation | null
}> {
  const conversationEntries = input.transcript.filter(
    isAssistantConversationTranscriptEntry,
  )
  if (conversationEntries.length < MIN_CONVERSATION_ENTRIES_TO_DISTILL) {
    return {
      created: false,
      distillation: null,
    }
  }

  const existing = await listAssistantTranscriptDistillations(
    input.vault,
    input.sessionId,
  )
  const latest = existing.at(-1) ?? null
  const nextStartOffset = latest ? latest.endEntryOffset + 1 : 0
  const maxEndExclusive = Math.max(
    nextStartOffset,
    conversationEntries.length - PRESERVED_RECENT_CONVERSATION_COUNT,
  )
  if (maxEndExclusive - nextStartOffset < MIN_NEW_CONVERSATION_ENTRIES_TO_DISTILL) {
    return {
      created: false,
      distillation: latest,
    }
  }

  const sourceEntries = conversationEntries.slice(nextStartOffset, maxEndExclusive)
  const summaryLines = buildAssistantTranscriptDistillationSummaryLines(sourceEntries)
  if (summaryLines.length === 0) {
    return {
      created: false,
      distillation: latest,
    }
  }

  const record = assistantTranscriptDistillationSchema.parse({
    schema: 'murph.assistant-transcript-distillation.v1',
    distillationId: `distill_${randomUUID().replace(/-/gu, '')}`,
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
    conversationEntryCount: conversationEntries.length,
    startEntryOffset: nextStartOffset,
    endEntryOffset: maxEndExclusive - 1,
    preservedRecentConversationCount: PRESERVED_RECENT_CONVERSATION_COUNT,
    preview:
      sourceEntries.length > 0
        ? truncateAssistantDistillationText(sourceEntries[0]!.text, SUMMARY_TEXT_LIMIT)
        : null,
    summaryLines,
  })

  await appendAssistantTranscriptDistillation(input.vault, record)
  return {
    created: true,
    distillation: record,
  }
}

export async function appendAssistantTranscriptDistillation(
  vault: string,
  distillation: AssistantTranscriptDistillation,
): Promise<AssistantTranscriptDistillation> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  const distillationPath = resolveAssistantTranscriptDistillationPath(
    paths.distillationsDirectory,
    distillation.sessionId,
  )
  await appendFile(
    distillationPath,
    `${JSON.stringify(assistantTranscriptDistillationSchema.parse(distillation))}\n`,
    'utf8',
  )
  return distillation
}

export async function listAssistantTranscriptDistillations(
  vault: string,
  sessionId: string,
): Promise<AssistantTranscriptDistillation[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  const distillationPath = resolveAssistantTranscriptDistillationPath(
    paths.distillationsDirectory,
    sessionId,
  )

  try {
    const raw = await readFile(distillationPath, 'utf8')
    const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
      assistantTranscriptDistillationSchema.parse(value),
    )
    return parsed.values.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    if (isJsonSyntaxError(error)) {
      return []
    }
    throw error
  }
}

export async function readLatestAssistantTranscriptDistillation(
  vault: string,
  sessionId: string,
): Promise<AssistantTranscriptDistillation | null> {
  const distillations = await listAssistantTranscriptDistillations(vault, sessionId)
  return distillations.at(-1) ?? null
}

export function buildAssistantTranscriptDistillationContinuityText(
  distillation: AssistantTranscriptDistillation | null,
): string | null {
  if (!distillation) {
    return null
  }

  const summary = distillation.summaryLines.map((line) => `- ${line}`).join('\n')
  const preview = normalizeNullableString(distillation.preview)

  return [
    'Older local conversation context distilled by Murph from this same session:',
    summary,
    preview ? `Preview: ${preview}` : null,
    'Treat this as Murph-generated, non-canonical continuity for older turns. Prefer fresher raw transcript messages and vault evidence when they conflict.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

export function resolveAssistantTranscriptDistillationPath(
  distillationsDirectory: string,
  sessionId: string,
): string {
  return path.join(distillationsDirectory, `${sessionId}.jsonl`)
}

function buildAssistantTranscriptDistillationSummaryLines(
  entries: readonly AssistantTranscriptEntry[],
): string[] {
  const summaryLines: string[] = []

  for (let index = 0; index < entries.length; ) {
    const current = entries[index]!
    const next = entries[index + 1]

    if (current.kind === 'user') {
      const userText = truncateAssistantDistillationText(
        current.text,
        SUMMARY_TEXT_LIMIT,
      )
      const assistantText =
        next?.kind === 'assistant'
          ? truncateAssistantDistillationText(next.text, SUMMARY_TEXT_LIMIT)
          : null
      summaryLines.push(
        assistantText
          ? `User asked: ${userText} Assistant replied: ${assistantText}`
          : `User asked: ${userText}`,
      )
      index += next?.kind === 'assistant' ? 2 : 1
      if (summaryLines.length >= SUMMARY_LINE_LIMIT) {
        break
      }
      continue
    }

    summaryLines.push(
      `Assistant noted: ${truncateAssistantDistillationText(current.text, SUMMARY_TEXT_LIMIT)}`,
    )
    index += 1
    if (summaryLines.length >= SUMMARY_LINE_LIMIT) {
      break
    }
  }

  return summaryLines
}

function truncateAssistantDistillationText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= limit) {
    return normalized
  }
  return `${normalized.slice(0, limit - 3)}...`
}

function isAssistantConversationTranscriptEntry(
  entry: AssistantTranscriptEntry,
): entry is AssistantTranscriptEntry {
  return entry.kind === 'assistant' || entry.kind === 'user'
}
