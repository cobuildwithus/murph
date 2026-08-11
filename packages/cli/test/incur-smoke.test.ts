import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
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
import { runMurphCliEntrypoint } from '../src/cli-entry.js'
import {
  type CliEnvelope,
  requireData,
  runCli,
  runRawCli,
} from './cli-test-helpers.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }
const INCUR_ROOT_HELP_TIMEOUT_MS = 90_000
const INCUR_HELP_TIMEOUT_MS = 45_000
const INCUR_SCHEMA_TIMEOUT_MS = 45_000
const INCUR_KNOWLEDGE_BOUNDARY_TIMEOUT_MS = 120_000
const DELETED_COMMONS_COMMANDS = [
  'commons search',
  'commons get',
  'commons source list',
] as const
let inProcessCliProcessStateQueue: Promise<void> = Promise.resolve()

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
  return runSourceCliRawFromCwd(args, {
    cwd: process.cwd(),
    env: process.env,
  })
}

async function runSourceJsonCliFromCwd<TData = Record<string, unknown>>(
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  },
): Promise<CliEnvelope<TData>> {
  const stdout = await runSourceCliRawFromCwd(
    withMachineJsonOutput(args),
    options,
  )

  return JSON.parse(stdout) as CliEnvelope<TData>
}

async function runSourceEntrypointJsonCliFromCwd<TData = Record<string, unknown>>(
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  },
): Promise<CliEnvelope<TData>> {
  const stdout = await runSourceEntrypointRawFromCwd(
    withMachineJsonOutput(args),
    options,
  )

  return JSON.parse(stdout) as CliEnvelope<TData>
}

async function runSourceEntrypointRawFromCwd(
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  },
): Promise<string> {
  return await withInProcessCliProcessStateLock(async () => {
    const previousCwd = process.cwd()
    const previousEnv = { ...process.env }
    const previousExitCode = process.exitCode
    const originalStdoutWrite = process.stdout.write
    const originalStderrWrite = process.stderr.write
    const stdout: string[] = []
    const stderr: string[] = []
    let exitCode: number | undefined

    try {
      replaceProcessEnvForEntrypointTest({
        ...process.env,
        ...options.env,
      })
      process.chdir(options.cwd)
      process.stdout.write = createProcessWriteInterceptor(stdout)
      process.stderr.write = createProcessWriteInterceptor(stderr)

      await runMurphCliEntrypoint(args, {
        argv0: 'vault-cli',
        exit(code = 0) {
          exitCode = code
        },
      })

      if (exitCode !== undefined && exitCode !== 0 && stdout.length === 0) {
        throw new Error(stderr.join('').trim() || `CLI exited with code ${exitCode}.`)
      }
    } finally {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
      process.chdir(previousCwd)
      replaceProcessEnvForEntrypointTest(previousEnv)
      process.exitCode = previousExitCode
    }

    return stdout.join('').trim()
  })
}

function replaceProcessEnvForEntrypointTest(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function createProcessWriteInterceptor(
  chunks: string[],
): typeof process.stdout.write {
  return ((chunk: string | Uint8Array, encodingOrCallback, callback) => {
    const resolvedEncoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8'
    const resolvedCallback =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    chunks.push(
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString(resolvedEncoding),
    )

    if (typeof resolvedCallback === 'function') {
      resolvedCallback()
    }

    return true
  }) as typeof process.stdout.write
}

async function runSourceCliRawFromCwd(
  args: string[],
  options: {
    cwd: string
    env?: NodeJS.ProcessEnv
  },
): Promise<string> {
  return await withInProcessCliProcessStateLock(async () => {
    const previousCwd = process.cwd()
    const cli = createVaultCli()
    const output: string[] = []

    try {
      process.chdir(options.cwd)
      await cli.serve(args, {
        env: {
          ...process.env,
          ...options.env,
        },
        exit: () => {},
        stdout(chunk) {
          output.push(chunk)
        },
      })
    } finally {
      process.chdir(previousCwd)
    }

    return output.join('').trim()
  })
}

async function withInProcessCliProcessStateLock<T>(
  run: () => Promise<T>,
): Promise<T> {
  const previous = inProcessCliProcessStateQueue
  let release = () => {}
  inProcessCliProcessStateQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  try {
    return await run()
  } finally {
    release()
  }
}

async function runJsonCli<TData>(
  cli: Cli.Cli,
  args: string[],
): Promise<{
  envelope: CliEnvelope<TData>
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
    envelope: JSON.parse(output.join('').trim()) as CliEnvelope<TData>,
    exitCode,
  }
}

test('root help exposes the Incur built-ins and simple health CRUD command groups', async () => {
  const help = await runSourceCliRaw(['--help'])

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
    'immunization',
    'family',
    'genetics',
  ]

  for (const command of commands) {
    const position = help.search(new RegExp(`^\\s+${command}\\s+`, 'mu'))
    assert.notEqual(position, -1, `expected root help to list ${command}`)
  }
}, INCUR_ROOT_HELP_TIMEOUT_MS)

