import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readAssistantCliLlmsManifest,
  type AssistantCliLlmsManifest,
  type AssistantCliLlmsManifestCommand,
  type AssistantCliLlmsManifestSchemaNode,
  buildAssistantCliProcessEnv,
} from './cli-surface-manifest.js'
import { ensureAssistantStateDirectory, isMissingFileError, writeJsonFileAtomic } from './shared.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { resolveAssistantStateDocumentPath } from './state.js'

const assistantCliSurfaceBootstrapSchemaVersion =
  'murph.assistant-cli-surface-bootstrap.v4'
export const assistantCliSurfacePrebuiltSchemaVersion =
  'murph.assistant-cli-surface-prebuilt.v2'
const assistantCliSurfaceBootstrapRenderPolicyVersion =
  'murph.assistant-cli-surface-render-policy.v1'
const assistantCliSurfaceBootstrapContractCharBudget = 40_000
const assistantCliSurfaceBootstrapDetailedModeCommandLimit = 120
export const assistantCliSurfacePrebuiltArtifactFileName =
  'cli-surface-contract.generated.json'
const assistantCliSurfaceBootstrapIgnoredOptionNames = new Set([
  'requestId',
  'vault',
])
const assistantCliSurfaceBootstrapIgnoredCommandFamilies = new Set([
  'age',
])
const assistantCliSurfaceBootstrapNameOnlyCommandFamilies = new Set([
  'audit',
  'document',
  'export',
  'family',
  'genetics',
  'inbox',
  'intake',
  'protocol',
  'provider',
  'query',
  'recipe',
  'samples',
  'scheduled-log',
  'vault',
])
const assistantCliSurfaceBootstrapIgnoredCommandNames = new Set([
  'assistant ask',
  'assistant chat',
  'assistant deliver',
  'assistant doctor',
  'assistant onboarding reopen',
  'assistant onboarding status',
  'assistant run',
  'assistant self-target clear',
  'assistant self-target list',
  'assistant self-target set',
  'assistant self-target show',
  'assistant session list',
  'assistant session show',
  'assistant status',
  'assistant stop',
  'chat',
  'doctor',
  'inbox attachment decode',
  'inbox attachment inspect',
  'inbox attachment list',
  'inbox attachment parse',
  'inbox attachment reparse',
  'inbox attachment show',
  'inbox attachment show-status',
  'inbox attachment status',
  'inbox backfill',
  'inbox bootstrap',
  'inbox doctor',
  'inbox init',
  'inbox model bundle',
  'inbox parse',
  'inbox requeue',
  'inbox run',
  'inbox setup',
  'inbox source add',
  'inbox source list',
  'inbox source remove',
  'inbox status',
  'inbox stop',
  'model',
  'run',
  'status',
  'stop',
])

const cachedAssistantCliSurfaceContractPromises = new Map<
  string,
  Promise<AssistantCliSurfaceContractSnapshot | null>
>()
let cachedPrebuiltAssistantCliSurfaceContractPromise:
  | Promise<AssistantCliSurfaceContractSnapshot | null>
  | null = null

type AssistantCliSurfaceContractSnapshot = {
  contract: string
  manifestFingerprint: string
}

export type AssistantCliSurfacePrebuiltArtifact = {
  contract: string
  manifestFingerprint: string
  schemaVersion: typeof assistantCliSurfacePrebuiltSchemaVersion
}

export function buildAssistantCliSurfaceBootstrapDocId(sessionId: string): string {
  return `sessions/${sessionId}/cli-surface-bootstrap`
}

