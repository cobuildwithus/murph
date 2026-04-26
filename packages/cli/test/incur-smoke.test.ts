import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { Cli, z } from 'incur'
import { initializeVault } from '@murphai/core'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { localParallelCliTest as test } from './local-parallel-test.js'
import {
  captureCommandDescriptions,
} from '../src/commands/capture.ts'
import {
  collectVaultCliDescriptorRootCommandNames,
  collectVaultCliDirectServiceBindings,
  vaultCliCommandDescriptors,
} from '../src/vault-cli-command-manifest.js'
import { createUnwiredCliVaultServices } from '../src/device-services.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { createVaultCli } from '../src/vault-cli.js'
import {
  binPath,
  commandOutputFromError,
  type CliEnvelope,
  requireData,
  runCli,
  runRawCli,
  withoutNodeV8Coverage,
} from './cli-test-helpers.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const packageJson = require('../package.json') as { version?: string }
const INCUR_HELP_TIMEOUT_MS = 45_000
const INCUR_SCHEMA_TIMEOUT_MS = 45_000

async function runBuiltCliFromCwd(
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  },
): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [binPath, ...args],
    {
      cwd: options.cwd,
      encoding: 'utf8',
      env: withoutNodeV8Coverage({
        ...process.env,
        ...options.env,
      }),
    },
  )

  return stdout.trim()
}

async function runBuiltJsonCliFromCwd<TData = Record<string, unknown>>(
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  },
): Promise<CliEnvelope<TData>> {
  try {
    const stdout = await runBuiltCliFromCwd(withMachineJsonOutput(args), options)
    return JSON.parse(stdout) as CliEnvelope<TData>
  } catch (error) {
    const output = commandOutputFromError(error)
    if (output !== null) {
      return JSON.parse(output) as CliEnvelope<TData>
    }

    throw error
  }
}

function withMachineJsonOutput(args: string[]): string[] {
  const nextArgs = [...args]

  if (!nextArgs.includes('--full-output')) {
    nextArgs.push('--full-output')
  }

  if (!nextArgs.includes('--json') && !nextArgs.includes('--format')) {
    nextArgs.push('--format', 'json')
  }

  return nextArgs
}