test('built CLI discovery surfaces remain available', async () => {
  const builtCliEnv = {
    MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
  }
  const help = await runRawCli(['--help'], { env: builtCliEnv })
  const schema = JSON.parse(
    await runRawCli(['search', 'query', '--schema', '--format', 'json'], {
      env: builtCliEnv,
    }),
  ) as {
    args: {
      properties: Record<string, unknown>
    }
  }
  const manifest = JSON.parse(
    await runRawCli(['--llms-full', '--format', 'json'], { env: builtCliEnv }),
  ) as {
    commands: Array<{ name: string }>
  }
  const completions = await runRawCli(['completions', 'bash'], {
    env: builtCliEnv,
  })

  assert.match(help, new RegExp(`vault-cli@${packageJson.version ?? '0.0.0'}`, 'u'))
  assert.equal('query' in schema.args.properties, true)
  assert.equal(
    manifest.commands.some((command) => command.name === 'search query'),
    true,
  )
  assert.match(completions, /_incur_complete_vault_cli/u)
}, INCUR_ROOT_HELP_TIMEOUT_MS)

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
            options: {
              requestId: 'config-smoke',
            },
          },
          search: {
            commands: {
              query: {
                options: {
                  limit: 1,
                },
              },
            },
          },
        },
      }),
    )

    const showResult = requireData(
      await runSourceEntrypointJsonCliFromCwd<{
        filters: {
          limit: number
        }
      }>(
        ['--config', configPath, 'search', 'query', '--vault', vaultRoot, '--text', 'no-match'],
        {
          cwd: tempRoot,
          env: isolatedEnv,
        },
      ),
    )
    assert.equal(showResult.filters.limit, 1)

    const withoutConfig = await runSourceEntrypointJsonCliFromCwd<{
      filters: {
        limit: number
      }
    }>([
      '--config',
      configPath,
      '--no-config',
      'search',
      'query',
      '--vault',
      vaultRoot,
      '--text',
      'no-match',
    ], {
      cwd: tempRoot,
      env: isolatedEnv,
    })
    assert.equal(withoutConfig.ok, true)
    if (withoutConfig.ok) {
      assert.equal(withoutConfig.data.filters.limit, 10)
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
          search: {
            commands: {
              query: {
                options: {
                  limit: 1,
                },
              },
            },
          },
        },
      }),
    )

    const output = await runSourceEntrypointRawFromCwd(
      [
        'search',
        'query',
        '--vault',
        homeVaultRoot,
        '--text',
        'no-match',
        '--format',
        'json',
        '--filter-output',
        'filters.limit',
      ],
      {
        cwd: tempRoot,
        env: {
          HOME: homeRoot,
          VAULT: '',
        },
      },
    )
    assert.deepEqual(JSON.parse(output), {
      filters: {
        limit: 1,
      },
    })
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
              options?: {
                properties?: {
                  requestId?: unknown
                }
              }
              commands?: {
                properties?: {
                  show?: {
                    properties?: {
                      options?: {
                        properties?: {
                          requestId?: unknown
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
    schema.properties?.commands?.properties?.vault?.properties?.commands?.properties?.show?.properties?.options?.properties?.requestId,
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

test('clinical import descriptors expose scaffolds and payload schemas', () => {
  const expectedLeafPaths = new Map([
    ['assertion', ['assertion scaffold', 'assertion save', 'assertion import-json', 'assertion payload-schema']],
    ['vitals', ['vitals scaffold', 'vitals save', 'vitals import-json', 'vitals payload-schema']],
    [
      'diagnostic-test',
      [
        'diagnostic-test scaffold',
        'diagnostic-test save',
        'diagnostic-test import-json',
        'diagnostic-test payload-schema',
      ],
    ],
    [
      'clinical-note',
      ['clinical-note scaffold', 'clinical-note import-json', 'clinical-note payload-schema'],
    ],
    [
      'social-history',
      ['social-history scaffold', 'social-history import-json', 'social-history payload-schema'],
    ],
  ] as const)

  for (const [descriptorId, expectedPaths] of expectedLeafPaths) {
    const descriptor = vaultCliCommandDescriptors.find(
      (candidate) => candidate.id === descriptorId,
    )

    if (!descriptor || !('leafCommands' in descriptor) || !descriptor.leafCommands) {
      throw new Error(`The ${descriptorId} descriptor is missing leaf commands.`)
    }

    const leafPaths = descriptor.leafCommands.map((leafCommand) => leafCommand.path.join(' '))
    for (const expectedPath of expectedPaths) {
      assert.equal(
        leafPaths.includes(expectedPath),
        true,
        `expected ${descriptorId} manifest to include ${expectedPath}`,
      )
    }
  }
})

test('experiment descriptor describes the explicit start source choice', () => {
  const descriptor = vaultCliCommandDescriptors.find(
    (candidate) => candidate.id === 'experiment',
  )

  if (!descriptor || !('leafCommands' in descriptor) || !descriptor.leafCommands) {
    throw new Error('The experiment descriptor is missing leaf commands.')
  }

  const startCommand = descriptor.leafCommands.find(
    (leafCommand) => leafCommand.path.join(' ') === 'experiment start',
  )

  assert.notEqual(startCommand, undefined, 'expected experiment start descriptor')
  assert.match(startCommand?.description ?? '', /Health Commons protocol/u)
  assert.match(startCommand?.description ?? '', /no-public-protocol fallback/u)
  assert.doesNotMatch(startCommand?.description ?? '', /protocol key is supplied/u)
})

test('murph age descriptor exposes metadata-only input readiness', () => {
  const descriptor = vaultCliCommandDescriptors.find(
    (candidate) => candidate.id === 'murph-age',
  )

  if (!descriptor || !('leafCommands' in descriptor) || !descriptor.leafCommands) {
    throw new Error('The Murph Age descriptor is missing leaf commands.')
  }

  const inputsCommand = descriptor.leafCommands.find(
    (leafCommand) => leafCommand.path.join(' ') === 'age inputs',
  )

  if (!inputsCommand) {
    throw new Error('expected age inputs descriptor')
  }
  assert.match(inputsCommand.description, /metadata-only/u)
  assert.equal('hint' in inputsCommand, true)
  assert.match(String(('hint' in inputsCommand ? inputsCommand.hint : '') ?? ''), /does not calculate an age/u)
  assert.equal('output' in inputsCommand, true)

  const scaffoldCommand = descriptor.leafCommands.find(
    (leafCommand) => leafCommand.path.join(' ') === 'age scaffold',
  )

  if (!scaffoldCommand) {
    throw new Error('expected age scaffold descriptor')
  }
  assert.match(scaffoldCommand.description, /research-preview JSON payload/u)
  assert.match(String(('hint' in scaffoldCommand ? scaffoldCommand.hint : '') ?? ''), /Wearable values/u)
  assert.equal('output' in scaffoldCommand, true)

  const previewCommand = descriptor.leafCommands.find(
    (leafCommand) => leafCommand.path.join(' ') === 'age preview',
  )

  if (!previewCommand) {
    throw new Error('expected age preview descriptor')
  }
  assert.match(previewCommand.description, /submitted JSON payload/u)
  assert.match(String(('hint' in previewCommand ? previewCommand.hint : '') ?? ''), /research-only/u)
  assert.equal('output' in previewCommand, true)

  const modelCardsCommand = descriptor.leafCommands.find(
    (leafCommand) => leafCommand.path.join(' ') === 'age model-cards',
  )

  if (!modelCardsCommand) {
    throw new Error('expected age model-cards descriptor')
  }
  assert.match(modelCardsCommand.description, /metadata-only/u)
  assert.match(modelCardsCommand.description, /model-card/u)
  assert.equal('hint' in modelCardsCommand, true)
  assert.match(
    String(('hint' in modelCardsCommand ? modelCardsCommand.hint : '') ?? ''),
    /does not expose model internals/u,
  )
  assert.equal('output' in modelCardsCommand, true)
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
    'capture import-json',
    'capture payload-schema',
    'capture show',
    'capture list',
    'capture manifest',
  ])
  assert.equal(descriptionsByPath.get('capture add')?.description, captureCommandDescriptions.add)
  assert.equal(descriptionsByPath.get('capture add')?.hint, captureCommandDescriptions.addHint)
  assert.equal(
    descriptionsByPath.get('capture import-json')?.description,
    captureCommandDescriptions.importJson,
  )
  assert.equal(
    descriptionsByPath.get('capture payload-schema')?.description,
    captureCommandDescriptions.payloadSchema,
  )
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

  for (const descriptor of vaultCliCommandDescriptors) {
    if (descriptor.bindingMode !== 'direct') {
      continue
    }

    const directVaultServiceBindings =
      'directVaultServiceBindings' in descriptor
        ? descriptor.directVaultServiceBindings
        : undefined
    const hasVaultBindings = Object.keys(directVaultServiceBindings ?? {}).length > 0

    assert.equal(
      hasVaultBindings,
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

  assert.equal(rootIndex.version, 'murph.schema-index.v1')
  assert.equal(rootIndex.kind, 'root')
  assert.equal(rootIndex.command, null)
  assert.equal(rootIndex.commands.some((command) => command.name === 'vault show'), true)
  assert.equal(rootIndex.commands.some((command) => command.name?.startsWith('inbox')), false)
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
    await runSourceCliRaw(['search', 'query', '--schema', '--format', 'json']),
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
  assert.deepEqual(schema.options.required, ['limit'])
})

test('audit list schema describes its filters and sort controls', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['audit', 'list', '--schema', '--format', 'json']),
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
  assert.deepEqual(schema.options.required, ['sort', 'limit'])
})

test('route estimate schema exposes the Mapbox-backed routing inputs', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['route', 'estimate', '--schema', '--format', 'json']),
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

  const help = await runSourceCliRaw(['route', 'estimate', '--help'])

  assert.match(help, /More specific text can improve geocoding, but provider display labels may still stay broad/u)
  assert.match(
    help,
    /More specific text or coordinates can improve point matching, but provider labels may still be broader than the routed point/u,
  )
})

test('supplement search-labels schema exposes hosted label lookup inputs', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['supplement', 'search-labels', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, { description?: string }>
      required?: string[]
    }
    options: {
      properties: Record<string, { description?: string }>
    }
  }

  assert.deepEqual(schema.args.required, ['query'])
  assert.match(
    String(schema.args.properties.query?.description ?? ''),
    /Supplement product, brand, ingredient, DSLD id, or UPC/u,
  )
  assert.match(
    String(schema.options.properties.limit?.description ?? ''),
    /Maximum label matches to return\. Defaults to 5/u,
  )
  assert.equal("generic" in schema.options.properties, false)
})

