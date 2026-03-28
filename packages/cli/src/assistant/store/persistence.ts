import { access, appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
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
  mergeAssistantBinding,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  isJsonSyntaxError,
  isMissingFileError,
  normalizeNullableString,
  parseAssistantJsonLinesWithTailSalvage,
  readAssistantJsonFile,
  writeTextFileAtomic,
  writeJsonFileAtomic,
} from '../shared.js'
import { serializeAssistantProviderSessionOptions } from '../provider-config.js'
import { normalizeAssistantSessionSnapshot } from '../provider-state.js'
import type {
  AssistantStatePaths,
} from './paths.js'
import type { ResolvedAssistantSession } from './types.js'

export const ASSISTANT_INDEX_STORE_VERSION = 2
export const ASSISTANT_AUTOMATION_STATE_VERSION = 2

export async function ensureAssistantState(
  paths: AssistantStatePaths,
): Promise<void> {
  await Promise.all([
    mkdir(paths.sessionsDirectory, {
      recursive: true,
    }),
    mkdir(paths.transcriptsDirectory, {
      recursive: true,
    }),
    mkdir(paths.outboxDirectory, {
      recursive: true,
    }),
    mkdir(paths.turnsDirectory, {
      recursive: true,
    }),
    mkdir(paths.diagnosticsDirectory, {
      recursive: true,
    }),
    mkdir(paths.stateDirectory, {
      recursive: true,
    }),
    mkdir(paths.usageDirectory, {
      recursive: true,
    }),
    mkdir(paths.usagePendingDirectory, {
      recursive: true,
    }),
  ])
}

export async function readAssistantSession(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantSession | null> {
  const sessionPath = resolveAssistantSessionPath(input.paths, input.sessionId)

  try {
    return (
      await readAssistantJsonFile({
        filePath: sessionPath,
        parse(value) {
          return normalizeAssistantSessionSnapshot(parseAssistantSessionRecord(value))
        },
      })
    ).value
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    if (isJsonSyntaxError(error)) {
      return null
    }
    throw error
  }
}

export async function writeAssistantSession(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<void> {
  const sessionPath = resolveAssistantSessionPath(paths, session.sessionId)
  await writeJsonFileAtomic(
    sessionPath,
    assistantSessionSchema.parse(normalizeAssistantSessionForWrite(session)),
  )
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
  return path.join(paths.transcriptsDirectory, `${sessionId}.jsonl`)
}

export function resolveAssistantSessionPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(paths.sessionsDirectory, `${sessionId}.json`)
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

  await mkdir(path.dirname(transcriptPath), {
    recursive: true,
  })
  await appendFile(transcriptPath, serialized, 'utf8')
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

  await mkdir(path.dirname(transcriptPath), {
    recursive: true,
  })
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
  const normalized = normalizeAssistantSessionSnapshot({
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

  const {
    providerSessionId: _providerSessionId,
    providerState: _providerState,
    ...persisted
  } = normalized
  return persisted
}

export async function persistResolvedSession(
  paths: AssistantStatePaths,
  session: AssistantSession,
  input: {
    alias: string | null
    bindingPatch: AssistantBindingPatch
  },
): Promise<AssistantSession> {
  const nextBinding = mergeAssistantBinding(session.binding, input.bindingPatch)
  const aliasChanged = input.alias !== null && input.alias !== session.alias
  const bindingChanged =
    JSON.stringify(nextBinding) !== JSON.stringify(session.binding)

  if (!aliasChanged && !bindingChanged) {
    return session
  }

  const updated = parseAssistantSessionRecord(
    normalizeAssistantSessionForWrite({
    ...session,
    alias: input.alias ?? session.alias,
    binding: nextBinding,
    updatedAt: new Date().toISOString(),
    }),
  )
  await writeAssistantSession(paths, updated)
  await synchronizeAssistantIndexes(paths, updated, session)
  return updated
}

export async function loadAndPersistResolvedSession(input: {
  paths: AssistantStatePaths
  sessionId: string
  persistenceInput: {
    alias: string | null
    bindingPatch: AssistantBindingPatch
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
  try {
    return (
      await readAssistantJsonFile({
        filePath: paths.indexesPath,
        parse(value) {
          return assistantAliasStoreSchema.parse(value)
        },
      })
    ).value
  } catch (error) {
    if (!isMissingFileError(error)) {
      if (isJsonSyntaxError(error)) {
        return rebuildAssistantIndexStore(paths)
      }
      throw error
    }
  }

  const initial = createInitialAssistantIndexStore()
  await writeJsonFileAtomic(paths.indexesPath, initial)
  return initial
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
}

export async function readAutomationState(
  paths: AssistantStatePaths,
): Promise<AssistantAutomationState> {
  try {
    return (
      await readAssistantJsonFile({
        filePath: paths.automationPath,
        parse(value) {
          return assistantAutomationStateSchema.parse(value)
        },
      })
    ).value
  } catch (error) {
    if (!isMissingFileError(error)) {
      if (isJsonSyntaxError(error)) {
        return createInitialAutomationState()
      }
      throw error
    }
  }

  const initial = createInitialAutomationState()
  await writeJsonFileAtomic(paths.automationPath, initial)
  return initial
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
      // Doctor will still flag the malformed session file; skip it while rebuilding indexes.
    }
  }

  return assistantAliasStoreSchema.parse({
    version: ASSISTANT_INDEX_STORE_VERSION,
    aliases,
    conversationKeys,
  })
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
