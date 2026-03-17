import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantAliasStoreSchema,
  assistantAutomationStateSchema,
  assistantProviderSessionOptionsSchema,
  assistantSessionSchema,
  type AssistantAliasStore,
  type AssistantApprovalPolicy,
  type AssistantAutomationState,
  type AssistantBindingDeliveryKind,
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
  type AssistantSession,
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
const LEGACY_ASSISTANT_STATE_SCHEMA = 'healthybob.assistant-session.v1'
const ASSISTANT_INDEX_STORE_VERSION = 2
const ASSISTANT_AUTOMATION_STATE_VERSION = 1

export interface AssistantStatePaths {
  absoluteVaultRoot: string
  assistantStateRoot: string
  automationPath: string
  indexesPath: string
  legacyAliasesPath: string
  sessionsDirectory: string
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
  sandbox?: AssistantSandbox | null
  vault: string
}

export interface ResolveAssistantSessionInput
  extends CreateAssistantSessionInput {
  createIfMissing?: boolean
}

export interface ResolvedAssistantSession {
  created: boolean
  paths: AssistantStatePaths
  session: AssistantSession
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
    indexesPath: path.join(assistantStateRoot, 'indexes.json'),
    legacyAliasesPath: path.join(assistantStateRoot, 'aliases.json'),
    sessionsDirectory: path.join(assistantStateRoot, 'sessions'),
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
  const conversationKey = resolveAssistantConversationLookupKey(input)

  if (input.sessionId) {
    const existing = await readAssistantSession({
      paths,
      sessionId: input.sessionId,
    })

    if (!existing) {
      throw new VaultCliError(
        'ASSISTANT_SESSION_NOT_FOUND',
        `Assistant session "${input.sessionId}" was not found.`,
      )
    }

    const updated = await persistResolvedSession(paths, existing, {
      alias: manualAlias,
      bindingPatch,
    })
    return {
      created: false,
      paths,
      session: updated,
    }
  }

  const indexes = await readAssistantIndexStore(paths)

  if (manualAlias) {
    const sessionId = indexes.aliases[manualAlias]
    if (sessionId) {
      const existing = await readAssistantSession({ paths, sessionId })
      if (existing) {
        const updated = await persistResolvedSession(paths, existing, {
          alias: manualAlias,
          bindingPatch,
        })
        return {
          created: false,
          paths,
          session: updated,
        }
      }
    }
  }

  if (conversationKey) {
    const sessionId = indexes.conversationKeys[conversationKey]
    if (sessionId) {
      const existing = await readAssistantSession({ paths, sessionId })
      if (existing) {
        const updated = await persistResolvedSession(paths, existing, {
          alias: manualAlias,
          bindingPatch,
        })
        return {
          created: false,
          paths,
          session: updated,
        }
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
    lastUserMessage: null,
    lastAssistantMessage: null,
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
  await mkdir(paths.sessionsDirectory, {
    recursive: true,
  })
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
    const parsed = JSON.parse(raw) as unknown
    const current = assistantSessionSchema.safeParse(parsed)
    if (current.success) {
      return current.data
    }

    const legacy = parseLegacyAssistantSession(parsed)
    if (!legacy) {
      throw current.error
    }

    await writeAssistantSession(input.paths, legacy)
    await synchronizeAssistantIndexes(input.paths, legacy, null)
    return legacy
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

  try {
    const raw = await readFile(paths.legacyAliasesPath, 'utf8')
    const parsed = parseLegacyAliasStore(JSON.parse(raw) as unknown)
    if (parsed) {
      const migrated = assistantAliasStoreSchema.parse({
        version: ASSISTANT_INDEX_STORE_VERSION,
        aliases: parsed.aliases,
        conversationKeys: {},
      })
      await writeJsonFileAtomic(paths.indexesPath, migrated)
      return migrated
    }
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

function parseLegacyAssistantSession(value: unknown): AssistantSession | null {
  const parsed = parseLegacySessionJson(value)
  if (!parsed) {
    return null
  }

  return assistantSessionSchema.parse({
    schema: ASSISTANT_STATE_SCHEMA,
    sessionId: parsed.sessionId,
    provider: parsed.provider,
    providerSessionId: parsed.providerSessionId,
    providerOptions: parsed.providerOptions,
    alias: parsed.alias,
    binding: createAssistantBinding({
      channel: parsed.channel,
      identityId: parsed.identityId,
      actorId: parsed.participantId,
      threadId: parsed.sourceThreadId,
    }),
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    lastTurnAt: parsed.lastTurnAt,
    turnCount: parsed.turnCount,
    lastUserMessage: parsed.lastUserMessage,
    lastAssistantMessage: parsed.lastAssistantMessage,
  })
}

function parseLegacySessionJson(
  value: unknown,
): {
  alias: string | null
  channel: string | null
  createdAt: string
  identityId: string | null
  lastAssistantMessage: string | null
  lastTurnAt: string | null
  lastUserMessage: string | null
  participantId: string | null
  provider: AssistantChatProvider
  providerOptions: AssistantProviderSessionOptions
  providerSessionId: string | null
  schema: typeof LEGACY_ASSISTANT_STATE_SCHEMA
  sessionId: string
  sourceThreadId: string | null
  turnCount: number
  updatedAt: string
} | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  if (candidate.schema !== LEGACY_ASSISTANT_STATE_SCHEMA) {
    return null
  }

  return {
    schema: LEGACY_ASSISTANT_STATE_SCHEMA,
    sessionId: normalizeLegacyString(candidate.sessionId) ?? '',
    provider: (normalizeLegacyString(candidate.provider) ??
      'codex-cli') as AssistantChatProvider,
    providerSessionId: normalizeLegacyString(candidate.providerSessionId),
    providerOptions: assistantProviderSessionOptionsSchema.parse(
      candidate.providerOptions ?? {
        model: null,
        sandbox: null,
        approvalPolicy: null,
        profile: null,
        oss: false,
      },
    ),
    alias: normalizeLegacyString(candidate.alias),
    channel: normalizeLegacyString(candidate.channel),
    identityId: normalizeLegacyString(candidate.identityId),
    participantId: normalizeLegacyString(candidate.participantId),
    sourceThreadId: normalizeLegacyString(candidate.sourceThreadId),
    createdAt: String(candidate.createdAt),
    updatedAt: String(candidate.updatedAt),
    lastTurnAt: normalizeLegacyString(candidate.lastTurnAt),
    turnCount: Number(candidate.turnCount ?? 0),
    lastUserMessage:
      typeof candidate.lastUserMessage === 'string'
        ? candidate.lastUserMessage
        : null,
    lastAssistantMessage:
      typeof candidate.lastAssistantMessage === 'string'
        ? candidate.lastAssistantMessage
        : null,
  }
}

function parseLegacyAliasStore(value: unknown): { aliases: Record<string, string> } | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1) {
    return null
  }

  const aliases = candidate.aliases
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    return null
  }

  return {
    aliases: Object.fromEntries(
      Object.entries(aliases).filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
    ),
  }
}

function normalizeProviderOptions(input: {
  approvalPolicy?: AssistantApprovalPolicy | null
  model?: string | null
  oss?: boolean
  profile?: string | null
  sandbox?: AssistantSandbox | null
}): AssistantProviderSessionOptions {
  return assistantProviderSessionOptionsSchema.parse({
    model: normalizeNullableString(input.model),
    sandbox: input.sandbox ?? null,
    approvalPolicy: input.approvalPolicy ?? null,
    profile: normalizeNullableString(input.profile),
    oss: input.oss ?? false,
  })
}

function normalizeLegacyString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}

function hashVaultRoot(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}