test('supplement search-labels-batch schema exposes hosted batch lookup inputs', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['supplement', 'search-labels-batch', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, { description?: string }>
      required?: string[]
    }
    options: {
      properties: Record<string, {
        description?: string
        items?: unknown
        maxItems?: number
        type?: string
      }>
      required?: string[]
    }
  }

  assert.deepEqual(schema.args.required ?? [], [])
  assert.deepEqual(schema.options.required, ['query'])
  assert.equal(schema.options.properties.query?.type, 'array')
  assert.equal(schema.options.properties.query?.maxItems, 50)
  assert.match(
    String(schema.options.properties.query?.description ?? ''),
    /Repeat --query/u,
  )
  assert.match(
    String(schema.options.properties.limit?.description ?? ''),
    /Maximum label matches to return per query\. Defaults to 5/u,
  )
})

test('food search-labels schema exposes hosted label lookup inputs', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['food', 'search-labels', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, { description?: string }>
      required?: string[]
    }
    options: {
      properties: Record<string, { description?: string }>
    }
  }

  assert.deepEqual(schema.args.required, ['query'])
  assert.match(
    String(schema.args.properties.query?.description ?? ''),
    /Food product, brand, USDA FDC id, UPC, or generic ingredient/u,
  )
  assert.match(
    String(schema.options.properties.limit?.description ?? ''),
    /Maximum label matches to return\. Defaults to 1/u,
  )
  assert.match(
    String(schema.options.properties.generic?.description ?? ''),
    /USDA generic food rows/u,
  )
  assert.match(
    String(schema.options.properties.fullLabel?.description ?? ''),
    /complete source label when the requested fact is absent from compact/u,
  )
})