export async function resolveAssistantCliSurfaceBootstrapContext(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('./execution-context.js').AssistantExecutionContext | null
  sessionId: string
  vault: string
  workingDirectory?: string | null
}): Promise<string | null> {
  const prebuiltContract = await readPrebuiltAssistantCliSurfaceContract()
  if (prebuiltContract !== null) {
    return prebuiltContract.contract
  }

  const docId = buildAssistantCliSurfaceBootstrapDocId(input.sessionId)
  const stateDirectory = resolveAssistantStatePaths(input.vault).stateDirectory
  const documentPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    docId,
  )
  const persistedContract = await readPersistedAssistantCliSurfaceContract(documentPath)
  const contractSnapshot = await loadAssistantCliSurfaceContract({
    cliEnv: input.cliEnv,
    executionContext: input.executionContext,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  })
  if (!contractSnapshot) {
    return persistedContract?.contract ?? null
  }
  if (
    persistedContract !== null &&
    persistedContract.manifestFingerprint === contractSnapshot.manifestFingerprint
  ) {
    return persistedContract.contract
  }

  await ensureAssistantStateDirectory(path.dirname(documentPath))
  await writeJsonFileAtomic(documentPath, {
    contract: contractSnapshot.contract,
    generatedAt: new Date().toISOString(),
    manifestFingerprint: contractSnapshot.manifestFingerprint,
    schemaVersion: assistantCliSurfaceBootstrapSchemaVersion,
  })

  return contractSnapshot.contract
}

export async function readAssistantCliSurfaceBootstrapContext(input: {
  sessionId: string
  vault: string
}): Promise<string | null> {
  const prebuiltContract = await readPrebuiltAssistantCliSurfaceContract()
  if (prebuiltContract !== null) {
    return prebuiltContract.contract
  }

  return await readPersistedAssistantCliSurfaceBootstrapContext(input)
}

export async function readPrebuiltAssistantCliSurfaceContract(input: {
  artifactPath?: string | null
} = {}): Promise<AssistantCliSurfaceContractSnapshot | null> {
  if (input.artifactPath) {
    return await readPrebuiltAssistantCliSurfaceContractFromPath(input.artifactPath)
  }

  if (cachedPrebuiltAssistantCliSurfaceContractPromise !== null) {
    return await cachedPrebuiltAssistantCliSurfaceContractPromise
  }

  const prebuiltArtifactPath = resolveAssistantCliSurfacePrebuiltArtifactPath()
  cachedPrebuiltAssistantCliSurfaceContractPromise =
    readPrebuiltAssistantCliSurfaceContractFromPath(prebuiltArtifactPath)

  try {
    const contract = await cachedPrebuiltAssistantCliSurfaceContractPromise
    if (contract === null) {
      cachedPrebuiltAssistantCliSurfaceContractPromise = null
    }

    return contract
  } catch (error) {
    cachedPrebuiltAssistantCliSurfaceContractPromise = null
    throw error
  }
}

export async function readPersistedAssistantCliSurfaceBootstrapContext(input: {
  sessionId: string
  vault: string
}): Promise<string | null> {
  const docId = buildAssistantCliSurfaceBootstrapDocId(input.sessionId)
  const stateDirectory = resolveAssistantStatePaths(input.vault).stateDirectory
  const documentPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    docId,
  )

  return (await readPersistedAssistantCliSurfaceContract(documentPath))?.contract ?? null
}

export function buildAssistantCliSurfaceContract(
  manifest: AssistantCliLlmsManifest,
): string | null {
  const commands = normalizeAssistantCliManifestCommands(manifest)
  if (commands.length === 0) {
    return null
  }

  const fallbackModes: readonly AssistantCliContractRenderMode[] =
    commands.length > assistantCliSurfaceBootstrapDetailedModeCommandLimit
      ? ['description-only']
      : ['required-only', 'description-only']

  for (const mode of fallbackModes) {
    const contract = renderAssistantCliSurfaceContract(commands, mode)
    if (contract.length <= assistantCliSurfaceBootstrapContractCharBudget) {
      return contract
    }
  }

  const minimalContract = renderAssistantCliSurfaceContract(
    commands,
    'description-only',
  )
  return minimalContract.slice(0, assistantCliSurfaceBootstrapContractCharBudget).trimEnd()
}

