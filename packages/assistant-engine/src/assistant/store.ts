import { readdir } from 'node:fs/promises'
import {
  assistantAutomationStateSchema,
  parseAssistantSessionRecord,
  assistantTranscriptEntrySchema,
  type AssistantAutomationState,
  type AssistantSession,
  type AssistantTranscriptEntry,
} from '@murphai/operator-config/assistant-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  serializeAssistantProviderSessionOptions,
} from '@murphai/operator-config/assistant/provider-config'
import {
  createAssistantBinding,
  type AssistantBindingPatch,
} from './bindings.js'
import {
  serializeAssistantConversationForPersistence,
} from './conversation-persistence.js'
import {
  conversationRefFromLocator,
} from './conversation-ref.js'
import {
  compareAssistantTimestampsAscending,
  normalizeNullableString,
  resolveTimestamp,
} from './shared.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  ensureAssistantState,
  appendTranscriptEntries,
  inspectAssistantSessionStorage,
  loadAndPersistResolvedSession,
  readAssistantRecentSessionIds,
  readAssistantIndexStore,
  readAssistantSession,
  readAssistantTranscriptEntries,
  readAssistantTranscriptTailEntries,
  readAutomationState,
  retireLegacyAssistantConversationKey,
  pruneAssistantTranscriptRetention,
  writeAutomationState,
  replaceTranscriptEntries,
  synchronizeAssistantIndexes,
  writeAssistantSession,
} from './store/persistence.js'
import {
  bindingInputFromLocator,
  bindingPatchFromLocator,
  normalizeProviderOptions,
  createAssistantSessionId,
  resolveLegacyAssistantConversationLookupKeyEntries,
  resolveAssistantConversationLookupKeyEntries,
  resolveAssistantStatePaths,
  type AssistantStatePaths,
  type AssistantConversationLookupKeyEntry,
} from './store/paths.js'
import {
  assistantBackendTargetToProviderConfigInput,
  createAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
export {
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantConversationLookupKey,
  resolveAssistantStatePaths,
} from './store/paths.js'
export type {
  AssistantSessionResolutionDiagnostics,
  AssistantSessionLocator,
  CreateAssistantSessionInput,
  ResolveAssistantSessionInput,
  ResolvedAssistantSession,
  AssistantTranscriptEntryInput,
  AssistantTranscriptEntryRef,
} from './store/types.js'
import type {
  AssistantSessionLocator,
  ResolveAssistantSessionInput,
  ResolvedAssistantSession,
  AssistantSessionResolutionDiagnostics,
  AssistantSessionResolutionLookupSource,
  AssistantTranscriptEntryInput,
  AssistantTranscriptEntryRef,
} from './store/types.js'

const ASSISTANT_STATE_SCHEMA = 'murph.assistant-conversation.v2'

export function isAssistantSessionNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ASSISTANT_SESSION_NOT_FOUND',
  )
}

export async function runAssistantTranscriptContentRetention(input: {
  now?: Date
  signal?: AbortSignal | null
  vault: string
}): Promise<Awaited<ReturnType<typeof pruneAssistantTranscriptRetention>>> {
  return await withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    input.signal?.throwIfAborted()
    await ensureAssistantState(paths)
    input.signal?.throwIfAborted()
    return await pruneAssistantTranscriptRetention(paths, {
      now: input.now ?? new Date(),
      signal: input.signal,
    })
  }, input.signal)
}

