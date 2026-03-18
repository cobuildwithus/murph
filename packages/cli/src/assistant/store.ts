import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantAliasStoreSchema,
  assistantAutomationStateSchema,
  assistantProviderSessionOptionsSchema,
  assistantSessionSchema,
  assistantTranscriptEntrySchema,
  type AssistantAliasStore,
  type AssistantApprovalPolicy,
  type AssistantAutomationState,
  type AssistantBindingDeliveryKind,
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
  type AssistantSession,
  type AssistantTranscriptEntry,
  type AssistantTranscriptEntryKind,
} from '../assistant-cli-contracts.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  createAssistantBinding,
  mergeAssistantBinding,
  resolveAssistantConversationKey,
  type AssistantBindingPatch,
} from './bindings.js'
import {
  isMissingFileError,
  normalizeNullableString,
  resolveTimestamp,
  writeJsonFileAtomic,
} from './shared.js'

const ASSISTANT_STATE_DIRECTORY_NAME = 'assistant-state'
const ASSISTANT_STATE_SCHEMA = 'healthybob.assistant-session.v2'
const ASSISTANT_INDEX_STORE_VERSION = 2
const ASSISTANT_AUTOMATION_STATE_VERSION = 2

export interface AssistantStatePaths {
  absoluteVaultRoot: string
  assistantStateRoot: string
  automationPath: string
  dailyMemoryDirectory: string
  indexesPath: string
  longTermMemoryPath: string
  sessionsDirectory: string
  transcriptsDirectory: string
}

export interface AssistantSessionLocator {
  actorId?: string | null
  alias?: string | null
  channel?: string | null
  deliveryKind?: AssistantBindingDeliveryKind | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
  threadId?: string | null
  threadIsDirect?: boolean | null
}

export interface CreateAssistantSessionInput extends AssistantSessionLocator {
  approvalPolicy?: AssistantApprovalPolicy | null
  model?: string | null
  now?: Date
  oss?: boolean
  profile?: string | null
  provider?: AssistantChatProvider
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  vault: string
}

export interface ResolveAssistantSessionInput
  extends CreateAssistantSessionInput {
  createIfMissing?: boolean
  maxSessionAgeMs?: number | null
}

export interface ResolvedAssistantSession {
  created: boolean
  paths: AssistantStatePaths
  session: AssistantSession
}

export interface AssistantTranscriptEntryInput {
  createdAt?: string | null
  kind: AssistantTranscriptEntryKind
  text: string
}

export function resolveAssistantStatePaths(
  vaultRoot: string,
): AssistantStatePaths {
  const absoluteVaultRoot = path.resolve(vaultRoot)
  const vaultName = path.basename(absoluteVaultRoot)
  const bucketName = `${vaultName}-${hashVaultRoot(absoluteVaultRoot)}`
  const assistantStateRoot = path.join(
    path.dirname(absoluteVaultRoot),
    ASSISTANT_STATE_DIRECTORY_NAME,
    bucketName,
  )

  return {
    absoluteVaultRoot,
    assistantStateRoot,
    automationPath: path.join(assistantStateRoot, 'automation.json'),
    dailyMemoryDirectory: path.join(assistantStateRoot, 'memory'),
    indexesPath: path.join(assistantStateRoot, 'indexes.json'),
    longTermMemoryPath: path.join(assistantStateRoot, 'MEMORY.md'),
    sessionsDirectory: path.join(assistantStateRoot, 'sessions'),
    transcriptsDirectory: path.join(assistantStateRoot, 'transcripts'),
  }
}

export function redactAssistantDisplayPath(filePath: string): string {
  const absolutePath = path.resolve(filePath)
  const homeDirectory = normalizeNullableString(process.env.HOME)
  if (!homeDirectory) {
    return absolutePath
  }

  const absoluteHome = path.resolve(homeDirectory)
  if (absolutePath === absoluteHome) {
    return '~'
  }

  if (!absolutePath.startsWith(`${absoluteHome}${path.sep}`)) {
    return absolutePath
  }

  return path.join('~', path.relative(absoluteHome, absolutePath))
}

export function resolveAssistantAliasKey(
  input: AssistantSessionLocator,
): string | null {
  const explicitAlias = normalizeNullableString(input.alias)
  if (explicitAlias) {
    return explicitAlias
  }

  return resolveAssistantConversationKey(bindingInputFromLocator(input))
}

export function resolveAssistantConversationLookupKey(
  input: AssistantSessionLocator,
): string | null {
  return resolveAssistantConversationKey(bindingInputFromLocator(input))
}

