import { access, readdir, readFile } from 'node:fs/promises'
import {
  assistantAliasStoreSchema,
  assistantAutomationStateSchema,
  assistantSessionSchema,
  assistantTranscriptEntrySchema,
  type AssistantAliasStore,
  type AssistantAutomationState,
  type AssistantSession,
  type AssistantTranscriptEntry,
  parseAssistantSessionRecord,
} from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import {
  getAssistantBindingIsolationConflicts,
  mergeAssistantBinding,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  createAssistantBoundedRuntimeCache,
  ASSISTANT_AUTOMATION_STATE_CACHE,
  ASSISTANT_INDEX_CACHE,
  ASSISTANT_SESSION_CACHE,
} from '../runtime-budget-policy.js'
import {
  appendTextFile,
  ensureAssistantStateDirectory,
  normalizeNullableString,
  parseAssistantJsonLinesWithTailSalvage,
  writeTextFileAtomic,
  writeJsonFileAtomic,
} from '../shared.js'
import { serializeAssistantProviderSessionOptions } from '../provider-config.js'
import { normalizeAssistantSessionSnapshot } from '../provider-state.js'
import {
  extractAssistantSessionSecretsForPersistence,
  mergeAssistantSessionSecrets,
  persistAssistantSessionSecrets,
  readAssistantSessionSecrets,
  resolveAssistantSessionSecretsPath,
} from '../state-secrets.js'
import { quarantineAssistantStateFile } from '../quarantine.js'
import { appendAssistantRuntimeEventAtPaths } from '../runtime-events.js'
import { resolveAssistantOpaqueStateFilePath } from '../state-ids.js'
import type { AssistantStatePaths } from './paths.js'
import type { ResolvedAssistantSession } from './types.js'

export const ASSISTANT_INDEX_STORE_VERSION = 2
export const ASSISTANT_AUTOMATION_STATE_VERSION = 2

const assistantSessionCache = createAssistantBoundedRuntimeCache<string, AssistantSession | null>({
  name: 'assistant.sessions',
  ...ASSISTANT_SESSION_CACHE,
})

