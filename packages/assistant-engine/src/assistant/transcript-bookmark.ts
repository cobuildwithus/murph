import { createHash } from 'node:crypto'
import type { AssistantTranscriptEntry } from '@murphai/operator-config/assistant-cli-contracts'
import type { TranscriptSeenThrough } from '@murphai/operator-config/assistant/codex-resume-state'

export function fingerprintTranscriptEntry(
  entry: Pick<AssistantTranscriptEntry, 'createdAt' | 'kind' | 'text'>,
): Exclude<TranscriptSeenThrough, 'start'> {
  return {
    createdAt: entry.createdAt,
    kind: entry.kind,
    textSha256: createHash('sha256').update(entry.text).digest('hex'),
  }
}

function matchesBookmark(
  entry: AssistantTranscriptEntry,
  bookmark: TranscriptSeenThrough,
): boolean {
  if (bookmark === 'start') return false
  const fingerprint = fingerprintTranscriptEntry(entry)
  return fingerprint.createdAt === bookmark.createdAt
    && fingerprint.kind === bookmark.kind
    && fingerprint.textSha256 === bookmark.textSha256
}

export function readTranscriptBoundary(
  entries: readonly AssistantTranscriptEntry[],
): TranscriptSeenThrough {
  const last = entries.at(-1)
  return last ? fingerprintTranscriptEntry(last) : 'start'
}

export function findEntriesAfterBookmark(
  entries: readonly AssistantTranscriptEntry[],
  bookmark: TranscriptSeenThrough,
): readonly AssistantTranscriptEntry[] | null {
  if (bookmark === 'start') return entries
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && matchesBookmark(entry, bookmark)) return entries.slice(index + 1)
  }
  return null
}

export function advanceBookmarkOverOwnEntries(input: {
  boundary: TranscriptSeenThrough
  ownEntries: readonly AssistantTranscriptEntry[]
  entries: readonly AssistantTranscriptEntry[]
}): TranscriptSeenThrough {
  const after = findEntriesAfterBookmark(input.entries, input.boundary)
  if (after === null) return input.boundary
  const own = new Set(input.ownEntries.map((entry) =>
    JSON.stringify(fingerprintTranscriptEntry(entry)),
  ))
  let bookmark = input.boundary
  for (const entry of after) {
    const fingerprint = fingerprintTranscriptEntry(entry)
    if (
      (entry.kind !== 'user' && entry.kind !== 'assistant') ||
      own.has(JSON.stringify(fingerprint))
    ) {
      bookmark = fingerprint
    } else {
      break
    }
  }
  return bookmark
}
