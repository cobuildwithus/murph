import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { Cli, z } from 'incur'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'
import { localParallelCliTest as test } from './local-parallel-test.js'
import {
  collectVaultCliDescriptorRootCommandNames,
  collectVaultCliDirectServiceBindings,
  vaultCliCommandDescriptors,
} from '../src/vault-cli-command-manifest.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { createIntegratedInboxServices } from '@murphai/assistant-core/inbox-services'
import { createUnwiredVaultServices } from '@murphai/assistant-core/vault-services'
import { createVaultCli } from '../src/vault-cli.js'
import {
  binPath,
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

  await cli.serve([...args, '--format', 'json', '--verbose'], {
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
  assert.match(help, /chat\s+Open the same assistant chat UI as/u)
  assert.match(help, /search\s+Search commands for the local read model/u)
  assert.match(help, /timeline\s+Build a descending timeline/u)
  assert.match(help, /completions\s+Generate shell completion script/u)
  assert.match(help, /mcp add\s+Register as MCP server/u)
  assert.match(help, /skills add\s+Sync skill files to agents/u)
  assert.match(help, /--config/u)
  assert.match(help, /--no-config/u)
  assert.match(help, /--schema\s+Show JSON Schema for command/u)
  assert.match(help, /--verbose\s+Show full output envelope/u)
  assert.match(help, /--llms, --llms-full\s+Print LLM-readable manifest/u)
})

test('root config file can provide command option defaults', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-config-'))
  const vaultRoot = path.join(tempRoot, 'vault')
  const configPath = path.join(tempRoot, 'murph.json')

  try {
    await writeFile(
      configPath,
      JSON.stringify({
        commands: {
          vault: {
            commands: {
              paths: {
                options: {
                  vault: vaultRoot,
                },
              },
            },
          },
        },
      }),
    )

    const pathsResult = requireData(
      await runCli<{ vault: string }>(['--config', configPath, 'vault', 'paths']),
    )
    assert.equal(pathsResult.vault, vaultRoot)

    const withoutConfig = await runCli([
      '--config',
      configPath,
      '--no-config',
      'vault',
      'paths',
    ])
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
    await mkdir(configDir, { recursive: true })
    await writeFile(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        commands: {
          vault: {
            commands: {
              paths: {
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
      ['vault', 'paths', '--format', 'json', '--filter-output', 'vault'],
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

test('root help lists the simple health CRUD command groups', async () => {
  const help = await runRawCli(['--help'])

  const commands = [
    'profile',
    'goal',
    'condition',
    'allergy',
    'food',
    'recipe',
    'supplement',
    'protocol',
    'history',
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

test('descriptor direct service bindings resolve against the declared service surfaces', () => {
  const descriptorBindings = collectVaultCliDirectServiceBindings()
  const vaultServices = createUnwiredVaultServices()
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

test('search query schema exposes retrieval-specific filters', async () => {
  const schema = JSON.parse(
    await runRawCli(['search', 'query', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('text' in schema.options.properties, true)
  assert.equal('backend' in schema.options.properties, true)
  assert.equal('recordType' in schema.options.properties, true)
  assert.equal('from' in schema.options.properties, true)
  assert.equal('to' in schema.options.properties, true)
  assert.equal('dateFrom' in schema.options.properties, false)
  assert.equal('dateTo' in schema.options.properties, false)
  assert.equal('entryType' in schema.options.properties, false)
  assert.deepEqual(schema.options.required, ['vault', 'limit'])
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

test('search index status schema stays scoped to index-management options', async () => {
  const schema = JSON.parse(
    await runRawCli(['search', 'index', 'status', '--schema', '--format', 'json']),
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
  const compileSchema = JSON.parse(
    await runRawCli(['knowledge', 'compile', '--schema', '--format', 'json']),
  ) as {
    args: {
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

  assert.deepEqual(compileSchema.args.required, ['prompt'])
  assert.equal('sourcePath' in compileSchema.options.properties, true)
  assert.equal('mode' in compileSchema.options.properties, true)
  assert.deepEqual(compileSchema.options.required, ['vault'])

  assert.equal('query' in searchSchema.args.properties, true)
  assert.deepEqual(searchSchema.args.required, ['query'])
  assert.equal('limit' in searchSchema.options.properties, true)
  assert.deepEqual(searchSchema.options.required, ['vault'])

  assert.equal('slug' in showSchema.args.properties, true)
  assert.deepEqual(showSchema.args.required, ['slug'])
  assert.deepEqual(showSchema.options.required, ['vault'])
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

test('assistant cron add schema exposes the scheduler-specific options', async () => {
  const schema = JSON.parse(
    await runRawCli(['assistant', 'cron', 'add', '--schema', '--format', 'json']),
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
  assert.equal('name' in schema.options.properties, true)
  assert.equal('at' in schema.options.properties, true)
  assert.equal('every' in schema.options.properties, true)
  assert.equal('cron' in schema.options.properties, true)
  assert.equal('state' in schema.options.properties, true)
  assert.equal('stateDoc' in schema.options.properties, true)
  assert.equal('deliverResponse' in schema.options.properties, false)
  assert.equal('deliveryTarget' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'name'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant cron preset install schema exposes preset variables, instructions, and delivery options', async () => {
  const schema = JSON.parse(
    await runRawCli([
      'assistant',
      'cron',
      'preset',
      'install',
      '--schema',
      '--format',
      'json',
    ]),
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

  assert.equal('preset' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['preset'])
  assert.equal('name' in schema.options.properties, true)
  assert.equal('var' in schema.options.properties, true)
  assert.equal('instructions' in schema.options.properties, true)
  assert.equal('at' in schema.options.properties, true)
  assert.equal('every' in schema.options.properties, true)
  assert.equal('cron' in schema.options.properties, true)
  assert.equal('state' in schema.options.properties, true)
  assert.equal('stateDoc' in schema.options.properties, true)
  assert.equal('deliverResponse' in schema.options.properties, false)
  assert.equal('deliveryTarget' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant cron target set schema exposes the retargeting sources and delivery options', async () => {
  const schema = JSON.parse(
    await runRawCli([
      'assistant',
      'cron',
      'target',
      'set',
      '--schema',
      '--format',
      'json',
    ]),
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

  assert.equal('job' in schema.args.properties, true)
  assert.deepEqual(schema.args.required, ['job'])
  assert.equal('toSelf' in schema.options.properties, true)
  assert.equal('copyFrom' in schema.options.properties, true)
  assert.equal('dryRun' in schema.options.properties, true)
  assert.equal('resetContinuity' in schema.options.properties, true)
  assert.equal('channel' in schema.options.properties, true)
  assert.equal('identity' in schema.options.properties, true)
  assert.equal('participant' in schema.options.properties, true)
  assert.equal('sourceThread' in schema.options.properties, true)
  assert.equal('deliveryTarget' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant state schemas expose document ids and JSON input payload flags', async () => {
  const listSchema = JSON.parse(
    await runRawCli(['assistant', 'state', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }
  const putSchema = JSON.parse(
    await runRawCli(['assistant', 'state', 'put', '--schema', '--format', 'json']),
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

  assert.equal('prefix' in listSchema.options.properties, true)
  assert.deepEqual(listSchema.options.required, ['vault'])
  assert.equal('doc' in putSchema.args.properties, true)
  assert.deepEqual(putSchema.args.required, ['doc'])
  assert.equal('input' in putSchema.options.properties, true)
  assert.deepEqual(putSchema.options.required, ['vault', 'input'])
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
  assert.equal('providerBinding' in (sessionVariant?.properties ?? {}), true)
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
  assert.equal('providerBinding' in (sessionVariant?.properties ?? {}), true)
}, INCUR_SCHEMA_TIMEOUT_MS)

test('assistant cron help explains when to opt into assistant state', async () => {
  const addHelp = await runRawCli(['assistant', 'cron', 'add', '--help'])
  const presetInstallHelp = await runRawCli(['assistant', 'cron', 'preset', 'install', '--help'])

  assert.match(
    addHelp,
    /Add --state or --stateDoc only when the job needs run-to-run scratch state such as cooldowns, dedupe, unresolved follow-ups, or delivery policy; leave it off for stateless jobs that can recompute everything each run\./u,
  )
  assert.match(
    presetInstallHelp,
    /Add --state only when the job needs run-to-run scratch state such as cooldowns, dedupe, unresolved follow-ups, or delivery policy; leave it off for stateless digest\/report jobs\./u,
  )
}, INCUR_HELP_TIMEOUT_MS)

test('food schedule schema exposes the recurring food options', async () => {
  const schema = JSON.parse(
    await runRawCli(['food', 'schedule', '--schema', '--format', 'json']),
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

test('food help exposes schedule and no longer exposes add-daily', async () => {
  const help = await runRawCli(['food', '--help'])

  assert.match(help, /rename\s+Rename one remembered food while preserving its canonical id\./u)
  assert.match(help, /schedule\s+Schedule one remembered food for daily auto-log meal creation\./u)
  assert.doesNotMatch(help, /add-daily/u)
})

test('profile show help exposes only the global format flag', async () => {
  const help = await runRawCli(['profile', 'show', '--help'])

  assert.match(help, /Usage: vault-cli profile show <id> \[options\]/u)
  assert.doesNotMatch(help, /Options:[\s\S]*--format <json\|md>/u)
  assert.match(help, /Global Options:[\s\S]*--format <toon\|json\|yaml\|md\|jsonl>/u)
})

test('health command help surfaces examples and hints through Incur metadata', async () => {
  const profileUpsertHelp = await runRawCli(['profile', 'upsert', '--help'])
  const foodRenameHelp = await runRawCli(['food', 'rename', '--help'])
  const supplementUpsertHelp = await runRawCli(['supplement', 'upsert', '--help'])
  const supplementRenameHelp = await runRawCli(['supplement', 'rename', '--help'])
  const supplementCompoundListHelp = await runRawCli(['supplement', 'compound', 'list', '--help'])
  const profileRebuildHelp = await runRawCli(['profile', 'current', 'rebuild', '--help'])
  const protocolStopHelp = await runRawCli(['protocol', 'stop', '--help'])

  assert.match(
    profileUpsertHelp,
    /vault-cli profile upsert --input @profile-snapshot\.json --vault \.\/vault/u,
  )
  assert.match(
    profileUpsertHelp,
    /--input accepts @file\.json or - so the CLI can load the structured profile snapshot payload from disk or stdin\./u,
  )
  assert.match(
    foodRenameHelp,
    /The previous food title is kept as an alias automatically so older operator language still resolves in the saved record\./u,
  )
  assert.match(
    supplementUpsertHelp,
    /--input accepts @file\.json or - so the CLI can load a supplement payload with product metadata and ingredients\./u,
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
    profileRebuildHelp,
    /Run this after accepting a snapshot if you need to refresh the derived current profile document immediately\./u,
  )
  assert.match(
    protocolStopHelp,
    /Use the canonical protocol id so the stop event is attached to the existing registry record\./u,
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

  assert.match(documentHelp, /^\s+--from\b/mu)
  assert.match(documentHelp, /^\s+--to\b/mu)
  assert.doesNotMatch(documentHelp, /^\s+--status\b/mu)
  assert.doesNotMatch(documentHelp, /^\s+--limit\b/mu)
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
    await runRawCli(['profile', 'upsert', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('input' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault', 'input'])
}, INCUR_HELP_TIMEOUT_MS)

test('verbose json exposes the native Incur success envelope', async () => {
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
    const result = await runCli<{ noun: string }>(['profile', 'scaffold', '--vault', vaultRoot])

    assert.equal(result.ok, true)
    assert.equal(requireData(result).noun, 'profile')
    assert.equal(
      result.meta.cta?.commands.some((command) =>
        command.command.includes('vault-cli profile upsert'),
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
    manifest.commands.some((command) => command.name === 'profile show'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'search query'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'search index status'),
    true,
  )
  assert.equal(
    manifest.commands.some((command) => command.name === 'search index rebuild'),
    true,
  )
})

test('full llms json manifest remains available for schema-rich commands', async () => {
  const manifest = JSON.parse(
    await runRawCli(['--llms-full', '--format', 'json']),
  ) as {
    commands: Array<{
      name: string
      options?: Record<string, unknown>
    }>
  }

  assert.equal(
    manifest.commands.some((command) => command.name === 'profile upsert'),
    true,
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
    manifest.commands.some((command) => command.name === 'search index status'),
    true,
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
    /Edit the emitted payload, save it as goal\.json, then pass it back with --input @goal\.json or pipe it to --input -\./u,
  )
})

test('profile scaffold exposes a success CTA in the verbose json envelope', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-incur-cta-'))

  try {
    const initResult = await runCli<{ created: boolean }>(['init', '--vault', vaultRoot])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    const scaffoldResult = await runCli<{
      noun: string
      payload: Record<string, unknown>
    }>(['profile', 'scaffold', '--vault', vaultRoot])

    assert.equal(scaffoldResult.ok, true)
    assert.equal(scaffoldResult.meta.command, 'profile scaffold')
    assert.equal(requireData(scaffoldResult).noun, 'profile')
    assert.deepEqual(scaffoldResult.meta.cta?.commands, [
      {
        command: 'vault-cli profile upsert --input @profile-snapshot.json --vault <vault>',
        description: 'Apply the edited profile snapshot payload.',
      },
    ])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