export async function resolveAssistantSession(
  input: ResolveAssistantSessionInput,
): Promise<ResolvedAssistantSession> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const requestedProviderOptions =
      resolveAssistantSessionRequestedProviderOptions(input)
    const requestedContinuityFingerprint =
      requestedProviderOptions?.continuityFingerprint ?? null

    const conversation = conversationRefFromLocator(input)
    const sessionId = normalizeNullableString(input.sessionId ?? conversation.sessionId)
    const manualAlias = normalizeNullableString(conversation.alias)
    const bindingPatch = bindingPatchFromLocator(input)
    const persistenceInput = {
      allowBindingRebind: input.allowBindingRebind === true,
      alias: manualAlias,
      bindingPatch,
      lookupSource: 'session-id' as const,
    }
    const conversationLookupEntries =
      resolveAssistantConversationLookupKeyEntries(input)
    const legacyConversationLookupEntries =
      resolveLegacyAssistantConversationLookupKeyEntries(input)

    if (sessionId) {
      const resolved = await loadAndPersistResolvedSession({
        paths,
        persistenceInput: {
          ...persistenceInput,
          bindingPatch:
            persistenceInput.allowBindingRebind
              ? bindingPatch
              : bindingPatchWithoutIncomingSystemActor(bindingPatch),
        },
        sessionId,
      })
      if (!resolved) {
        throw await createAssistantSessionNotFoundError({
          paths,
          sessionId,
        })
      }
      return withAssistantSessionResolutionDiagnostics(
        resolved,
        buildAssistantSessionResolutionDiagnostics({
          conversationLookupEntries,
          lookupSource: 'session-id',
        }),
      )
    }

    const indexes = await readAssistantIndexStore(paths)
    const conversationLookupDiagnosticsInput = {
      conversationLookupEntries,
      indexes,
    } as const

    if (manualAlias) {
      const sessionId = indexes.aliases[manualAlias]
      if (sessionId) {
        const resolved = await loadAndPersistResolvedSession({
          paths,
          sessionId,
          persistenceInput: {
            ...persistenceInput,
            lookupSource: 'alias',
          },
        })
        if (resolved) {
          return withAssistantSessionResolutionDiagnostics(
            resolved,
            buildAssistantSessionResolutionDiagnostics({
              ...conversationLookupDiagnosticsInput,
              lookupSource: 'alias',
            }),
          )
        }
      }
    }

    for (const conversationLookupEntry of conversationLookupEntries) {
      const sessionId = indexes.conversationKeys[conversationLookupEntry.key]
      if (sessionId) {
        const resolved = await loadAndPersistResolvedSession({
          paths,
          sessionId,
          persistenceInput: {
            ...persistenceInput,
            lookupSource: 'conversation-key',
          },
          expectedContinuityFingerprint: requestedContinuityFingerprint,
          skipIfExpired: true,
          maxSessionAgeMs: input.maxSessionAgeMs,
          now: input.now,
        })
        if (resolved) {
          return withAssistantSessionResolutionDiagnostics(
            resolved,
            buildAssistantSessionResolutionDiagnostics({
              ...conversationLookupDiagnosticsInput,
              lookupSource: 'conversation-key',
              matchedEntry: conversationLookupEntry,
            }),
          )
        }
      }
    }

    const legacyResetSessions = new Map<string, AssistantSession>()
    for (const legacyLookupEntry of legacyConversationLookupEntries) {
      const sessionId = indexes.conversationKeys[legacyLookupEntry.key]
      if (!sessionId) {
        continue
      }

      const legacySession = await readAssistantSession({ paths, sessionId })
      if (
        !legacySession ||
        legacySession.binding.conversationKey !== legacyLookupEntry.key
      ) {
        continue
      }

      if (canMigrateLegacyAssistantAudienceSession({
        bindingPatch,
        session: legacySession,
      })) {
        const resolved = await loadAndPersistResolvedSession({
          paths,
          sessionId,
          persistenceInput: {
            ...persistenceInput,
            lookupSource: 'conversation-key',
          },
          expectedContinuityFingerprint: requestedContinuityFingerprint,
          skipIfExpired: true,
          maxSessionAgeMs: input.maxSessionAgeMs,
          now: input.now,
        })
        if (resolved) {
          return withAssistantSessionResolutionDiagnostics(
            resolved,
            buildAssistantSessionResolutionDiagnostics({
              ...conversationLookupDiagnosticsInput,
              legacyAudienceContinuity: 'migrated',
              lookupSource: 'conversation-key',
              matchedEntry: legacyLookupEntry,
            }),
          )
        }
      }

      legacyResetSessions.set(legacySession.sessionId, legacySession)
    }

    if (input.createIfMissing === false) {
      throw new VaultCliError(
        'ASSISTANT_SESSION_NOT_FOUND',
        'Assistant session could not be resolved from the supplied identifiers.',
      )
    }

    const now = resolveTimestamp(input.now)
    const providerOptions = requestedProviderOptions ?? normalizeProviderOptions(input)
    const target = input.target ?? createAssistantModelTarget(providerOptions)
    if (!target) {
      throw new VaultCliError(
        'ASSISTANT_TARGET_REQUIRED',
        'Assistant session creation requires an explicit assistant target.',
      )
    }
    const session = parseAssistantSessionRecord({
      schema: ASSISTANT_STATE_SCHEMA,
      conversationId: createAssistantSessionId(),
      codexTarget: target,
      codexResume: null,
      alias: manualAlias,
      binding: createAssistantBinding(bindingInputFromLocator(input)),
      createdAt: now,
      updatedAt: now,
      lastTurnAt: null,
      turnCount: 0,
    })

    const savedSession = await saveAssistantSessionAtPaths(paths, session)
    for (const legacySession of legacyResetSessions.values()) {
      await retireLegacyAssistantConversationKey(paths, legacySession)
    }

    return {
      created: true,
      paths,
      resolutionDiagnostics: buildAssistantSessionResolutionDiagnostics({
        ...conversationLookupDiagnosticsInput,
        ...(legacyResetSessions.size > 0
          ? { legacyAudienceContinuity: 'reset' as const }
          : {}),
        lookupSource: 'created',
      }),
      session: savedSession,
    }
  })
}