async function runSourceCliRaw(args: string[]): Promise<string> {
  const cli = createVaultCli()
  const output: string[] = []

  await cli.serve(args, {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

async function runJsonCli<TData>(
  cli: Cli.Cli,
  args: string[],
): Promise<{
  envelope: {
    ok: boolean
    data?: TData
    error?: {
      code?: string
      message?: string
      retryable?: boolean
    }
  }
  exitCode: number | null
}> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve([...args, '--format', 'json', '--full-output'], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    envelope: JSON.parse(output.join('').trim()) as {
      ok: boolean
      data?: TData
      error?: {
        code?: string
        message?: string
        retryable?: boolean
      }
    },
    exitCode,
  }
}

test('root help exposes the Incur built-ins', async () => {
  const help = await runRawCli(['--help'])

  assert.match(help, new RegExp(`vault-cli@${packageJson.version ?? '0.0.0'}`, 'u'))
  assert.match(help, /Integrations:/u)
  assert.match(help, /chat\s+Open the same interactive assistant chat UI as/u)
  assert.match(help, /commons\s+Read-only Health Commons commands/u)
  assert.match(help, /search\s+Search commands for the shared local query projection/u)
  assert.match(help, /timeline\s+Build a descending cross-record timeline/u)
  assert.match(help, /completions\s+Generate shell completion script/u)
  assert.match(help, /mcp add\s+Register as MCP server/u)
  assert.match(help, /skills\s+Sync skill files to agents \(add, list\)/u)
  assert.match(help, /--config/u)
  assert.match(help, /--no-config/u)
  assert.match(help, /--schema\s+Show JSON Schema for command/u)
  assert.match(help, /--full-output\s+Show full output envelope/u)
  assert.match(help, /--llms, --llms-full\s+Print LLM-readable manifest/u)
})

test('root config file can provide command option defaults', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-config-'))
  const homeRoot = path.join(tempRoot, 'home')
  const vaultRoot = path.join(tempRoot, 'configured-vault')
  const configPath = path.join(tempRoot, 'murph.json')
  const isolatedEnv = {
    HOME: homeRoot,
    VAULT: '',
  }

  try {
    await initializeVault({ vaultRoot })
    await writeFile(
      configPath,
      JSON.stringify({
        commands: {
          vault: {
            commands: {
              show: {
                options: {
                  vault: vaultRoot,
                },
              },
            },
          },
        },
      }),
    )

    const showResult = requireData(
      await runBuiltJsonCliFromCwd<{ vault: string }>(
        ['--config', configPath, 'vault', 'show'],
        {
          cwd: tempRoot,
          env: isolatedEnv,
        },
      ),
    )
    assert.equal(showResult.vault, vaultRoot)

    const withoutConfig = await runBuiltJsonCliFromCwd([
      '--config',
      configPath,
      '--no-config',
      'vault',
      'show',
    ], {
      cwd: tempRoot,
      env: isolatedEnv,
    })
    assert.equal(withoutConfig.ok, false)

    if (!withoutConfig.ok) {
      assert.match(
        withoutConfig.error.message ?? withoutConfig.error.code ?? '',
        /vault/u,
      )
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('root config autodiscovery resolves ~/.config/murph/config.json', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-config-home-'))
  const homeRoot = path.join(tempRoot, 'home')
  const homeVaultRoot = path.join(tempRoot, 'home-default')
  const configDir = path.join(homeRoot, '.config', 'murph')

  try {
    await initializeVault({ vaultRoot: homeVaultRoot })
    await mkdir(configDir, { recursive: true })
    await writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        commands: {
          vault: {
            commands: {
              show: {
                options: {
                  vault: homeVaultRoot,
                },
              },
            },
          },
        },
      }),
    )

    const output = await runBuiltCliFromCwd(
      ['vault', 'show', '--format', 'json', '--filter-output', 'vault'],
      {
        cwd: tempRoot,
        env: {
          HOME: homeRoot,
        },
      },
    )
    assert.equal(JSON.parse(output), homeVaultRoot)
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('published config schema artifact stays on the native incur shape', async () => {
  const schemaText = await readFile(
    new URL('../config.schema.json', import.meta.url),
    'utf8',
  )
  const schema = JSON.parse(schemaText) as {
    type?: string
    properties?: {
      commands?: {
        properties?: {
          vault?: {
            properties?: {
              commands?: {
                properties?: {
                  show?: {
                    properties?: {
                      options?: {
                        properties?: {
                          vault?: unknown
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          assistant?: {
            properties?: {
              commands?: {
                properties?: {
                  chat?: {
                    properties?: {
                      options?: {
                        properties?: {
                          model?: unknown
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(schema.type, 'object')
  assert.ok(
    schema.properties?.commands?.properties?.vault?.properties?.commands?.properties?.show?.properties?.options?.properties?.vault,
  )
  assert.ok(
    schema.properties?.commands?.properties?.assistant?.properties?.commands?.properties?.chat?.properties?.options?.properties?.model,
  )
  assert.equal(schemaText.includes('"x-incur-'), false)
})

test('VaultCliError remains a typed incur envelope through the CLI bridge', async () => {
  const cli = Cli.create('bridge-smoke', {
    description: 'bridge smoke test',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  cli.command('fail', {
    args: z.object({}),
    async run() {
      throw new VaultCliError(
        'BRIDGE_SMOKE',
        'bridge preserved the command error',
        {
          exitCode: 7,
          retryable: true,
        },
      )
    },
  })

  const result = await runJsonCli(cli, ['fail'])

  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error?.code, 'BRIDGE_SMOKE')
  assert.equal(result.envelope.error?.message, 'bridge preserved the command error')
  assert.equal(result.envelope.error?.retryable, true)
  assert.equal(result.exitCode, 7)
})

test('VaultCliError envelopes default retryable to false', async () => {
  const cli = Cli.create('bridge-smoke', {
    description: 'bridge smoke test',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  cli.command('fail', {
    args: z.object({}),
    async run() {
      throw new VaultCliError(
        'BRIDGE_DEFAULT_RETRYABLE',
        'bridge defaulted retryable',
      )
    },
  })

  const result = await runJsonCli(cli, ['fail'])

  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error?.code, 'BRIDGE_DEFAULT_RETRYABLE')
  assert.equal(result.envelope.error?.retryable, false)
  assert.equal(result.exitCode, 1)
})

test('root help lists the simple health CRUD command groups', async () => {
  const help = await runRawCli(['--help'])

  const commands = [
    'goal',
    'condition',
    'allergy',
    'food',
    'recipe',
    'supplement',
    'regimen',
    'protocol',
    'blood-test',
    'family',
    'genetics',
  ]

  for (const command of commands) {
    const position = help.search(new RegExp(`^\\s+${command}\\s+`, 'mu'))
    assert.notEqual(position, -1, `expected root help to list ${command}`)
  }
})

test('descriptor manifest stays aligned with the live root command topology', async () => {
  const cli = createVaultCli(
    createUnwiredVaultServices(),
    createIntegratedInboxServices(),
  )
  const registeredCommands = Cli.toCommands.get(cli)

  assert.notEqual(registeredCommands, undefined, 'expected createVaultCli to register commands')

  const actualRootCommands = [...(registeredCommands?.keys() ?? [])]

  assert.deepEqual(actualRootCommands, collectVaultCliDescriptorRootCommandNames())
})

test('generic health descriptor manifest uses import-json for hard-cut registry imports', () => {
  for (const commandName of ['goal', 'condition', 'allergy', 'family', 'genetics'] as const) {
    const descriptor = vaultCliCommandDescriptors.find(
      (candidate) => candidate.id === `health:${commandName}`,
    )

    if (!descriptor || !('leafCommands' in descriptor) || !descriptor.leafCommands) {
      throw new Error(`The ${commandName} health descriptor is missing leaf commands.`)
    }

    const leafPaths = descriptor.leafCommands.map((leafCommand) => leafCommand.path.join(' '))
    assert.equal(leafPaths.includes(`${commandName} import-json`), true)
    assert.equal(leafPaths.includes(`${commandName} upsert`), false)
  }
})

test('workout descriptor does not expose the removed workout measurement alias', () => {
  const workoutDescriptor = vaultCliCommandDescriptors.find(
    (descriptor) => descriptor.id === 'workout',
  )

  if (
    !workoutDescriptor
    || !('leafCommands' in workoutDescriptor)
    || !workoutDescriptor.leafCommands
  ) {
    throw new Error('The workout command descriptor is missing its leaf commands.')
  }

  assert.equal(
    workoutDescriptor.leafCommands.some(
      (leafCommand) => leafCommand.path.join(' ').startsWith('workout measurement '),
    ),
    false,
  )
})

test('capture descriptor exposes the add, show, list, and manifest leaves', () => {
  const captureDescriptor = vaultCliCommandDescriptors.find(
    (descriptor) => descriptor.id === 'capture',
  )

  if (
    !captureDescriptor
    || !('leafCommands' in captureDescriptor)
    || !captureDescriptor.leafCommands
  ) {
    throw new Error('The capture command descriptor is missing its leaf commands.')
  }

  const descriptionsByPath = new Map(
    captureDescriptor.leafCommands.map((leafCommand) => [
      leafCommand.path.join(' '),
      {
        description: leafCommand.description,
        hint: 'hint' in leafCommand ? leafCommand.hint : undefined,
      },
    ]),
  )

  assert.deepEqual([...descriptionsByPath.keys()], [
    'capture add',
    'capture show',
    'capture list',
    'capture manifest',
  ])
  assert.equal(descriptionsByPath.get('capture add')?.description, captureCommandDescriptions.add)
  assert.equal(descriptionsByPath.get('capture add')?.hint, captureCommandDescriptions.addHint)
  assert.equal(descriptionsByPath.get('capture show')?.description, captureCommandDescriptions.show)
  assert.equal(descriptionsByPath.get('capture list')?.description, captureCommandDescriptions.list)
  assert.equal(
    descriptionsByPath.get('capture manifest')?.description,
    captureCommandDescriptions.manifest,
  )
})

test('descriptor direct service bindings resolve against the declared service surfaces', () => {
  const descriptorBindings = collectVaultCliDirectServiceBindings()
  const vaultServices = createUnwiredCliVaultServices(createUnwiredVaultServices())
  const inboxServices = createIntegratedInboxServices()

  for (const descriptor of vaultCliCommandDescriptors) {
    if (descriptor.bindingMode !== 'direct') {
      continue
    }

    const directVaultServiceBindings =
      'directVaultServiceBindings' in descriptor
        ? descriptor.directVaultServiceBindings
        : undefined
    const directInboxServiceBindings =
      'directInboxServiceBindings' in descriptor
        ? descriptor.directInboxServiceBindings
        : undefined
    const hasVaultBindings = Object.keys(directVaultServiceBindings ?? {}).length > 0
    const hasInboxBindings = (directInboxServiceBindings?.length ?? 0) > 0

    assert.equal(
      hasVaultBindings || hasInboxBindings,
      true,
      `expected direct descriptor ${descriptor.id} to declare at least one service binding`,
    )
  }

  for (const [groupName, methodNames] of Object.entries(descriptorBindings.vault) as Array<
    [keyof typeof descriptorBindings.vault, readonly string[]]
  >) {
    const serviceGroup = vaultServices[groupName]

    for (const methodName of methodNames) {
      assert.equal(
        typeof serviceGroup[methodName as keyof typeof serviceGroup],
        'function',
        `expected vault service binding ${String(groupName)}.${methodName} to exist`,
      )
    }
  }

  for (const methodName of descriptorBindings.inbox) {
    assert.equal(
      typeof inboxServices[methodName],
      'function',
      `expected inbox service binding ${methodName} to exist`,
    )
  }
})

test('root and group schema json requests return command indexes', async () => {
  const rootIndex = JSON.parse(
    await runSourceCliRaw(['--schema', '--format', 'json']),
  ) as {
    command: string | null
    commands: Array<{ name?: string }>
    kind: string
    version: string
  }
  const inboxIndex = JSON.parse(
    await runSourceCliRaw(['inbox', '--schema', '--format', 'json']),
  ) as {
    command: string | null
    commands: Array<{ name?: string }>
    kind: string
    version: string
  }

  assert.equal(rootIndex.version, 'murph.schema-index.v1')
  assert.equal(rootIndex.kind, 'root')
  assert.equal(rootIndex.command, null)
  assert.equal(rootIndex.commands.some((command) => command.name === 'vault show'), true)

  assert.equal(inboxIndex.version, 'murph.schema-index.v1')
  assert.equal(inboxIndex.kind, 'group')
  assert.equal(inboxIndex.command, 'inbox')
  assert.equal(inboxIndex.commands.some((command) => command.name === 'inbox bootstrap'), true)
})

test('read-only vault commands reject uninitialized vault roots before query reads', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-uninitialized-vault-'))

  try {
    const commands = [
      ['vault', 'show', '--vault', vaultRoot],
      ['vault', 'stats', '--vault', vaultRoot],
      ['audit', 'list', '--vault', vaultRoot],
      ['audit', 'show', 'aud_missing', '--vault', vaultRoot],
    ]

    for (const command of commands) {
      const result = await runJsonCli(createVaultCli(), command)

      assert.equal(result.exitCode, 1, command.join(' '))
      assert.equal(result.envelope.ok, false, command.join(' '))
      if (!result.envelope.ok) {
        const error = result.envelope.error
        assert.ok(error, command.join(' '))
        assert.equal(error.code, 'invalid_vault', command.join(' '))
        assert.match(error.message ?? '', /not initialized/u)
        assert.equal(error.retryable, false, command.join(' '))
      }
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('search query schema exposes retrieval-specific filters', async () => {
  const schema = JSON.parse(
    await runRawCli(['search', 'query', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
    options: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
  }

  assert.equal('query' in schema.args.properties, true)
  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('text' in schema.options.properties, true)
  assert.equal('backend' in schema.options.properties, false)
  assert.equal('recordType' in schema.options.properties, true)
  assert.equal('from' in schema.options.properties, true)
  assert.equal('to' in schema.options.properties, true)
  assert.equal('dateFrom' in schema.options.properties, false)
  assert.equal('dateTo' in schema.options.properties, false)
  assert.equal('entryType' in schema.options.properties, false)
  assert.match(
    String(schema.options.properties.text?.description ?? ''),
    /Named search text alias/u,
  )
  assert.match(
    String(schema.options.properties.recordType?.description ?? ''),
    /workout_format/u,
  )
  assert.doesNotMatch(
    String(schema.options.properties.recordType?.description ?? ''),
    /history/u,
  )
  assert.deepEqual(schema.options.required, ['vault', 'limit'])
})

test('audit list schema describes its filters and sort controls', async () => {
  const schema = JSON.parse(
    await runRawCli(['audit', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
  }

  assert.match(
    String(schema.options.properties.action?.description ?? ''),
    /audit action filter/u,
  )
  assert.match(
    String(schema.options.properties.sort?.description ?? ''),
    /ascending or descending/u,
  )
  assert.match(
    String(schema.options.properties.limit?.description ?? ''),
    /Maximum number of audit records/u,
  )
  assert.deepEqual(schema.options.required, ['vault', 'sort', 'limit'])
})

test('route estimate schema exposes the Mapbox-backed routing inputs', async () => {
  const schema = JSON.parse(
    await runRawCli(['route', 'estimate', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, { description?: string }>
      required?: string[]
    }
    options: {
      properties: Record<string, { description?: string }>
    }
  }

  assert.deepEqual(schema.args.required, ['origin', 'destination'])
  assert.match(
    String(schema.args.properties.origin?.description ?? ''),
    /plain text or a lon,lat literal/u,
  )
  assert.match(
    String(schema.args.properties.origin?.description ?? ''),
    /include suburb\/state\/postcode, or use coordinates when you need the routed point pinned exactly/u,
  )
  assert.match(
    String(schema.args.properties.destination?.description ?? ''),
    /plain text or a lon,lat literal/u,
  )
  assert.match(
    String(schema.args.properties.destination?.description ?? ''),
    /include suburb\/state\/postcode, or use coordinates when you need the routed point pinned exactly/u,
  )
  assert.match(
    String(schema.options.properties.profile?.description ?? ''),
    /walking for hikes, runs, and on-foot trail estimates/u,
  )
  assert.match(
    String(schema.options.properties.elevation?.description ?? ''),
    /approximate elevation summary/u,
  )
  assert.match(
    String(schema.options.properties.geometry?.description ?? ''),
    /GeoJSON LineString/u,
  )
  assert.equal('waypoint' in schema.options.properties, true)
  assert.equal('country' in schema.options.properties, true)
  assert.equal('language' in schema.options.properties, true)
  assert.equal('elevationSampleSpacingMeters' in schema.options.properties, true)
  assert.equal('maxElevationSamples' in schema.options.properties, true)

  const help = await runRawCli(['route', 'estimate', '--help'])

  assert.match(help, /More specific text can improve geocoding, but provider display labels may still stay broad/u)
  assert.match(
    help,
    /More specific text or coordinates can improve point matching, but provider labels may still be broader than the routed point/u,
  )
})

test('model schema explains preset-gated non-interactive updates', async () => {
  const schema = JSON.parse(
    await runRawCli(['model', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, {
        description?: string
      }>
    }
  }

  assert.match(
    String(schema.options.properties.preset?.description ?? ''),
    /Required for non-interactive updates/u,
  )
  assert.match(
    String(schema.options.properties.providerPreset?.description ?? ''),
    /Only applies with `--preset openai-compatible`/u,
  )
  assert.match(
    String(schema.options.properties.profile?.description ?? ''),
    /Only applies with `--preset codex`/u,
  )
})

test('blood-test list schema stays scoped to shared date-range and status filters', async () => {
  const schema = JSON.parse(
    await runRawCli(['blood-test', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('status' in schema.options.properties, true)
  assert.equal('from' in schema.options.properties, true)
  assert.equal('to' in schema.options.properties, true)
  assert.equal('kind' in schema.options.properties, false)
  assert.deepEqual(schema.options.required, ['vault', 'limit'])
})

test('query projection status schema stays scoped to projection-management options', async () => {
  const schema = JSON.parse(
    await runRawCli(['query', 'projection', 'status', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('text' in schema.options.properties, false)
  assert.equal('backend' in schema.options.properties, false)
  assert.deepEqual(Object.keys(schema.options.properties), ['vault', 'requestId'])
  assert.deepEqual(schema.options.required, ['vault'])
})

test('knowledge commands expose the expected schema at the built CLI boundary', async () => {
  const upsertSchema = JSON.parse(
    await runRawCli(['knowledge', 'upsert', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties?: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const searchSchema = JSON.parse(
    await runRawCli(['knowledge', 'search', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const showSchema = JSON.parse(
    await runRawCli(['knowledge', 'show', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const logTailSchema = JSON.parse(
    await runRawCli(['knowledge', 'log', 'tail', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties?: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.deepEqual(upsertSchema.args.required ?? [], [])
  assert.equal(
    Object.keys(upsertSchema.args.properties ?? {}).length,
    0,
  )
  assert.equal('body' in upsertSchema.options.properties, true)
  assert.equal('sourcePath' in upsertSchema.options.properties, true)
  assert.equal('relatedSlug' in upsertSchema.options.properties, true)
  assert.equal('librarySlug' in upsertSchema.options.properties, true)
  assert.equal('clearLibraryLinks' in upsertSchema.options.properties, true)
  assert.equal('mode' in upsertSchema.options.properties, false)
  assert.deepEqual(upsertSchema.options.required, ['vault', 'body'])
  assert.match(
    String((upsertSchema.options.properties.sourcePath as { description?: unknown }).description),
    /vault-relative source file paths, or absolute source file paths that still resolve inside the selected vault/u,
  )

  assert.equal('query' in searchSchema.args.properties, true)
  assert.deepEqual(searchSchema.args.required, ['query'])
  assert.equal('limit' in searchSchema.options.properties, true)
  assert.deepEqual(searchSchema.options.required, ['vault'])

  assert.equal('slug' in showSchema.args.properties, true)
  assert.deepEqual(showSchema.args.required, ['slug'])
  assert.deepEqual(showSchema.options.required, ['vault'])

  assert.deepEqual(logTailSchema.args.required ?? [], [])
  assert.equal('limit' in logTailSchema.options.properties, true)
  assert.deepEqual(logTailSchema.options.required, ['vault', 'limit'])
})

test('knowledge upsert persists assistant-authored pages through the built CLI boundary', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-cli-'))

  try {
    requireData(await runCli(['init', '--vault', vaultRoot]))
    await mkdir(path.join(vaultRoot, 'research', '2026', '04'), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'research', '2026', '04', 'sleep-note.md'),
      '# Sleep note\n\nMagnesium improved continuity.\n',
    )
    await mkdir(path.join(vaultRoot, 'bank', 'library'), {
      recursive: true,
    })
    await writeFile(
      path.join(vaultRoot, 'bank', 'library', 'sleep-architecture.md'),
      [
        '---',
        'title: Sleep architecture',
        'slug: sleep-architecture',
        'entityType: biomarker',
        '---',
        '',
        '# Sleep architecture',
        '',
        'Stable reference page.',
        '',
      ].join('\n'),
    )
    await writeFile(
      path.join(vaultRoot, 'bank', 'library', 'sleep-duration.md'),
      [
        '---',
        'title: Sleep duration',
        'slug: sleep-duration',
        'entityType: biomarker',
        '---',
        '',
        '# Sleep duration',
        '',
        'Stable reference page.',
        '',
      ].join('\n'),
    )

    const upserted = requireData(
      await runCli<{
        bodyLength: number
        page: {
          librarySlugs: string[]
          slug: string
          sourcePaths: string[]
          title: string
        }
      }>([
        'knowledge',
        'upsert',
        '--vault',
        vaultRoot,
        '--title',
        'Sleep quality',
        '--body',
        '# Sleep quality\n\nMagnesium may help sleep continuity.\n\n## Related\n\n- [[magnesium]]\n',
        '--library-slug',
        'sleep-architecture',
        '--source-path',
        'research/2026/04/sleep-note.md',
      ]),
    )

    assert.equal(upserted.bodyLength > 0, true)
    assert.deepEqual(upserted.page.librarySlugs, ['sleep-architecture'])
    assert.equal(upserted.page.slug, 'sleep-quality')
    assert.deepEqual(upserted.page.sourcePaths, ['research/2026/04/sleep-note.md'])

    const shown = requireData(
      await runCli<{
        page: {
          body: string
          markdown: string
          title: string
        }
      }>([
        'knowledge',
        'show',
        'sleep-quality',
        '--vault',
        vaultRoot,
      ]),
    )

    assert.equal(shown.page.title, 'Sleep quality')
    assert.match(shown.page.body, /## Sources/u)
    assert.match(shown.page.body, /research\/2026\/04\/sleep-note\.md/u)
    assert.match(shown.page.markdown, /sourcePaths:/u)
    assert.match(shown.page.markdown, /relatedSlugs:/u)

    const log = requireData(
      await runCli<{
        entries: Array<{
          action: string
          block: string
          title: string
        }>
      }>([
        'knowledge',
        'log',
        'tail',
        '--vault',
        vaultRoot,
        '--limit',
        '1',
      ]),
    )

    assert.equal(log.entries.length, 1)
    assert.equal(log.entries[0]?.action, 'upsert')
    assert.equal(log.entries[0]?.title, 'Sleep quality')
    assert.match(log.entries[0]?.block ?? '', /librarySlugs: `sleep-architecture`/u)
    assert.match(log.entries[0]?.block ?? '', /slug: `sleep-quality`/u)

    requireData(
      await runCli<{
        page: {
          librarySlugs: string[]
        }
      }>([
        'knowledge',
        'upsert',
        '--vault',
        vaultRoot,
        '--slug',
        'sleep-quality',
        '--body',
        '# Sleep quality\n\nRefreshed note.\n',
        '--clear-library-links',
        '--library-slug',
        'sleep-duration',
      ]),
    )

    const replaced = requireData(
      await runCli<{
        page: {
          librarySlugs: string[]
        }
      }>([
        'knowledge',
        'show',
        'sleep-quality',
        '--vault',
        vaultRoot,
      ]),
    )

    assert.deepEqual(replaced.page.librarySlugs, ['sleep-duration'])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('knowledge upsert allows a heading-only body through the built CLI boundary', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-cli-empty-body-'))

  try {
    requireData(await runCli(['init', '--vault', vaultRoot]))

    const upserted = requireData(
      await runCli<{
        bodyLength: number
        page: {
          slug: string
          title: string
        }
      }>([
        'knowledge',
        'upsert',
        '--vault',
        vaultRoot,
        '--title',
        'Sleep quality',
        '--body',
        '# Sleep quality\n',
      ]),
    )

    assert.equal(upserted.bodyLength, 0)
    assert.equal(upserted.page.slug, 'sleep-quality')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('knowledge upsert rejects whitespace-only bodies through the CLI boundary', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-cli-blank-body-'))
  const cli = createVaultCli()

  try {
    const initialized = await runJsonCli(cli, ['init', '--vault', vaultRoot])
    assert.equal(initialized.envelope.ok, true)

    const result = await runJsonCli(cli, [
      'knowledge',
      'upsert',
      '--vault',
      vaultRoot,
      '--title',
      'Blank page',
      '--body',
      '   \n\t',
    ])

    assert.equal(result.exitCode, 1)
    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      const error = result.envelope.error
      assert.ok(error)
      assert.equal(error.code, 'knowledge_body_required')
      assert.equal(error.retryable, false)
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('root chat alias keeps the same command schema as assistant chat', async () => {
  const rootSchema = JSON.parse(
    await runRawCli(['chat', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runRawCli(['assistant', 'chat', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root run alias keeps the same command schema as assistant run', async () => {
  const rootSchema = JSON.parse(
    await runRawCli(['run', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runRawCli(['assistant', 'run', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root status alias keeps the same command schema as assistant status', async () => {
  const rootSchema = JSON.parse(
    await runRawCli(['status', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runRawCli(['assistant', 'status', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root doctor alias keeps the same command schema as assistant doctor', async () => {
  const rootSchema = JSON.parse(
    await runRawCli(['doctor', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runRawCli(['assistant', 'doctor', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root stop alias keeps the same command schema as assistant stop', async () => {
  const rootSchema = JSON.parse(
    await runRawCli(['stop', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runRawCli(['assistant', 'stop', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('research schema exposes the review:gpt orchestration options', async () => {
  const schema = JSON.parse(
    await runRawCli(['research', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('prompt' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['prompt'])
  assert.equal('title' in schema.options.properties, true)
  assert.equal('chat' in schema.options.properties, true)
  assert.equal('browserPath' in schema.options.properties, true)
  assert.equal('timeout' in schema.options.properties, true)
  assert.equal('waitTimeout' in schema.options.properties, true)
  assert.match(
    String(
      (
        schema.options.properties.timeout as {
          description?: string
        }
      ).description ?? '',
    ),
    /defaults this to 40m/u,
  )
  assert.match(
    String(
      (
        schema.options.properties.waitTimeout as {
          description?: string
        }
      ).description ?? '',
    ),
    /defaults to the overall timeout/u,
  )
  assert.deepEqual(schema.options.required, ['vault'])
})

test('deepthink schema stays aligned with research schema', async () => {
  const researchSchema = JSON.parse(
    await runRawCli(['research', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const deepthinkSchema = JSON.parse(
    await runRawCli(['deepthink', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(deepthinkSchema.args, researchSchema.args)
  assert.deepEqual(deepthinkSchema.options, researchSchema.options)
})

test('automation upsert schema exposes the canonical automation payload input', async () => {
  const schema = JSON.parse(
    await runRawCli(['automation', 'upsert', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('input' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'input'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('automation show schema accepts an id-or-slug lookup', async () => {
  const schema = JSON.parse(
    await runRawCli(['automation', 'show', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('lookup' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['lookup'])
  assert.deepEqual(schema.options.required, ['vault'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory upsert schema exposes create-only canonical memory fields', async () => {
  const schema = JSON.parse(
    await runRawCli(['memory', 'upsert', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('text' in schema.args.properties, true)
  assert.match(
    String(schema.args.properties.text?.description ?? ''),
    /Memory text to store/u,
  )
  assert.deepEqual(schema.args.required, ['text'])
  assert.equal('section' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'section'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory update schema requires a memory id and text, with an optional replacement section', async () => {
  const schema = JSON.parse(
    await runRawCli(['memory', 'update', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('memoryId' in schema.args.properties, true)
  assert.equal('text' in schema.args.properties, true)
  assert.match(
    String(schema.args.properties.memoryId?.description ?? ''),
    /Canonical memory record id/u,
  )
  assert.deepEqual(schema.args.required, ['memoryId', 'text'])
  assert.equal('section' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory show schema accepts an optional memory id', async () => {
  const schema = JSON.parse(
    await runRawCli(['memory', 'show', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('memoryId' in schema.args.properties, true)
  assert.match(
    String(schema.args.properties.memoryId?.description ?? ''),
    /omit to return the whole memory document/u,
  )
  assert.deepEqual(schema.args.required ?? [], [])
  assert.deepEqual(schema.options.required, ['vault'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant session list schema emits the normalized session output shape', async () => {
  const schema = JSON.parse(
    await runRawCli(['assistant', 'session', 'list', '--schema', '--format', 'json']),
  ) as {
    output: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('stateRoot' in schema.output.properties, true)
  assert.equal('sessions' in schema.output.properties, true)
  assert.deepEqual(schema.output.required, ['vault', 'stateRoot', 'sessions'])

  const sessions = schema.output.properties.sessions as {
    items?: {
      properties?: Record<string, unknown>
      required?: string[]
    }
  }
  const sessionVariant = sessions.items

  assert.notEqual(sessionVariant, undefined)
  assert.equal('providerSessionId' in (sessionVariant?.properties ?? {}), false)
  assert.equal('providerBinding' in (sessionVariant?.properties ?? {}), false)
  assert.equal('target' in (sessionVariant?.properties ?? {}), true)
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant session show schema emits the normalized session output shape', async () => {
  const schema = JSON.parse(
    await runRawCli(['assistant', 'session', 'show', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    output: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('sessionId' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['sessionId'])
  assert.equal('stateRoot' in schema.output.properties, true)
  assert.equal('session' in schema.output.properties, true)
  assert.deepEqual(schema.output.required, ['vault', 'stateRoot', 'session'])

  const session = schema.output.properties.session as {
    properties?: Record<string, unknown>
    required?: string[]
  }
  const sessionVariant = session

  assert.notEqual(sessionVariant, undefined)
  assert.equal('providerSessionId' in (sessionVariant?.properties ?? {}), false)
  assert.equal('providerBinding' in (sessionVariant?.properties ?? {}), false)
  assert.equal('target' in (sessionVariant?.properties ?? {}), true)
}, INCUR_SCHEMA_TIMEOUT_MS)

test('automation help points operators at canonical automations', async () => {
  const upsertHelp = await runRawCli(['automation', 'upsert', '--help'])
  const scaffoldHelp = await runRawCli(['automation', 'scaffold', '--help'])

  assert.match(upsertHelp, /Create or update one automation record from a JSON payload\./u)
  assert.match(scaffoldHelp, /Emit a canonical automation payload template/u)
}, INCUR_HELP_TIMEOUT_MS)

test('food schedule schema exposes the recurring food options', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['food', 'schedule', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('title' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['title'])
  assert.equal('time' in schema.options.properties, true)
  assert.equal('note' in schema.options.properties, true)
  assert.equal('slug' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'time'])
})

test('food unschedule schema exposes the recurring food lookup', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['food', 'unschedule', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('id' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['id'])
  assert.deepEqual(schema.options.required, ['vault'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal('set' in schema.options.properties, false)
  assert.equal('clear' in schema.options.properties, false)
})

test('food help exposes schedule and no longer exposes add-daily', async () => {
  const help = await runSourceCliRaw(['food', '--help'])

  assert.match(help, /rename\s+Rename one remembered food while preserving its canonical id\./u)
  assert.match(help, /schedule\s+Schedule one remembered food for daily auto-log meal creation\./u)
  assert.match(help, /unschedule\s+Unschedule one remembered food from daily auto-log meal creation\./u)
  assert.doesNotMatch(help, /add-daily/u)
})

test('inbox attachment help exposes inspect, status, and decode commands', async () => {
  const help = await runSourceCliRaw(['inbox', 'attachment', '--help'])
  const inspectHelp = await runSourceCliRaw(['inbox', 'attachment', 'inspect', '--help'])
  const statusHelp = await runSourceCliRaw(['inbox', 'attachment', 'status', '--help'])
  const decodeHelp = await runSourceCliRaw(['inbox', 'attachment', 'decode', '--help'])

  assert.match(help, /inspect\s+Inspect one stored inbox attachment/u)
  assert.match(help, /status\s+Show the current runtime parse status/u)
  assert.match(
    help,
    /decode\s+Run the attachment parse\/decode pipeline now when existing extracted text is missing or needs a fresh parse/u,
  )
  assert.match(
    inspectHelp,
    /Use `inspect` first when you want the stored attachment details and extracted text/u,
  )
  assert.match(
    statusHelp,
    /Use `status` when you want the current parser state/u,
  )
  assert.match(
    decodeHelp,
    /Use `decode` only when you need an explicit parse run/u,
  )
})

test('inbox source list schema exposes the list limit option', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['inbox', 'source', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('limit' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('inbox attachment list schema exposes the list limit option', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['inbox', 'attachment', 'list', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, unknown>
      required?: string[]
    }
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('captureId' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['captureId'])
  assert.equal('limit' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('goal show help exposes only the global format flag', async () => {
  const help = await runRawCli(['goal', 'show', '--help'])

  assert.match(help, /Usage: vault-cli goal show <id> \[options\]/u)
  assert.doesNotMatch(help, /Options:[\s\S]*--format <json\|md>/u)
  assert.match(help, /Global Options:[\s\S]*--format <toon\|json\|yaml\|md\|jsonl>/u)
})

test('wearables day help keeps the date positional and omits the old --date flag', async () => {
  const help = await runRawCli(['wearables', 'day', '--help'])

  assert.match(help, /Usage: vault-cli wearables day <date> \[options\]/u)
  assert.match(help, /Calendar date in YYYY-MM-DD form\./u)
  assert.doesNotMatch(help, /--date\b/u)
})

test('health command help surfaces examples and hints through Incur metadata', async () => {
  const goalImportJsonHelp = await runRawCli(['goal', 'import-json', '--help'])
  const journalLinkHelp = await runRawCli(['journal', 'link', '--help'])
  const foodRenameHelp = await runRawCli(['food', 'rename', '--help'])
  const supplementImportJsonHelp = await runRawCli(['supplement', 'import-json', '--help'])
  const supplementStopHelp = await runRawCli(['supplement', 'stop', '--help'])
  const supplementRenameHelp = await runRawCli(['supplement', 'rename', '--help'])
  const supplementCompoundListHelp = await runRawCli(['supplement', 'compound', 'list', '--help'])
  const regimenStopHelp = await runRawCli(['regimen', 'stop', '--help'])

  assert.match(
    goalImportJsonHelp,
    /vault-cli goal import-json --input @goal\.json --vault \.\/vault/u,
  )
  assert.match(
    goalImportJsonHelp,
    /--input accepts @file\.json or - so the CLI can load the structured goal payload from disk or stdin\./u,
  )
  assert.match(
    goalImportJsonHelp,
    /Run goal scaffold first if you need the current canonical field shape\./u,
  )
  assert.match(
    journalLinkHelp,
    /Link either event ids or sample streams into the journal day frontmatter\./u,
  )
  assert.match(
    journalLinkHelp,
    /Choose exactly one target type per command: repeat --event-id for events or repeat --stream for sample streams\./u,
  )
  assert.match(
    foodRenameHelp,
    /The previous food title is kept as an alias automatically so older operator language still resolves in the saved record\./u,
  )
  assert.match(
    supplementImportJsonHelp,
    /--input accepts @file\.json or - so the CLI can load a supplement payload with product metadata and ingredients\./u,
  )
  assert.match(
    supplementStopHelp,
    /Usage: vault-cli supplement stop <id> \[options\]/u,
  )
  assert.doesNotMatch(supplementStopHelp, /<protocolId>/u)
  assert.match(
    supplementStopHelp,
    /--stopped-on <string>\s+Optional calendar day when the supplement stopped\. Defaults to today\./u,
  )
  assert.match(
    supplementRenameHelp,
    /Use the canonical supplement id or current slug; the CLI reuses the existing supplement record instead of creating a new one\./u,
  )
  assert.match(
    supplementCompoundListHelp,
    /The compound ledger defaults to active supplements so overlapping ingredients sum into a single canonical row\./u,
  )
  assert.match(
    regimenStopHelp,
    /Use the canonical regimen id so the stop event is attached to the existing registry record\./u,
  )
}, INCUR_HELP_TIMEOUT_MS)

test('health list help preserves command-family option shapes', async () => {
  const providerHelp = await runRawCli(['provider', 'list', '--help'])
  const eventHelp = await runRawCli(['event', 'list', '--help'])
  const documentHelp = await runRawCli(['document', 'list', '--help'])

  assert.match(providerHelp, /^\s+--status\b/mu)
  assert.doesNotMatch(providerHelp, /^\s+--from\b/mu)
  assert.doesNotMatch(providerHelp, /^\s+--to\b/mu)

  assert.match(eventHelp, /^\s+--kind\b/mu)
  assert.match(eventHelp, /^\s+--from\b/mu)
  assert.match(eventHelp, /^\s+--to\b/mu)
  assert.match(eventHelp, /^\s+--tag\b/mu)
  assert.match(eventHelp, /^\s+--experiment\b/mu)
  assert.match(
    eventHelp,
    /--kind <string>\s+Optional canonical event kind filter such as encounter, procedure, test, adverse_effect, or exposure\./u,
  )
  assert.match(
    eventHelp,
    /--tag <array>\s+Optional tag filter\. Repeat --tag to match any listed tag\./u,
  )
  assert.match(
    eventHelp,
    /--experiment <string>\s+Optional experiment slug filter for events linked to one experiment\./u,
  )

  assert.match(documentHelp, /^\s+--from\b/mu)
  assert.match(documentHelp, /^\s+--to\b/mu)
  assert.doesNotMatch(documentHelp, /^\s+--status\b/mu)
  assert.doesNotMatch(documentHelp, /^\s+--limit\b/mu)
}, INCUR_HELP_TIMEOUT_MS)

test('owned date-range list help reuses consistent date and limit descriptions', async () => {
  const journalListHelp = await runRawCli(['journal', 'list', '--help'])
  const workoutListHelp = await runRawCli(['workout', 'list', '--help'])
  const eventListHelp = await runRawCli(['event', 'list', '--help'])

  for (const help of [journalListHelp, workoutListHelp, eventListHelp]) {
    assert.match(
      help,
      /--from <string>\s+Optional inclusive lower date bound in YYYY-MM-DD form\./u,
    )
    assert.match(
      help,
      /--to <string>\s+Optional inclusive upper date bound in YYYY-MM-DD form\./u,
    )
    assert.match(
      help,
      /--limit <number>\s+Maximum number of results to return\./u,
    )
  }
}, INCUR_HELP_TIMEOUT_MS)

test('command schema reflects only domain-specific options', async () => {
  const schema = JSON.parse(
    await runRawCli(['init', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.deepEqual(Object.keys(schema.options.properties), ['vault', 'requestId', 'timezone'])
  assert.deepEqual(schema.options.required, ['vault'])
}, INCUR_HELP_TIMEOUT_MS)

test('health command schema remains JSON-Schema-safe', async () => {
  const schema = JSON.parse(
    await runRawCli(['goal', 'import-json', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('input' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'input'])
}, INCUR_HELP_TIMEOUT_MS)

test('full-output json exposes the native Incur success envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-'))

  try {
    const result = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])

    assert.equal(result.ok, true)
    assert.equal(result.meta.command, 'init')
    assert.equal(requireData(result).created, true)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('health command metadata exposes Incur-native CTA suggestions', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-'))

  try {
    const result = await runCli<{ noun: string }>(['goal', 'scaffold', '--vault', vaultRoot])

    assert.equal(result.ok, true)
    assert.equal(requireData(result).noun, 'goal')
    assert.equal(
      result.meta.cta?.commands.some((command) =>
        command.command.includes('vault-cli goal import-json'),
      ),
      true,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('compact llms json manifest remains available', async () => {
  const manifest = JSON.parse(
    await runRawCli(['--llms', '--format', 'json']),
  ) as {
    version: string
    commands: Array<{ name: string }>
  }

  assert.equal(manifest.version, 'incur.v1')
  assert.equal(manifest.commands.some((command) => command.name === 'init'), true)
  assert.equal(manifest.commands.some((command) => command.name === 'chat'), true)
  assert.equal(
    manifest.commands.some((command) => command.name === 'goal show'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'search query'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'commons search'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'commons protocol show'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'query projection status'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'query projection rebuild'),
    true,
  )
})

test('full llms json manifest remains available for schema-rich commands', async () => {
  const manifest = JSON.parse(
    await runRawCli(['--llms-full', '--format', 'json']),
  ) as {
    commands: Array<{
      description?: string
      name: string
      options?: Record<string, unknown>
    }>
  }

  assert.equal(
    manifest.commands.some((command) => command.name === 'goal import-json'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'goal upsert'),
    false,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'chat'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'search query'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'commons source list'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'query projection status'),
    true,
  )
  const searchQueryCommand = manifest.commands.find(
    (command) => command.name === 'search query',
  )
  assert.match(
    String(searchQueryCommand?.description ?? ''),
    /either positionally or with `--text`/u,
  )
})

test('bash completions remain available', async () => {
  const script = await runRawCli(['completions', 'bash'])

  assert.match(script, /_incur_complete_vault_cli/u)
  assert.match(
    script,
    /complete -o default -o bashdefault -o nosort -F _incur_complete_vault_cli vault-cli/u,
  )
})

test('goal scaffold help surfaces factory-provided example and hint text', async () => {
  const help = await runRawCli(['goal', 'scaffold', '--help'])

  assert.match(
    help,
    /vault-cli goal scaffold --vault \.\/vault  # Print a template goal payload\./u,
  )
  assert.match(
    help,
    /Edit the emitted payload, save it as goal\.json, then import it with goal import-json --input @goal\.json or pipe it to --input -\./u,
  )
  assert.match(
    help,
    /The scaffold output is the current canonical field shape for this command\./u,
  )
})

test('goal scaffold exposes a success CTA in the full-output json envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-cta-'))

  try {
    const initResult = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    const scaffoldResult = await runCli<{
      noun: string
      payload: Record<string, unknown>
    }>(['goal', 'scaffold', '--vault', vaultRoot])

    assert.equal(scaffoldResult.ok, true)
    assert.equal(scaffoldResult.meta.command, 'goal scaffold')
    assert.equal(requireData(scaffoldResult).noun, 'goal')
    assert.deepEqual(scaffoldResult.meta.cta?.commands, [
      {
        command: 'vault-cli goal import-json --input @goal.json --vault <vault>',
        description: 'Apply the edited goal payload.',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
