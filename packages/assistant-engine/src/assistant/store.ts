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
  createAssistantBinding,
  type AssistantBindingPatch,
} from './bindings.js'
import { normalizeAssistantSessionSnapshot } from './provider-state.js'
import {
  conversationRefFromLocator,
} from './conversation-ref.js'
import {
  normalizeNullableString,
  resolveTimestamp,
} from './shared.js'
import { withAssistantRuntimeWriteLock } from './runtime-write-lock.js'
import {
  ensureAssistantState,
  appendTranscriptEntries,
  inspectAssistantSessionStorage,
  loadAndPersistResolvedSession,
  readAssistantIndexStore,
  readAssistantSession,
  readAssistantTranscriptEntries,
  readAutomationState,
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
  redactAssistantDisplayPath,
  resolveAssistantConversationLookupKey,
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from './store/paths.js'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
export {
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantConversationLookupKey,
  resolveAssistantStatePaths,
} from './store/paths.js'
export type {
  AssistantSessionLocator,
  CreateAssistantSessionInput,
  ResolveAssistantSessionInput,
  ResolvedAssistantSession,
  AssistantTranscriptEntryInput,
} from './store/types.js'
import type {
  AssistantSessionLocator,
  ResolveAssistantSessionInput,
  ResolvedAssistantSession,
  AssistantTranscriptEntryInput,
} from './store/types.js'

const ASSISTANT_STATE_SCHEMA = 'murph.assistant-session.v1'

export function isAssistantSessionNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ASSISTANT_SESSION_NOT_FOUND',
  )
}

export async function resolveAssistantSession(
  input: ResolveAssistantSessionInput,
): Promise<ResolvedAssistantSession> {
  return withAssistantRuntimeWriteLock(input.vault, async (paths) => {
    await ensureAssistantState(paths)

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
    const conversationKey = resolveAssistantConversationLookupKey(input)

    if (sessionId) {
      const resolved = await loadAndPersistResolvedSession({
        paths,
        persistenceInput,
        sessionId,
      })
      if (!resolved) {
        throw await createAssistantSessionNotFoundError({
          paths,
          sessionId,
        })
      }
      return resolved
    }

    const indexes = await readAssistantIndexStore(paths)

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
          return resolved
        }
      }
    }

    if (conversationKey) {
      const sessionId = indexes.conversationKeys[conversationKey]
      if (sessionId) {
        const resolved = await loadAndPersistResolvedSession({
          paths,
          sessionId,
          persistenceInput: {
            ...persistenceInput,
            lookupSource: 'conversation-key',
          },
          skipIfExpired: true,
          maxSessionAgeMs: input.maxSessionAgeMs,
          now: input.now,
        })
        if (resolved) {
          return resolved
        }
      }
    }

    if (input.createIfMissing === false) {
      throw new VaultCliError(
        'ASSISTANT_SESSION_NOT_FOUND',
        'Assistant session could not be resolved from the supplied identifiers.',
      )
    }

    const now = resolveTimestamp(input.now)
    const providerOptions = normalizeProviderOptions(input)
    const target =
      input.target ??
      createAssistantModelTarget({
        provider: input.provider,
        ...providerOptions,
      })
    if (!target) {
      throw new VaultCliError(
        'ASSISTANT_TARGET_REQUIRED',
        'Assistant session creation requires an explicit assistant target.',
      )
    }
    const session = parseAssistantSessionRecord({
      schema: ASSISTANT_STATE_SCHEMA,
      sessionId: createAssistantSessionId(),
      target,
      resumeState: null,
      alias: manualAlias,
      binding: createAssistantBinding(bindingInputFromLocator(input)),
      createdAt: now,
      updatedAt: now,
      lastTurnAt: null,
      turnCount: 0,
    })

    const savedSession = await saveAssistantSessionAtPaths(paths, session)

    return {
      created: true,
      paths,
      session: savedSession,
    }
  })
}

export async function listAssistantSessions(
  vault: string,
): Promise<AssistantSession[]> {
  return listAssistantSessionsLocal(vault)
}

export async function listAssistantSessionsLocal(
  vault: string,
): Promise<AssistantSession[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  const entries = await readdir(paths.sessionsDirectory, {
    withFileTypes: true,
  })
  const sessions: AssistantSession[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }

    const sessionId = entry.name.replace(/\.json$/u, '')
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
    right.updatedAt.localeCompare(left.updatedAt),
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
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  const session = await readAssistantSession({ paths, sessionId })
  if (!session) {
    throw await createAssistantSessionNotFoundError({
      paths,
      sessionId,
    })
  }

  return session
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

export async function appendAssistantTranscriptEntries(
  vault: string,
  sessionId: string,
  entries: readonly AssistantTranscriptEntryInput[],
): Promise<AssistantTranscriptEntry[]> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  if (entries.length === 0) {
    return []
  }

  const parsed = entries.map((entry) =>
    assistantTranscriptEntrySchema.parse({
      schema: 'murph.assistant-transcript-entry.v1',
      kind: entry.kind,
      text: entry.text,
      createdAt: normalizeNullableString(entry.createdAt) ?? new Date().toISOString(),
    }),
  )
  await appendTranscriptEntries(paths, sessionId, parsed)

  return parsed
}

async function createAssistantSessionNotFoundError(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<VaultCliError> {
  const diagnosis = await inspectAssistantSessionStorage(input)
  const stateRoot = redactAssistantDisplayPath(input.paths.assistantStateRoot)
  const message = [
    `Assistant session "${input.sessionId}" was not found in ${stateRoot}.`,
    diagnosis.transcriptExists
      ? 'A local transcript exists for that id, but the matching session record is missing, so local assistant state is out of sync.'
      : null,
    'Assistant sessions are vault-scoped. This usually means the session id was resumed against a different vault/default vault, or the local session file was deleted while assistant-state remained.',
    'List sessions for the current vault or start a new chat.',
  ]
    .filter((value): value is string => value !== null)
    .join(' ')

  return new VaultCliError('ASSISTANT_SESSION_NOT_FOUND', message, {
    sessionId: input.sessionId,
    stateRoot,
    sessionPath: redactAssistantDisplayPath(diagnosis.sessionPath),
    sessionExists: diagnosis.sessionExists,
    transcriptPath: redactAssistantDisplayPath(diagnosis.transcriptPath),
    transcriptExists: diagnosis.transcriptExists,
  })
}

export async function readAssistantAutomationState(
  vault: string,
): Promise<AssistantAutomationState> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return readAutomationState(paths)
}

export async function saveAssistantAutomationState(
  vault: string,
  state: AssistantAutomationState,
): Promise<AssistantAutomationState> {
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)
  return writeAutomationState(paths, assistantAutomationStateSchema.parse(state))
}

async function saveAssistantSessionAtPaths(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<AssistantSession> {
  const existing = await readAssistantSession({
    paths,
    sessionId: session.sessionId,
  })
  const parsed = normalizeAssistantSessionSnapshot(session)
  await writeAssistantSession(paths, parsed)
  await synchronizeAssistantIndexes(paths, parsed, existing)
  return parsed
}

function parseAssistantTranscriptEntries(
  entries: readonly AssistantTranscriptEntryInput[],
): AssistantTranscriptEntry[] {
  return entries.map((entry) =>
    assistantTranscriptEntrySchema.parse({
      schema: 'murph.assistant-transcript-entry.v1',
      kind: entry.kind,
      text: entry.text,
      createdAt: normalizeNullableString(entry.createdAt) ?? new Date().toISOString(),
    }),
  )
}