// A runtime-authored completion resumes an already-authorized thread and
// carries no actor of its own (`actorId: null`), which would otherwise clear
// the stored binding and fail closed on an isolation conflict. Only that
// no-actor case is dropped: a differing non-null actor on an explicit session
// still means the caller is retargeting the session at another participant, so
// it keeps failing with a routing conflict unless the caller opts in through
// `allowBindingRebind`. Channel, identity, thread, and directness always stay
// in the patch so their isolation conflicts still fail closed.
function bindingPatchWithoutIncomingSystemActor(
  patch: AssistantBindingPatch,
): AssistantBindingPatch {
  if (patch.actorId !== null) {
    return patch
  }
  const { actorId: _actorId, ...rest } = patch
  return rest
}

function withAssistantSessionResolutionDiagnostics(
  resolved: ResolvedAssistantSession,
  resolutionDiagnostics: AssistantSessionResolutionDiagnostics,
): ResolvedAssistantSession {
  return {
    ...resolved,
    resolutionDiagnostics,
  }
}

function buildAssistantSessionResolutionDiagnostics(input: {
  conversationLookupEntries: readonly AssistantConversationLookupKeyEntry[]
  indexes?: {
    conversationKeys: Readonly<Record<string, string>>
  }
  lookupSource: AssistantSessionResolutionLookupSource
  legacyAudienceContinuity?: 'migrated' | 'reset'
  matchedEntry?: AssistantConversationLookupKeyEntry | null
}): AssistantSessionResolutionDiagnostics {
  const primaryEntry = input.conversationLookupEntries[0] ?? null
  const actorFallbackEntry =
    input.conversationLookupEntries.find(
      (entry, index) => index > 0 && entry.scope === 'actor',
    ) ?? null
  const indexedSessionIds =
    input.indexes
      ? new Set(
          input.conversationLookupEntries.flatMap((entry) => {
            const sessionId = input.indexes?.conversationKeys[entry.key]
            return sessionId ? [sessionId] : []
          }),
        )
      : null

  return {
    actorFallbackConversationIndexed: input.indexes && actorFallbackEntry
      ? input.indexes.conversationKeys[actorFallbackEntry.key] !== undefined
      : null,
    conversationLookupIndexedCandidateCount:
      indexedSessionIds === null ? null : indexedSessionIds.size,
    conversationLookupKeyCount: input.conversationLookupEntries.length,
    conversationLookupMatchedScope: input.matchedEntry?.scope ?? (
      input.lookupSource === 'created' ? 'none' : null
    ),
    primaryConversationIndexed: input.indexes && primaryEntry
      ? input.indexes.conversationKeys[primaryEntry.key] !== undefined
      : null,
    ...(input.legacyAudienceContinuity
      ? { legacyAudienceContinuity: input.legacyAudienceContinuity }
      : {}),
    sessionResolutionLookupSource: input.lookupSource,
  }
}

function canMigrateLegacyAssistantAudienceSession(input: {
  bindingPatch: AssistantBindingPatch
  session: AssistantSession
}): boolean {
  const channel = normalizeNullableString(input.bindingPatch.channel)
  return (
    channel === 'telegram' &&
    input.bindingPatch.threadIsDirect === true &&
    input.session.binding.channel === channel &&
    input.session.binding.threadIsDirect === true
  )
}

function resolveAssistantSessionRequestedProviderOptions(
  input: ResolveAssistantSessionInput,
) {
  if (input.target) {
    return serializeAssistantProviderSessionOptions(
      assistantBackendTargetToProviderConfigInput(input.target),
    )
  }

  if (!hasAssistantSessionProviderOverrideInput(input)) {
    return null
  }

  return normalizeProviderOptions(input)
}

