import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  type AssistantMemoryLongTermSection,
  type AssistantMemoryQueryScope,
  type AssistantMemoryRecord,
  type AssistantMemoryRecordProvenance,
  type AssistantMemorySearchHit,
  type AssistantMemoryVisibleSection,
  type AssistantMemoryWriteScope,
} from '../assistant-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { appendAssistantRuntimeEvent } from './runtime-events.js'
import { redactAssistantDisplayPath } from './store.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  writeTextFileAtomic,
} from './shared.js'
import {
  resolveAssistantDailyMemoryPath,
  resolveAssistantMemoryStoragePaths,
  type AssistantMemoryPaths,
} from './memory/paths.js'
export {
  resolveAssistantDailyMemoryPath,
  resolveAssistantMemoryStoragePaths,
} from './memory/paths.js'
export type { AssistantMemoryPaths } from './memory/paths.js'
import {
  type AssistantMemoryTurnContext,
} from './memory/turn-context.js'
export {
  createAssistantMemoryTurnContextEnv,
  resolveAssistantMemoryTurnContext,
  assertAssistantMemoryTurnContextVault,
  assistantMemoryTurnEnvKeys,
} from './memory/turn-context.js'
export type {
  AssistantMemoryTurnContext,
  AssistantMemoryTurnContextInput,
} from './memory/turn-context.js'
import { withAssistantMemoryWriteLock } from './memory/locking.js'
import {
  type AssistantLongTermMemoryEntry,
  extractAssistantMemory,
  normalizeAssistantDailyMemoryText,
  normalizeAssistantLongTermMemoryText,
} from './memory/extraction.js'
export {
  extractAssistantMemory,
} from './memory/extraction.js'
export type {
  AssistantLongTermMemoryEntry,
  AssistantMemoryExtraction,
} from './memory/extraction.js'
import {
  clampMemorySearchLimit,
  compareAssistantMemorySearchHits,
  groupLongTermPromptRecords,
  scoreAssistantMemoryRecord,
} from './memory/search.js'
import {
  type AssistantMemoryBullet,
  type ParsedMarkdownDocument,
  createDefaultDailyMemoryDocument,
  createDefaultLongTermMemoryDocument,
  findOrCreateSection,
  getDailySectionBullets,
  getSectionBullets,
  parseAssistantMemoryRecords,
  parseMarkdownDocument,
  renderMarkdownDocument,
  renderSectionBulletLines,
  toAssistantMemoryRecord,
} from './memory/storage-format.js'
import {
  buildDailyMemoryMapKey,
  deriveLongTermReplaceKey,
  formatLocalDate,
  formatLocalTime,
  isLongTermSection,
  longTermMemorySections,
  memoryTimeSeparator,
  normalizeMemoryLookup,
} from './memory/text.js'

const LONG_TERM_MEMORY_SECTIONS = longTermMemorySections
const MEMORY_PROMPT_MAX_CHARS = 2_800
const MEMORY_TIME_SEPARATOR = memoryTimeSeparator

export interface AssistantMemoryPromptInput {
  now?: Date
  vault: string
  includeSensitiveHealthContext?: boolean
}

export interface AssistantMemorySearchInput {
  limit?: number
  scope?: AssistantMemoryQueryScope
  section?: AssistantMemoryVisibleSection | null
  text?: string | null
  vault: string
  includeSensitiveHealthContext?: boolean
}

export interface AssistantMemorySearchResponse {
  query: string | null
  results: AssistantMemorySearchHit[]
  scope: AssistantMemoryQueryScope
  section: AssistantMemoryVisibleSection | null
}

export interface AssistantMemoryGetInput {
  id: string
  vault: string
  includeSensitiveHealthContext?: boolean
}

export interface AssistantMemoryForgetInput {
  id: string
  vault: string
}

interface AssistantMemoryForgetWriteResult {
  removed: AssistantMemoryRecord
}

export interface AssistantMemoryUpsertInput {
  now?: Date
  scope?: AssistantMemoryWriteScope
  section?: AssistantMemoryLongTermSection | null
  sourcePrompt?: string | null
  text: string
  vault: string
  allowSensitiveHealthContext?: boolean
  provenance?: AssistantMemoryRecordProvenance | null
  requireSourcePromptMatch?: boolean
  turnContext?: AssistantMemoryTurnContext | null
}

