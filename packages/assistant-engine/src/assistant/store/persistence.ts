import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  open,
  readdir,
  readFile,
  rename,
  rm,
  type FileHandle,
} from 'node:fs/promises'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import {
  assistantAliasStoreSchema,
  assistantAutomationStateSchema,
  assistantPersistedSessionSchema,
  assistantSessionIdSchema,
  assistantTranscriptEntrySchema,
  type AssistantAliasStore,
  type AssistantAutomationState,
  type AssistantSession,
  type AssistantTranscriptEntry,
  parseAssistantSessionRecord,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  adoptAssistantStateFile,
  openSqliteRuntimeDatabase,
  readSqliteRuntimeUserVersion,
  withImmediateTransaction,
  writeSqliteRuntimeUserVersion,
} from '@murphai/runtime-state/node'
import {
  assistantWithinConversationDriftFields,
  getAssistantBindingIsolationConflicts,
  mergeAssistantBinding,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  createAssistantBoundedRuntimeCache,
  ASSISTANT_AUTOMATION_STATE_CACHE,
} from '../runtime-budget-policy.js'
import {
  appendTextFile,
  compareAssistantTimestampsAscending,
  ensureAssistantStateDirectory,
  normalizeNullableString,
  parseAssistantJsonLinesWithTailSalvage,
  writeTextFileAtomic,
  writeJsonFileAtomic,
} from '../shared.js'
import { serializeAssistantProviderSessionOptions } from '@murphai/operator-config/assistant/provider-config'
import {
  serializeAssistantConversationForPersistence,
} from '../conversation-persistence.js'
import {
  extractAssistantSessionSecretsForPersistence,
  mergeAssistantSessionSecrets,
  readAssistantSessionSecrets,
  resolveAssistantSessionSecretsPath,
  stageAssistantSessionSecretsForPersistence,
} from '../state-secrets.js'
import { quarantineAssistantStateFile } from '../quarantine.js'
import { appendAssistantRuntimeEventAtPaths } from '../runtime-events.js'
import { resolveAssistantOpaqueStateFilePath } from '../state-ids.js'
import type { AssistantStatePaths } from './paths.js'
import type { ResolvedAssistantSession } from './types.js'

export const ASSISTANT_AUTOMATION_STATE_VERSION = 1
export const ASSISTANT_TRANSCRIPT_AUDIT_RETENTION_LIMIT = 100
/**
 * How long an inbound message's verbatim text may survive in a transcript.
 *
 * The audit limit above is a count, not a clock: a low-volume thread keeps its
 * hundred most recent entries forever. Ordinary attachment-free messages never
 * produce an inbox capture, so for those the transcript is the only durable
 * copy of what the member wrote and a count cap alone leaves it indefinitely.
 * This matches the capture-ledger window so one deadline covers both paths.
 */
export const ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const ASSISTANT_RECENT_SESSIONS_INDEX_LIMIT = 50
const ASSISTANT_SESSION_ROUTING_DATABASE_VERSION = 1
const ASSISTANT_SESSION_ROUTING_DATABASE_NAME = 'session-routing.sqlite'
type AssistantSessionRoutingKind = 'alias' | 'conversation-key'
type AssistantSessionRoutingDatabase = import('node:sqlite').DatabaseSync

class AssistantSessionRoutingDatabaseValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AssistantSessionRoutingDatabaseValidationError'
  }
}

const assistantRecentSessionRowSchema = z
  .object({
    sessionId: assistantSessionIdSchema,
  })
  .strict()

const assistantAutomationStateCache = createAssistantBoundedRuntimeCache<string, AssistantAutomationState>({
  name: 'assistant.automation-state',
  ...ASSISTANT_AUTOMATION_STATE_CACHE,
})

export async function ensureAssistantState(
  paths: AssistantStatePaths,
): Promise<void> {
  await Promise.all([
    ensureAssistantStateDirectory(paths.assistantStateRoot),
    ensureAssistantStateDirectory(paths.sessionsDirectory),
    ensureAssistantStateDirectory(paths.transcriptsDirectory),
    ensureAssistantStateDirectory(paths.outboxDirectory),
    ensureAssistantStateDirectory(paths.outboxQuarantineDirectory),
    ensureAssistantStateDirectory(paths.turnsDirectory),
    ensureAssistantStateDirectory(paths.diagnosticsDirectory),
    ensureAssistantStateDirectory(paths.journalsDirectory),
    ensureAssistantStateDirectory(paths.issuesDirectory),
    ensureAssistantStateDirectory(paths.issuesPendingDirectory),
    ensureAssistantStateDirectory(paths.quarantineDirectory),
    ensureAssistantStateDirectory(paths.stateDirectory),
    ensureAssistantStateDirectory(paths.secretsDirectory),
    ensureAssistantStateDirectory(paths.sessionSecretsDirectory),
  ])
}