test('food search-labels-batch schema exposes hosted batch lookup inputs', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['food', 'search-labels-batch', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, { description?: string }>
      required?: string[]
    }
    options: {
      properties: Record<string, {
        description?: string
        items?: unknown
        maxItems?: number
        type?: string
      }>
      required?: string[]
    }
  }

  assert.deepEqual(schema.args.required ?? [], [])
  assert.deepEqual(schema.options.required, ['query'])
  assert.equal(schema.options.properties.query?.type, 'array')
  assert.equal(schema.options.properties.query?.maxItems, 50)
  const queryDescription = String(
    schema.options.properties.query?.description ?? '',
  )
  assert.match(queryDescription, /Food product, brand, or generic ingredient/u)
  assert.match(queryDescription, /Repeat --query/u)
  assert.match(
    String(schema.options.properties.generic?.description ?? ''),
    /USDA generic food rows/u,
  )
  assert.match(
    String(schema.options.properties.fullLabel?.description ?? ''),
    /complete source labels when a requested fact is absent from compact/u,
  )
  assert.doesNotMatch(queryDescription, /USDA FDC id|UPC/u)
  assert.match(
    String(schema.options.properties.limit?.description ?? ''),
    /Maximum label matches to return per query\. Defaults to 1/u,
  )

  const help = await runSourceCliRaw(['food', 'search-labels-batch', '--help'])
  assert.match(
    help,
    /For USDA FDC ids or UPCs, use `food search-labels` with one query/u,
  )
})

test('model schema explains preset-gated non-interactive updates', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['model', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, {
        description?: string
      }>
    }
  }

  assert.match(
    String(schema.options.properties.preset?.description ?? ''),
    /only accepts Codex/u,
  )
  assert.equal('providerPreset' in schema.options.properties, false)
  assert.equal('baseUrl' in schema.options.properties, false)
  assert.equal('apiKeyEnv' in schema.options.properties, false)
  assert.equal('headersJson' in schema.options.properties, false)
  assert.equal('modelProvider' in schema.options.properties, true)
  assert.match(
    String(schema.options.properties.modelProvider?.description ?? ''),
    /Codex model provider/u,
  )
  assert.match(
    String(schema.options.properties.profile?.description ?? ''),
    /Only applies with `--preset codex`/u,
  )
})

test('blood-test list schema exposes targeted text, date-range, and status filters', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['blood-test', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('status' in schema.options.properties, true)
  assert.equal('from' in schema.options.properties, true)
  assert.equal('to' in schema.options.properties, true)
  assert.equal('text' in schema.options.properties, true)
  assert.equal('kind' in schema.options.properties, false)
  assert.deepEqual(schema.options.required, ['limit'])
})

test('immunization list schema stays scoped to shared date-range filters', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['immunization', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('status' in schema.options.properties, false)
  assert.equal('from' in schema.options.properties, true)
  assert.equal('to' in schema.options.properties, true)
  assert.equal('kind' in schema.options.properties, false)
  assert.deepEqual(schema.options.required, ['limit'])
})

test('query projection status schema stays scoped to projection-management options', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw([
      'query',
      'projection',
      'status',
      '--schema',
      '--format',
      'json',
    ]),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('text' in schema.options.properties, false)
  assert.equal('backend' in schema.options.properties, false)
  assert.deepEqual(Object.keys(schema.options.properties), ['requestId'])
  assert.deepEqual(schema.options.required ?? [], [])
})