export interface AssistantMemoryUpsertWriteResult {
  dailyAdded: number
  longTermAdded: number
  memories: AssistantMemoryRecord[]
  scope: AssistantMemoryWriteScope
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return ''
    }

    throw error
  }
}

interface NormalizedAssistantMemoryUpsert {
  provenance: AssistantMemoryRecordProvenance
  dailyText: string | null
  longTermEntry: AssistantLongTermMemoryEntry | null
  requireSourcePromptMatch: boolean
  sourcePrompt: string | null
  scope: AssistantMemoryWriteScope
}

export async function loadAssistantMemoryPromptBlock(
  input: AssistantMemoryPromptInput,
): Promise<string | null> {
  const records = await loadAssistantMemoryRecords({
    vault: input.vault,
    scope: 'long-term',
    includeSensitiveHealthContext: input.includeSensitiveHealthContext ?? true,
  })
  const grouped = groupLongTermPromptRecords(records)
  const blocks = LONG_TERM_MEMORY_SECTIONS.flatMap((section) => {
    if (section === 'Health context' && !(input.includeSensitiveHealthContext ?? true)) {
      return []
    }

    const entries = grouped.get(section) ?? []
    if (entries.length === 0) {
      return []
    }

    return [`${section}:\n${entries.map((entry) => `- ${entry}`).join('\n')}`]
  })

  if (blocks.length === 0) {
    return null
  }

  return truncateMemoryPromptText(
    [
      'Assistant memory lives outside the canonical vault and is only for conversational continuity.',
      'Use this core block only for durable naming, response preferences, standing instructions, useful long-lived context, and private-context health memory.',
      'If assistant memory conflicts with the vault, trust the vault.',
      `Core assistant memory:\n${blocks.join('\n\n')}`,
    ].join('\n\n'),
  )
}

export async function searchAssistantMemory(
  input: AssistantMemorySearchInput,
): Promise<AssistantMemorySearchResponse> {
  const scope = input.scope ?? 'all'
  const section = input.section ?? null
  const query = normalizeNullableString(input.text)
  const limit = clampMemorySearchLimit(input.limit)
  const records = await loadAssistantMemoryRecords({
    vault: input.vault,
    scope,
    includeSensitiveHealthContext: input.includeSensitiveHealthContext ?? true,
  })
  const filtered = section
    ? records.filter((record) => record.section === section)
    : records

  const hits = filtered
    .map((record) => ({
      ...record,
      score: scoreAssistantMemoryRecord(record, query),
    }))
    .filter((record) => (query ? record.score > 0 : true))
    .sort((left, right) => compareAssistantMemorySearchHits(left, right, Boolean(query)))
    .slice(0, limit)

  return {
    query,
    results: hits,
    scope,
    section,
  }
}

export async function getAssistantMemory(
  input: AssistantMemoryGetInput,
): Promise<AssistantMemoryRecord> {
  return await requireAssistantMemoryRecord({
    id: input.id,
    includeSensitiveHealthContext: input.includeSensitiveHealthContext ?? true,
    vault: input.vault,
  })
}

export async function forgetAssistantMemory(
  input: AssistantMemoryForgetInput,
): Promise<AssistantMemoryForgetWriteResult> {
  const paths = resolveAssistantMemoryStoragePaths(input.vault)
  const removed = await withAssistantMemoryWriteLock(paths, async () => {
    const target = await requireAssistantMemoryRecord({
      id: input.id,
      includeSensitiveHealthContext: true,
      vault: input.vault,
    })
    await removeAssistantMemoryRecord(paths, target)
    return target
  })

  await appendAssistantRuntimeEvent({
    component: 'assistant.memory',
    data: {
      kind: removed.kind,
      section: removed.section,
      sourcePath: redactAssistantDisplayPath(removed.sourcePath),
    },
    entityId: removed.id,
    entityType: 'assistant-memory',
    kind: 'memory.removed',
    message: `Removed assistant memory ${removed.id}.`,
    vault: input.vault,
  })

  return {
    removed,
  }
}