export async function readAssistantSession(input: {
  paths: AssistantStatePaths
  sessionId: string
  treatCorruptedAsMissing?: boolean
}): Promise<AssistantSession | null> {
  const sessionPath = resolveAssistantSessionPath(input.paths, input.sessionId)
  let raw: string
  try {
    raw = await readFile(sessionPath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }

  let persistedSession: AssistantSession
  try {
    persistedSession = normalizeAssistantConversationSnapshot(
      parseAssistantSessionRecord(JSON.parse(raw)),
    )
  } catch (error) {
    await quarantineAssistantStateFile({
      artifactKind: 'session',
      error,
      expectedContent: raw,
      filePath: sessionPath,
      paths: input.paths,
    })
    if (input.treatCorruptedAsMissing) {
      return null
    }
    throw createAssistantSessionCorruptedError({
      error,
      sessionId: input.sessionId,
      sessionPath,
    })
  }

  return mergeAssistantSessionSecrets(persistedSession, null)
}

export async function writeAssistantSession(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<void> {
  const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
  const normalized = normalizeAssistantConversationSnapshot(session)
  const {
    persisted: redactedSession,
    secrets,
  } = extractAssistantSessionSecretsForPersistence(normalized)
  const persisted = assistantPersistedSessionSchema.parse(
    normalizeAssistantSessionForWrite(redactedSession),
  )
  const stagedSecrets = await stageAssistantSessionSecretsForPersistence({
    paths,
    secrets,
    sessionId: normalized.sessionId,
  })
  try {
    await writeJsonFileAtomic(sessionPath, persisted)
    await stagedSecrets.commit()
  } catch (error) {
    await stagedSecrets.abort().catch(() => undefined)
    throw error
  }
  await appendAssistantRuntimeEventAtPaths(paths, {
    at: normalized.updatedAt,
    component: 'state',
    entityId: normalized.sessionId,
    entityType: 'session',
    kind: 'session.upserted',
    level: 'info',
    message: `Assistant session ${normalized.sessionId} was persisted.`,
  }).catch(() => undefined)
}

export async function readAssistantTranscriptEntries(
  paths: AssistantStatePaths,
  sessionId: string,
): Promise<AssistantTranscriptEntry[]> {
  const transcriptPath = resolveAssistantTranscriptPath(paths, sessionId)

  try {
    return parseAssistantTranscriptRaw(await readFile(transcriptPath, 'utf8'))
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
  }
}

function parseAssistantTranscriptRaw(raw: string): AssistantTranscriptEntry[] {
  const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
    assistantTranscriptEntrySchema.parse(value),
  )
  if (parsed.malformedLineCount > 0) {
    throw new VaultCliError(
      'ASSISTANT_TRANSCRIPT_CORRUPTED',
      'Assistant transcript contains malformed committed entries.',
    )
  }
  return parsed.values
}

// Bounded tail read for recurring maintenance work: reads at most maxBytes
// from the end of the committed transcript JSONL instead of parsing the whole
// file. A partial first line from the byte cut is dropped before parsing.
export async function readAssistantTranscriptTailEntries(
  paths: AssistantStatePaths,
  sessionId: string,
  maxBytes: number,
): Promise<AssistantTranscriptEntry[]> {
  const transcriptPath = resolveAssistantTranscriptPath(paths, sessionId)

  let handle: FileHandle
  try {
    handle = await open(transcriptPath, 'r')
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }
    throw error
  }

  try {
    const size = (await handle.stat()).size
    const readBytes = Math.min(size, Math.max(0, maxBytes))
    if (readBytes === 0) {
      return []
    }
    const buffer = Buffer.alloc(readBytes)
    await handle.read(buffer, 0, readBytes, size - readBytes)
    let raw = buffer.toString('utf8')
    if (readBytes < size) {
      const firstNewlineIndex = raw.indexOf('\n')
      raw = firstNewlineIndex === -1 ? '' : raw.slice(firstNewlineIndex + 1)
    }
    return parseAssistantTranscriptRaw(raw)
  } finally {
    await handle.close()
  }
}

export function resolveAssistantTranscriptPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: paths.transcriptsDirectory,
    extension: '.jsonl',
    kind: 'session',
    value: sessionId,
  })
}

export function resolveAssistantSessionPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return resolveAssistantOpaqueStateFilePath({
    directory: paths.sessionsDirectory,
    extension: '.json',
    kind: 'session',
    value: sessionId,
  })
}

export function resolveAssistantSessionRoutingDatabasePath(
  paths: AssistantStatePaths,
): string {
  return path.join(
    paths.stateDirectory,
    ASSISTANT_SESSION_ROUTING_DATABASE_NAME,
  )
}

function resolveAssistantSessionRoutingKeyDigest(
  kind: AssistantSessionRoutingKind,
  key: string,
): string {
  return createHash('sha256')
    .update(kind)
    .update('\0')
    .update(key)
    .digest('hex')
}

export async function inspectAssistantSessionStorage(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<{
  sessionExists: boolean
  sessionPath: string
  transcriptExists: boolean
  transcriptPath: string
}> {
  const sessionPath = resolveAssistantSessionPath(input.paths, input.sessionId)
  const transcriptPath = resolveAssistantTranscriptPath(input.paths, input.sessionId)
  const [sessionExists, transcriptExists] = await Promise.all([
    pathExists(sessionPath),
    pathExists(transcriptPath),
  ])

  return {
    sessionExists,
    sessionPath,
    transcriptExists,
    transcriptPath,
  }
}

export async function appendTranscriptEntries(
  paths: AssistantStatePaths,
  sessionId: string,
  entries: readonly AssistantTranscriptEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return
  }

  const transcriptPath = resolveAssistantTranscriptPath(paths, sessionId)
  const serialized = `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`

  await appendTextFile(transcriptPath, serialized)
}

export async function replaceTranscriptEntries(
  paths: AssistantStatePaths,
  sessionId: string,
  entries: readonly AssistantTranscriptEntry[],
): Promise<void> {
  const transcriptPath = resolveAssistantTranscriptPath(paths, sessionId)
  const serialized =
    entries.length > 0
      ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
      : ''

  await writeTextFileAtomic(transcriptPath, serialized)
}

