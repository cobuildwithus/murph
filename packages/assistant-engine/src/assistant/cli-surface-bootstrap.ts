import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  readAssistantCliLlmsManifest,
  type AssistantCliLlmsManifest,
  type AssistantCliLlmsManifestCommand,
  type AssistantCliLlmsManifestSchemaNode,
} from '../assistant-cli-tools.js'
import { ensureAssistantStateDirectory, isMissingFileError, writeJsonFileAtomic } from './shared.js'
import { resolveAssistantStatePaths } from './store/paths.js'
import { resolveAssistantStateDocumentPath } from './state.js'

const assistantCliSurfaceBootstrapSchemaVersion =
  'murph.assistant-cli-surface-bootstrap.v2'
const assistantCliSurfaceBootstrapContractCharBudget = 40_000
const assistantCliSurfaceBootstrapFamilyIndexEntryLimit = 8
const assistantCliSurfaceBootstrapOptionalOptionLimit = 4
const assistantCliSurfaceBootstrapIgnoredOptionNames = new Set([
  'requestId',
  'vault',
])

let cachedAssistantCliSurfaceContractPromise: Promise<string | null> | null = null

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
  const docId = buildAssistantCliSurfaceBootstrapDocId(input.sessionId)
  const stateDirectory = resolveAssistantStatePaths(input.vault).stateDirectory
  const documentPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    docId,
  )
  const persistedContract = await readPersistedAssistantCliSurfaceContract(documentPath)
  if (persistedContract !== null) {
    return persistedContract
  }

  const contract = await loadAssistantCliSurfaceContract({
    cliEnv: input.cliEnv,
    executionContext: input.executionContext,
    vault: input.vault,
    workingDirectory: input.workingDirectory,
  })
  if (!contract) {
    return null
  }

  await ensureAssistantStateDirectory(path.dirname(documentPath))
  await writeJsonFileAtomic(documentPath, {
    contract,
    generatedAt: new Date().toISOString(),
    schemaVersion: assistantCliSurfaceBootstrapSchemaVersion,
  })

  return contract
}

export function buildAssistantCliSurfaceContract(
  manifest: AssistantCliLlmsManifest,
  input?: {
    sourceDetail?: 'compact' | 'full'
  },
): string | null {
  const commands = normalizeAssistantCliManifestCommands(manifest)
  if (commands.length === 0) {
    return null
  }
  const sourceDetail = input?.sourceDetail ?? 'full'

  const fallbackModes: readonly AssistantCliContractRenderMode[] = [
    'with-common-options',
    'required-only',
    'description-only',
  ]

  for (const mode of fallbackModes) {
    const contract = renderAssistantCliSurfaceContract(commands, mode, sourceDetail)
    if (contract.length <= assistantCliSurfaceBootstrapContractCharBudget) {
      return contract
    }
  }

  const minimalContract = renderAssistantCliSurfaceContract(
    commands,
    'description-only',
    sourceDetail,
  )
  return minimalContract.slice(0, assistantCliSurfaceBootstrapContractCharBudget).trimEnd()
}

async function readPersistedAssistantCliSurfaceContract(
  documentPath: string,
): Promise<string | null> {
  try {
    const raw = await readFile(documentPath, 'utf8')
    const value = JSON.parse(raw) as Record<string, unknown>
    const contract = value.contract
    if (typeof contract === 'string' && contract.trim().length > 0) {
      return contract.trim()
    }

    const summary = value.summary
    return typeof summary === 'string' && summary.trim().length > 0 ? summary.trim() : null
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    return null
  }
}

async function loadAssistantCliSurfaceContract(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('./execution-context.js').AssistantExecutionContext | null
  vault: string
  workingDirectory?: string | null
}): Promise<string | null> {
  if (cachedAssistantCliSurfaceContractPromise === null) {
    cachedAssistantCliSurfaceContractPromise = generateAssistantCliSurfaceContract(input)
  }

  try {
    const contract = await cachedAssistantCliSurfaceContractPromise
    if (contract === null) {
      cachedAssistantCliSurfaceContractPromise = null
    }

    return contract
  } catch {
    cachedAssistantCliSurfaceContractPromise = null
    return null
  }
}

async function generateAssistantCliSurfaceContract(input: {
  cliEnv?: NodeJS.ProcessEnv
  executionContext?: import('./execution-context.js').AssistantExecutionContext | null
  vault: string
  workingDirectory?: string | null
}): Promise<string | null> {
  try {
    const manifest = await readAssistantCliLlmsManifest({
      cliEnv: input.cliEnv,
      detail: 'full',
      executionContext: input.executionContext,
      vault: input.vault,
      workingDirectory: input.workingDirectory,
    })
    return buildAssistantCliSurfaceContract(manifest, {
      sourceDetail: 'full',
    })
  } catch {
    const manifest = await readAssistantCliLlmsManifest({
      cliEnv: input.cliEnv,
      detail: 'compact',
      executionContext: input.executionContext,
      vault: input.vault,
      workingDirectory: input.workingDirectory,
    })
    return buildAssistantCliSurfaceContract(manifest, {
      sourceDetail: 'compact',
    })
  }
}

