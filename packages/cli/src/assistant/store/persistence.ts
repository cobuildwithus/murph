import { access, appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantAliasStoreSchema,
  assistantAutomationStateSchema,
  assistantChatProviderValues,
  assistantSessionSchema,
  assistantTranscriptEntrySchema,
  type AssistantAliasStore,
  type AssistantAutomationState,
  type AssistantChatProvider,
  type AssistantSession,
  type AssistantTranscriptEntry,
} from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import {
  mergeAssistantBinding,
  type AssistantBindingPatch,
} from '../bindings.js'
import {
  isMissingFileError,
  normalizeNullableString,
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
  ])
}

export async function readAssistantSession(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantSession | null> {
  const sessionPath = resolveAssistantSessionPath(input.paths, input.sessionId)

  try {
    const raw = await readFile(sessionPath, 'utf8')
    return normalizeAssistantSessionSnapshot(
      assistantSessionSchema.parse(normalizeAssistantSessionRecord(JSON.parse(raw) as unknown)),
    )
  } catch (error) {
    if (isMissingFileError(error)) {
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
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => assistantTranscriptEntrySchema.parse(JSON.parse(line) as unknown))
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

function normalizeAssistantSessionRecord(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return raw
  }

  const source = raw as Record<string, unknown>
  const provider: AssistantChatProvider =
    typeof source.provider === 'string' && source.provider.trim().length > 0
      ? ((assistantChatProviderValues as readonly string[]).includes(source.provider)
          ? (source.provider as AssistantChatProvider)
          : 'codex-cli')
      : 'codex-cli'
  const rawProviderOptions =
    source.providerOptions &&
    typeof source.providerOptions === 'object' &&
    !Array.isArray(source.providerOptions)
      ? (source.providerOptions as Record<string, unknown>)
      : {}
  const rawProviderState =
    source.providerState &&
    typeof source.providerState === 'object' &&
    !Array.isArray(source.providerState)
      ? source.providerState
      : undefined

  return {
    ...source,
    provider,
    ...(rawProviderState === undefined ? {} : { providerState: rawProviderState }),
    providerOptions: serializeAssistantProviderSessionOptions({
      provider,
      ...rawProviderOptions,
    }),
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
    providerState: session.providerState,
  })
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

  const updated = assistantSessionSchema.parse({
    ...session,
    alias: input.alias ?? session.alias,
    binding: nextBinding,
    updatedAt: new Date().toISOString(),
  })
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
    const raw = await readFile(paths.indexesPath, 'utf8')
    return assistantAliasStoreSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  const initial = assistantAliasStoreSchema.parse({
    version: ASSISTANT_INDEX_STORE_VERSION,
    aliases: {},
    conversationKeys: {},
  })
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
    const raw = await readFile(paths.automationPath, 'utf8')
    return assistantAutomationStateSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }

  const initial = assistantAutomationStateSchema.parse({
    version: ASSISTANT_AUTOMATION_STATE_VERSION,
    inboxScanCursor: null,
    autoReplyScanCursor: null,
    autoReplyChannels: [],
    preferredChannels: [],
    autoReplyBacklogChannels: [],
    autoReplyPrimed: true,
    updatedAt: new Date().toISOString(),
  })
  await writeJsonFileAtomic(paths.automationPath, initial)
  return initial
}