const ASSISTANT_SESSION_PROVIDER_OVERRIDE_FIELDS = [
  'approvalPolicy',
  'codexHome',
  'model',
  'modelProvider',
  'oss',
  'profile',
  'provider',
  'reasoningEffort',
  'sandbox',
] as const satisfies readonly (keyof ResolveAssistantSessionInput)[]

function hasAssistantSessionProviderOverrideInput(
  input: ResolveAssistantSessionInput,
): boolean {
  return ASSISTANT_SESSION_PROVIDER_OVERRIDE_FIELDS.some(
    (field) => field in input,
  )
}

export async function listAssistantSessions(
  vault: string,
  options?: {
    limit?: number
  },
): Promise<AssistantSession[]> {
  if (typeof options?.limit !== 'number') {
    return listAssistantSessionsLocal(vault)
  }

  const limit = Math.max(0, Math.trunc(options.limit))
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const sessionIds = await readAssistantRecentSessionIds(paths, { limit })
    return (await readAssistantSessionsSorted(paths, sessionIds)).slice(0, limit)
  })
}

// Maps a Codex thread back to the Murph assistant session that owns it (via
// the persisted native-resume state). Used by idle-time maintenance, which
// only knows the provider thread id, to attribute usage to the real session.
export async function findAssistantSessionIdByCodexThreadId(
  vault: string,
  codexThreadId: string,
): Promise<string | null> {
  const sessions = await listAssistantSessionsLocal(vault)
  return (
    sessions.find((session) => session.resumeState?.threadId === codexThreadId)
      ?.sessionId ?? null
  )
}

export async function listAssistantSessionsLocal(
  vault: string,
): Promise<AssistantSession[]> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    return readAssistantSessionsSorted(paths, await listAssistantSessionFileIds(paths))
  })
}

async function listAssistantSessionFileIds(
  paths: AssistantStatePaths,
): Promise<string[]> {
  const entries = await readdir(paths.sessionsDirectory, {
    withFileTypes: true,
  })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/u, ''))
}

async function readAssistantSessionsSorted(
  paths: AssistantStatePaths,
  sessionIds: readonly string[],
): Promise<AssistantSession[]> {
  const sessions: AssistantSession[] = []
  for (const sessionId of sessionIds) {
    const session = await readAssistantSession({
      paths,
      sessionId,
      treatCorruptedAsMissing: true,
    })
    if (session) {
      sessions.push(session)
    }
  }

  return sessions.sort((left, right) =>
    compareAssistantTimestampsAscending(right.updatedAt, left.updatedAt),
  )
}

export async function getAssistantSession(
  vault: string,
  sessionId: string,
): Promise<AssistantSession> {
  return getAssistantSessionLocal(vault, sessionId)
}

export async function getAssistantSessionLocal(
  vault: string,
  sessionId: string,
): Promise<AssistantSession> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)

    const session = await readAssistantSession({ paths, sessionId })
    if (!session) {
      throw await createAssistantSessionNotFoundError({
        paths,
        sessionId,
      })
    }

    return session
  })
}

export async function saveAssistantSession(
  vault: string,
  session: AssistantSession,
): Promise<AssistantSession> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    return saveAssistantSessionAtPaths(paths, session)
  })
}

export async function restoreAssistantSessionSnapshot(
  input: {
    session: AssistantSession
    transcriptEntries?: readonly AssistantTranscriptEntryInput[] | null
    vault: string
  },
): Promise<AssistantSession> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)
    const parsedSession = await saveAssistantSessionAtPaths(paths, input.session)
    if (input.transcriptEntries !== undefined && input.transcriptEntries !== null) {
      const transcriptEntries = parseAssistantTranscriptEntries(
        input.transcriptEntries,
      )
      await replaceTranscriptEntries(
        paths,
        parsedSession.sessionId,
        transcriptEntries,
      )
    }

    return parsedSession
  })
}

export async function listAssistantTranscriptEntries(
  vault: string,
  sessionId: string,
): Promise<AssistantTranscriptEntry[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return readAssistantTranscriptEntries(paths, sessionId)
}

export async function listAssistantTranscriptTailEntries(
  vault: string,
  sessionId: string,
  options: { maxBytes: number },
): Promise<AssistantTranscriptEntry[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return readAssistantTranscriptTailEntries(paths, sessionId, options.maxBytes)
}

export async function appendAssistantTranscriptEntries(
  vault: string,
  sessionId: string,
  entries: readonly AssistantTranscriptEntryInput[],
): Promise<AssistantTranscriptEntry[]> {
  const result = await appendAssistantTranscriptEntriesWithRefs(
    vault,
    sessionId,
    entries,
  )
  return result.entries
}