async function readPersistedAssistantCliSurfaceContract(
  documentPath: string,
): Promise<{
  contract: string
  manifestFingerprint: string
} | null> {
  try {
    const raw = await readFile(documentPath, 'utf8')
    const value = JSON.parse(raw) as Record<string, unknown>
    const contract = value.contract
    const manifestFingerprint = value.manifestFingerprint
    if (
      value.schemaVersion !== assistantCliSurfaceBootstrapSchemaVersion ||
      typeof contract !== 'string' ||
      typeof manifestFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(manifestFingerprint) ||
      value.sourceDetail !== undefined
    ) {
      return null
    }

    const normalizedContract = contract.trim()
    if (
      normalizedContract.length === 0 ||
      normalizedContract.length > assistantCliSurfaceBootstrapContractCharBudget ||
      !normalizedContract.startsWith('Murph CLI Contract:')
    ) {
      return null
    }

    return {
      contract: normalizedContract,
      manifestFingerprint,
    }
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
}

async function readPrebuiltAssistantCliSurfaceContractFromPath(
  artifactPath: string,
): Promise<AssistantCliSurfaceContractSnapshot | null> {
  try {
    const raw = await readFile(artifactPath, 'utf8')
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      throw createInvalidAssistantCliSurfacePrebuiltArtifactError(error)
    }
    if (!value || typeof value !== 'object') {
      throw createInvalidAssistantCliSurfacePrebuiltArtifactError()
    }
    const parsed = parseAssistantCliSurfacePrebuiltArtifact(
      value as Record<string, unknown>,
    )
    if (parsed === null) {
      throw createInvalidAssistantCliSurfacePrebuiltArtifactError()
    }

    return parsed
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

function parseAssistantCliSurfacePrebuiltArtifact(
  value: Record<string, unknown>,
): AssistantCliSurfaceContractSnapshot | null {
  const contract = value.contract
  const manifestFingerprint = value.manifestFingerprint
  if (
    value.schemaVersion !== assistantCliSurfacePrebuiltSchemaVersion ||
    typeof contract !== 'string' ||
    typeof manifestFingerprint !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(manifestFingerprint) ||
    value.sourceDetail !== undefined
  ) {
    return null
  }

  const normalizedContract = contract.trim()
  if (
    normalizedContract.length === 0 ||
    normalizedContract.length > assistantCliSurfaceBootstrapContractCharBudget ||
    !normalizedContract.startsWith('Murph CLI Contract:')
  ) {
    return null
  }

  return {
    contract: normalizedContract,
    manifestFingerprint,
  }
}

function createInvalidAssistantCliSurfacePrebuiltArtifactError(
  cause?: unknown,
): Error {
  return new Error('Generated assistant CLI surface contract artifact is invalid.', {
    cause,
  })
}

function resolveAssistantCliSurfacePrebuiltArtifactPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    assistantCliSurfacePrebuiltArtifactFileName,
  )
}

async function loadAssistantCliSurfaceContract(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('./execution-context.js').AssistantExecutionContext | null
  vault: string
  workingDirectory?: string | null
}): Promise<AssistantCliSurfaceContractSnapshot | null> {
  const cacheKey = createAssistantCliSurfaceContractCacheKey(input)
  let cachedAssistantCliSurfaceContractPromise =
    cachedAssistantCliSurfaceContractPromises.get(cacheKey) ?? null
  if (cachedAssistantCliSurfaceContractPromise === null) {
    cachedAssistantCliSurfaceContractPromise =
      generateAssistantCliSurfaceContract(input)
    cachedAssistantCliSurfaceContractPromises.set(
      cacheKey,
      cachedAssistantCliSurfaceContractPromise,
    )
  }

  try {
    const contract = await cachedAssistantCliSurfaceContractPromise
    cachedAssistantCliSurfaceContractPromises.delete(cacheKey)

    return contract
  } catch {
    cachedAssistantCliSurfaceContractPromises.delete(cacheKey)
    return null
  }
}

