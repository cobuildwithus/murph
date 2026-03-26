import {
  assistantTranscriptContinuationNotice,
  assistantTranscriptContinuationSchema,
  type AssistantTranscriptContinuation,
  type AssistantTranscriptEntry,
} from '../../assistant-cli-contracts.js'

const MAX_SUMMARY_BULLETS = 6
const MAX_OPEN_LOOPS = 4
const MAX_REPRESENTATIVE_EXCERPTS = 3
const MAX_PREVIEW_LENGTH = 160

interface TranscriptTurn {
  assistant: AssistantTranscriptEntry[]
  errors: AssistantTranscriptEntry[]
  user: AssistantTranscriptEntry | null
}

export function buildAssistantTranscriptContinuation(input: {
  archivedEntries: readonly AssistantTranscriptEntry[]
  sessionId: string
  updatedAt?: string
}): AssistantTranscriptContinuation | null {
  if (input.archivedEntries.length === 0) {
    return null
  }

  const turns = groupArchivedTranscriptTurns(input.archivedEntries)
  const summaryBullets = buildSummaryBullets(turns)
  const openLoops = buildOpenLoops(turns)
  const representativeExcerpts = buildRepresentativeExcerpts(input.archivedEntries)

  return assistantTranscriptContinuationSchema.parse({
    schema: 'healthybob.assistant-transcript-continuation.v1',
    sessionId: input.sessionId,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    sourceEntryCount: input.archivedEntries.length,
    sourceStartAt: input.archivedEntries[0]?.createdAt ?? null,
    sourceEndAt:
      input.archivedEntries[input.archivedEntries.length - 1]?.createdAt ?? null,
    notice: assistantTranscriptContinuationNotice,
    summaryBullets,
    openLoops,
    representativeExcerpts,
  })
}

export function formatAssistantTranscriptContinuationForReplay(
  continuation: AssistantTranscriptContinuation,
): string {
  return [
    'Local transcript continuation:',
    continuation.notice,
    continuation.summaryBullets.length > 0
      ? [
          'Summary bullets:',
          ...continuation.summaryBullets.map((bullet) => `- ${bullet}`),
        ].join('\n')
      : null,
    continuation.openLoops.length > 0
      ? [
          'Open loops:',
          ...continuation.openLoops.map((loop) => `- ${loop}`),
        ].join('\n')
      : null,
    continuation.representativeExcerpts.length > 0
      ? [
          'Representative excerpts:',
          ...continuation.representativeExcerpts.map((excerpt) =>
            `- [${excerpt.kind}] ${excerpt.text}`,
          ),
        ].join('\n')
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join('\n\n')
}

function groupArchivedTranscriptTurns(
  entries: readonly AssistantTranscriptEntry[],
): TranscriptTurn[] {
  const turns: TranscriptTurn[] = []
  let currentTurn: TranscriptTurn | null = null

  for (const entry of entries) {
    if (entry.kind === 'user') {
      currentTurn = {
        assistant: [],
        errors: [],
        user: entry,
      }
      turns.push(currentTurn)
      continue
    }

    if (!currentTurn) {
      currentTurn = {
        assistant: [],
        errors: [],
        user: null,
      }
      turns.push(currentTurn)
    }

    if (entry.kind === 'assistant') {
      currentTurn.assistant.push(entry)
      continue
    }

    currentTurn.errors.push(entry)
  }

  return turns
}

function buildSummaryBullets(turns: readonly TranscriptTurn[]): string[] {
  return selectEvenlySpaced(turns, MAX_SUMMARY_BULLETS)
    .map((turn) => formatSummaryBullet(turn))
    .filter((bullet): bullet is string => bullet !== null)
}

function formatSummaryBullet(turn: TranscriptTurn): string | null {
  const userText = turn.user ? clampPreview(turn.user.text) : null
  const assistantText =
    turn.assistant.length > 0
      ? clampPreview(turn.assistant[turn.assistant.length - 1]?.text ?? '')
      : null
  const errorText =
    turn.errors.length > 0
      ? clampPreview(turn.errors[turn.errors.length - 1]?.text ?? '')
      : null

  if (userText && assistantText) {
    return `User asked "${userText}" and the assistant replied "${assistantText}".`
  }

  if (userText && errorText) {
    return `User asked "${userText}" and the transcript captured an error: "${errorText}".`
  }

  if (userText) {
    return `User asked "${userText}".`
  }

  if (assistantText) {
    return `Assistant said "${assistantText}".`
  }

  if (errorText) {
    return `Transcript recorded an error: "${errorText}".`
  }

  return null
}

function buildOpenLoops(turns: readonly TranscriptTurn[]): string[] {
  const loops: string[] = []

  for (const turn of [...turns].reverse()) {
    if (loops.length >= MAX_OPEN_LOOPS) {
      break
    }

    const userText = turn.user ? clampPreview(turn.user.text) : null
    const lastAssistantText =
      turn.assistant.length > 0
        ? clampPreview(turn.assistant[turn.assistant.length - 1]?.text ?? '')
        : null
    const lastErrorText =
      turn.errors.length > 0
        ? clampPreview(turn.errors[turn.errors.length - 1]?.text ?? '')
        : null

    if (lastErrorText) {
      loops.push(`A prior turn ended with an error: "${lastErrorText}".`)
      continue
    }

    if (userText && turn.assistant.length === 0) {
      loops.push(`A prior user request may still matter: "${userText}".`)
      continue
    }

    if (lastAssistantText && /[?]\s*$/u.test(lastAssistantText)) {
      loops.push(`The assistant previously asked: "${lastAssistantText}".`)
    }
  }

  return [...new Set(loops)].slice(0, MAX_OPEN_LOOPS)
}

function buildRepresentativeExcerpts(
  entries: readonly AssistantTranscriptEntry[],
): AssistantTranscriptContinuation['representativeExcerpts'] {
  return selectEvenlySpaced(entries, MAX_REPRESENTATIVE_EXCERPTS).map((entry) => ({
    createdAt: entry.createdAt,
    kind: entry.kind,
    text: clampPreview(entry.text),
  }))
}

function selectEvenlySpaced<T>(
  items: readonly T[],
  maxCount: number,
): T[] {
  if (items.length <= maxCount) {
    return [...items]
  }

  const indices = new Set<number>()
  for (let offset = 0; offset < maxCount; offset += 1) {
    const position =
      maxCount === 1
        ? 0
        : Math.round((offset * (items.length - 1)) / (maxCount - 1))
    indices.add(position)
  }

  return [...indices]
    .sort((left, right) => left - right)
    .map((index) => items[index]!)
}

function clampPreview(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= MAX_PREVIEW_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…`
}