export async function pruneAssistantTranscriptRetention(
  paths: AssistantStatePaths,
  options: { now?: Date; signal?: AbortSignal | null } = {},
): Promise<{
  entriesRedacted: number
  entriesTrimmed: number
  nextEligibleAt: string | null
  transcriptsTrimmed: number
}> {
  options.signal?.throwIfAborted()
  const now = options.now ?? new Date()
  await ensureAssistantStateDirectory(paths.transcriptsDirectory)
  options.signal?.throwIfAborted()
  const entries = await readdir(paths.transcriptsDirectory, {
    withFileTypes: true,
  })
  options.signal?.throwIfAborted()
  let entriesRedacted = 0
  let entriesTrimmed = 0
  let nextEligibleAt: string | null = null
  let transcriptsTrimmed = 0

  for (const entry of entries) {
    options.signal?.throwIfAborted()
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      continue
    }

    const transcriptPath = path.join(paths.transcriptsDirectory, entry.name)
    let raw: string
    try {
      raw = await readFile(transcriptPath, 'utf8')
      options.signal?.throwIfAborted()
    } catch (error) {
      options.signal?.throwIfAborted()
      if (isMissingFileError(error)) {
        continue
      }
      throw error
    }

    const parsed = parseAssistantJsonLinesWithTailSalvage(raw, (value) =>
      assistantTranscriptEntrySchema.parse(value),
    )
    if (parsed.malformedLineCount > 0) {
      continue
    }

    const retained = trimAssistantTranscriptEntriesForAudit(parsed.values)
    const redaction = redactExpiredAssistantTranscriptEntries(retained, now)
    nextEligibleAt = selectEarlierAssistantRetentionWake(
      nextEligibleAt,
      redaction.nextEligibleAt,
    )
    const trimmedCount = parsed.values.length - retained.length
    if (
      trimmedCount === 0
      && redaction.redactedCount === 0
    ) {
      continue
    }

    options.signal?.throwIfAborted()
    await writeTextFileAtomic(
      transcriptPath,
      redaction.entries.length > 0
        ? `${redaction.entries.map((retainedEntry) => JSON.stringify(retainedEntry)).join('\n')}\n`
        : '',
    )
    options.signal?.throwIfAborted()
    entriesRedacted += redaction.redactedCount
    entriesTrimmed += trimmedCount
    transcriptsTrimmed += 1
  }

  return {
    entriesRedacted,
    entriesTrimmed,
    nextEligibleAt,
    transcriptsTrimmed,
  }
}

/**
 * Clear the text of inbound entries past the content-retention window.
 *
 * Only `user` entries are redacted: they are the member's own words, which is
 * what the retention policy covers. The entry itself stays so the transcript
 * still shows a message occurred at that point in the conversation, and
 * `textRetiredAt` records that the text expired rather than was empty.
 */
export function redactExpiredAssistantTranscriptEntries(
  entries: readonly AssistantTranscriptEntry[],
  now: Date,
): {
  entries: AssistantTranscriptEntry[]
  nextEligibleAt: string | null
  redactedCount: number
} {
  const cutoffMs = now.getTime() - ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS
  let redactedCount = 0
  let nextEligibleAt: string | null = null

  const next = entries.map((entry) => {
    if (entry.kind !== 'user' || entry.textRetiredAt !== undefined) {
      return entry
    }
    if (entry.text.length === 0) {
      return entry
    }
    // Phase one cannot safely infer a receipt for legacy entries after normal
    // accepted-turn residue pruning has discarded the input-to-transcript
    // journal. Preserve those entries until the separately deployed phase-two
    // cutover, after one full retention interval of stamped writes.
    if (entry.contentReceivedAt === undefined) {
      return entry
    }
    const contentReceivedAtMs = Date.parse(entry.contentReceivedAt)
    if (!Number.isFinite(contentReceivedAtMs)) {
      return entry
    }
    if (contentReceivedAtMs > cutoffMs) {
      nextEligibleAt = selectEarlierAssistantRetentionWake(
        nextEligibleAt,
        new Date(
          contentReceivedAtMs + ASSISTANT_TRANSCRIPT_CONTENT_RETENTION_MS,
        ).toISOString(),
      )
      return entry
    }

    redactedCount += 1
    return {
      ...entry,
      text: '',
      textRetiredAt: now.toISOString(),
    }
  })

  return { entries: next, nextEligibleAt, redactedCount }
}

function selectEarlierAssistantRetentionWake(
  current: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) {
    return current
  }
  if (current === null) {
    return candidate
  }
  return Date.parse(candidate) < Date.parse(current) ? candidate : current
}

export function trimAssistantTranscriptEntriesForAudit(
  entries: readonly AssistantTranscriptEntry[],
): AssistantTranscriptEntry[] {
  let conversationEntrySeen = 0
  let startIndex = entries.length

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }
    if (entry.kind === 'assistant' || entry.kind === 'user') {
      conversationEntrySeen += 1
    }
    if (conversationEntrySeen === ASSISTANT_TRANSCRIPT_AUDIT_RETENTION_LIMIT) {
      startIndex = index
      break
    }
  }

  if (startIndex < entries.length) {
    return entries.slice(startIndex)
  }

  if (entries.length <= ASSISTANT_TRANSCRIPT_AUDIT_RETENTION_LIMIT) {
    return [...entries]
  }

  return entries.slice(-ASSISTANT_TRANSCRIPT_AUDIT_RETENTION_LIMIT)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (isMissingFileError(error)) {
      return false
    }

    throw error
  }
}