function createAssistantCliSurfaceContractCacheKey(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('./execution-context.js').AssistantExecutionContext | null
  vault: string
  workingDirectory?: string | null
}): string {
  return JSON.stringify({
    cliEnvHash: hashAssistantCliSurfaceEnv(input.cliEnv),
    executionContext: input.executionContext ?? null,
    vault: input.vault,
    workingDirectory: input.workingDirectory ?? null,
  })
}

function hashAssistantCliSurfaceEnv(env: NodeJS.ProcessEnv | undefined): string {
  const effectiveEnv = buildAssistantCliProcessEnv({
    cliEnv: env,
  })
  const hash = createHash('sha256')
  for (const key of Object.keys(effectiveEnv).sort()) {
    hash.update(key)
    hash.update('\0')
    hash.update(effectiveEnv[key] ?? '')
    hash.update('\0')
  }

  return hash.digest('hex')
}

async function generateAssistantCliSurfaceContract(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('./execution-context.js').AssistantExecutionContext | null
  vault: string
  workingDirectory?: string | null
}): Promise<AssistantCliSurfaceContractSnapshot | null> {
  const manifest = await readAssistantCliLlmsManifest({
    cliEnv: input.cliEnv,
    executionContext: input.executionContext,
    workingDirectory: input.workingDirectory,
  })
  const contract = buildAssistantCliSurfaceContract(manifest)
  return contract
    ? {
        contract,
        manifestFingerprint: hashAssistantCliSurfaceManifest(manifest),
      }
    : null
}

export function hashAssistantCliSurfaceManifest(
  manifest: AssistantCliLlmsManifest,
): string {
  return createHash('sha256')
    .update(assistantCliSurfaceBootstrapRenderPolicyVersion)
    .update('\0')
    .update(JSON.stringify(manifest))
    .digest('hex')
}

function normalizeAssistantCliManifestCommands(
  manifest: AssistantCliLlmsManifest,
): AssistantCliLlmsManifestCommand[] {
  const seenCommandNames = new Set<string>()
  const commands: AssistantCliLlmsManifestCommand[] = []

  for (const command of manifest.commands) {
    const name = command.name.trim()
    if (
      name.length === 0 ||
      seenCommandNames.has(name) ||
      assistantCliSurfaceBootstrapIgnoredCommandFamilies.has(
        readAssistantCliCommandFamily(name),
      ) ||
      assistantCliSurfaceBootstrapIgnoredCommandNames.has(name)
    ) {
      continue
    }

    seenCommandNames.add(name)
    commands.push({
      ...command,
      description:
        typeof command.description === 'string' && command.description.trim().length > 0
          ? command.description.trim()
          : undefined,
      name,
    })
  }

  return commands
}

type AssistantCliContractRenderMode =
  | 'description-only'
  | 'required-only'

type AssistantCliContractCommandLineMode =
  | AssistantCliContractRenderMode
  | 'name-only'

type AssistantCliCommandGroup = {
  commands: AssistantCliLlmsManifestCommand[]
  family: string
}

function renderAssistantCliSurfaceContract(
  commands: readonly AssistantCliLlmsManifestCommand[],
  mode: AssistantCliContractRenderMode,
): string {
  const groupedCommands = groupAssistantCliManifestCommands(commands)
  const lines = [
    'Murph CLI Contract:',
    'Use `vault-cli` directly from the current runtime process. Command names below are the tokens after `vault-cli`.',
    'This block is compiled automatically from `vault-cli --llms --format json`.',
    'Use this contract first. Only fall back to `--schema --format json` or `--help` when a needed detail is missing here.',
    'Bare command-name entries are low-frequency routes; inspect `vault-cli <command> --schema --format json` or `vault-cli <command> --help` before executing one.',
  ]

  for (const group of groupedCommands) {
    lines.push('')
    lines.push(`${group.family}:`)
    for (const command of group.commands) {
      lines.push(
        renderAssistantCliContractCommandLine(
          command,
          readAssistantCliContractCommandLineMode(command, mode),
        ),
      )
    }
  }

  return lines.join('\n')
}

