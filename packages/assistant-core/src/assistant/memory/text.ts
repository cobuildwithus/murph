import {
  assistantMemoryLongTermSectionValues,
  type AssistantMemoryLongTermSection,
  type AssistantMemoryRecordKind,
} from '../../assistant-cli-contracts.js'
import { normalizeNullableString } from '../shared.js'

const RESPONSE_CONTEXT_PATTERN =
  /\b(?:answer|answers|response|responses|reply|replies|summary|summaries)\b/iu

export const longTermMemorySections = assistantMemoryLongTermSectionValues
export const memoryTimeSeparator = ' — '

export function formatLocalDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLocalTime(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function normalizeMemoryLookup(value: string): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  return normalized
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+—\s+/u, '')
    .replace(/^\d{2}:\d{2}\s+—\s+/u, '')
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

export function buildLongTermMemoryMapKey(
  section: AssistantMemoryLongTermSection,
  text: string,
): string | null {
  const normalized = normalizeMemoryLookup(text)
  if (!normalized) {
    return null
  }

  const replaceKey = deriveLongTermReplaceKey(section, text)
  return replaceKey
    ? `${section.toLowerCase()}|slot:${replaceKey}`
    : `${section.toLowerCase()}|text:${normalized}`
}

export function buildDailyMemoryMapKey(text: string): string | null {
  const normalized = normalizeMemoryLookup(text)
  if (!normalized) {
    return null
  }

  const replaceKey =
    deriveIdentityReplaceKey(normalized) ??
    deriveAssistantBehaviorReplaceKey(normalized) ??
    deriveHealthContextReplaceKey(normalized)

  return replaceKey ? `daily|slot:${replaceKey}` : `daily|text:${normalized}`
}

export function deriveLongTermReplaceKey(
  section: AssistantMemoryLongTermSection,
  text: string,
): string | null {
  const normalized = normalizeMemoryLookup(text)
  if (!normalized) {
    return null
  }

  if (section === 'Identity' && normalized.startsWith('call the user ')) {
    return 'identity:name'
  }

  if (section === 'Preferences' || section === 'Standing instructions') {
    return deriveAssistantBehaviorReplaceKey(normalized)
  }

  if (section === 'Health context') {
    return deriveHealthContextReplaceKey(normalized)
  }

  return null
}

export function buildAssistantMemoryRecordId(
  kind: AssistantMemoryRecordKind,
  lookupKey: string,
): string {
  return `${kind}:${encodeURIComponent(lookupKey)}`
}

export function buildDailyMemoryRecordLookupKey(
  dailyDate: string | null | undefined,
  text: string,
): string | null {
  const noteKey = buildDailyMemoryMapKey(text)
  if (!noteKey || !dailyDate) {
    return null
  }

  return `${dailyDate}|${noteKey}`
}

export function extractMemoryRecordTimestampLabel(
  kind: AssistantMemoryRecordKind,
  rawText: string,
  dailyDate: string | null,
): string | null {
  const longTermMatch = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+—\s+/u.exec(rawText)
  if (longTermMatch?.[1]) {
    return longTermMatch[1]
  }

  const dailyMatch = /^(\d{2}:\d{2})\s+—\s+/u.exec(rawText)
  if (dailyMatch?.[1] && kind === 'daily' && dailyDate) {
    return `${dailyDate} ${dailyMatch[1]}`
  }

  return null
}

export function stripMemoryBulletPrefix(rawText: string): string {
  return normalizeNullableString(
    rawText
      .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+—\s+/u, '')
      .replace(/^\d{2}:\d{2}\s+—\s+/u, ''),
  ) ?? rawText
}

export function isLongTermSection(
  value: string,
): value is AssistantMemoryLongTermSection {
  return longTermMemorySections.includes(value as AssistantMemoryLongTermSection)
}

function deriveIdentityReplaceKey(text: string): string | null {
  return text.startsWith('call the user ') ? 'identity:name' : null
}

function deriveAssistantBehaviorReplaceKey(text: string): string | null {
  if (/\buse\s+(?:metric|imperial|us customary)\s+units\b/iu.test(text)) {
    return 'assistant-style:units'
  }

  if (
    RESPONSE_CONTEXT_PATTERN.test(text) &&
    /\b(?:brief|concise|detailed)\b/iu.test(text)
  ) {
    return 'assistant-style:verbosity'
  }

  if (RESPONSE_CONTEXT_PATTERN.test(text) && /\bbullet(?: point)?s?\b/iu.test(text)) {
    return 'assistant-style:format:bullets'
  }

  if (RESPONSE_CONTEXT_PATTERN.test(text) && /\btable(?:s)?\b/iu.test(text)) {
    return 'assistant-style:format:tables'
  }

  if (/\btone\b/iu.test(text)) {
    return 'assistant-style:tone'
  }

  return null
}

function deriveHealthContextReplaceKey(text: string): string | null {
  const allergyMatch = /^user is allergic to (.+)$/iu.exec(text)
  if (allergyMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(allergyMatch[1])
    return subject ? `health:allergy:${subject}` : null
  }

  const medicationMatch = /^user takes (.+)$/iu.exec(text)
  if (medicationMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(medicationMatch[1])
    return subject ? `health:medication:${subject}` : null
  }

  const usageMatch = /^user uses (.+)$/iu.exec(text)
  if (usageMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(usageMatch[1])
    return subject ? `health:use:${subject}` : null
  }

  const trackingMatch = /^user (?:tracks|monitors) (.+)$/iu.exec(text)
  if (trackingMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(trackingMatch[1])
    return subject ? `health:tracked:${subject}` : null
  }

  const measurementMatch =
    /^user's (.+?)\s+(?:is|was|are|were)\s+.+$/iu.exec(text)
  if (measurementMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(measurementMatch[1])
    return subject ? `health:measurement:${subject}` : null
  }

  return null
}

function normalizeHealthSubjectKey(value: string): string | null {
  const normalized = normalizeMemoryLookup(value)
  if (!normalized) {
    return null
  }

  return normalizeNullableString(
    normalized
      .replace(
        /\b\d+(?:\.\d+)?\s*(?:g|iu|mcg|mg|ml|units?)\b.*$/u,
        '',
      )
      .replace(/\b(?:as needed|daily|monthly|nightly|prn|weekly)\b.*$/u, '')
      .replace(/[,:;].*$/u, '')
      .trim(),
  )
}
