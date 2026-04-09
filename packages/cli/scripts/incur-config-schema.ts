import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)

export const packageDir = fileURLToPath(new URL('../', import.meta.url))
const repoDir = fileURLToPath(new URL('../../../', import.meta.url))
const distEntryPath = path.join(packageDir, 'dist', 'index.js')
const incurBinPath = path.join(packageDir, 'node_modules', 'incur', 'dist', 'bin.js')

export const configSchemaPath = path.join(packageDir, 'config.schema.json')
export const incurGeneratedTypesPath = path.join(packageDir, 'src', 'incur.generated.ts')

interface JsonSchemaNode {
  type?: string
  properties?: Record<string, JsonSchemaNode>
  additionalProperties?: boolean
  description?: string
  [key: string]: unknown
}

interface CommandMetadataNode {
  description?: string
  hint?: string
  examples?: unknown[]
  canonicalCommand?: string
  commands?: Record<string, CommandMetadataNode>
}

interface LoadedCliGenerationContext {
  cli: {
    description?: string
  }
  fromCli(cli: object): JsonSchemaNode
  commands: Map<string, Record<string, unknown>> | undefined
}

interface GeneratedIncurOutputs {
  configSchema: string
  types: string
}

interface IncurGenerationOptions {
  rebuildCli?: boolean
}

interface GeneratedIncurArtifacts {
  generatedTypesPath: string
  generatedConfigSchemaPath: string
}

const rootCommandAliases = new Map<string, string>([
  ['chat', 'assistant chat'],
  ['run', 'assistant run'],
  ['status', 'assistant status'],
  ['doctor', 'assistant doctor'],
  ['stop', 'assistant stop'],
])

const customSchemaMetadataKeys = [
  'x-incur-hint',
  'x-incur-examples',
  'x-incur-canonical-command',
] as const

export async function generateIncurConfigSchema(
  options: IncurGenerationOptions = {},
): Promise<string> {
  return (await generateIncurArtifacts(options)).configSchema
}

export async function generateIncurTypes(
  options: IncurGenerationOptions = {},
): Promise<string> {
  return (await generateIncurArtifacts(options)).types
}

export async function generateIncurArtifacts(
  options: IncurGenerationOptions = {},
): Promise<GeneratedIncurOutputs> {
  return withGeneratedIncurArtifacts(options, async ({
    generatedConfigSchemaPath,
    generatedTypesPath,
  }) => {
    const { cli, commands, fromCli } = await loadCliGenerationContext()
    const generatedConfigSchema = JSON.parse(
      await readFile(generatedConfigSchemaPath, 'utf8'),
    ) as JsonSchemaNode
    const generatedSchema = fromCli(cli)
    assertMatchingRawConfigSchema(generatedSchema, generatedConfigSchema)

    return {
      configSchema:
        JSON.stringify(
          buildEnrichedConfigSchema(generatedSchema, cli, commands),
          null,
          2,
        ) + '\n',
      types: await readFile(generatedTypesPath, 'utf8'),
    }
  })
}