export async function upsertAssistantMemory(
  input: AssistantMemoryUpsertInput,
): Promise<AssistantMemoryUpsertWriteResult> {
  const normalized = normalizeAssistantMemoryUpsert(input)
  const paths = resolveAssistantMemoryStoragePaths(input.vault)
  const now = input.now ?? new Date()
  const { dailyAdded, longTermAdded, memories } = await withAssistantMemoryWriteLock(
    paths,
    async () => {
      let nextLongTermAdded = 0
      let nextDailyAdded = 0

      if (normalized.longTermEntry) {
        nextLongTermAdded = await mergeLongTermAssistantMemory(
          paths,
          [normalized.longTermEntry],
          now,
          normalized.provenance,
        )
      }

      if (normalized.dailyText) {
        nextDailyAdded = await appendAssistantDailyMemory(
          paths,
          [normalized.dailyText],
          now,
          normalized.provenance,
        )
      }

      const memories = await resolveUpsertedAssistantMemoryRecords({
        dailyDate: normalized.dailyText ? formatLocalDate(now) : null,
        dailyText: normalized.dailyText,
        longTermEntry: normalized.longTermEntry,
        paths,
      })

      return {
        dailyAdded: nextDailyAdded,
        longTermAdded: nextLongTermAdded,
        memories,
      }
    },
  )

  await appendAssistantRuntimeEvent({
    component: 'assistant.memory',
    data: {
      dailyAdded,
      longTermAdded,
      memoryIds: memories.map((memory) => memory.id),
      scope: normalized.scope,
    },
    entityId: memories.length === 1 ? memories[0]!.id : null,
    entityType: 'assistant-memory',
    kind: 'memory.upserted',
    message: `Updated assistant memory (${longTermAdded} long-term, ${dailyAdded} daily).`,
    vault: input.vault,
  })

  return {
    dailyAdded,
    longTermAdded,
    memories,
    scope: normalized.scope,
  }
}

async function requireAssistantMemoryRecord(input: {
  id: string
  includeSensitiveHealthContext: boolean
  vault: string
}): Promise<AssistantMemoryRecord> {
  const records = await loadAssistantMemoryRecords({
    vault: input.vault,
    scope: 'all',
    includeSensitiveHealthContext: input.includeSensitiveHealthContext,
  })
  const record = records.find((candidate) => candidate.id === input.id)

  if (!record) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_NOT_FOUND',
      `Assistant memory "${input.id}" was not found.`,
    )
  }

  return record
}

async function removeAssistantMemoryRecord(
  paths: AssistantMemoryPaths,
  record: AssistantMemoryRecord,
): Promise<void> {
  const existing = await readOptionalText(record.sourcePath)
  if (!existing) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_NOT_FOUND',
      `Assistant memory "${record.id}" was not found.`,
    )
  }

  const document = parseMarkdownDocument(existing)
  const section = document.sections.find((candidate) => candidate.heading === record.section)
  if (!section) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_NOT_FOUND',
      `Assistant memory "${record.id}" was not found.`,
    )
  }

  const key =
    record.kind === 'long-term' && isLongTermSection(record.section)
      ? normalizeMemoryLookup(record.text)
      : buildDailyMemoryMapKey(record.text)
  if (!key) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_NOT_FOUND',
      `Assistant memory "${record.id}" was not found.`,
    )
  }

  const nextBullets =
    record.kind === 'long-term' && isLongTermSection(record.section)
      ? getSectionBullets(section, record.section).filter((bullet) => bullet.key !== key)
      : getDailySectionBullets(section).filter((bullet) => bullet.key !== key)

  const currentCount =
    record.kind === 'long-term' && isLongTermSection(record.section)
      ? getSectionBullets(section, record.section).length
      : getDailySectionBullets(section).length

  if (nextBullets.length === currentCount) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_NOT_FOUND',
      `Assistant memory "${record.id}" was not found.`,
    )
  }

  section.lines = renderSectionBulletLines(nextBullets)
  await writeTextFileAtomic(record.sourcePath, renderMarkdownDocument(document))
}

export function redactAssistantMemoryRecord(
  record: AssistantMemoryRecord,
): AssistantMemoryRecord {
  return {
    ...record,
    sourcePath: redactAssistantDisplayPath(record.sourcePath),
  }
}

export function redactAssistantMemorySearchHit(
  record: AssistantMemorySearchHit,
): AssistantMemorySearchHit {
  return {
    ...record,
    sourcePath: redactAssistantDisplayPath(record.sourcePath),
  }
}

async function loadAssistantMemoryRecords(input: {
  vault: string
  scope: AssistantMemoryQueryScope
  includeSensitiveHealthContext: boolean
}): Promise<AssistantMemoryRecord[]> {
  const paths = resolveAssistantMemoryStoragePaths(input.vault)
  const records: AssistantMemoryRecord[] = []

  if (input.scope === 'all' || input.scope === 'long-term') {
    records.push(
      ...(await loadAssistantLongTermMemoryRecords(paths, input.includeSensitiveHealthContext)),
    )
  }

  if (input.scope === 'all' || input.scope === 'daily') {
    records.push(
      ...(await loadAssistantDailyMemoryRecords(paths, input.includeSensitiveHealthContext)),
    )
  }

  return records
}

