import type {
  AssistantMemoryLongTermSection,
  AssistantMemoryRecord,
  AssistantMemoryRecordKind,
  AssistantMemoryRecordProvenance,
  AssistantMemoryVisibleSection,
} from '../../assistant-cli-contracts.js'
import { normalizeNullableString } from '../shared.js'
import {
  buildAssistantMemoryRecordId,
  buildDailyMemoryMapKey,
  buildDailyMemoryRecordLookupKey,
  buildLongTermMemoryMapKey,
  deriveLongTermReplaceKey,
  extractMemoryRecordTimestampLabel,
  formatLocalDate,
  isLongTermSection,
  longTermMemorySections,
  normalizeMemoryLookup,
  stripMemoryBulletPrefix,
} from './text.js'

const ASSISTANT_MEMORY_METADATA_COMMENT_PREFIX = 'murph-assistant-memory:'

export interface MarkdownSection {
  heading: string
  lines: string[]
}

export interface ParsedMarkdownDocument {
  preambleLines: string[]
  sections: MarkdownSection[]
}

export interface AssistantMemoryBullet {
  key: string
  rawText: string
  provenance: AssistantMemoryRecordProvenance | null
  replaceKey: string | null
}

export interface ParsedAssistantMemoryRecord {
  id: string
  kind: AssistantMemoryRecordKind
  provenance: AssistantMemoryRecordProvenance | null
  recordedAt: string | null
  section: AssistantMemoryVisibleSection
  sourceLine: number
  text: string
}

interface MemoryRecordParseInput {
  kind: AssistantMemoryRecordKind
  sourcePath: string
  text: string
  dailyDate?: string | null
  includeSensitiveHealthContext: boolean
}

export function toAssistantMemoryRecord(
  input: ParsedAssistantMemoryRecord,
  sourcePath: string,
): AssistantMemoryRecord {
  return {
    id: input.id,
    kind: input.kind,
    provenance: input.provenance,
    section: input.section,
    text: input.text,
    recordedAt: input.recordedAt,
    sourcePath,
    sourceLine: input.sourceLine,
  }
}

export function parseAssistantMemoryRecords(
  input: MemoryRecordParseInput,
): ParsedAssistantMemoryRecord[] {
  const records: ParsedAssistantMemoryRecord[] = []
  const lines = input.text.replace(/\r\n/gu, '\n').split('\n')
  let activeSection: AssistantMemoryVisibleSection | null =
    input.kind === 'daily' ? 'Notes' : null

  for (const [index, line] of lines.entries()) {
    const sectionMatch = /^##\s+(.+)$/u.exec(line)
    if (sectionMatch?.[1]) {
      const heading = normalizeNullableString(sectionMatch[1])
      if (heading && (heading === 'Notes' || isLongTermSection(heading))) {
        activeSection = heading
      } else {
        activeSection = null
      }
      continue
    }

    if (!activeSection) {
      continue
    }

    if (
      activeSection === 'Health context' &&
      !input.includeSensitiveHealthContext
    ) {
      continue
    }

    const bullet = parseAssistantMemoryBullet(line)
    if (!bullet) {
      continue
    }

    const text = stripMemoryBulletPrefix(bullet.rawText)
    const lookupKey =
      input.kind === 'long-term'
        ? isLongTermSection(activeSection)
          ? buildLongTermMemoryMapKey(activeSection, text)
          : null
        : buildDailyMemoryRecordLookupKey(input.dailyDate, text)

    if (!lookupKey) {
      continue
    }

    records.push({
      id: buildAssistantMemoryRecordId(input.kind, lookupKey),
      kind: input.kind,
      provenance: bullet.provenance,
      recordedAt: extractMemoryRecordTimestampLabel(
        input.kind,
        bullet.rawText,
        input.dailyDate ?? null,
      ),
      section: activeSection,
      sourceLine: index + 1,
      text,
    })
  }

  return records
}

export function createDefaultLongTermMemoryDocument(): ParsedMarkdownDocument {
  return {
    preambleLines: [
      '# Assistant memory',
      '',
      'This file lives outside the canonical vault. It stores non-canonical conversational memory such as naming, response preferences, standing instructions, and selected health context.',
      'If anything here conflicts with the vault, trust the vault. Newer bullets override older bullets.',
    ],
    sections: longTermMemorySections.map((heading) => ({
      heading,
      lines: [],
    })),
  }
}

export function createDefaultDailyMemoryDocument(
  now: Date,
): ParsedMarkdownDocument {
  return {
    preambleLines: [
      `# Daily assistant memory — ${formatLocalDate(now)}`,
      '',
      'This file lives outside the canonical vault and stores short-lived conversational context for recent sessions only.',
    ],
    sections: [
      {
        heading: 'Notes',
        lines: [],
      },
    ],
  }
}

export function parseMarkdownDocument(text: string): ParsedMarkdownDocument {
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const preambleLines: string[] = []
  const sections: MarkdownSection[] = []
  let activeSection: MarkdownSection | null = null

  for (const line of lines) {
    const sectionMatch = /^##\s+(.+)$/u.exec(line)
    if (sectionMatch?.[1]) {
      activeSection = {
        heading: sectionMatch[1].trim(),
        lines: [],
      }
      sections.push(activeSection)
      continue
    }

    if (activeSection) {
      activeSection.lines.push(line)
    } else {
      preambleLines.push(line)
    }
  }

  return {
    preambleLines,
    sections,
  }
}