const assistantIndexStoreCache = createAssistantBoundedRuntimeCache<string, AssistantAliasStore>({
  name: 'assistant.indexes',
  ...ASSISTANT_INDEX_CACHE,
})

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
    ensureAssistantStateDirectory(paths.distillationsDirectory),
    ensureAssistantStateDirectory(paths.journalsDirectory),
    ensureAssistantStateDirectory(paths.providerRouteRecoveryDirectory),
    ensureAssistantStateDirectory(paths.providerRouteRecoverySecretsDirectory),
    ensureAssistantStateDirectory(paths.quarantineDirectory),
    ensureAssistantStateDirectory(paths.stateDirectory),
    ensureAssistantStateDirectory(paths.secretsDirectory),
    ensureAssistantStateDirectory(paths.sessionSecretsDirectory),
    ensureAssistantStateDirectory(paths.usageDirectory),
    ensureAssistantStateDirectory(paths.usagePendingDirectory),
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
      assistantSessionCache.set(sessionPath, null)
      return null
    }
    throw error
  }

  let persistedSession: AssistantSession
  try {
    persistedSession = normalizeAssistantSessionSnapshot(
      parseAssistantSessionRecord(JSON.parse(raw) as unknown),
    )
  } catch (error) {
    assistantSessionCache.delete(sessionPath)
    await quarantineAssistantStateFile({
      artifactKind: 'session',
      error,
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

  let secrets: Awaited<ReturnType<typeof readAssistantSessionSecrets>>
  try {
    secrets = await readAssistantSessionSecrets({
      paths: input.paths,
      sessionId: input.sessionId,
    })
  } catch (error) {
    assistantSessionCache.delete(sessionPath)
    if (input.treatCorruptedAsMissing) {
      return null
    }
    throw createAssistantSessionCorruptedError({
      error,
      sessionId: input.sessionId,
      sessionPath: resolveAssistantSessionSecretsPath(input.paths, input.sessionId),
    })
  }

  const session = mergeAssistantSessionSecrets(persistedSession, secrets)
  assistantSessionCache.set(sessionPath, session)
  return session
}

export async function writeAssistantSession(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<void> {
  const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
  const normalized = normalizeAssistantSessionSnapshot(session)
  const {
    persisted: redactedSession,
    secrets,
  } = extractAssistantSessionSecretsForPersistence(normalized)
  const persisted = assistantSessionSchema.parse(
    normalizeAssistantSessionForWrite(redactedSession),
  )
  await persistAssistantSessionSecrets({
    paths,
    secrets,
    sessionId: normalized.sessionId,
  })
  await writeJsonFileAtomic(sessionPath, persisted)
  assistantSessionCache.set(sessionPath, normalized)
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
    const raw = await readFile(transcriptPath, 'utf8')
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
  } catch (error) {
    if (isMissingFileError(error)) {
      return []
    }

    throw error
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
  session: AssistantSession,
): AssistantSession {
  return normalizeAssistantSessionSnapshot({
    ...session,
    providerOptions: serializeAssistantProviderSessionOptions({
      provider: session.provider,
      ...session.providerOptions,
    }),
    providerBinding: session.providerBinding
      ? {
          ...session.providerBinding,
          providerOptions: serializeAssistantProviderSessionOptions({
            provider: session.providerBinding.provider,
            ...session.providerBinding.providerOptions,
          }),
        }
      : null,
  })
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
  if (
    routingConflicts.length > 0 &&
    !(
      input.allowBindingRebind === true &&
      input.lookupSource === 'session-id'
    )
  ) {
    throw createAssistantSessionRoutingConflictError({
      conflicts: routingConflicts,
      lookupSource: input.lookupSource,
      session,
    })
  }

  const nextBinding = mergeAssistantBinding(session.binding, input.bindingPatch)
  const aliasChanged = input.alias !== null && input.alias !== session.alias
  const bindingChanged = !areAssistantBindingsEqual(nextBinding, session.binding)

  if (!aliasChanged && !bindingChanged) {
    return session
  }

  const updated = normalizeAssistantSessionSnapshot(
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

export async function loadAndPersistResolvedSession(input: {
  paths: AssistantStatePaths
  sessionId: string
  persistenceInput: {
    allowBindingRebind?: boolean
    alias: string | null
    bindingPatch: AssistantBindingPatch
    lookupSource: 'alias' | 'conversation-key' | 'session-id'
  }
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
    input.skipIfExpired &&
    isAssistantSessionExpired(existing, input.maxSessionAgeMs, input.now)
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

export async function readAssistantIndexStore(
  paths: AssistantStatePaths,
): Promise<AssistantAliasStore> {
  const cached = assistantIndexStoreCache.get(paths.indexesPath)
  if (cached !== undefined) {
    return cached
  }

  let raw: string
  try {
    raw = await readFile(paths.indexesPath, 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    const initial = createInitialAssistantIndexStore()
    await writeJsonFileAtomic(paths.indexesPath, initial)
    assistantIndexStoreCache.set(paths.indexesPath, initial)
    return initial
  }

  try {
    const parsed = assistantAliasStoreSchema.parse(JSON.parse(raw) as unknown)
    assistantIndexStoreCache.set(paths.indexesPath, parsed)
    return parsed
  } catch (error) {
    assistantIndexStoreCache.delete(paths.indexesPath)
    await quarantineAssistantStateFile({
      artifactKind: 'indexes',
      error,
      filePath: paths.indexesPath,
      paths,
    })
    return await rebuildAssistantIndexStore(paths)
  }
}

export async function synchronizeAssistantIndexes(
  paths: AssistantStatePaths,
  session: AssistantSession,
  previous: AssistantSession | null,
): Promise<void> {
  const store = await readAssistantIndexStore(paths)
  const aliases = {
    ...store.aliases,
  }
  const conversationKeys = {
    ...store.conversationKeys,
  }

  if (previous?.alias && previous.alias !== session.alias) {
    delete aliases[previous.alias]
  }
  if (
    previous?.binding.conversationKey &&
    previous.binding.conversationKey !== session.binding.conversationKey
  ) {
    delete conversationKeys[previous.binding.conversationKey]
  }

  if (session.alias) {
    aliases[session.alias] = session.sessionId
  }
  if (session.binding.conversationKey) {
    conversationKeys[session.binding.conversationKey] = session.sessionId
  }

  const updated = assistantAliasStoreSchema.parse({
    version: ASSISTANT_INDEX_STORE_VERSION,
    aliases,
    conversationKeys,
  })
  await writeJsonFileAtomic(paths.indexesPath, updated)
  assistantIndexStoreCache.set(paths.indexesPath, updated)
}

export async function writeAutomationState(
  paths: AssistantStatePaths,
  state: AssistantAutomationState,
): Promise<AssistantAutomationState> {
  const parsed = assistantAutomationStateSchema.parse(state)
  await writeJsonFileAtomic(paths.automationPath, parsed)
  assistantAutomationStateCache.set(paths.automationPath, parsed)
  return parsed
}

export async function readAutomationState(
  paths: AssistantStatePaths,
): Promise<AssistantAutomationState> {
  const cached = assistantAutomationStateCache.get(paths.automationPath)
  if (cached !== undefined) {
    return cached
  }

  let raw: string
  try {
    raw = await readFile(paths.automationPath, 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    const initial = createInitialAutomationState()
    await writeJsonFileAtomic(paths.automationPath, initial)
    assistantAutomationStateCache.set(paths.automationPath, initial)
    return initial
  }

  try {
    const parsed = assistantAutomationStateSchema.parse(JSON.parse(raw) as unknown)
    assistantAutomationStateCache.set(paths.automationPath, parsed)
    return parsed
  } catch (error) {
    assistantAutomationStateCache.delete(paths.automationPath)
    await quarantineAssistantStateFile({
      artifactKind: 'automation',
      error,
      filePath: paths.automationPath,
      paths,
    })
    const initial = createInitialAutomationState()
    await writeJsonFileAtomic(paths.automationPath, initial)
    assistantAutomationStateCache.set(paths.automationPath, initial)
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

function createInitialAssistantIndexStore(): AssistantAliasStore {
  return assistantAliasStoreSchema.parse({
    version: ASSISTANT_INDEX_STORE_VERSION,
    aliases: {},
    conversationKeys: {},
  })
}

async function rebuildAssistantIndexStore(
  paths: AssistantStatePaths,
): Promise<AssistantAliasStore> {
  const entries = await readdir(paths.sessionsDirectory, {
    withFileTypes: true,
  })
  const aliases: Record<string, string> = {}
  const conversationKeys: Record<string, string> = {}

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
      if (session.alias) {
        aliases[session.alias] = session.sessionId
      }
      if (session.binding.conversationKey) {
        conversationKeys[session.binding.conversationKey] = session.sessionId
      }
    } catch {
      // Quarantine already happened in readAssistantSession; keep rebuild best-effort.
    }
  }

  const rebuilt = assistantAliasStoreSchema.parse({
    version: ASSISTANT_INDEX_STORE_VERSION,
    aliases,
    conversationKeys,
  })
  await writeJsonFileAtomic(paths.indexesPath, rebuilt)
  assistantIndexStoreCache.set(paths.indexesPath, rebuilt)
  await appendAssistantRuntimeEventAtPaths(paths, {
    component: 'state',
    entityId: 'indexes',
    entityType: 'indexes',
    kind: 'indexes.rebuilt',
    level: 'warn',
    message: 'Assistant session indexes were rebuilt from durable session files.',
  }).catch(() => undefined)
  return rebuilt
}

function createInitialAutomationState(): AssistantAutomationState {
  return assistantAutomationStateSchema.parse({
    version: ASSISTANT_AUTOMATION_STATE_VERSION,
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: [],
    preferredChannels: [],
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
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
