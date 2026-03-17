import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantAliasStoreSchema,
  assistantProviderSessionOptionsSchema,
  assistantSessionSchema,
  type AssistantAliasStore,
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
  type AssistantSession,
} from './assistant-cli-contracts.js'
import { VaultCliError } from './vault-cli-errors.js'

const ASSISTANT_STATE_DIRECTORY_NAME = 'assistant-state'
const ASSISTANT_ALIAS_STORE_VERSION = 1
const ASSISTANT_STATE_SCHEMA = 'healthybob.assistant-session.v1'

export interface AssistantStatePaths {
  absoluteVaultRoot: string
  assistantStateRoot: string
  sessionsDirectory: string
  aliasesPath: string
}

export interface AssistantSessionLocator {
  alias?: string | null
  channel?: string | null
  identityId?: string | null
  participantId?: string | null
  sessionId?: string | null
  sourceThreadId?: string | null
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
    sessionsDirectory: path.join(assistantStateRoot, 'sessions'),
    aliasesPath: path.join(assistantStateRoot, 'aliases.json'),
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

  const entries = [
    ['channel', normalizeNullableString(input.channel)],
    ['identity', normalizeNullableString(input.identityId)],
    ['participant', normalizeNullableString(input.participantId)],
    ['thread', normalizeNullableString(input.sourceThreadId)],
  ].filter((entry): entry is [string, string] => entry[1] !== null)

  if (entries.length === 0) {
    return null
  }

  return entries
    .map(([key, value]) => `${key}:${encodeURIComponent(value)}`)
    .join('|')
}

export async function resolveAssistantSession(
  input: ResolveAssistantSessionInput,
): Promise<ResolvedAssistantSession> {
  const paths = resolveAssistantStatePaths(input.vault)
  await ensureAssistantState(paths)

  const aliasKey = resolveAssistantAliasKey(input)

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

    const updated = await persistAliasIfNeeded(paths, existing, aliasKey)
    return {
      created: false,
      paths,
      session: updated,
    }
  }

  if (aliasKey) {
    const aliases = await readAssistantAliasStore(paths)
    const sessionId = aliases.aliases[aliasKey]
    if (sessionId) {
      const existing = await readAssistantSession({
        paths,
        sessionId,
      })
      if (existing) {
        return {
          created: false,
          paths,
          session: existing,
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
    alias: aliasKey,
    channel: normalizeNullableString(input.channel),
    identityId: normalizeNullableString(input.identityId),
    participantId: normalizeNullableString(input.participantId),
    sourceThreadId: normalizeNullableString(input.sourceThreadId),
    createdAt: now,
    updatedAt: now,
    lastTurnAt: null,
    turnCount: 0,
    lastUserMessage: null,
    lastAssistantMessage: null,
  })

  await writeAssistantSession(paths, session)
  if (aliasKey) {
    await upsertAssistantAlias(paths, aliasKey, session.sessionId)
  }

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

  const parsed = assistantSessionSchema.parse(session)
  await writeAssistantSession(paths, parsed)

  if (parsed.alias) {
    await upsertAssistantAlias(paths, parsed.alias, parsed.sessionId)
  }

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
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}

async function persistAliasIfNeeded(
  paths: AssistantStatePaths,
  session: AssistantSession,
  aliasKey: string | null,
): Promise<AssistantSession> {
  if (!aliasKey || aliasKey === session.alias) {
    return session
  }

  const updated = assistantSessionSchema.parse({
    ...session,
    alias: aliasKey,
    updatedAt: new Date().toISOString(),
  })
  await writeAssistantSession(paths, updated)
  await upsertAssistantAlias(paths, aliasKey, updated.sessionId)
  return updated
}

async function readAssistantAliasStore(
  paths: AssistantStatePaths,
): Promise<AssistantAliasStore> {
  try {
    const raw = await readFile(paths.aliasesPath, 'utf8')
    return assistantAliasStoreSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      const initial = assistantAliasStoreSchema.parse({
        version: ASSISTANT_ALIAS_STORE_VERSION,
        aliases: {},
      })
      await writeAssistantAliasStore(paths, initial)
      return initial
    }
    throw error
  }
}

async function writeAssistantAliasStore(
  paths: AssistantStatePaths,
  store: AssistantAliasStore,
): Promise<void> {
  await writeFile(paths.aliasesPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

async function upsertAssistantAlias(
  paths: AssistantStatePaths,
  aliasKey: string,
  sessionId: string,
): Promise<void> {
  const store = await readAssistantAliasStore(paths)
  if (store.aliases[aliasKey] === sessionId) {
    return
  }

  const updated = assistantAliasStoreSchema.parse({
    ...store,
    aliases: {
      ...store.aliases,
      [aliasKey]: sessionId,
    },
  })
  await writeAssistantAliasStore(paths, updated)
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

function createAssistantSessionId(): string {
  return `asst_${randomUUID().replace(/-/gu, '')}`
}

function hashVaultRoot(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveTimestamp(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT',
  )
}
