import { readdir } from 'node:fs/promises'
import {
  assistantAutomationStateSchema,
  assistantSessionSchema,
  assistantTranscriptEntrySchema,
  type AssistantAutomationState,
  type AssistantSession,
  type AssistantTranscriptEntry,
} from '../assistant-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  createAssistantBinding,
  type AssistantBindingPatch,
} from './bindings.js'
import {
  mergeConversationRefs,
  normalizeConversationRef,
} from './conversation-ref.js'
import {
  writeJsonFileAtomic,
  normalizeNullableString,
  resolveTimestamp,
} from './shared.js'
import {
  ensureAssistantState,
  appendTranscriptEntries,
  inspectAssistantSessionStorage,
  loadAndPersistResolvedSession,
  readAssistantIndexStore,
  readAssistantSession,
  readAssistantTranscriptEntries,
  readAutomationState,
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
export {
  redactAssistantDisplayPath,
  resolveAssistantAliasKey,
  resolveAssistantConversationLookupKey,
  resolveAssistantStatePaths,
} from './store/paths.js'
export type { AssistantStatePaths } from './store/paths.js'
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

const ASSISTANT_STATE_SCHEMA = 'healthybob.assistant-session.v2'

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
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)

  const conversation = normalizeConversationRef(
    mergeConversationRefs(input.conversation, {
      sessionId: input.sessionId,
      alias: input.alias,
      channel: input.channel,
      identityId: input.identityId,
      participantId: input.actorId ?? input.participantId,
      threadId: input.threadId ?? input.sourceThreadId,
      directness:
        input.threadIsDirect === true
          ? 'direct'
          : input.threadIsDirect === false
            ? 'group'
            : null,
    }),
  )
  const sessionId = normalizeNullableString(input.sessionId ?? conversation.sessionId)
  const manualAlias = normalizeNullableString(conversation.alias)
  const bindingPatch = bindingPatchFromLocator(input)
  const persistenceInput = {
    alias: manualAlias,
    bindingPatch,
  }
  const conversationKey = resolveAssistantConversationLookupKey(input)

  if (sessionId) {
    const resolved = await loadAndPersistResolvedSession({
      paths,
      sessionId,
      persistenceInput,
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
        persistenceInput,
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
        persistenceInput,
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
  const session = assistantSessionSchema.parse({
    schema: ASSISTANT_STATE_SCHEMA,
    sessionId: createAssistantSessionId(),
    provider: input.provider ?? 'codex-cli',
    providerSessionId: null,
    providerOptions,
    alias: manualAlias,
    binding: createAssistantBinding(bindingInputFromLocator(input)),
    createdAt: now,
    updatedAt: now,
    lastTurnAt: null,
    turnCount: 0,
  })

  await writeAssistantSession(paths, session)
  await synchronizeAssistantIndexes(paths, session, null)

  return {
    created: true,
    paths,
    session,
  }
}

export async function listAssistantSessions(
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
    const session = await readAssistantSession({ paths, sessionId })
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
  const paths = resolveAssistantStatePaths(vault)
  await ensureAssistantState(paths)

  const existing = await readAssistantSession({
    paths,
    sessionId: session.sessionId,
  })
  const parsed = assistantSessionSchema.parse(session)
  await writeAssistantSession(paths, parsed)
  await synchronizeAssistantIndexes(paths, parsed, existing)
  return parsed
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
      schema: 'healthybob.assistant-transcript-entry.v1',
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
  const parsed = assistantAutomationStateSchema.parse(state)
  await writeJsonFileAtomic(paths.automationPath, parsed)
  return parsed
}
