import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveAssistantTranscriptArchiveDirectory,
  resolveAssistantTranscriptContinuationPath,
  resolveAssistantTranscriptMaintenancePath,
  type AssistantStatePaths,
} from '@healthybob/runtime-state'
import {
  assistantTranscriptContinuationSchema,
  assistantTranscriptMaintenanceSchema,
  type AssistantTranscriptContinuation,
  type AssistantTranscriptEntry,
  type AssistantTranscriptMaintenance,
} from '../../assistant-cli-contracts.js'
import {
  isMissingFileError,
  writeJsonFileAtomic,
  writeTextFileAtomic,
} from '../shared.js'
import {
  buildAssistantTranscriptContinuation,
  formatAssistantTranscriptContinuationForReplay,
} from './continuation.js'
import {
  scanAssistantTranscriptText,
  serializeAssistantTranscriptEntries,
  type ScannedAssistantTranscriptEntry,
} from './scanner.js'

export const ASSISTANT_TRANSCRIPT_HOT_ENTRY_LIMIT = 80
export const ASSISTANT_TRANSCRIPT_HOT_BYTE_LIMIT = 256 * 1024
export const ASSISTANT_TRANSCRIPT_MIN_HOT_ENTRIES = 24
export const ASSISTANT_TRANSCRIPT_MIN_HOT_TURNS = 8

export interface AssistantPreparedTranscriptReplayContext {
  continuation: AssistantTranscriptContinuation | null
  conversationMessages: Array<{
    content: string
    role: 'assistant' | 'user'
  }>
  hotEntries: AssistantTranscriptEntry[]
  maintenance: AssistantTranscriptMaintenance
}

export interface AssistantTranscriptState {
  continuation: AssistantTranscriptContinuation | null
  entries: AssistantTranscriptEntry[]
  maintenance: AssistantTranscriptMaintenance
}