export function renderMarkdownDocument(
  document: ParsedMarkdownDocument,
): string {
  const chunks: string[] = []
  const preamble = document.preambleLines.join('\n').trimEnd()
  if (preamble.length > 0) {
    chunks.push(preamble)
  }

  for (const section of document.sections) {
    const body = section.lines.join('\n').replace(/\n+$/u, '')
    chunks.push(body.length > 0 ? `## ${section.heading}\n${body}` : `## ${section.heading}`)
  }

  return `${chunks.join('\n\n').trimEnd()}\n`
}

export function findOrCreateSection(
  document: ParsedMarkdownDocument,
  heading: string,
): MarkdownSection {
  const existing = document.sections.find((section) => section.heading === heading)
  if (existing) {
    return existing
  }

  const created = {
    heading,
    lines: [],
  }
  document.sections.push(created)
  return created
}

export function getSectionBullets(
  section: MarkdownSection,
  sectionName: AssistantMemoryLongTermSection,
): AssistantMemoryBullet[] {
  return section.lines
    .map((line) => parseAssistantMemoryBullet(line))
    .filter((line): line is AssistantMemoryBullet => Boolean(line))
    .map((bullet) => {
      const key = normalizeMemoryLookup(bullet.rawText)
      if (!key) {
        return null
      }

      return {
        key,
        rawText: bullet.rawText,
        provenance: bullet.provenance,
        replaceKey: deriveLongTermReplaceKey(sectionName, bullet.rawText),
      }
    })
    .filter((bullet): bullet is AssistantMemoryBullet => Boolean(bullet))
}

export function getDailySectionBullets(
  section: MarkdownSection,
): AssistantMemoryBullet[] {
  return section.lines
    .map((line) => parseAssistantMemoryBullet(line))
    .filter((line): line is AssistantMemoryBullet => Boolean(line))
    .map<AssistantMemoryBullet | null>((bullet) => {
      const key = buildDailyMemoryMapKey(stripMemoryBulletPrefix(bullet.rawText))
      if (!key) {
        return null
      }

      return {
        key,
        rawText: bullet.rawText,
        provenance: bullet.provenance,
        replaceKey: null,
      }
    })
    .filter((bullet): bullet is AssistantMemoryBullet => Boolean(bullet))
}

export function renderSectionBulletLines(
  bullets: AssistantMemoryBullet[],
): string[] {
  return bullets.flatMap((bullet, index) =>
    index === 0
      ? [`- ${renderAssistantMemoryBulletText(bullet)}`]
      : ['', `- ${renderAssistantMemoryBulletText(bullet)}`],
  )
}

function parseBulletLine(line: string): string | null {
  const match = /^\s*-\s+(.+)$/u.exec(line)
  if (!match?.[1]) {
    return null
  }

  return normalizeNullableString(match[1])
}

function parseAssistantMemoryBullet(line: string): AssistantMemoryBullet | null {
  const bulletLine = parseBulletLine(line)
  if (!bulletLine) {
    return null
  }

  const { provenance, rawText } = splitAssistantMemoryMetadata(bulletLine)
  const key = normalizeMemoryLookup(rawText)
  if (!key) {
    return null
  }

  return {
    key,
    provenance,
    rawText,
    replaceKey: null,
  }
}

function renderAssistantMemoryBulletText(
  bullet: AssistantMemoryBullet,
): string {
  const metadataComment = renderAssistantMemoryMetadataComment(bullet.provenance)
  return metadataComment ? `${bullet.rawText} ${metadataComment}` : bullet.rawText
}

function splitAssistantMemoryMetadata(value: string): {
  provenance: AssistantMemoryRecordProvenance | null
  rawText: string
} {
  const match = new RegExp(
    `^(.*)\\s+<!--\\s*${ASSISTANT_MEMORY_METADATA_COMMENT_PREFIX}(.+)\\s*-->\\s*$`,
    'u',
  ).exec(value)
  if (!match?.[1]) {
    return {
      provenance: null,
      rawText: value,
    }
  }

  const rawText = normalizeNullableString(match[1]) ?? value
  const rawMetadata = normalizeNullableString(match[2])
  if (!rawMetadata) {
    return {
      provenance: null,
      rawText,
    }
  }

  try {
    const parsed = JSON.parse(rawMetadata) as unknown
    if (isAssistantMemoryRecordProvenance(parsed)) {
      return {
        provenance: parsed,
        rawText,
      }
    }
  } catch {}

  return {
    provenance: null,
    rawText,
  }
}

function renderAssistantMemoryMetadataComment(
  provenance: AssistantMemoryRecordProvenance | null,
): string | null {
  if (!provenance) {
    return null
  }

  return `<!-- ${ASSISTANT_MEMORY_METADATA_COMMENT_PREFIX}${JSON.stringify(provenance)} -->`
}

function isAssistantMemoryRecordProvenance(
  value: unknown,
): value is AssistantMemoryRecordProvenance {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'writtenBy' in value &&
      ((value as { writtenBy?: unknown }).writtenBy === 'assistant' ||
        (value as { writtenBy?: unknown }).writtenBy === 'operator') &&
      'sessionId' in value &&
      ((value as { sessionId?: unknown }).sessionId === null ||
        typeof (value as { sessionId?: unknown }).sessionId === 'string') &&
      'turnId' in value &&
      ((value as { turnId?: unknown }).turnId === null ||
        typeof (value as { turnId?: unknown }).turnId === 'string'),
  )
}