export async function resolveAssistantSession(
  input: ResolveAssistantSessionInput,
): Promise<ResolvedAssistantSession> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)

  const manualAlias = normalizeNullableString(input.alias)
  const bindingPatch = bindingPatchFromLocator(input)
  const persistenceInput = {
    alias: manualAlias,
    bindingPatch,
  }
  const conversationKey = resolveAssistantConversationLookupKey(input)

  if (input.sessionId) {
    const resolved = await loadAndPersistResolvedSession({
      paths,
      sessionId: input.sessionId,
      persistenceInput,
    })
    if (!resolved) {
      throw new VaultCliError(
        'ASSISTANT_SESSION_NOT_FOUND',
        `Assistant session "${input.sessionId}" was not found.`,
      )
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
    throw new VaultCliError(
      'ASSISTANT_SESSION_NOT_FOUND',
      `Assistant session "${sessionId}" was not found.`,
    )
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
  const transcriptPath = resolveAssistantTranscriptPath(paths, sessionId)
  const serialized = `${parsed.map((entry) => JSON.stringify(entry)).join('\n')}\n`

  await mkdir(path.dirname(transcriptPath), {
    recursive: true,
  })
  await appendFile(transcriptPath, serialized, 'utf8')

  return parsed
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

async function ensureAssistantState(paths: AssistantStatePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.sessionsDirectory, {
      recursive: true,
    }),
    mkdir(paths.transcriptsDirectory, {
      recursive: true,
    }),
  ])
}

async function readAssistantSession(input: {
  paths: AssistantStatePaths
  sessionId: string
}): Promise<AssistantSession | null> {
  const sessionPath = path.join(
    input.paths.sessionsDirectory,
    `${input.sessionId}.json`,
  )

  try {
    const raw = await readFile(sessionPath, 'utf8')
    return assistantSessionSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}

async function writeAssistantSession(
  paths: AssistantStatePaths,
  session: AssistantSession,
): Promise<void> {
  const sessionPath = path.join(paths.sessionsDirectory, `${session.sessionId}.json`)
  await writeJsonFileAtomic(sessionPath, session)
}

async function readAssistantTranscriptEntries(
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

function resolveAssistantTranscriptPath(
  paths: AssistantStatePaths,
  sessionId: string,
): string {
  return path.join(paths.transcriptsDirectory, `${sessionId}.jsonl`)
}

async function persistResolvedSession(
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

async function loadAndPersistResolvedSession(input: {
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

function isAssistantSessionExpired(
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

async function readAssistantIndexStore(
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

async function synchronizeAssistantIndexes(
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

async function readAutomationState(
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
    autoReplyPrimed: true,
    updatedAt: new Date().toISOString(),
  })
  await writeJsonFileAtomic(paths.automationPath, initial)
  return initial
}

function bindingInputFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  return {
    actorId: normalizeNullableString(input.actorId ?? input.participantId),
    channel: normalizeNullableString(input.channel),
    deliveryKind: input.deliveryKind ?? null,
    identityId: normalizeNullableString(input.identityId),
    threadId: normalizeNullableString(input.threadId ?? input.sourceThreadId),
    threadIsDirect:
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null,
  }
}

function bindingPatchFromLocator(
  input: AssistantSessionLocator,
): AssistantBindingPatch {
  const patch: AssistantBindingPatch = {}

  if ('actorId' in input || 'participantId' in input) {
    patch.actorId = normalizeNullableString(input.actorId ?? input.participantId)
  }
  if ('channel' in input) {
    patch.channel = normalizeNullableString(input.channel)
  }
  if ('deliveryKind' in input) {
    patch.deliveryKind = input.deliveryKind ?? null
  }
  if ('identityId' in input) {
    patch.identityId = normalizeNullableString(input.identityId)
  }
  if ('threadId' in input || 'sourceThreadId' in input) {
    patch.threadId = normalizeNullableString(input.threadId ?? input.sourceThreadId)
  }
  if ('threadIsDirect' in input) {
    patch.threadIsDirect =
      typeof input.threadIsDirect === 'boolean' ? input.threadIsDirect : null
  }

  return patch
}


function normalizeProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}): AssistantProviderSessionOptions {
  return assistantProviderSessionOptionsSchema.parse({
    model: normalizeNullableString(input.model),
    reasoningEffort: normalizeNullableString(input.reasoningEffort),
    sandbox: input.sandbox ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    profile: normalizeNullableString(input.profile),
    oss: input.oss ?? false,
  })
}

function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}

function hashVaultRoot(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}