async function loadAssistantLongTermMemoryRecords(
  paths: AssistantMemoryPaths,
  includeSensitiveHealthContext: boolean,
): Promise<AssistantMemoryRecord[]> {
  const text = await readOptionalText(paths.longTermMemoryPath)
  if (!text) {
    return []
  }

  return parseAssistantMemoryRecords({
    kind: 'long-term',
    sourcePath: paths.longTermMemoryPath,
    text,
    includeSensitiveHealthContext,
  }).map((record) => toAssistantMemoryRecord(record, paths.longTermMemoryPath))
}

async function loadAssistantDailyMemoryRecords(
  paths: AssistantMemoryPaths,
  includeSensitiveHealthContext: boolean,
): Promise<AssistantMemoryRecord[]> {
  let fileNames: string[] = []

  try {
    fileNames = await readdir(paths.dailyMemoryDirectory)
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }

  const dailyFiles = fileNames
    .filter((fileName) => fileName.endsWith('.md'))
    .sort()
  const records: AssistantMemoryRecord[] = []

  for (const fileName of dailyFiles) {
    const filePath = path.join(paths.dailyMemoryDirectory, fileName)
    const text = await readOptionalText(filePath)
    if (!text) {
      continue
    }

    const dailyDate = fileName.replace(/\.md$/u, '')
    records.push(
      ...parseAssistantMemoryRecords({
        kind: 'daily',
        sourcePath: filePath,
        text,
        dailyDate,
        includeSensitiveHealthContext,
      }).map((record) => toAssistantMemoryRecord(record, filePath)),
    )
  }

  return records
}

function normalizeAssistantMemoryUpsert(
  input: AssistantMemoryUpsertInput,
): NormalizedAssistantMemoryUpsert {
  const turnContext = input.turnContext ?? null
  const scope = input.scope ?? 'long-term'
  const rawText = normalizeNullableString(input.text.replace(/\s+/gu, ' '))
  const sourcePrompt = normalizeNullableString(
    (turnContext?.sourcePrompt ?? input.sourcePrompt ?? '').replace(/\s+/gu, ' '),
  )
  const allowSensitiveHealthContext =
    turnContext?.allowSensitiveHealthContext ??
    input.allowSensitiveHealthContext ??
    false
  const provenance = turnContext?.provenance ??
    input.provenance ??
    {
      writtenBy: 'operator' as const,
      sessionId: null,
      turnId: null,
    }
  const requireSourcePromptMatch =
    turnContext !== null ? true : input.requireSourcePromptMatch ?? false

  if (!rawText) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_TEXT_REQUIRED',
      'Assistant memory upsert requires non-empty text.',
    )
  }

  if (scope === 'daily') {
    if (input.section) {
      throw new VaultCliError(
        'ASSISTANT_MEMORY_SECTION_NOT_ALLOWED',
        'Daily assistant memory upserts must not include a long-term section.',
      )
    }

    return {
      dailyText: normalizeAssistantDailyMemoryText({
        allowSensitiveHealthContext,
        sourcePrompt,
        text: rawText,
      }),
      longTermEntry: null,
      provenance,
      requireSourcePromptMatch,
      sourcePrompt,
      scope,
    }
  }

  const section = input.section
  if (!section) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_SECTION_REQUIRED',
      'Long-term assistant memory upserts require a section.',
    )
  }

  const longTermText = normalizeAssistantLongTermMemoryText({
    allowSensitiveHealthContext,
    requireSourcePromptMatch,
    section,
    sourcePrompt,
    text: rawText,
  })

  return {
    dailyText: scope === 'both' ? longTermText : null,
    longTermEntry: {
      section,
      text: longTermText,
    },
    provenance,
    requireSourcePromptMatch,
    sourcePrompt,
    scope,
  }
}