export async function appendAssistantTranscriptEntriesWithRefs(
  vault: string,
  sessionId: string,
  entries: readonly AssistantTranscriptEntryInput[],
): Promise<{
  entries: AssistantTranscriptEntry[]
  refs: AssistantTranscriptEntryRef[]
}> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)

    if (entries.length === 0) {
      return {
        entries: [],
        refs: [],
      }
    }

    const existingEntries = await readAssistantTranscriptEntries(paths, sessionId)
    const firstEntryIndex = existingEntries.length
    const parsed = entries.map((entry) => {
      const createdAt =
        normalizeNullableString(entry.createdAt) ?? new Date().toISOString()
      const contentReceivedAt =
        normalizeNullableString(entry.contentReceivedAt)
        ?? (entry.kind === 'user' ? createdAt : null)
      return assistantTranscriptEntrySchema.parse({
        schema: 'murph.assistant-transcript-entry.v1',
        kind: entry.kind,
        text: entry.text,
        createdAt,
        ...(contentReceivedAt
          ? { contentReceivedAt }
          : {}),
      })
    })
    await appendTranscriptEntries(paths, sessionId, parsed)

    return {
      entries: parsed,
      refs: parsed.map((entry, index) => ({
        entryCreatedAt: entry.createdAt,
        entryIndex: firstEntryIndex + index,
        entryKind: entry.kind,
        sessionId,
      })),
    }
  })
}

async function createAssistantSessionNotFoundError(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<VaultCliError> {
  const diagnosis = await inspectAssistantSessionStorage(input)
  const message = [
    'Assistant session was not found in the current vault assistant state.',
    diagnosis.transcriptExists
      ? 'A local transcript exists for that id, but the matching session record is missing, so local assistant state is out of sync.'
      : null,
    'Assistant sessions are vault-scoped. This usually means the session id was resumed against a different vault/default vault, or the local session file was deleted while assistant-state remained.',
    'List sessions for the current vault or start a new chat.',
  ]
    .filter((value): value is string => value !== null)
    .join(' ')

  return new VaultCliError('ASSISTANT_SESSION_NOT_FOUND', message, {
    sessionIdPresent: true,
    sessionExists: diagnosis.sessionExists,
    transcriptExists: diagnosis.transcriptExists,
  })
}

export async function readAssistantAutomationState(
  vault: string,
): Promise<AssistantAutomationState> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    return readAutomationState(paths)
  })
}

export async function saveAssistantAutomationState(
  vault: string,
  state: AssistantAutomationState,
): Promise<AssistantAutomationState> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    return writeAutomationState(paths, assistantAutomationStateSchema.parse(state))
  })
}

export async function updateAssistantAutomationState(
  vault: string,
  update: (
    state: AssistantAutomationState,
  ) => AssistantAutomationState | Promise<AssistantAutomationState>,
): Promise<AssistantAutomationState> {
  return withAssistantRuntimeWriteLock(vault, async (paths) => {
    await ensureAssistantState(paths)
    const current = await readAutomationState(paths, { fresh: true })
    const updated = await update(current)
    if (updated === current) {
      return current
    }
    return writeAutomationState(paths, assistantAutomationStateSchema.parse(updated))
  })
}

async function saveAssistantSessionAtPaths(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<AssistantSession> {
  const existing = await readAssistantSession({
    paths,
    sessionId: session.sessionId,
  })
  const parsed = normalizeAssistantConversationSnapshot(session)
  await writeAssistantSession(paths, parsed)
  await synchronizeAssistantIndexes(paths, parsed, existing)
  return parsed
}

function normalizeAssistantConversationSnapshot(
  session: AssistantSession,
): AssistantSession {
  return parseAssistantSessionRecord(
    serializeAssistantConversationForPersistence(session),
  )
}

function parseAssistantTranscriptEntries(
  entries: readonly AssistantTranscriptEntryInput[],
): AssistantTranscriptEntry[] {
  return entries.map((entry) => {
    const createdAt =
      normalizeNullableString(entry.createdAt) ?? new Date().toISOString()
    const contentReceivedAt =
      normalizeNullableString(entry.contentReceivedAt)
      ?? (entry.kind === 'user' ? createdAt : null)
    return assistantTranscriptEntrySchema.parse({
      schema: 'murph.assistant-transcript-entry.v1',
      kind: entry.kind,
      text: entry.text,
      createdAt,
      ...(contentReceivedAt
        ? { contentReceivedAt }
        : {}),
    })
  })
}