export async function loadAssistantTranscriptState(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantTranscriptState> {
  return maintainAssistantTranscript(input)
}

export async function loadAssistantPreparedTranscriptReplayContext(input: {
  limit: number
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantPreparedTranscriptReplayContext> {
  const state = await maintainAssistantTranscript(input)
  const hotConversationMessages = state.entries
    .flatMap((entry) =>
      entry.kind === 'assistant' || entry.kind === 'user'
        ? [{
            role: entry.kind,
            content: entry.text,
          } as const]
        : [],
    )
    .slice(-Math.max(0, Math.trunc(input.limit)))

  return {
    continuation: state.continuation,
    conversationMessages: [
      ...(state.continuation
        ? [{
            role: 'assistant' as const,
            content: formatAssistantTranscriptContinuationForReplay(
              state.continuation,
            ),
          }]
        : []),
      ...hotConversationMessages,
    ],
    hotEntries: state.entries,
    maintenance: state.maintenance,
  }
}

async function maintainAssistantTranscript(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantTranscriptState> {
  const transcriptPath = resolveAssistantTranscriptPath(input.paths, input.sessionId)
  const previousMaintenance = await readAssistantTranscriptMaintenance(input)
  const previousContinuation = await readAssistantTranscriptContinuation(input)
  const now = new Date().toISOString()

  let transcriptRaw: string | null = null
  try {
    transcriptRaw = await readFile(transcriptPath, 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  let entries: ScannedAssistantTranscriptEntry[] = []
  let hotText = ''
  let repaired = false
  let compacted = false

  if (transcriptRaw !== null) {
    const scan = scanAssistantTranscriptText(transcriptRaw)
    entries = [...scan.entries]
    hotText = transcriptRaw

    if (scan.issues.length > 0) {
      await archiveRepairSnapshot({
        paths: input.paths,
        raw: transcriptRaw,
        sessionId: input.sessionId,
      })
      hotText = serializeAssistantTranscriptEntries(entries)
      await writeTextFileAtomic(transcriptPath, hotText)
      repaired = true
    } else if (transcriptRaw.length > 0 && !scan.endedWithNewline) {
      hotText = serializeAssistantTranscriptEntries(entries)
      if (hotText !== transcriptRaw) {
        await writeTextFileAtomic(transcriptPath, hotText)
      }
    } else {
      hotText = transcriptRaw
    }

    if (shouldCompactTranscript(entries, hotText)) {
      const hotStartIndex = resolveCompactionHotStartIndex(entries)
      if (hotStartIndex > 0) {
        const archivedEntries = entries.slice(0, hotStartIndex)
        const hotEntries = entries.slice(hotStartIndex)
        await writeCompactedArchiveSegment({
          entries: archivedEntries,
          paths: input.paths,
          sessionId: input.sessionId,
        })
        entries = hotEntries
        hotText = serializeAssistantTranscriptEntries(entries)
        await writeTextFileAtomic(transcriptPath, hotText)
        compacted = true
      }
    }
  }

  const archived = await readArchivedTranscriptSegments(input)
  const continuation = await synchronizeTranscriptContinuation({
    archivedEntries: archived.entries,
    input,
    now,
    previous: previousContinuation,
  })
  const maintenance = assistantTranscriptMaintenanceSchema.parse({
    schema: 'healthybob.assistant-transcript-maintenance.v1',
    sessionId: input.sessionId,
    updatedAt: resolveMaintenanceUpdatedAt({
      compacted,
      hotByteLength: Buffer.byteLength(hotText, 'utf8'),
      hotEntryCount: entries.length,
      now,
      previous: previousMaintenance,
      repaired,
      nextArchiveSegmentCount: archived.segmentCount,
      nextArchivedEntryCount: archived.entries.length,
    }),
    hotEntryCount: entries.length,
    hotByteLength: Buffer.byteLength(hotText, 'utf8'),
    archivedEntryCount: archived.entries.length,
    archiveSegmentCount: archived.segmentCount,
    lastCompactedAt: compacted ? now : previousMaintenance?.lastCompactedAt ?? null,
    lastRepairedAt: repaired ? now : previousMaintenance?.lastRepairedAt ?? null,
    repairCount: (previousMaintenance?.repairCount ?? 0) + (repaired ? 1 : 0),
  })

  if (!isSameMaintenance(previousMaintenance, maintenance)) {
    await writeJsonFileAtomic(
      resolveAssistantTranscriptMaintenancePath(input.paths, input.sessionId),
      maintenance,
    )
  }

  return {
    continuation,
    entries: entries.map((entry) => entry.entry),
    maintenance:
      previousMaintenance && isSameMaintenance(previousMaintenance, maintenance)
        ? previousMaintenance
        : maintenance,
  }
}

async function readAssistantTranscriptMaintenance(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantTranscriptMaintenance | null> {
  try {
    const raw = await readFile(
      resolveAssistantTranscriptMaintenancePath(input.paths, input.sessionId),
      'utf8',
    )
    return assistantTranscriptMaintenanceSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
}

async function readAssistantTranscriptContinuation(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantTranscriptContinuation | null> {
  try {
    const raw = await readFile(
      resolveAssistantTranscriptContinuationPath(input.paths, input.sessionId),
      'utf8',
    )
    return assistantTranscriptContinuationSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
}

async function archiveRepairSnapshot(input: {
  paths: AssistantStatePaths
  raw: string
  sessionId: string
}): Promise<void> {
  const archivePath = await allocateTranscriptArchivePath({
    extension: '.jsonl',
    paths: input.paths,
    prefix: 'repair',
    sessionId: input.sessionId,
  })
  await writeTextFileAtomic(archivePath, input.raw)
}

async function writeCompactedArchiveSegment(input: {
  entries: readonly ScannedAssistantTranscriptEntry[]
  paths: AssistantStatePaths
  sessionId: string
}): Promise<void> {
  const archivePath = await allocateTranscriptArchivePath({
    extension: '.jsonl',
    paths: input.paths,
    prefix: 'seg',
    sessionId: input.sessionId,
  })
  await writeTextFileAtomic(archivePath, serializeAssistantTranscriptEntries(input.entries))
}

async function allocateTranscriptArchivePath(input: {
  extension: '.jsonl'
  paths: AssistantStatePaths
  prefix: 'repair' | 'seg'
  sessionId: string
}): Promise<string> {
  const archiveDirectory = resolveAssistantTranscriptArchiveDirectory(
    input.paths,
    input.sessionId,
  )
  await mkdir(archiveDirectory, {
    recursive: true,
  })

  const nextSequence = await determineNextArchiveSequence({
    archiveDirectory,
    extension: input.extension,
    prefix: input.prefix,
  })
  return path.join(
    archiveDirectory,
    `${input.prefix}_${String(nextSequence).padStart(6, '0')}${input.extension}`,
  )
}

async function determineNextArchiveSequence(input: {
  archiveDirectory: string
  extension: '.jsonl'
  prefix: 'repair' | 'seg'
}): Promise<number> {
  const entries = await readdir(input.archiveDirectory, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  })
  let maxSequence = 0

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    const match = new RegExp(
      `^${input.prefix}_(\\d+)\\${input.extension}$`,
      'u',
    ).exec(entry.name)
    if (!match) {
      continue
    }

    const sequence = Number.parseInt(match[1] ?? '', 10)
    if (Number.isInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence
    }
  }

  return maxSequence + 1
}

async function readArchivedTranscriptSegments(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<{
  entries: AssistantTranscriptEntry[]
  segmentCount: number
}> {
  const archiveDirectory = resolveAssistantTranscriptArchiveDirectory(
    input.paths,
    input.sessionId,
  )
  const directoryEntries = await readdir(archiveDirectory, {
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  })
  const segmentFileNames = directoryEntries
    .filter((entry) => entry.isFile() && /^seg_\d+\.jsonl$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
  const entries: AssistantTranscriptEntry[] = []

  for (const fileName of segmentFileNames) {
    const raw = await readFile(path.join(archiveDirectory, fileName), 'utf8')
    const scan = scanAssistantTranscriptText(raw)
    entries.push(...scan.entries.map((entry) => entry.entry))
  }

  return {
    entries,
    segmentCount: segmentFileNames.length,
  }
}

async function synchronizeTranscriptContinuation(input: {
  archivedEntries: readonly AssistantTranscriptEntry[]
  input: {
    paths: AssistantStatePaths
    sessionId: string
  }
  now: string
  previous: AssistantTranscriptContinuation | null
}): Promise<AssistantTranscriptContinuation | null> {
  const continuationPath = resolveAssistantTranscriptContinuationPath(
    input.input.paths,
    input.input.sessionId,
  )
  const nextBase = buildAssistantTranscriptContinuation({
    archivedEntries: input.archivedEntries,
    sessionId: input.input.sessionId,
    updatedAt: input.previous?.updatedAt ?? input.now,
  })

  if (!nextBase) {
    if (input.previous) {
      await rm(continuationPath, {
        force: true,
      }).catch((error: unknown) => {
        if (!isMissingFileError(error)) {
          throw error
        }
      })
    }
    return null
  }

  if (input.previous && isSameContinuation(input.previous, nextBase)) {
    return input.previous
  }

  const next = buildAssistantTranscriptContinuation({
    archivedEntries: input.archivedEntries,
    sessionId: input.input.sessionId,
    updatedAt: input.now,
  })
  if (!next) {
    return null
  }

  await writeJsonFileAtomic(continuationPath, next)
  return next
}

function shouldCompactTranscript(
  entries: readonly ScannedAssistantTranscriptEntry[],
  hotText: string,
): boolean {
  return (
    entries.length > ASSISTANT_TRANSCRIPT_HOT_ENTRY_LIMIT ||
    Buffer.byteLength(hotText, 'utf8') > ASSISTANT_TRANSCRIPT_HOT_BYTE_LIMIT
  )
}

function resolveCompactionHotStartIndex(
  entries: readonly ScannedAssistantTranscriptEntry[],
): number {
  let hotStartIndex = Math.max(
    0,
    entries.length - ASSISTANT_TRANSCRIPT_MIN_HOT_ENTRIES,
  )
  let userTurnsSeen = 0
  let turnStartIndex: number | null = null

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.entry.kind !== 'user') {
      continue
    }

    userTurnsSeen += 1
    turnStartIndex = index
    if (userTurnsSeen >= ASSISTANT_TRANSCRIPT_MIN_HOT_TURNS) {
      hotStartIndex = Math.min(hotStartIndex, turnStartIndex)
      break
    }
  }

  return hotStartIndex
}

function resolveMaintenanceUpdatedAt(input: {
  compacted: boolean
  hotByteLength: number
  hotEntryCount: number
  nextArchiveSegmentCount: number
  nextArchivedEntryCount: number
  now: string
  previous: AssistantTranscriptMaintenance | null
  repaired: boolean
}): string {
  if (!input.previous) {
    return input.now
  }

  if (
    input.repaired ||
    input.compacted ||
    input.previous.hotEntryCount !== input.hotEntryCount ||
    input.previous.hotByteLength !== input.hotByteLength ||
    input.previous.archivedEntryCount !== input.nextArchivedEntryCount ||
    input.previous.archiveSegmentCount !== input.nextArchiveSegmentCount
  ) {
    return input.now
  }

  return input.previous.updatedAt
}

function isSameMaintenance(
  left: AssistantTranscriptMaintenance | null,
  right: AssistantTranscriptMaintenance,
): boolean {
  if (!left) {
    return false
  }

  return (
    left.sessionId === right.sessionId &&
    left.hotEntryCount === right.hotEntryCount &&
    left.hotByteLength === right.hotByteLength &&
    left.archivedEntryCount === right.archivedEntryCount &&
    left.archiveSegmentCount === right.archiveSegmentCount &&
    left.lastCompactedAt === right.lastCompactedAt &&
    left.lastRepairedAt === right.lastRepairedAt &&
    left.repairCount === right.repairCount
  )
}

function isSameContinuation(
  left: AssistantTranscriptContinuation | null,
  right: AssistantTranscriptContinuation,
): boolean {
  if (!left) {
    return false
  }

  return (
    left.sessionId === right.sessionId &&
    left.sourceEntryCount === right.sourceEntryCount &&
    left.sourceStartAt === right.sourceStartAt &&
    left.sourceEndAt === right.sourceEndAt &&
    left.notice === right.notice &&
    JSON.stringify(left.summaryBullets) === JSON.stringify(right.summaryBullets) &&
    JSON.stringify(left.openLoops) === JSON.stringify(right.openLoops) &&
    JSON.stringify(left.representativeExcerpts) ===
      JSON.stringify(right.representativeExcerpts)
  )
}

function resolveAssistantTranscriptPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(paths.transcriptsDirectory, `${sessionId}.jsonl`)
}