async function resolveUpsertedAssistantMemoryRecords(input: {
  dailyDate: string | null
  dailyText: string | null
  longTermEntry: AssistantLongTermMemoryEntry | null
  paths: AssistantMemoryPaths
}): Promise<AssistantMemoryRecord[]> {
  const records: AssistantMemoryRecord[] = []
  const longTermRecords = input.longTermEntry
    ? await loadAssistantLongTermMemoryRecords(input.paths, true)
    : []
  const dailyRecords = input.dailyText
    ? await loadAssistantDailyMemoryRecords(input.paths, true)
    : []

  if (input.longTermEntry) {
    const record = longTermRecords.find(
      (candidate) =>
        candidate.section === input.longTermEntry?.section &&
        candidate.text === input.longTermEntry?.text,
    )
    if (record) {
      records.push(record)
    }
  }

  if (input.dailyText) {
    const record = dailyRecords.find(
      (candidate) =>
        candidate.section === 'Notes' &&
        candidate.text === input.dailyText &&
        (!input.dailyDate || candidate.recordedAt?.startsWith(input.dailyDate) === true),
    )
    if (record) {
      records.push(record)
    }
  }

  return records
}

async function mergeLongTermAssistantMemory(
  paths: AssistantMemoryPaths,
  entries: AssistantLongTermMemoryEntry[],
  now: Date,
  provenance: AssistantMemoryRecordProvenance,
): Promise<number> {
  const existing = await readOptionalText(paths.longTermMemoryPath)
  const document = existing
    ? parseMarkdownDocument(existing)
    : createDefaultLongTermMemoryDocument()
  const stampedPrefix = `${formatLocalDate(now)} ${formatLocalTime(now)}${MEMORY_TIME_SEPARATOR}`
  let added = 0
  let changed = false

  for (const sectionName of LONG_TERM_MEMORY_SECTIONS) {
    const section = findOrCreateSection(document, sectionName)
    const bullets = getSectionBullets(section, sectionName)
    let nextBullets = bullets
    let sectionChanged = false

    for (const entry of entries) {
      if (entry.section !== sectionName) {
        continue
      }

      const key = normalizeMemoryLookup(entry.text)
      if (!key) {
        continue
      }

      const replaceKey = deriveLongTermReplaceKey(sectionName, entry.text)
      if (replaceKey) {
        const filtered = nextBullets.filter(
          (bullet) => bullet.replaceKey !== replaceKey || bullet.key === key,
        )
        if (filtered.length !== nextBullets.length) {
          nextBullets = filtered
          sectionChanged = true
        }
      }

      if (nextBullets.some((bullet) => bullet.key === key)) {
        continue
      }

      nextBullets = [
        ...nextBullets,
        {
          key,
          rawText: `${stampedPrefix}${entry.text}`,
          provenance,
          replaceKey,
        },
      ]
      sectionChanged = true
      added += 1
    }

    if (sectionChanged) {
      section.lines = renderSectionBulletLines(nextBullets)
      changed = true
    }
  }

  if (changed) {
    await ensureAssistantStateDirectory(path.dirname(paths.longTermMemoryPath))
    await writeTextFileAtomic(
      paths.longTermMemoryPath,
      renderMarkdownDocument(document),
    )
  }

  return added
}

async function appendAssistantDailyMemory(
  paths: AssistantMemoryPaths,
  notes: string[],
  now: Date,
  provenance: AssistantMemoryRecordProvenance,
): Promise<number> {
  const dailyPath = resolveAssistantDailyMemoryPath(paths, now)
  const existing = await readOptionalText(dailyPath)
  const document = existing
    ? parseMarkdownDocument(existing)
    : createDefaultDailyMemoryDocument(now)
  const section = findOrCreateSection(document, 'Notes')
  let bullets = getDailySectionBullets(section)
  const seen = new Set(bullets.map((bullet) => bullet.key))
  let added = 0

  for (const note of notes) {
    const key = buildDailyMemoryMapKey(note)
    if (!key || seen.has(key)) {
      continue
    }

    bullets = [
      ...bullets,
      {
        key,
        rawText: `${formatLocalTime(now)}${MEMORY_TIME_SEPARATOR}${note}`,
        provenance,
        replaceKey: null,
      },
    ]
    seen.add(key)
    added += 1
  }

  if (added > 0) {
    section.lines = renderSectionBulletLines(bullets)
    await ensureAssistantStateDirectory(path.dirname(dailyPath))
    await writeTextFileAtomic(dailyPath, renderMarkdownDocument(document))
  }

  return added
}

function truncateMemoryPromptText(text: string): string {
  if (text.length <= MEMORY_PROMPT_MAX_CHARS) {
    return text
  }

  return `${text.slice(0, MEMORY_PROMPT_MAX_CHARS - 18).trimEnd()}\n\n[truncated memory]`
}