function groupAssistantCliManifestCommands(
  commands: readonly AssistantCliLlmsManifestCommand[],
): AssistantCliCommandGroup[] {
  const groups = new Map<string, AssistantCliLlmsManifestCommand[]>()

  for (const command of commands) {
    const family = readAssistantCliCommandFamily(command.name)
    const entries = groups.get(family) ?? []
    entries.push(command)
    groups.set(family, entries)
  }

  return [...groups.entries()].map(([family, groupedCommands]) => ({
    commands: groupedCommands,
    family,
  }))
}

function readAssistantCliCommandFamily(commandName: string): string {
  const separatorIndex = commandName.indexOf(' ')
  return separatorIndex === -1 ? 'root' : commandName.slice(0, separatorIndex)
}

function renderAssistantCliContractCommandLine(
  command: AssistantCliLlmsManifestCommand,
  mode: AssistantCliContractCommandLineMode,
): string {
  const normalizedDescription =
    mode === 'name-only' ? '' : truncateAssistantCliText(command.description ?? '', 220)
  const parts = [`- \`${command.name}\`${normalizedDescription ? `: ${normalizedDescription}` : ''}`]
  const argsSchema = command.schema?.args
  const optionsSchema = command.schema?.options
  const requiredArgs = readAssistantCliRequiredSchemaPropertyNames(argsSchema).map(
    (name) => `<${name}>`,
  )
  const requiredOptions = readAssistantCliRequiredSchemaPropertyNames(optionsSchema)
    .filter((name) => !assistantCliSurfaceBootstrapIgnoredOptionNames.has(name))
    .map((name) => renderAssistantCliOptionSignature(name, optionsSchema?.properties?.[name]))

  if (mode === 'required-only') {
    if (requiredArgs.length > 0) {
      parts.push(`args ${requiredArgs.join(' ')}`)
    }

    if (requiredOptions.length > 0) {
      parts.push(`required ${requiredOptions.join(', ')}`)
    }
  }

  return `${parts.join('; ')}.`
}

function readAssistantCliContractCommandLineMode(
  command: AssistantCliLlmsManifestCommand,
  mode: AssistantCliContractRenderMode,
): AssistantCliContractCommandLineMode {
  return assistantCliSurfaceBootstrapNameOnlyCommandFamilies.has(
    readAssistantCliCommandFamily(command.name),
  )
    ? 'name-only'
    : mode
}

function readAssistantCliRequiredSchemaPropertyNames(
  schema: AssistantCliLlmsManifestSchemaNode | undefined,
): string[] {
  const requiredNames = new Set(schema?.required ?? [])
  const propertyNames = Object.keys(schema?.properties ?? {})

  return propertyNames.filter((name) => requiredNames.has(name))
}

function renderAssistantCliOptionSignature(
  optionName: string,
  schema: AssistantCliLlmsManifestSchemaNode | undefined,
): string {
  const suffix = renderAssistantCliOptionValueSuffix(schema)
  return `--${optionName}${suffix}`
}

function renderAssistantCliOptionValueSuffix(
  schema: AssistantCliLlmsManifestSchemaNode | undefined,
): string {
  if (!schema) {
    return ''
  }

  if (schema.type === 'boolean') {
    return ''
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const renderedValues =
      schema.enum.length <= 6
        ? schema.enum.join('|')
        : `${schema.enum.slice(0, 6).join('|')}...`
    return `=${renderedValues}`
  }

  if (schema.type === 'array') {
    return '=list'
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    return `=${schema.type}`
  }

  if (schema.type === 'string') {
    return '=string'
  }

  return ''
}

function truncateAssistantCliText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}