test('knowledge commands expose the expected schema', async () => {
  const upsertSchema = JSON.parse(
    await runSourceCliRaw(['knowledge', 'upsert', '--schema', '--format', 'json']),
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
    await runSourceCliRaw(['knowledge', 'search', '--schema', '--format', 'json']),
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
  const appendSectionSchema = JSON.parse(
    await runSourceCliRaw(['knowledge', 'append-section', '--schema', '--format', 'json']),
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
  const listSchema = JSON.parse(
    await runSourceCliRaw(['knowledge', 'list', '--schema', '--format', 'json']),
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
  const showSchema = JSON.parse(
    await runSourceCliRaw(['knowledge', 'show', '--schema', '--format', 'json']),
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
    await runSourceCliRaw(['knowledge', 'log', 'tail', '--schema', '--format', 'json']),
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
  assert.equal('createOnly' in upsertSchema.options.properties, false)
  assert.equal('mode' in upsertSchema.options.properties, false)
  assert.deepEqual(upsertSchema.options.required, ['body'])
  assert.match(
    String((upsertSchema.options.properties.sourcePath as { description?: unknown }).description),
    /vault-relative source file paths, or absolute source file paths that still resolve inside the selected vault/u,
  )

  assert.equal('slug' in appendSectionSchema.args.properties, true)
  assert.equal('heading' in appendSectionSchema.args.properties, true)
  assert.deepEqual(appendSectionSchema.args.required, ['slug', 'heading'])
  assert.equal('body' in appendSectionSchema.options.properties, true)
  assert.equal('position' in appendSectionSchema.options.properties, true)
  assert.equal('sourcePath' in appendSectionSchema.options.properties, true)
  assert.deepEqual(appendSectionSchema.options.required, ['body', 'position'])
  assert.match(
    String((appendSectionSchema.args.properties.heading as { description?: unknown }).description),
    /rejects duplicate level-two section headings/u,
  )

  assert.equal('query' in searchSchema.args.properties, true)
  assert.deepEqual(searchSchema.args.required, ['query'])
  assert.equal('limit' in searchSchema.options.properties, true)
  assert.deepEqual(searchSchema.options.required, ['limit'])

  assert.deepEqual(listSchema.args.required ?? [], [])
  assert.equal('limit' in listSchema.options.properties, true)
  assert.deepEqual(listSchema.options.required, ['limit'])

  assert.equal('slug' in showSchema.args.properties, true)
  assert.deepEqual(showSchema.args.required, ['slug'])
  assert.deepEqual(showSchema.options.required ?? [], [])

  assert.deepEqual(logTailSchema.args.required ?? [], [])
  assert.equal('limit' in logTailSchema.options.properties, true)
  assert.deepEqual(logTailSchema.options.required, ['limit'])
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
}, INCUR_KNOWLEDGE_BOUNDARY_TIMEOUT_MS)

test('knowledge append-section appends one dated page section through the built CLI boundary', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-knowledge-cli-append-'))
  const cli = createVaultCli()

  try {
    const initialized = await runJsonCli(cli, ['init', '--vault', vaultRoot])
    assert.equal(initialized.envelope.ok, true)

    await mkdir(path.join(vaultRoot, 'journal'), { recursive: true })
    await writeFile(
      path.join(vaultRoot, 'journal', 'sleep.md'),
      '# Sleep evidence\n\nResting heart rate dipped after earlier bedtimes.\n',
    )

    const appended = await runJsonCli<{
      page: {
        slug: string
        sourcePaths: string[]
        title: string
      }
    }>(cli, [
      'knowledge',
      'append-section',
      'weekly-health-insights',
      '2026-06-17',
      '--vault',
      vaultRoot,
      '--title',
      'Weekly health insights',
      '--body',
      'Resting heart rate looked lower after earlier bedtimes.',
      '--source-path',
      'journal/sleep.md',
    ])

    assert.equal(appended.envelope.ok, true)
    if (appended.envelope.ok) {
      assert.equal(appended.envelope.data.page.slug, 'weekly-health-insights')
      assert.equal(appended.envelope.data.page.title, 'Weekly health insights')
      assert.deepEqual(appended.envelope.data.page.sourcePaths, ['journal/sleep.md'])
    }

    const shown = await runJsonCli<{
      page: {
        body: string
        markdown: string
      }
    }>(cli, [
      'knowledge',
      'show',
      'weekly-health-insights',
      '--vault',
      vaultRoot,
    ])

    assert.equal(shown.envelope.ok, true)
    if (shown.envelope.ok) {
      assert.match(shown.envelope.data.page.body, /## 2026-06-17/u)
      assert.match(
        shown.envelope.data.page.body,
        /Resting heart rate looked lower after earlier bedtimes/u,
      )
      assert.match(shown.envelope.data.page.markdown, /sourcePaths:/u)
    }

    const duplicate = await runJsonCli(cli, [
      'knowledge',
      'append-section',
      'weekly-health-insights',
      '2026-06-17',
      '--vault',
      vaultRoot,
      '--body',
      'Duplicate finding.',
    ])

    assert.equal(duplicate.exitCode, 1)
    assert.equal(duplicate.envelope.ok, false)
    if (!duplicate.envelope.ok) {
      assert.equal(duplicate.envelope.error.code, 'knowledge_section_already_exists')
      assert.equal(duplicate.envelope.error.retryable, false)
    }
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
    await runSourceCliRaw(['chat', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runSourceCliRaw(['assistant', 'chat', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root run alias keeps the same command schema as assistant run', async () => {
  const rootSchema = JSON.parse(
    await runSourceCliRaw(['run', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runSourceCliRaw(['assistant', 'run', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root status alias keeps the same command schema as assistant status', async () => {
  const rootSchema = JSON.parse(
    await runSourceCliRaw(['status', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runSourceCliRaw(['assistant', 'status', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root doctor alias keeps the same command schema as assistant doctor', async () => {
  const rootSchema = JSON.parse(
    await runSourceCliRaw(['doctor', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runSourceCliRaw(['assistant', 'doctor', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('root stop alias keeps the same command schema as assistant stop', async () => {
  const rootSchema = JSON.parse(
    await runSourceCliRaw(['stop', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }
  const assistantSchema = JSON.parse(
    await runSourceCliRaw(['assistant', 'stop', '--schema', '--format', 'json']),
  ) as {
    args: unknown
    options: unknown
  }

  assert.deepEqual(rootSchema.args, assistantSchema.args)
  assert.deepEqual(rootSchema.options, assistantSchema.options)
})

test('automation save and edit schemas expose typed automation fields and a separate JSON import fallback', async () => {
  const saveSchema = JSON.parse(
    await runSourceCliRaw(['automation', 'save', '--schema', '--format', 'json']),
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

  assert.equal('title' in saveSchema.args.properties, true)
  assert.deepEqual(saveSchema.args.required, ['title'])
  assert.equal('input' in saveSchema.options.properties, false)
  for (const field of [
    'id',
    'createOnly',
    'slug',
    'status',
    'summary',
    'tags',
    'continuityPolicy',
    'instructions',
    'scheduleKind',
    'scheduleAt',
    'scheduleEveryMs',
    'scheduleCron',
    'scheduleLocalTime',
    'channel',
    'deliveryTarget',
    'identityId',
    'participantId',
    'threadId',
    'assistantTargetOverrideModel',
    'assistantTargetOverrideModelProvider',
    'assistantTargetOverrideReasoningEffort',
  ]) {
    assert.equal(field in saveSchema.options.properties, true, field)
  }

  const editSchema = JSON.parse(
    await runSourceCliRaw(['automation', 'edit', '--schema', '--format', 'json']),
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

  assert.equal('lookup' in editSchema.args.properties, true)
  assert.deepEqual(editSchema.args.required, ['lookup'])
  assert.equal('input' in editSchema.options.properties, false)
  assert.equal(editSchema.options.required?.includes('instructions') ?? false, false)
  for (const field of [
    'title',
    'continuityPolicy',
    'instructions',
    'channel',
    'assistantTargetOverrideModel',
    'assistantTargetOverrideModelProvider',
    'assistantTargetOverrideReasoningEffort',
    'clearAssistantTargetOverride',
  ]) {
    assert.equal(field in editSchema.options.properties, true, field)
  }

  const importJsonSchema = JSON.parse(
    await runSourceCliRaw(['automation', 'import-json', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('input' in importJsonSchema.options.properties, true)
  assert.deepEqual(importJsonSchema.options.required, ['input'])

  const listSchema = JSON.parse(
    await runSourceCliRaw(['automation', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('includeBody' in listSchema.options.properties, false)
}, INCUR_SCHEMA_TIMEOUT_MS)

test('automation show schema accepts an id-or-slug lookup', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['automation', 'show', '--schema', '--format', 'json']),
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
  assert.deepEqual(schema.options.required ?? [], [])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory upsert schema exposes create-only canonical memory fields', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['memory', 'upsert', '--schema', '--format', 'json']),
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
  assert.deepEqual(schema.options.required, ['section'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory set-name schema exposes the typed preferred-name command', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['memory', 'set-name', '--schema', '--format', 'json']),
  ) as {
    args: {
      properties: Record<string, {
        description?: string
      }>
      required?: string[]
    }
    options: {
      required?: string[]
    }
  }

  assert.equal('displayName' in schema.args.properties, true)
  assert.match(
    String(schema.args.properties.displayName?.description ?? ''),
    /Preferred display name/u,
  )
  assert.deepEqual(schema.args.required, ['displayName'])
  assert.deepEqual(schema.options.required ?? [], [])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory update schema requires a memory id and text, with an optional replacement section', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['memory', 'update', '--schema', '--format', 'json']),
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
  assert.deepEqual(schema.options.required ?? [], [])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('memory show schema accepts an optional memory id', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['memory', 'show', '--schema', '--format', 'json']),
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
  assert.deepEqual(schema.options.required ?? [], [])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant session list schema emits the normalized session output shape', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['assistant', 'session', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
    output: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('stateRoot' in schema.output.properties, true)
  assert.equal('sessions' in schema.output.properties, true)
  assert.equal('limit' in schema.options.properties, true)
  assert.equal('filters' in schema.output.properties, true)
  assert.equal('count' in schema.output.properties, true)
  assert.deepEqual(schema.output.required, ['vault', 'stateRoot', 'filters', 'sessions', 'count'])

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
  assert.equal('target' in (sessionVariant?.properties ?? {}), false)
  assert.equal('providerOptions' in (sessionVariant?.properties ?? {}), false)
  assert.equal('model' in (sessionVariant?.properties ?? {}), true)
  assert.equal('resumeThreadId' in (sessionVariant?.properties ?? {}), true)
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant session show schema emits the normalized session output shape', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['assistant', 'session', 'show', '--schema', '--format', 'json']),
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
  const saveHelp = await runSourceCliRaw(['automation', 'save', '--help'])
  const saveDiscovery = await runSourceCliRaw(['automation', 'save', '--llms-full'])
  const importJsonHelp = await runSourceCliRaw(['automation', 'import-json', '--help'])
  const importJsonDiscovery = await runSourceCliRaw([
    'automation',
    'import-json',
    '--llms-full',
  ])
  const scaffoldHelp = await runSourceCliRaw(['automation', 'scaffold', '--help'])

  for (const surface of [saveHelp, saveDiscovery]) {
    assert.match(
      surface,
      /Create one automation or intentionally replace its full definition from typed command fields\./u,
    )
    assert.match(surface, /Use automation edit for existing-record changes/u)
    assert.match(surface, /automation set-status for lifecycle changes/u)
    assert.match(surface, /automation import-json/u)
    assert.match(
      surface,
      /Optional existing automation id whose full definition will be replaced\./u,
    )
    assert.doesNotMatch(surface, /Create or update/u)
    assert.doesNotMatch(surface, /existing automation id to update/u)
  }
  for (const surface of [importJsonHelp, importJsonDiscovery]) {
    assert.match(
      surface,
      /Create one automation or intentionally replace its full definition from an advanced JSON payload\./u,
    )
    assert.match(surface, /Use automation edit or automation set-status/u)
    assert.doesNotMatch(surface, /bulk-edit/u)
  }
  assert.match(scaffoldHelp, /advanced automation JSON payload template/u)
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
  assert.deepEqual(schema.options.required, ['time'])
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
  assert.deepEqual(schema.options.required ?? [], [])
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

test('inbox command group is not exposed', async () => {
  const help = await runSourceCliRaw(['--help'])
  const output = await runSourceCliRaw(['inbox', '--format', 'json', '--full-output'])

  assert.doesNotMatch(help, /(?:^|\n)\s*inbox\s+/u)
  assert.match(output, /command_not_found|COMMAND_NOT_FOUND/iu)
})

test('goal show help exposes only the global format flag', async () => {
  const help = await runSourceCliRaw(['goal', 'show', '--help'])

  assert.match(help, /Usage: vault-cli goal show <id> \[options\]/u)
  assert.doesNotMatch(help, /Options:[\s\S]*--format <json\|md>/u)
  assert.match(help, /Global Options:[\s\S]*--format <toon\|json\|yaml\|md\|jsonl>/u)
})

test('wearables day help keeps the date positional and omits the old --date flag', async () => {
  const help = await runSourceCliRaw(['wearables', 'day', '--help'])

  assert.match(help, /Usage: vault-cli wearables day <date> \[options\]/u)
  assert.match(help, /Calendar date in YYYY-MM-DD form\./u)
  assert.doesNotMatch(help, /--date\b/u)
})

test('health command help surfaces examples and hints through Incur metadata', async () => {
  const goalImportJsonHelp = await runSourceCliRaw(['goal', 'import-json', '--help'])
  const journalLinkHelp = await runSourceCliRaw(['journal', 'link', '--help'])
  const foodRenameHelp = await runSourceCliRaw(['food', 'rename', '--help'])
  const supplementSaveHelp = await runSourceCliRaw(['supplement', 'save', '--help'])
  const supplementStopHelp = await runSourceCliRaw(['supplement', 'stop', '--help'])
  const supplementCompoundListHelp = await runSourceCliRaw(['supplement', 'compound', 'list', '--help'])
  const regimenStopHelp = await runSourceCliRaw(['regimen', 'stop', '--help'])

  assert.match(
    goalImportJsonHelp,
    /vault-cli goal import-json --input @goal\.json/u,
  )
  assert.match(
    goalImportJsonHelp,
    /--input accepts @file\.json or - so the CLI can load the structured goal payload from disk or stdin\./u,
  )
  assert.match(
    goalImportJsonHelp,
    /Run goal scaffold first if you need a representative starter payload with canonical field names\./u,
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
    supplementSaveHelp,
    /Repeat --ingredient with one shell-quoted JSON object: compound required; label, amount, unit, active, note optional\. Do not pass ingredient text or arrays\. Label units such as "mcg DFE", "mg NE", and "billion CFU" are normalized before saving\./u,
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
    supplementCompoundListHelp,
    /The compound ledger defaults to active supplements so overlapping ingredients sum into a single canonical row\./u,
  )
  assert.match(
    regimenStopHelp,
    /Use the canonical regimen id so the stop event is attached to the existing registry record\./u,
  )
}, INCUR_HELP_TIMEOUT_MS)

test('health list help preserves command-family option shapes', async () => {
  const providerHelp = await runSourceCliRaw(['provider', 'list', '--help'])
  const eventHelp = await runSourceCliRaw(['event', 'list', '--help'])
  const documentHelp = await runSourceCliRaw(['document', 'list', '--help'])

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
  assert.match(documentHelp, /^\s+--limit\b/mu)
}, INCUR_HELP_TIMEOUT_MS)

test('owned date-range list help reuses consistent date and limit descriptions', async () => {
  const journalListHelp = await runSourceCliRaw(['journal', 'list', '--help'])
  const workoutListHelp = await runSourceCliRaw(['workout', 'list', '--help'])
  const eventListHelp = await runSourceCliRaw(['event', 'list', '--help'])

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
    await runSourceCliRaw(['init', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.deepEqual(Object.keys(schema.options.properties), ['requestId', 'timezone'])
  assert.deepEqual(schema.options.required ?? [], [])
}, INCUR_HELP_TIMEOUT_MS)

test('health command schema remains JSON-Schema-safe', async () => {
  const schema = JSON.parse(
    await runSourceCliRaw(['goal', 'import-json', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('input' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['input'])
}, INCUR_HELP_TIMEOUT_MS)

test('full-output json exposes the native Incur success envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-'))

  try {
    const result = await runJsonCli<{ created: boolean }>(
      createVaultCli(),
      ['init', '--vault', vaultRoot],
    )

    assert.equal(result.envelope.ok, true)
    assert.equal(result.envelope.meta.command, 'init')
    assert.equal(requireData(result.envelope).created, true)
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('health command metadata exposes Incur-native CTA suggestions', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-'))

  try {
    const result = await runJsonCli<{ noun: string }>(
      createVaultCli(),
      ['goal', 'scaffold', '--vault', vaultRoot],
    )

    assert.equal(result.envelope.ok, true)
    assert.equal(requireData(result.envelope).noun, 'goal')
    assert.equal(
      result.envelope.meta.cta?.commands.some((command) =>
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
    await runSourceCliRaw(['--llms', '--format', 'json']),
  ) as {
    version: string
    commands: Array<{ hint?: string; name: string }>
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
    manifest.commands.some((command) => command.name === 'commons protocol show'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'commons protocol explore'),
    true,
  )
  for (const deletedCommand of DELETED_COMMONS_COMMANDS) {
    assert.equal(
      manifest.commands.some((command) => command.name === deletedCommand),
      false,
    )
  }
  assert.equal(
    manifest.commands.some((command) => command.name === 'query projection status'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'query projection rebuild'),
    true,
  )
  const supplementSaveCommand = manifest.commands.find(
    (command) => command.name === 'supplement save',
  )
  assert.match(
    String(supplementSaveCommand?.hint ?? ''),
    /one shell-quoted JSON object: compound required/u,
  )
  assert.match(
    String(supplementSaveCommand?.hint ?? ''),
    /Do not pass ingredient text or arrays/u,
  )
  assert.match(
    String(supplementSaveCommand?.hint ?? ''),
    /"mcg DFE", "mg NE", and "billion CFU" are normalized before saving/u,
  )
})

test('full llms json manifest remains available for schema-rich commands', async () => {
  const manifest = JSON.parse(
    await runSourceCliRaw(['--llms-full', '--format', 'json']),
  ) as {
    commands: Array<{
      description?: string
      hint?: string
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
  const ageInputsCommand = manifest.commands.find(
    (command) => command.name === 'age inputs',
  )
  assert.notEqual(ageInputsCommand, undefined)
  assert.match(
    String(ageInputsCommand?.description ?? ''),
    /metadata-only/u,
  )
  const automationSaveCommand = manifest.commands.find(
    (command) => command.name === 'automation save',
  )
  const automationImportCommand = manifest.commands.find(
    (command) => command.name === 'automation import-json',
  )
  assert.match(
    String(automationSaveCommand?.description ?? ''),
    /intentionally replace its full definition from typed command fields/u,
  )
  assert.match(
    String(automationImportCommand?.description ?? ''),
    /intentionally replace its full definition from an advanced JSON payload/u,
  )
  assert.doesNotMatch(String(automationSaveCommand?.description ?? ''), /update/u)
  assert.doesNotMatch(String(automationImportCommand?.description ?? ''), /bulk-edit/u)
  assert.equal(
    manifest.commands.some((command) => command.name === 'age model-cards'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'age preview'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'age scaffold'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'commons protocol list'),
    true,
  )
  for (const deletedCommand of DELETED_COMMONS_COMMANDS) {
    assert.equal(
      manifest.commands.some((command) => command.name === deletedCommand),
      false,
    )
  }
  assert.equal(
    manifest.commands.some((command) => command.name === 'query projection status'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'research'),
    false,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'deepthink'),
    false,
  )
  const searchQueryCommand = manifest.commands.find(
    (command) => command.name === 'search query',
  )
  assert.match(
    String(searchQueryCommand?.description ?? ''),
    /either positionally or with `--text`/u,
  )
  const supplementSaveCommand = manifest.commands.find(
    (command) => command.name === 'supplement save',
  )
  assert.match(
    String(supplementSaveCommand?.hint ?? ''),
    /one shell-quoted JSON object: compound required/u,
  )
  assert.match(
    String(supplementSaveCommand?.hint ?? ''),
    /label, amount, unit, active, note optional/u,
  )
  assert.match(
    String(supplementSaveCommand?.hint ?? ''),
    /"mcg DFE", "mg NE", and "billion CFU" are normalized before saving/u,
  )
})

test('bash completions remain available', async () => {
  const script = await runSourceCliRaw(['completions', 'bash'])

  assert.match(script, /_incur_complete_vault_cli/u)
  assert.match(
    script,
    /complete -o default -o bashdefault -o nosort -F _incur_complete_vault_cli vault-cli/u,
  )
})

test('goal scaffold help surfaces factory-provided example and hint text', async () => {
  const help = await runSourceCliRaw(['goal', 'scaffold', '--help'])

  assert.match(
    help,
    /vault-cli goal scaffold  # Print a template goal payload\./u,
  )
  assert.match(
    help,
    /Edit the emitted payload, save it as goal\.json, then import it with goal import-json --input @goal\.json or pipe it to --input -\. The scaffold is a representative starter payload with canonical field names; command docs may expose additional optional branches\./u,
  )
  assert.match(
    help,
    /representative starter payload/u,
  )
})

test('goal scaffold exposes a success CTA in the full-output json envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-cta-'))

  try {
    const cli = createVaultCli()
    const initResult = await runJsonCli<{ created: boolean }>(
      cli,
      ['init', '--vault', vaultRoot],
    )
    assert.equal(initResult.envelope.ok, true)
    assert.equal(requireData(initResult.envelope).created, true)

    const scaffoldResult = await runJsonCli<{
      noun: string
      payload: Record<string, unknown>
    }>(cli, ['goal', 'scaffold', '--vault', vaultRoot])

    assert.equal(scaffoldResult.envelope.ok, true)
    assert.equal(scaffoldResult.envelope.meta.command, 'goal scaffold')
    assert.equal(requireData(scaffoldResult.envelope).noun, 'goal')
    assert.deepEqual(scaffoldResult.envelope.meta.cta?.commands, [
      {
        command: 'vault-cli goal import-json --input @goal.json --vault <vault>',
        description: 'Apply the edited goal payload.',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