function normalizeAssistantCliManifestCommands(
  manifest: AssistantCliLlmsManifest,
): AssistantCliLlmsManifestCommand[] {
  const seenCommandNames = new Set<string>()
  const commands: AssistantCliLlmsManifestCommand[] = []

  for (const command of manifest.commands) {
    const name = command.name.trim()
    if (name.length === 0 || seenCommandNames.has(name)) {
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
  | 'with-common-options'

type AssistantCliCommandGroup = {
  commands: AssistantCliLlmsManifestCommand[]
  family: string
}

function renderAssistantCliSurfaceContract(
  commands: readonly AssistantCliLlmsManifestCommand[],
  mode: AssistantCliContractRenderMode,
  sourceDetail: 'compact' | 'full',
): string {
  const groupedCommands = groupAssistantCliManifestCommands(commands)
  const lines = [
    'Murph CLI Contract:',
    'Canonical executor: `murph.cli.run`. Pass only the tokens after `vault-cli`.',
    sourceDetail === 'full'
      ? 'This block is compiled automatically from `vault-cli --llms-full --format json` at session bootstrap.'
      : 'This block is compiled automatically from `vault-cli --llms --format json` at session bootstrap because the full manifest was unavailable.',
    'Use this contract first. Only fall back to `--schema --format json` or `--help` when a needed detail is missing here.',
    '',
    'Family Index:',
    ...buildAssistantCliFamilyIndexLines(groupedCommands),
  ]

  for (const group of groupedCommands) {
    lines.push('')
    lines.push(`${group.family}:`)
    for (const command of group.commands) {
      lines.push(renderAssistantCliContractCommandLine(command, mode))
    }
  }

  return lines.join('\n')
}

function buildAssistantCliFamilyIndexLines(
  groups: readonly AssistantCliCommandGroup[],
): string[] {
  return groups.map((group) => {
    const renderedLeafCommands = group.commands
      .map((command) => renderAssistantCliFamilyLeafCommandName(group.family, command.name))
      .slice(0, assistantCliSurfaceBootstrapFamilyIndexEntryLimit)
    const remainingCount = group.commands.length - renderedLeafCommands.length
    return `- ${group.family} (${group.commands.length}): ${renderedLeafCommands.join(', ')}${remainingCount > 0 ? ` +${remainingCount} more` : ''}`
  })
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

function renderAssistantCliFamilyLeafCommandName(
  family: string,
  commandName: string,
): string {
  if (family === 'root') {
    return commandName
  }

  return commandName === family ? family : commandName.slice(family.length + 1)
}

function renderAssistantCliContractCommandLine(
  command: AssistantCliLlmsManifestCommand,
  mode: AssistantCliContractRenderMode,
): string {
  const normalizedDescription = truncateAssistantCliText(command.description ?? '', 220)
  const parts = [`- \`${command.name}\`${normalizedDescription ? `: ${normalizedDescription}` : ''}`]
  const argsSchema = command.schema?.args
  const optionsSchema = command.schema?.options
  const requiredArgs = readAssistantCliRequiredSchemaPropertyNames(argsSchema).map(
    (name) => `<${name}>`,
  )
  const requiredOptions = readAssistantCliRequiredSchemaPropertyNames(optionsSchema)
    .filter((name) => !assistantCliSurfaceBootstrapIgnoredOptionNames.has(name))
    .map((name) => renderAssistantCliOptionSignature(name, optionsSchema?.properties?.[name]))
  const commonOptions =
    mode === 'with-common-options'
      ? readAssistantCliCommonOptionalOptionNames(optionsSchema).map((name) =>
          renderAssistantCliOptionSignature(name, optionsSchema?.properties?.[name]),
        )
      : []

  if (mode !== 'description-only') {
    if (requiredArgs.length > 0) {
      parts.push(`args ${requiredArgs.join(' ')}`)
    }

    if (requiredOptions.length > 0) {
      parts.push(`required ${requiredOptions.join(', ')}`)
    }
  }

  if (mode === 'with-common-options' && commonOptions.length > 0) {
    parts.push(`common ${commonOptions.join(', ')}`)
  }

  return `${parts.join('; ')}.`
}

function readAssistantCliRequiredSchemaPropertyNames(
  schema: AssistantCliLlmsManifestSchemaNode | undefined,
): string[] {
  const requiredNames = new Set(schema?.required ?? [])
  const propertyNames = Object.keys(schema?.properties ?? {})

  return propertyNames.filter((name) => requiredNames.has(name))
}

function readAssistantCliCommonOptionalOptionNames(
  schema: AssistantCliLlmsManifestSchemaNode | undefined,
): string[] {
  const requiredNames = new Set(schema?.required ?? [])
  const propertyEntries = Object.entries(schema?.properties ?? {})

  return propertyEntries
    .filter(([name]) => !assistantCliSurfaceBootstrapIgnoredOptionNames.has(name))
    .filter(([name]) => !requiredNames.has(name))
    .slice(0, assistantCliSurfaceBootstrapOptionalOptionLimit)
    .map(([name]) => name)
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

  return ''
}

function truncateAssistantCliText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}