function normalizeAssistantSessionForWrite(
  session: AssistantSession | z.infer<typeof assistantPersistedSessionSchema>,
) {
  const normalized = normalizeAssistantConversationSnapshot(
    'provider' in session
      ? {
          ...session,
          providerOptions: serializeAssistantProviderSessionOptions(
            session.providerOptions,
          ),
        }
      : parseAssistantSessionRecord(session),
  )
  return serializeAssistantConversationForPersistence(normalized)
}

export async function persistResolvedSession(
  paths: AssistantStatePaths,
  session: AssistantSession,
  input: {
    allowBindingRebind?: boolean
    alias: string | null
    bindingPatch: AssistantBindingPatch
    lookupSource: 'alias' | 'conversation-key' | 'session-id'
  },
): Promise<AssistantSession> {
  const routingConflicts = getAssistantBindingIsolationConflicts(
    session.binding,
    input.bindingPatch,
  )
  // A conversation-key match is located BY the routing boundary itself: channel,
  // identity, audience, and the thread-or-actor scope are all encoded in the
  // lookup key, so a match already proves those are equal. Only a group's active
  // speaker may drift within one key. That drift must update the binding, never
  // fail the reply: rejecting it strands the inbound message as unhandled and
  // wedges the whole conversation. We enforce the drift boundary locally (not
  // just trust the key derivation) so a conflict on any wider field still fails
  // closed. Explicit session-id resumes stay opt-in via
  // allowBindingRebind because the caller supplies the identifier and could be
  // retargeting the session at a genuinely different audience; alias resumes
  // never rebind for the same reason.
  const conversationKeyRebindAllowed =
    input.lookupSource === 'conversation-key' &&
    routingConflicts.every((conflict) =>
      assistantWithinConversationDriftFields.has(conflict.field),
    )
  const bindingRebindAllowed =
    conversationKeyRebindAllowed ||
    (input.allowBindingRebind === true && input.lookupSource === 'session-id')
  if (routingConflicts.length > 0 && !bindingRebindAllowed) {
    throw createAssistantSessionRoutingConflictError({
      conflicts: routingConflicts,
      lookupSource: input.lookupSource,
      session,
    })
  }

  const audienceBoundaryChangedWithoutDirectness =
    !('threadIsDirect' in input.bindingPatch) &&
    (
      ('channel' in input.bindingPatch &&
        normalizeNullableString(input.bindingPatch.channel) !==
          session.binding.channel) ||
      ('identityId' in input.bindingPatch &&
        normalizeNullableString(input.bindingPatch.identityId) !==
          session.binding.identityId) ||
      ('threadId' in input.bindingPatch &&
        normalizeNullableString(input.bindingPatch.threadId) !==
          session.binding.threadId) ||
      ('actorId' in input.bindingPatch &&
        normalizeNullableString(input.bindingPatch.actorId) !==
          session.binding.actorId &&
        session.binding.threadId === null &&
        normalizeNullableString(input.bindingPatch.threadId) === null)
    )
  const bindingPatch = audienceBoundaryChangedWithoutDirectness
    ? {
        ...input.bindingPatch,
        threadIsDirect: null,
      }
    : input.bindingPatch
  const nextBinding = mergeAssistantBinding(session.binding, bindingPatch)
  const aliasChanged = input.alias !== null && input.alias !== session.alias
  const bindingChanged = !areAssistantBindingsEqual(nextBinding, session.binding)

  if (!aliasChanged && !bindingChanged) {
    return session
  }

  const updated = normalizeAssistantConversationSnapshot(
    parseAssistantSessionRecord(
      normalizeAssistantSessionForWrite({
        ...session,
        alias: input.alias ?? session.alias,
        binding: nextBinding,
        updatedAt: new Date().toISOString(),
      }),
    ),
  )
  await writeAssistantSession(paths, updated)
  await synchronizeAssistantIndexes(paths, updated, session)
  return updated
}

function normalizeAssistantConversationSnapshot(
  session: AssistantSession,
): AssistantSession {
  return parseAssistantSessionRecord(
    serializeAssistantConversationForPersistence(session),
  )
}

export async function loadAndPersistResolvedSession(input: {
  paths: AssistantStatePaths
  sessionId: string
  persistenceInput: {
    allowBindingRebind?: boolean
    alias: string | null
    bindingPatch: AssistantBindingPatch
    lookupSource: 'alias' | 'conversation-key' | 'session-id'
  }
  expectedAlias?: string
  expectedContinuityFingerprint?: string | null
  expectedConversationKey?: string
  skipIfExpired?: boolean
  maxSessionAgeMs?: number | null
  now?: Date
}): Promise<ResolvedAssistantSession | null> {
  const existing = await readAssistantSession({
    paths: input.paths,
    sessionId: input.sessionId,
  })
  if (!existing) {
    return null
  }
  if (
    (input.expectedAlias !== undefined &&
      existing.alias !== input.expectedAlias) ||
    (input.expectedConversationKey !== undefined &&
      existing.binding.conversationKey !== input.expectedConversationKey)
  ) {
    return null
  }
  if (
    input.skipIfExpired &&
    isAssistantSessionExpired(existing, input.maxSessionAgeMs, input.now)
  ) {
    return null
  }
  if (
    input.expectedContinuityFingerprint &&
    existing.providerOptions.continuityFingerprint !==
      input.expectedContinuityFingerprint
  ) {
    return null
  }

  const updated = await persistResolvedSession(
    input.paths,
    existing,
    input.persistenceInput,
  )
  return {
    created: false,
    paths: input.paths,
    session: updated,
  }
}

