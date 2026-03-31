import type {
  AssistantMemoryLongTermSection,
  AssistantMemoryRecord,
  AssistantMemorySearchHit,
} from '../../assistant-cli-contracts.js'
import {
  longTermMemorySections,
  normalizeMemoryLookup,
} from './text.js'

const MEMORY_SEARCH_DEFAULT_LIMIT = 8
const MEMORY_SEARCH_MAX_LIMIT = 25

export function groupLongTermPromptRecords(
  records: AssistantMemoryRecord[],
): Map<AssistantMemoryLongTermSection, string[]> {
  const grouped = new Map<AssistantMemoryLongTermSection, string[]>()

  for (const section of longTermMemorySections) {
    grouped.set(section, [])
  }

  for (const record of records) {
    if (!longTermMemorySections.includes(record.section as AssistantMemoryLongTermSection)) {
      continue
    }

    grouped.get(record.section as AssistantMemoryLongTermSection)?.push(record.text)
  }

  return grouped
}

export function clampMemorySearchLimit(value: number | undefined): number {
  if (!value || Number.isNaN(value)) {
    return MEMORY_SEARCH_DEFAULT_LIMIT
  }

  return Math.max(1, Math.min(MEMORY_SEARCH_MAX_LIMIT, Math.trunc(value)))
}

export function scoreAssistantMemoryRecord(
  record: AssistantMemoryRecord,
  query: string | null,
): number {
  if (!query) {
    return 0
  }

  const normalizedQuery = normalizeMemoryLookup(query)
  const normalizedText = normalizeMemoryLookup(record.text)
  const normalizedSection = normalizeMemoryLookup(record.section)

  if (!normalizedQuery || !normalizedText) {
    return 0
  }

  let score = 0

  if (normalizedText.includes(normalizedQuery)) {
    score += 12
  }

  if (normalizedSection?.includes(normalizedQuery)) {
    score += 4
  }

  const tokens = normalizedQuery.split(/\s+/u).filter((token) => token.length > 1)
  for (const token of tokens) {
    if (normalizedText.includes(token)) {
      score += 2
    }

    if (normalizedSection?.includes(token)) {
      score += 1
    }
  }

  return score
}

export function compareAssistantMemorySearchHits(
  left: AssistantMemorySearchHit,
  right: AssistantMemorySearchHit,
  scored: boolean,
): number {
  if (scored && right.score !== left.score) {
    return right.score - left.score
  }

  const recordedOrder = compareNullableStringsDesc(left.recordedAt, right.recordedAt)
  if (recordedOrder !== 0) {
    return recordedOrder
  }

  if (left.kind !== right.kind) {
    return left.kind === 'long-term' ? -1 : 1
  }

  const pathOrder = left.sourcePath.localeCompare(right.sourcePath)
  if (pathOrder !== 0) {
    return pathOrder
  }

  return left.sourceLine - right.sourceLine
}

function compareNullableStringsDesc(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return right.localeCompare(left)
}