async function withGeneratedIncurArtifacts<T>(
  options: IncurGenerationOptions,
  run: (artifacts: GeneratedIncurArtifacts) => Promise<T>,
): Promise<T> {
  if (!existsSync(incurBinPath)) {
    throw new Error(
      'Missing local incur binary. Run pnpm install --frozen-lockfile before generating the CLI config schema.',
    )
  }

  if ((options.rebuildCli ?? true) || !existsSync(distEntryPath)) {
    await execFileAsync('pnpm', ['build'], {
      cwd: packageDir,
      env: process.env,
    })
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'murph-incur-gen-'))

  try {
    const generatedTypesPath = path.join(tempDir, 'incur.generated.ts')
    const generatedConfigSchemaPath = path.join(tempDir, 'config.schema.json')

    await execFileAsync(
      process.execPath,
      [
        incurBinPath,
        'gen',
        '--dir',
        repoDir,
        '--entry',
        distEntryPath,
        '--output',
        generatedTypesPath,
      ],
      {
        cwd: packageDir,
        env: {
          ...process.env,
          NODE_NO_WARNINGS: '1',
        },
      },
    )
    return await run({
      generatedTypesPath,
      generatedConfigSchemaPath,
    })
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function loadCliGenerationContext(): Promise<LoadedCliGenerationContext> {
  const {
    default: cli,
  } = (await import(pathToFileURL(distEntryPath).href)) as {
    default: object
  }
  const { fromCli } = await import(
    pathToFileURL(
      path.join(packageDir, 'node_modules', 'incur', 'dist', 'internal', 'configSchema.js'),
    ).href
  ) as {
    fromCli(cli: object): JsonSchemaNode
  }
  const { toCommands } = await import(
    pathToFileURL(path.join(packageDir, 'node_modules', 'incur', 'dist', 'Cli.js')).href
  ) as {
    toCommands: WeakMap<object, Map<string, Record<string, unknown>>>
  }

  return {
    cli: cli as LoadedCliGenerationContext['cli'],
    commands: toCommands.get(cli),
    fromCli,
  }
}

function assertMatchingRawConfigSchema(
  generatedSchema: JsonSchemaNode,
  generatedConfigSchema: JsonSchemaNode,
): void {
  if (
    JSON.stringify(stripCustomSchemaMetadata(generatedSchema)) !==
    JSON.stringify(stripCustomSchemaMetadata(generatedConfigSchema))
  ) {
    throw new Error(
      'Generated config schema shape drifted from the installed Incur generator. Refresh this script before writing package config schema output.',
    )
  }
}

function buildEnrichedConfigSchema(
  generatedSchema: JsonSchemaNode,
  cli: LoadedCliGenerationContext['cli'],
  commands: LoadedCliGenerationContext['commands'],
): JsonSchemaNode {
  const enrichedSchema = JSON.parse(JSON.stringify(generatedSchema)) as JsonSchemaNode
  const rootDescription = readOptionalNonEmptyString(cli.description)

  if (rootDescription) {
    enrichedSchema.description = rootDescription
  }

  enrichSchemaNode(
    enrichedSchema,
    {
      commands: buildCommandMetadataTree(commands, []),
    },
  )

  return enrichedSchema
}

function buildCommandMetadataTree(
  commands: Map<string, Record<string, unknown>> | undefined,
  pathSegments: string[],
): Record<string, CommandMetadataNode> {
  const commandsMetadata: Record<string, CommandMetadataNode> = {}

  for (const [name, entry] of commands ?? []) {
    const nextPathSegments = [...pathSegments, name]
    const metadata = readCommandMetadata(entry, nextPathSegments)

    if ('_group' in entry && entry._group && entry.commands instanceof Map) {
      metadata.commands = buildCommandMetadataTree(
        entry.commands as Map<string, Record<string, unknown>>,
        nextPathSegments,
      )
    }

    commandsMetadata[name] = metadata
  }

  return commandsMetadata
}

function readCommandMetadata(
  entry: Record<string, unknown>,
  pathSegments: string[],
): CommandMetadataNode {
  const metadata: CommandMetadataNode = {}
  const description = readOptionalNonEmptyString(entry.description)
  const hint = readOptionalNonEmptyString(entry.hint)
  const examples = readExamples(entry.examples)
  const canonicalCommand = rootCommandAliases.get(pathSegments.join(' '))

  if (description) {
    metadata.description = description
  }

  if (hint) {
    metadata.hint = hint
  }

  if (examples) {
    metadata.examples = examples
  }

  if (canonicalCommand) {
    metadata.canonicalCommand = canonicalCommand
  }

  return metadata
}

function readOptionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined
}

function readExamples(value: unknown): unknown[] | undefined {
  return Array.isArray(value) && value.length > 0
    ? value
    : undefined
}

function enrichSchemaNode(
  schemaNode: JsonSchemaNode,
  metadataNode: CommandMetadataNode | undefined,
): void {
  if (!metadataNode) {
    return
  }

  if (metadataNode.description) {
    schemaNode.description = metadataNode.description
  }

  if (metadataNode.hint) {
    schemaNode['x-incur-hint'] = metadataNode.hint
  }

  if (metadataNode.examples) {
    schemaNode['x-incur-examples'] = metadataNode.examples
  }

  if (metadataNode.canonicalCommand) {
    schemaNode['x-incur-canonical-command'] = metadataNode.canonicalCommand
  }

  const schemaCommandNodes = schemaNode.properties?.commands?.properties
  const metadataCommandNodes = metadataNode.commands

  if (!schemaCommandNodes || !metadataCommandNodes) {
    return
  }

  for (const [name, childSchemaNode] of Object.entries(schemaCommandNodes)) {
    enrichSchemaNode(childSchemaNode, metadataCommandNodes[name])
  }
}

function stripCustomSchemaMetadata(schemaNode: JsonSchemaNode): JsonSchemaNode {
  const clone = JSON.parse(JSON.stringify(schemaNode)) as JsonSchemaNode
  for (const metadataKey of customSchemaMetadataKeys) {
    delete clone[metadataKey]
  }

  if (clone.properties) {
    for (const [name, child] of Object.entries(clone.properties)) {
      clone.properties[name] = stripCustomSchemaMetadata(child)
    }
  }

  return clone
}