export async function retireLegacyAssistantConversationKey(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<AssistantSession> {
  if (session.binding.conversationKey === null) {
    return session
  }

  const retired = normalizeAssistantConversationSnapshot({
    ...session,
    binding: {
      ...session.binding,
      conversationKey: null,
    },
  })
  await writeAssistantSession(paths, retired)
  await synchronizeAssistantIndexes(paths, retired, session)
  return retired
}

export function isAssistantSessionExpired(
  session: AssistantSession,
  maxSessionAgeMs: number | null | undefined,
  now?: Date,
): boolean {
  if (!Number.isFinite(maxSessionAgeMs) || typeof maxSessionAgeMs !== 'number') {
    return false
  }

  const normalizedMaxAgeMs = Math.max(Math.trunc(maxSessionAgeMs), 0)
  if (normalizedMaxAgeMs === 0) {
    return false
  }

  const referenceTimestamp =
    normalizeNullableString(session.lastTurnAt) ??
    normalizeNullableString(session.updatedAt) ??
    normalizeNullableString(session.createdAt)
  if (!referenceTimestamp) {
    return false
  }

  const referenceTime = Date.parse(referenceTimestamp)
  const nowTime = (now ?? new Date()).getTime()
  if (!Number.isFinite(referenceTime) || !Number.isFinite(nowTime)) {
    return false
  }

  return nowTime - referenceTime >= normalizedMaxAgeMs
}

export async function readAssistantSessionRouting(
  paths: AssistantStatePaths,
  input: {
    alias: string | null
    conversationKeys: readonly string[]
  },
): Promise<{
  aliasSessionId: string | null
  conversationKeySessionIds: ReadonlyMap<string, string>
}> {
  return await withAssistantSessionRoutingDatabase(paths, (database) => {
    const readRoute = database.prepare(`
      SELECT session_id AS sessionId
      FROM assistant_session_routes
      WHERE kind = ? AND key_digest = ?
    `)
    const readSessionId = (
      kind: AssistantSessionRoutingKind,
      key: string,
    ): string | null => {
      const row = readRoute.get(
        kind,
        resolveAssistantSessionRoutingKeyDigest(kind, key),
      ) as { sessionId?: unknown } | undefined
      if (!row) {
        return null
      }
      return assistantSessionIdSchema.parse(row.sessionId)
    }

    const aliasSessionId = input.alias
      ? readSessionId('alias', input.alias)
      : null
    const conversationKeySessionIds = new Map<string, string>()
    for (const conversationKey of new Set(input.conversationKeys)) {
      const sessionId = readSessionId('conversation-key', conversationKey)
      if (sessionId) {
        conversationKeySessionIds.set(conversationKey, sessionId)
      }
    }

    return {
      aliasSessionId,
      conversationKeySessionIds,
    }
  })
}

export async function synchronizeAssistantIndexes(
  paths: AssistantStatePaths,
  session: AssistantSession,
  previous: AssistantSession | null,
): Promise<void> {
  await withAssistantSessionRoutingDatabase(paths, (database) => {
    synchronizeAssistantSessionRoutingDatabase(
      database,
      session,
      previous,
    )
  })
}

export async function readAssistantRecentSessionIds(
  paths: AssistantStatePaths,
  options: {
    limit: number
  },
): Promise<string[]> {
  const limit = Math.max(0, Math.trunc(options.limit))
  if (limit === 0) {
    return []
  }

  return await withAssistantSessionRoutingDatabase(paths, (database) => {
    const rows = database.prepare(`
      SELECT
        session_id AS sessionId
      FROM assistant_recent_sessions
      ORDER BY last_active_at_ms DESC, session_id ASC
      LIMIT ?
    `).all(limit)
    return rows.map((row) =>
      assistantRecentSessionRowSchema.parse(row).sessionId,
    )
  })
}

async function collectAssistantSessionsForRoutingRebuild(
  paths: AssistantStatePaths,
): Promise<AssistantSession[]> {
  const entries = await readdir(paths.sessionsDirectory, {
    withFileTypes: true,
  })
  const sessions: AssistantSession[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    try {
      const session = await readAssistantSession({
        paths,
        sessionId: entry.name.replace(/\.json$/u, ''),
        treatCorruptedAsMissing: true,
      })
      if (!session) {
        continue
      }
      sessions.push(session)
    } catch {
      // Quarantine already happened in readAssistantSession; keep rebuild best-effort.
    }
  }
  return sessions
}

function buildAssistantSessionRoutingProjection(
  sessions: readonly AssistantSession[],
): AssistantAliasStore {
  const aliases: Record<string, string> = {}
  const conversationKeys: Record<string, string> = {}
  const recentSessions: Record<string, string> = {}
  for (const session of sortSessionsForIndexRebuild(sessions)) {
    if (session.alias) {
      aliases[session.alias] = session.sessionId
    }
    if (session.binding.conversationKey) {
      conversationKeys[session.binding.conversationKey] = session.sessionId
    }
    recentSessions[session.sessionId] =
      resolveAssistantIndexRebuildTimestamp(session)
  }
  return assistantAliasStoreSchema.parse({
    version: 1,
    aliases,
    conversationKeys,
    recentSessions: pruneAssistantRecentSessions(recentSessions),
  })
}

async function withAssistantSessionRoutingDatabase<T>(
  paths: AssistantStatePaths,
  operation: (database: AssistantSessionRoutingDatabase) => T,
): Promise<T> {
  const database = await openOrRebuildAssistantSessionRoutingDatabase(paths)
  try {
    const result = operation(database)
    database.close()
    return result
  } catch (error) {
    try {
      database.close()
    } catch {
      // Preserve the operation or close error without invoking recovery.
    }
    throw error
  }
}

async function openOrRebuildAssistantSessionRoutingDatabase(
  paths: AssistantStatePaths,
): Promise<AssistantSessionRoutingDatabase> {
  if (await pathExists(paths.indexesPath)) {
    return await rebuildAssistantSessionRoutingDatabase(
      paths,
      await readAssistantLegacyIndex(paths),
    )
  }

  const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
  if (!await pathExists(databasePath)) {
    return await rebuildAssistantSessionRoutingDatabase(paths)
  }
  try {
    return openAssistantSessionRoutingDatabase(paths)
  } catch (error) {
    if (!isAssistantSessionRoutingDatabaseCorruptionError(error)) {
      throw error
    }
    await quarantineAssistantSessionRoutingDatabase(paths, error)
    return await rebuildAssistantSessionRoutingDatabase(paths)
  }
}

async function readAssistantLegacyIndex(
  paths: AssistantStatePaths,
): Promise<AssistantAliasStore | null> {
  let raw: string
  try {
    raw = await readFile(paths.indexesPath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
  try {
    return assistantAliasStoreSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}

function openAssistantSessionRoutingDatabase(
  paths: AssistantStatePaths,
): AssistantSessionRoutingDatabase {
  const database = openSqliteRuntimeDatabase(
    resolveAssistantSessionRoutingDatabasePath(paths),
    {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    },
  )
  try {
    const version = readSqliteRuntimeUserVersion(database)
    if (version !== ASSISTANT_SESSION_ROUTING_DATABASE_VERSION) {
      throw new AssistantSessionRoutingDatabaseValidationError(
        `Unsupported assistant session routing database version: ${version}.`,
      )
    }
    assertAssistantSessionRoutingDatabaseShape(database)
    return database
  } catch (error) {
    try {
      database.close()
    } catch {
      // Preserve the validation or SQLite error for the recovery boundary.
    }
    throw error
  }
}

function assertAssistantSessionRoutingDatabaseShape(
  database: AssistantSessionRoutingDatabase,
): void {
  try {
    database.prepare(`
      SELECT kind, key_digest, session_id
      FROM assistant_session_routes
      LIMIT 0
    `).all()
    database.prepare(`
      SELECT session_id, last_active_at_ms
      FROM assistant_recent_sessions
      LIMIT 0
    `).all()
  } catch (error) {
    if (!isAssistantSessionRoutingDatabaseShapeError(error)) {
      throw error
    }
    throw new AssistantSessionRoutingDatabaseValidationError(
      'Assistant session routing database has an invalid schema.',
      { cause: error },
    )
  }
}

function isAssistantSessionRoutingDatabaseShapeError(
  error: unknown,
): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as {
    code?: unknown
    errcode?: unknown
    message?: unknown
  }
  return (
    candidate.code === 'ERR_SQLITE_ERROR' &&
    candidate.errcode === 1 &&
    typeof candidate.message === 'string' &&
    /^(?:no such (?:column|table)|table .* has no column named)/u.test(
      candidate.message,
    )
  )
}

function isAssistantSessionRoutingDatabaseCorruptionError(
  error: unknown,
): boolean {
  if (error instanceof AssistantSessionRoutingDatabaseValidationError) {
    return true
  }
  if (!error || typeof error !== 'object') {
    return false
  }
  const candidate = error as {
    code?: unknown
    errcode?: unknown
  }
  if (
    candidate.code !== 'ERR_SQLITE_ERROR' ||
    typeof candidate.errcode !== 'number'
  ) {
    return false
  }
  const primaryCode = candidate.errcode & 0xff
  return primaryCode === 11 || primaryCode === 26
}

function initializeAssistantSessionRoutingDatabase(
  database: AssistantSessionRoutingDatabase,
  projection: AssistantAliasStore,
): void {
  withImmediateTransaction(database, () => {
    database.exec(`
      CREATE TABLE assistant_session_routes (
        kind TEXT NOT NULL CHECK (kind IN ('alias', 'conversation-key')),
        key_digest TEXT NOT NULL CHECK (length(key_digest) = 64),
        session_id TEXT NOT NULL,
        PRIMARY KEY (kind, key_digest)
      ) STRICT;
      CREATE TABLE assistant_recent_sessions (
        session_id TEXT PRIMARY KEY,
        last_active_at_ms INTEGER NOT NULL
      ) STRICT;
    `)

    const upsertRoute = database.prepare(`
      INSERT INTO assistant_session_routes (kind, key_digest, session_id)
      VALUES (?, ?, ?)
      ON CONFLICT (kind, key_digest) DO UPDATE SET session_id = excluded.session_id
    `)
    const upsertRecent = database.prepare(`
      INSERT INTO assistant_recent_sessions (session_id, last_active_at_ms)
      VALUES (?, ?)
    `)
    for (const [alias, sessionId] of Object.entries(projection.aliases)) {
      upsertRoute.run(
        'alias',
        resolveAssistantSessionRoutingKeyDigest('alias', alias),
        sessionId,
      )
    }
    for (const [conversationKey, sessionId] of Object.entries(
      projection.conversationKeys,
    )) {
      upsertRoute.run(
        'conversation-key',
        resolveAssistantSessionRoutingKeyDigest(
          'conversation-key',
          conversationKey,
        ),
        sessionId,
      )
    }
    for (const [sessionId, lastActiveAt] of Object.entries(
      pruneAssistantRecentSessions(projection.recentSessions ?? {}),
    )) {
      upsertRecent.run(sessionId, Date.parse(lastActiveAt))
    }
    writeSqliteRuntimeUserVersion(
      database,
      ASSISTANT_SESSION_ROUTING_DATABASE_VERSION,
    )
  })
}

async function rebuildAssistantSessionRoutingDatabase(
  paths: AssistantStatePaths,
  legacyIndex: AssistantAliasStore | null = null,
): Promise<AssistantSessionRoutingDatabase> {
  const projection = await resolveAssistantSessionRoutingProjection(
    paths,
    legacyIndex,
  )
  const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
  const rebuildPath = `${databasePath}.${randomUUID()}.rebuild`
  await removeAssistantSessionRoutingDatabaseSidecars(rebuildPath)
  await rm(rebuildPath, { force: true })

  let rebuilt: AssistantSessionRoutingDatabase | null = null
  try {
    rebuilt = openSqliteRuntimeDatabase(rebuildPath, {
      journalMode: 'DELETE',
      synchronous: 'FULL',
    })
    await adoptAssistantStateFile(rebuildPath)
    initializeAssistantSessionRoutingDatabase(rebuilt, projection)
    rebuilt.close()
    rebuilt = null

    await removeAssistantSessionRoutingDatabaseSidecars(databasePath)
    await rename(rebuildPath, databasePath)
    // A legacy aggregate is one-way migration input. Publishing this projection
    // establishes the runtime rollback floor before the aggregate is removed.
    await rm(paths.indexesPath, { force: true })
  } catch (error) {
    rebuilt?.close()
    await rm(rebuildPath, { force: true }).catch(() => undefined)
    await removeAssistantSessionRoutingDatabaseSidecars(rebuildPath)
    throw error
  }

  await appendAssistantRuntimeEventAtPaths(paths, {
    component: 'state',
    entityId: 'indexes',
    entityType: 'indexes',
    kind: 'indexes.rebuilt',
    level: 'warn',
    message: 'Assistant session indexes were rebuilt from available routing state.',
  }).catch(() => undefined)
  return openAssistantSessionRoutingDatabase(paths)
}

async function resolveAssistantSessionRoutingProjection(
  paths: AssistantStatePaths,
  legacyIndex: AssistantAliasStore | null,
): Promise<AssistantAliasStore> {
  if (legacyIndex?.recentSessions !== undefined) {
    return legacyIndex
  }
  const rebuilt = buildAssistantSessionRoutingProjection(
    await collectAssistantSessionsForRoutingRebuild(paths),
  )
  return legacyIndex
    ? assistantAliasStoreSchema.parse({
        ...rebuilt,
        aliases: legacyIndex.aliases,
        conversationKeys: legacyIndex.conversationKeys,
      })
    : rebuilt
}

function synchronizeAssistantSessionRoutingDatabase(
  database: AssistantSessionRoutingDatabase,
  session: AssistantSession,
  previous: AssistantSession | null,
): void {
  return withImmediateTransaction(database, () => {
    const upsertRoute = database.prepare(`
      INSERT INTO assistant_session_routes (kind, key_digest, session_id)
      VALUES (?, ?, ?)
      ON CONFLICT (kind, key_digest) DO UPDATE SET session_id = excluded.session_id
    `)
    const removeRouteIfOwned = database.prepare(`
      DELETE FROM assistant_session_routes
      WHERE kind = ? AND key_digest = ? AND session_id = ?
    `)

    if (session.alias) {
      upsertRoute.run(
        'alias',
        resolveAssistantSessionRoutingKeyDigest('alias', session.alias),
        session.sessionId,
      )
    }
    if (session.binding.conversationKey) {
      upsertRoute.run(
        'conversation-key',
        resolveAssistantSessionRoutingKeyDigest(
          'conversation-key',
          session.binding.conversationKey,
        ),
        session.sessionId,
      )
    }
    if (previous?.alias && previous.alias !== session.alias) {
      removeRouteIfOwned.run(
        'alias',
        resolveAssistantSessionRoutingKeyDigest('alias', previous.alias),
        session.sessionId,
      )
    }
    if (
      previous?.binding.conversationKey &&
      previous.binding.conversationKey !== session.binding.conversationKey
    ) {
      removeRouteIfOwned.run(
        'conversation-key',
        resolveAssistantSessionRoutingKeyDigest(
          'conversation-key',
          previous.binding.conversationKey,
        ),
        session.sessionId,
      )
    }

    database.prepare(`
      INSERT INTO assistant_recent_sessions (session_id, last_active_at_ms)
      VALUES (?, ?)
      ON CONFLICT (session_id) DO UPDATE SET last_active_at_ms = excluded.last_active_at_ms
    `).run(
      session.sessionId,
      Date.parse(session.lastTurnAt ?? session.updatedAt),
    )
    database.exec(`
      DELETE FROM assistant_recent_sessions
      WHERE session_id IN (
        SELECT session_id
        FROM assistant_recent_sessions
        ORDER BY last_active_at_ms DESC, session_id ASC
        LIMIT -1 OFFSET ${ASSISTANT_RECENT_SESSIONS_INDEX_LIMIT}
      )
    `)
  })
}

async function quarantineAssistantSessionRoutingDatabase(
  paths: AssistantStatePaths,
  error: unknown,
): Promise<void> {
  const databasePath = resolveAssistantSessionRoutingDatabasePath(paths)
  await quarantineAssistantStateFile({
    artifactKind: 'indexes',
    error,
    filePath: databasePath,
    paths,
  })
  await removeAssistantSessionRoutingDatabaseSidecars(databasePath)
}

async function removeAssistantSessionRoutingDatabaseSidecars(
  databasePath: string,
): Promise<void> {
  await Promise.all([
    rm(`${databasePath}-journal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
  ])
}

function pruneAssistantRecentSessions(
  recentSessions: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recentSessions)
      .sort(([, left], [, right]) =>
        compareAssistantTimestampsAscending(right, left),
      )
      .slice(0, ASSISTANT_RECENT_SESSIONS_INDEX_LIMIT),
  )
}

export async function writeAutomationState(
  paths: AssistantStatePaths,
  state: AssistantAutomationState,
): Promise<AssistantAutomationState> {
  const parsed = assistantAutomationStateSchema.parse(state)
  await writeJsonFileAtomic(paths.automationStatePath, parsed)
  assistantAutomationStateCache.set(paths.automationStatePath, parsed)
  return parsed
}

export async function readAutomationState(
  paths: AssistantStatePaths,
  options?: {
    fresh?: boolean
  },
): Promise<AssistantAutomationState> {
  if (options?.fresh !== true) {
    const cached = assistantAutomationStateCache.get(paths.automationStatePath)
    if (cached !== undefined) {
      return cached
    }
  }

  let raw: string
  try {
    raw = await readFile(paths.automationStatePath, 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    const initial = createInitialAutomationState()
    await writeJsonFileAtomic(paths.automationStatePath, initial)
    assistantAutomationStateCache.set(paths.automationStatePath, initial)
    return initial
  }

  try {
    const parsed = assistantAutomationStateSchema.parse(JSON.parse(raw))
    assistantAutomationStateCache.set(paths.automationStatePath, parsed)
    return parsed
  } catch (error) {
    assistantAutomationStateCache.delete(paths.automationStatePath)
    const quarantine = await quarantineAssistantStateFile({
      artifactKind: 'automation',
      error,
      expectedContent: raw,
      filePath: paths.automationStatePath,
      paths,
    })
    if (!quarantine) {
      return await readAutomationState(paths, { fresh: true })
    }
    const initial = createInitialAutomationState()
    await writeJsonFileAtomic(paths.automationStatePath, initial)
    assistantAutomationStateCache.set(paths.automationStatePath, initial)
    await appendAssistantRuntimeEventAtPaths(paths, {
      component: 'automation',
      entityId: 'automation',
      entityType: 'automation-state',
      kind: 'automation.recovered',
      level: 'warn',
      message: 'Assistant automation state was rebuilt after quarantine.',
    }).catch(() => undefined)
    return initial
  }
}

function sortSessionsForIndexRebuild(
  sessions: readonly AssistantSession[],
): AssistantSession[] {
  return [...sessions].sort((left, right) => {
    const timestampOrder = compareAssistantTimestampsAscending(
      resolveAssistantIndexRebuildTimestamp(left),
      resolveAssistantIndexRebuildTimestamp(right),
    )
    return timestampOrder === 0
      ? left.sessionId.localeCompare(right.sessionId)
      : timestampOrder
  })
}

function resolveAssistantIndexRebuildTimestamp(
  session: AssistantSession,
): string {
  return (
    normalizeNullableString(session.lastTurnAt) ??
    normalizeNullableString(session.updatedAt) ??
    normalizeNullableString(session.createdAt) ??
    ''
  )
}

function createInitialAutomationState(): AssistantAutomationState {
  return assistantAutomationStateSchema.parse({
    version: ASSISTANT_AUTOMATION_STATE_VERSION,
    autoReply: [],
    updatedAt: new Date().toISOString(),
  })
}

function areAssistantBindingsEqual(
  left: AssistantSession['binding'],
  right: AssistantSession['binding'],
): boolean {
  return (
    left.actorId === right.actorId &&
    left.channel === right.channel &&
    left.conversationKey === right.conversationKey &&
    left.identityId === right.identityId &&
    left.threadId === right.threadId &&
    left.threadIsDirect === right.threadIsDirect &&
    left.delivery?.kind === right.delivery?.kind &&
    left.delivery?.target === right.delivery?.target
  )
}

function createAssistantSessionCorruptedError(input: {
  error: unknown
  sessionId: string
  sessionPath: string
}): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_SESSION_CORRUPTED',
    `Assistant session "${input.sessionId}" is corrupted and was quarantined. Repair or restore the session file before resuming it.`,
    {
      sessionId: input.sessionId,
      sessionPath: input.sessionPath,
      reason: input.error instanceof Error ? input.error.message : String(input.error),
    },
  )
}

function createAssistantSessionRoutingConflictError(input: {
  conflicts: ReturnType<typeof getAssistantBindingIsolationConflicts>
  lookupSource: 'alias' | 'conversation-key' | 'session-id'
  session: AssistantSession
}): VaultCliError {
  return new VaultCliError(
    'ASSISTANT_SESSION_ROUTING_CONFLICT',
    `Assistant session "${input.session.sessionId}" is already bound to a different routed audience. Resume it without changing channel, identity, participant, or thread metadata, or send a one-off explicit target override instead.`,
    {
      alias: input.session.alias,
      conflicts: input.conflicts,
      conversationKey: input.session.binding.conversationKey,
      lookupSource: input.lookupSource,
      sessionId: input.session.sessionId,
    },
  )
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT',
  )
}
