import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, test, vi } from 'vitest'

import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const prebuiltArtifactPathEnv = 'MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH'
const originalPrebuiltArtifactPathEnv = process.env[prebuiltArtifactPathEnv]

function createManifestCommandChildProcess(output: unknown): EventEmitter & {
  kill: () => void
  stderr: EventEmitter
  stdin: {
    end: () => void
    on: () => void
  }
  stdout: EventEmitter
} {
  const child = new EventEmitter() as EventEmitter & {
    kill: () => void
    stderr: EventEmitter
    stdin: {
      end: () => void
      on: () => void
    }
    stdout: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = {
    end: () => undefined,
    on: () => undefined,
  }
  child.kill = () => undefined

  queueMicrotask(() => {
    child.stdout.emit('data', JSON.stringify(output))
    child.emit('close', 0, null)
  })

  return child
}

beforeEach(() => {
  process.env[prebuiltArtifactPathEnv] = path.join(
    path.sep,
    'tmp',
    'murph-test-missing-cli-surface-contract.generated.json',
  )
})

afterEach(async () => {
  if (originalPrebuiltArtifactPathEnv === undefined) {
    delete process.env[prebuiltArtifactPathEnv]
  } else {
    process.env[prebuiltArtifactPathEnv] = originalPrebuiltArtifactPathEnv
  }
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.doUnmock('node:child_process')
  vi.doUnmock('node:fs/promises')
  vi.doUnmock('../src/assistant/cli-surface-manifest.js')
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

test('readPrebuiltAssistantCliSurfaceContract accepts a generated artifact payload', async () => {
  const { parentRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-prebuilt-',
  )
  cleanupPaths.push(parentRoot)

  const artifactPath = path.join(parentRoot, 'cli-surface-contract.generated.json')
  const prebuiltContract = 'Murph CLI Contract:\nPrebuilt assistant cli contract'
  await writeFile(
    artifactPath,
    JSON.stringify({
      contract: prebuiltContract,
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v3',
    }),
    'utf8',
  )

  const {
    readPrebuiltAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const artifact = await readPrebuiltAssistantCliSurfaceContract({
    artifactPath,
  })

  assert.equal(artifact, prebuiltContract)
})

test('readAssistantCliSurfaceBootstrapContext reads only the generated artifact', async () => {
  const { parentRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-bootstrap-context-',
  )
  cleanupPaths.push(parentRoot)

  const artifactPath = path.join(parentRoot, 'cli-surface-contract.generated.json')
  const prebuiltContract = 'Murph CLI Contract:\nGenerated assistant cli contract'
  await writeFile(
    artifactPath,
    JSON.stringify({
      contract: prebuiltContract,
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v3',
    }),
    'utf8',
  )
  process.env[prebuiltArtifactPathEnv] = artifactPath

  const {
    readAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  assert.equal(await readAssistantCliSurfaceBootstrapContext(), prebuiltContract)
})

test('readAssistantCliSurfaceBootstrapContext returns null when the generated artifact is absent', async () => {
  const {
    readAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  assert.equal(await readAssistantCliSurfaceBootstrapContext(), null)
})

test('readPrebuiltAssistantCliSurfaceContract rejects malformed, oversized, and obsolete artifacts', async () => {
  const { parentRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-invalid-prebuilt-',
  )
  cleanupPaths.push(parentRoot)

  const artifactPath = path.join(parentRoot, 'cli-surface-contract.generated.json')
  const {
    readPrebuiltAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const invalidArtifacts = [
    {
      contract: 'not a Murph CLI contract',
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v3',
    },
    {
      contract: `Murph CLI Contract:\n${'x'.repeat(45_000)}`,
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v3',
    },
    {
      contract: 'Murph CLI Contract:\nObsolete assistant cli contract',
      manifestFingerprint: '4'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v2',
    },
  ]

  for (const invalidArtifact of invalidArtifacts) {
    await writeFile(artifactPath, JSON.stringify(invalidArtifact), 'utf8')
    await assert.rejects(
      () => readPrebuiltAssistantCliSurfaceContract({
        artifactPath,
      }),
      /Generated assistant CLI surface contract artifact is invalid/u,
    )
  }
})

test('readPrebuiltAssistantCliSurfaceContract falls back from source mode to the built dist artifact', async () => {
  vi.resetModules()
  delete process.env[prebuiltArtifactPathEnv]

  const distContract = 'Murph CLI Contract:\nDist assistant cli contract'
  vi.doMock('node:fs/promises', async () => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    return {
      ...actual,
      readFile: vi.fn(async (targetPath: string) => {
        if (
          targetPath.endsWith(
            path.join(
              'src',
              'assistant',
              'cli-surface-contract.generated.json',
            ),
          )
        ) {
          throw Object.assign(new Error('missing source prebuilt artifact'), {
            code: 'ENOENT',
          })
        }

        if (
          targetPath.endsWith(
            path.join(
              'dist',
              'assistant',
              'cli-surface-contract.generated.json',
            ),
          )
        ) {
          return JSON.stringify({
            contract: distContract,
            schemaVersion: 'murph.assistant-cli-surface-prebuilt.v3',
          })
        }

        throw Object.assign(new Error(`unexpected read: ${targetPath}`), {
          code: 'ENOENT',
        })
      }),
    }
  })

  const {
    readPrebuiltAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  assert.equal(await readPrebuiltAssistantCliSurfaceContract(), distContract)
})

test('buildAssistantCliSurfaceContract normalizes commands into a compact index with detailed hot paths', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: '   Search the indexed documents for matching records.   ',
        name: 'search docs',
        schema: {
          args: {
            properties: {
              query: {
                type: 'string',
              },
            },
            required: ['query'],
          },
          options: {
            properties: {
              format: {
                enum: ['json', 'text'],
              },
              limit: {
                type: 'integer',
              },
              requestId: {
                type: 'string',
              },
              tags: {
                type: 'array',
              },
              verbose: {
                type: 'boolean',
              },
              vault: {
                type: 'string',
              },
            },
            required: ['format', 'vault'],
          },
        },
      },
      {
        description: 'Root command help',
        name: 'search',
      },
      {
        description: 'Duplicate name that should be ignored',
        name: 'search docs',
      },
      {
        description: 'Recursive assistant route',
        name: 'assistant run',
      },
      {
        description: 'Outbound delivery route',
        name: 'assistant deliver',
      },
      {
        description: 'Assistant runtime diagnostics',
        name: 'assistant status',
      },
      {
        description: 'Assistant session inspection',
        name: 'assistant session list',
      },
      {
        description: 'Assistant self delivery setup',
        name: 'assistant self-target set',
      },
      {
        description: 'Assistant onboarding status',
        name: 'assistant onboarding status',
      },
      {
        description: 'Read compact setup context for onboarding resume',
        name: 'assistant onboarding resume-context',
        schema: {
          options: {
            properties: {
              limit: {
                description: 'Maximum records to return per setup surface',
                type: 'number',
              },
            },
            type: 'object',
          },
        },
      },
      {
        description: 'Murph Age readiness',
        name: 'age inputs',
      },
      {
        description: 'Murph Age report',
        name: 'age report',
      },
      {
        description: 'Mark onboarding complete',
        name: 'assistant onboarding complete',
      },
      {
        description: 'Import a document into the vault',
        name: 'document import',
      },
      {
        description: 'Root status alias',
        name: 'status',
      },
      {
        description: 'Root doctor alias',
        name: 'doctor',
      },
      {
        description: 'Root model config',
        name: 'model',
      },
      {
        description: '   ',
        name: '   ',
      },
    ],
  })

  assert.ok(contract)
  assert.match(contract, /^Murph CLI Contract:/u)
  assert.match(contract, /Use `vault-cli` directly from the current runtime process/u)
  assert.match(contract, /compact index lists exact command tokens/u)
  assert.match(contract, /Hot commands:/u)
  assert.match(contract, /Command index:/u)
  assert.match(contract, /- `search`: `docs`\./u)
  assert.match(contract, /- `root`: `search`\./u)
  assert.match(
    contract,
    /- `assistant`: `onboarding complete`, `onboarding resume-context`\./u,
  )
  assert.match(contract, /- `document`: `import`\./u)
  assert.doesNotMatch(contract, /- `age`:/u)
  assert.match(
    contract,
    /- `assistant onboarding resume-context`: Read compact setup context for onboarding resume; options --limit=number\./u,
  )
  assert.doesNotMatch(contract, /Search the indexed documents/u)
  assert.doesNotMatch(contract, /Root command help/u)
  assert.doesNotMatch(contract, /Mark onboarding complete/u)
  assert.doesNotMatch(contract, /Import a document into the vault/u)
  assert.doesNotMatch(contract, /args <query>/u)
  assert.doesNotMatch(contract, /--verbose/u)
  assert.doesNotMatch(contract, /requestId/u)
  assert.doesNotMatch(contract, /--vault/u)
  assert.doesNotMatch(contract, /Duplicate name/u)
  assert.doesNotMatch(contract, /`assistant run`/u)
  assert.doesNotMatch(contract, /`assistant deliver`/u)
  assert.doesNotMatch(contract, /`assistant status`/u)
  assert.doesNotMatch(contract, /`assistant session list`/u)
  assert.doesNotMatch(contract, /`assistant self-target set`/u)
  assert.doesNotMatch(contract, /`assistant onboarding status`/u)
  assert.doesNotMatch(contract, /`age inputs`/u)
  assert.doesNotMatch(contract, /`age report`/u)
  assert.doesNotMatch(contract, /`status`/u)
  assert.doesNotMatch(contract, /`doctor`/u)
  assert.doesNotMatch(contract, /`model`/u)
})

test('scopeAssistantCliSurfaceContractForAssistant removes retired style commands from stale contracts', async () => {
  const {
    scopeAssistantCliSurfaceContractForAssistant,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')
  const contract = [
    'Murph CLI Contract:',
    'assistant:',
    '- `assistant style show`: Show style settings.',
    '- `assistant style set`: Set style settings.',
    '- `assistant style reset`: Reset style settings.',
    '- `assistant onboarding resume-context`: Read onboarding context.',
    'Command index:',
    '- `assistant`: `onboarding complete`, `style reset`, `style set`, `style show`.',
    '- `goal`: `list`, `save`.',
  ].join('\n')

  assert.equal(
    scopeAssistantCliSurfaceContractForAssistant({
      contract,
    }),
    [
      'Murph CLI Contract:',
      'assistant:',
      '- `assistant onboarding resume-context`: Read onboarding context.',
      'Command index:',
      '- `assistant`: `onboarding complete`.',
      '- `goal`: `list`, `save`.',
    ].join('\n'),
  )
})

test('scopeAssistantCliSurfaceContractForAssistant removes hosted-invalid action commands only in hosted runtime', async () => {
  const {
    scopeAssistantCliSurfaceContractForAssistant,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')
  const contract = [
    'Murph CLI Contract:',
    '- `automation save`: Save an automation.',
    '- `automation show`: Read an automation.',
    '- `device connect`: Connect a provider.',
    '- `device provider list`: List supported providers.',
    'Command index:',
    '- `automation`: `edit`, `import-json`, `list`, `save`, `scaffold`, `set-status`, `show`.',
    '- `device`: `account disconnect`, `account list`, `account reconcile`, `account show`, `connect`, `daemon start`, `daemon status`, `daemon stop`, `provider list`.',
  ].join('\n')

  assert.equal(
    scopeAssistantCliSurfaceContractForAssistant({
      contract,
      hostedRuntime: true,
    }),
    [
      'Murph CLI Contract:',
      '- `automation show`: Read an automation.',
      '- `device provider list`: List supported providers.',
      'Command index:',
      '- `automation`: `list`, `scaffold`, `show`.',
      '- `device`: `provider list`.',
    ].join('\n'),
  )
  assert.equal(
    scopeAssistantCliSurfaceContractForAssistant({
      contract,
      hostedRuntime: false,
    }),
    contract,
  )
})

test('scopeAssistantCliSurfaceContractForAssistant hides the research family when Exa is unavailable', async () => {
  const {
    scopeAssistantCliSurfaceContractForAssistant,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')
  const contract = [
    'Murph CLI Contract:',
    '- `research scout`: Search current human research.',
    '- `goal list`: List goals.',
    'Command index:',
    '- `research`: `payload-schema`, `scout`, `scout-batch`.',
    '- `goal`: `list`, `save`.',
  ].join('\n')

  assert.equal(
    scopeAssistantCliSurfaceContractForAssistant({
      contract,
      researchAvailable: false,
    }),
    [
      'Murph CLI Contract:',
      '- `goal list`: List goals.',
      'Command index:',
      '- `goal`: `list`, `save`.',
    ].join('\n'),
  )
  assert.equal(
    scopeAssistantCliSurfaceContractForAssistant({
      contract,
      researchAvailable: true,
    }),
    contract,
  )
})

test('buildAssistantCliProcessEnv keeps manifest subprocess env credential-free', async () => {
  const {
    buildAssistantCliProcessEnv,
  } = await import('../src/assistant/cli-surface-manifest.ts')

  const env = buildAssistantCliProcessEnv({
    ambientEnv: {
      HOME: '/tmp/murph-home',
      LINQ_API_TOKEN: 'secret-token',
      MAPBOX_ACCESS_TOKEN: 'secret-map-token',
      PATH: '/usr/bin',
      TELEGRAM_BOT_TOKEN: 'secret-bot-token',
    },
    cliEnv: {
      DEVICE_SYNC_SECRET: 'secret-device',
      LINQ_WEBHOOK_SECRET: 'secret-webhook',
      PATH: '',
    },
  })

  assert.equal(env.HOME, '/tmp/murph-home')
  assert.ok((env.PATH ?? '').length > 0)
  assert.equal(env.NO_COLOR, '1')
  assert.equal(env.DEVICE_SYNC_SECRET, undefined)
  assert.equal(env.LINQ_API_TOKEN, undefined)
  assert.equal(env.LINQ_WEBHOOK_SECRET, undefined)
  assert.equal(env.MAPBOX_ACCESS_TOKEN, undefined)
  assert.equal(env.TELEGRAM_BOT_TOKEN, undefined)
})

test('readAssistantCliLlmsManifest launches workspace CLI source with base tsconfig', async () => {
  vi.resetModules()

  const fakeTsxBinary = path.join(path.sep, 'tmp', 'murph-test-bin', 'tsx')
  const spawnCalls: Array<{
    args: string[]
    command: string
    cwd?: string
    env?: NodeJS.ProcessEnv
  }> = []

  vi.doMock('node:fs/promises', async () => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    return {
      ...actual,
      access: vi.fn(async (targetPath: string) => {
        if (
          targetPath === fakeTsxBinary ||
          targetPath.endsWith('tsconfig.base.json') ||
          targetPath.endsWith(path.join('packages', 'cli', 'src', 'bin.ts'))
        ) {
          return
        }

        throw new Error(`missing test executable: ${targetPath}`)
      }),
    }
  })
  vi.doMock('node:child_process', () => ({
    spawn: vi.fn((
      command: string,
      args: string[],
      options: {
        cwd?: string
        env?: NodeJS.ProcessEnv
      },
    ) => {
      spawnCalls.push({
        args: [...args],
        command,
        cwd: options.cwd,
        env: options.env,
      })

      return createManifestCommandChildProcess({
        commands: [
          {
            name: 'memory show',
          },
        ],
        version: 'incur.v1',
      })
    }),
  }))

  const {
    readAssistantCliLlmsManifest,
  } = await import('../src/assistant/cli-surface-manifest.ts')

  const manifest = await readAssistantCliLlmsManifest({
    cliEnv: {
      HOME: path.join(path.sep, 'tmp', 'murph-test-home'),
      PATH: path.dirname(fakeTsxBinary),
    },
    workingDirectory: path.join(path.sep, 'tmp', 'murph-workspace'),
  })

  assert.equal(manifest.commands[0]?.name, 'memory show')
  assert.equal(spawnCalls.length, 1)

  const spawnCall = spawnCalls[0]
  assert.ok(spawnCall)
  assert.equal(spawnCall.command, fakeTsxBinary)
  assert.equal(spawnCall.args[0], '--tsconfig')
  assert.match(spawnCall.args[1] ?? '', /tsconfig\.base\.json$/u)
  assert.match(spawnCall.args[2] ?? '', /packages[\\/]cli[\\/]src[\\/]bin\.ts$/u)
  assert.deepEqual(spawnCall.args.slice(3), ['--llms', '--format', 'json'])
  assert.equal(spawnCall.cwd, path.join(path.sep, 'tmp', 'murph-workspace'))
})

test('readAssistantCliLlmsFullManifest launches the full schema-bearing manifest', async () => {
  vi.resetModules()

  const fakeTsxBinary = path.join(path.sep, 'tmp', 'murph-test-bin', 'tsx')
  const spawnCalls: Array<{
    args: string[]
    command: string
  }> = []

  vi.doMock('node:fs/promises', async () => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    return {
      ...actual,
      access: vi.fn(async (targetPath: string) => {
        if (
          targetPath === fakeTsxBinary ||
          targetPath.endsWith('tsconfig.base.json') ||
          targetPath.endsWith(path.join('packages', 'cli', 'src', 'bin.ts'))
        ) {
          return
        }

        throw new Error(`missing test executable: ${targetPath}`)
      }),
    }
  })
  vi.doMock('node:child_process', () => ({
    spawn: vi.fn((command: string, args: string[]) => {
      spawnCalls.push({
        args: [...args],
        command,
      })

      return createManifestCommandChildProcess({
        commands: [
          {
            name: 'goal save',
            schema: {
              args: {
                properties: {
                  title: {
                    type: 'string',
                  },
                },
              },
            },
          },
        ],
      })
    }),
  }))

  const {
    readAssistantCliLlmsFullManifest,
  } = await import('../src/assistant/cli-surface-manifest.ts')

  const manifest = await readAssistantCliLlmsFullManifest({
    cliEnv: {
      PATH: path.dirname(fakeTsxBinary),
    },
  })

  assert.equal(manifest.commands[0]?.name, 'goal save')
  assert.equal(spawnCalls.length, 1)

  const spawnCall = spawnCalls[0]
  assert.ok(spawnCall)
  assert.equal(spawnCall.command, fakeTsxBinary)
  assert.deepEqual(spawnCall.args.slice(3), ['--llms-full', '--format', 'json'])
})

test('generate-cli-surface-contract builds the prebuilt artifact from the full manifest', async () => {
  vi.resetModules()

  const writeFileMock = vi.fn(
    async (_artifactPath: string, _rawArtifact: string, _encoding: BufferEncoding) =>
      undefined,
  )
  vi.doMock('node:fs/promises', async () => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    return {
      ...actual,
      writeFile: writeFileMock,
    }
  })

  const readAssistantCliLlmsManifest = vi.fn(
    async (_input: { workingDirectory?: string | null }) => {
      throw new Error('compact manifest should not be used for prebuilt generation')
    },
  )
  const readAssistantCliLlmsFullManifest = vi.fn(
    async (_input: { workingDirectory?: string | null }) => ({
      commands: [
        {
          description: 'Create or update one goal from typed command fields.',
          name: 'goal save',
          schema: {
            args: {
              properties: {
                title: {
                  type: 'string',
                },
              },
              required: ['title'],
            },
            options: {
              properties: {
                horizon: {
                  enum: ['short_term', 'medium_term', 'long_term', 'ongoing'],
                  type: 'string',
                },
                status: {
                  enum: ['active', 'paused', 'completed', 'abandoned'],
                  type: 'string',
                },
              },
            },
          },
        },
      ],
    }),
  )
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    buildAssistantCliProcessEnv: () => ({}),
    readAssistantCliLlmsFullManifest,
    readAssistantCliLlmsManifest,
  }))

  await import('../src/assistant/generate-cli-surface-contract.ts')

  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 0)
  assert.equal(readAssistantCliLlmsFullManifest.mock.calls.length, 1)
  assert.equal(
    path.resolve(
      readAssistantCliLlmsFullManifest.mock.calls[0]?.[0]?.workingDirectory ?? '',
    ),
    repoRoot,
  )
  assert.equal(writeFileMock.mock.calls.length, 1)

  const writeCall = writeFileMock.mock.calls[0]
  assert.ok(writeCall)
  const [artifactPath, rawArtifact, encoding] = writeCall
  assert.match(
    String(artifactPath),
    /packages[\\/]assistant-engine[\\/]src[\\/]assistant[\\/]cli-surface-contract\.generated\.json$/u,
  )
  assert.equal(encoding, 'utf8')

  const artifact = JSON.parse(String(rawArtifact)) as {
    contract: string
    schemaVersion: string
  }
  assert.equal(
    artifact.schemaVersion,
    'murph.assistant-cli-surface-prebuilt.v3',
  )
  assert.deepEqual(Object.keys(artifact).sort(), ['contract', 'schemaVersion'])
  assert.match(
    artifact.contract,
    /- `goal save`: Create or update one goal from typed command fields\.; args <title>; options --horizon=short_term\|medium_term\|long_term\|ongoing, --status=active\|paused\|completed\|abandoned\./u,
  )
})

test('readAssistantCliLlmsManifest skips workspace CLI source when base tsconfig is missing', async () => {
  vi.resetModules()

  const fakeBinDirectory = path.join(path.sep, 'tmp', 'murph-test-bin')
  const fakeVaultCliBinary = path.join(fakeBinDirectory, 'vault-cli')
  const fakeTsxBinary = path.join(fakeBinDirectory, 'tsx')
  const spawnCalls: Array<{
    args: string[]
    command: string
  }> = []

  vi.doMock('node:fs/promises', async () => {
    const actual =
      await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    return {
      ...actual,
      access: vi.fn(async (targetPath: string) => {
        if (
          targetPath === fakeVaultCliBinary ||
          targetPath === fakeTsxBinary ||
          targetPath.endsWith(path.join('packages', 'cli', 'src', 'bin.ts'))
        ) {
          return
        }

        throw new Error(`missing test path: ${targetPath}`)
      }),
    }
  })
  vi.doMock('node:child_process', () => ({
    spawn: vi.fn((command: string, args: string[]) => {
      spawnCalls.push({
        args: [...args],
        command,
      })

      return createManifestCommandChildProcess({
        commands: [
          {
            name: 'memory show',
          },
        ],
      })
    }),
  }))

  const {
    readAssistantCliLlmsManifest,
  } = await import('../src/assistant/cli-surface-manifest.ts')

  const manifest = await readAssistantCliLlmsManifest({
    cliEnv: {
      PATH: fakeBinDirectory,
    },
  })

  assert.equal(manifest.commands[0]?.name, 'memory show')
  assert.equal(spawnCalls.length, 1)

  const spawnCall = spawnCalls[0]
  assert.ok(spawnCall)
  assert.equal(spawnCall.command, fakeVaultCliBinary)
  assert.deepEqual(spawnCall.args, ['--llms', '--format', 'json'])
})

test('buildAssistantCliSurfaceContract renders optional string option signatures for hot commands', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Inspect command options',
        name: 'device connect',
        schema: {
          options: {
            properties: {
              freeform: {},
              label: {
                type: 'string',
              },
            },
            required: ['label'],
          },
        },
      },
    ],
  })

  assert.ok(contract)
  assert.match(contract, /options --freeform, --label=string\./u)
})

test('buildAssistantCliSurfaceContract renders array options as repeated flags with hints for hot commands', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Search several supplement label queries.',
        hint: 'Repeat --query for each supplement.',
        name: 'memory upsert',
        schema: {
          options: {
            properties: {
              query: {
                items: {
                  type: 'string',
                },
                type: 'array',
              },
            },
            required: ['query'],
          },
        },
      },
    ],
  })

  assert.ok(contract)
  assert.match(
    contract,
    /options repeat --query=string; hint Repeat --query for each supplement\./u,
  )
  assert.doesNotMatch(contract, /supplement\.\./u)
  assert.doesNotMatch(contract, /--query=list/u)
})

test('buildAssistantCliSurfaceContract renders explicit hints without required array options for hot commands', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Create or update one supplement from typed command fields.',
        hint:
          'Repeat --ingredient with one shell-quoted JSON object: compound required; label, amount, unit, active, note optional. Do not pass ingredient text or arrays. Use unit "mcg".',
        name: 'memory upsert',
        schema: {
          args: {
            properties: {
              title: {
                type: 'string',
              },
            },
            required: ['title'],
          },
          options: {
            properties: {
              ingredient: {
                items: {
                  type: 'string',
                },
                type: 'array',
              },
            },
          },
        },
      },
    ],
  })

  assert.ok(contract)
  assert.match(contract, /options repeat --ingredient=string/u)
  assert.match(
    contract,
    /hint Repeat --ingredient with one shell-quoted JSON object: compound required; label, amount, unit, active, note optional\. Do not pass ingredient text or arrays\. Use unit "mcg"/u,
  )
})

test('buildAssistantCliSurfaceContract renders every non-ignored family as a compact command index', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const indexedFamilies = [
    'audit',
    'document',
    'export',
    'family',
    'genetics',
    'intake',
    'protocol',
    'provider',
    'query',
    'recipe',
    'samples',
    'scheduled-log',
    'vault',
  ]
  const contract = buildAssistantCliSurfaceContract({
    commands: [
      ...indexedFamilies.map((family) => ({
        description: `${family} detailed route`,
        hint:
          family === 'scheduled-log'
            ? 'Prefer scheduled-log save for canonical typed create/update usage.'
            : undefined,
        name: `${family} inspect`,
        schema: {
          args: {
            properties: {
              target: {
                type: 'string',
              },
            },
            required: ['target'],
          },
          options: {
            properties: {
              format: {
                enum: ['json', 'text'],
              },
            },
            required: ['format'],
          },
        },
      })),
      {
        description: 'Event detail route',
        name: 'event inspect',
        schema: {
          args: {
            properties: {
              target: {
                type: 'string',
              },
            },
            required: ['target'],
          },
          options: {
            properties: {
              format: {
                enum: ['json', 'text'],
              },
            },
            required: ['format'],
          },
        },
      },
    ],
  })

  assert.ok(contract)
  for (const family of indexedFamilies) {
    assert.match(contract, new RegExp(`- \`${family}\`: \`inspect\`\\.`, 'u'))
    assert.doesNotMatch(contract, new RegExp(`${family} detailed route`, 'u'))
  }
  assert.match(contract, /- `event`: `inspect`\./u)
  assert.doesNotMatch(contract, /Event detail route/u)
  assert.doesNotMatch(contract, /args <target>/u)
  assert.doesNotMatch(contract, /scheduled-log save for canonical/u)
})

test('buildAssistantCliSurfaceContract exposes optional enum fields for detailed save commands', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Create or update one goal from typed command fields.',
        name: 'goal save',
        schema: {
          args: {
            properties: {
              title: {
                type: 'string',
              },
            },
            required: ['title'],
          },
          options: {
            properties: {
              domain: {
                items: {
                  type: 'string',
                },
                type: 'array',
              },
              horizon: {
                enum: ['short_term', 'medium_term', 'long_term', 'ongoing'],
                type: 'string',
              },
              requestId: {
                type: 'string',
              },
              status: {
                enum: ['active', 'paused', 'completed', 'abandoned'],
                type: 'string',
              },
              vault: {
                type: 'string',
              },
            },
          },
        },
      },
    ],
  })

  assert.ok(contract)
  assert.match(
    contract,
    /- `goal save`: Create or update one goal from typed command fields\.; args <title>; options repeat --domain=string, --horizon=short_term\|medium_term\|long_term\|ongoing, --status=active\|paused\|completed\|abandoned\./u,
  )
  assert.doesNotMatch(contract, /requestId/u)
  assert.doesNotMatch(contract, /--vault/u)
})

test('buildAssistantCliSurfaceContract keeps large manifests compact without non-hot descriptions or schemas', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const oversizedDescription = 'Long description '.repeat(400)
  const contract = buildAssistantCliSurfaceContract({
    commands: Array.from({ length: 220 }, (_, index) => ({
      description: oversizedDescription,
      name: `event command-${index}`,
      schema: {
        args: {
          properties: {
            query: {
              type: 'string',
            },
          },
          required: ['query'],
        },
        options: {
          properties: {
            labels: {
              type: 'array',
            },
            mode: {
              enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
            },
            threshold: {
              type: 'number',
            },
            verbose: {
              type: 'boolean',
            },
          },
          required: ['mode'],
        },
      },
    })),
  })

  assert.ok(contract)
  assert.ok(contract.length <= 45_000)
  assert.ok(contract.length < 8_000)
  assert.match(contract, /- `event`: `command-0`,/u)
  assert.match(contract, /`command-219`/u)
  assert.doesNotMatch(contract, /Long description/u)
  assert.doesNotMatch(contract, /args <query>/u)
  assert.doesNotMatch(contract, /--verbose/u)
  assert.equal(contract.endsWith(' '), false)
})

test('buildAssistantCliSurfaceContract keeps every normalized command reconstructible from the compact index', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const expectedCommandNames = [
    'init',
    'search',
    'search docs',
    'device account list',
    'experiment outcome analyze',
    'goal save',
    ...Array.from(
      { length: 300 },
      (_, index) => `family-${index % 12} multi token leaf-${index}`,
    ),
  ]
  const contract = buildAssistantCliSurfaceContract({
    commands: [
      ...expectedCommandNames.map((name) => ({
        name: `  ${name}  `,
      })),
      {
        name: 'search docs',
      },
      {
        name: 'age report',
      },
      {
        name: 'assistant status',
      },
      {
        name: '   ',
      },
    ],
  })

  assert.ok(contract)
  assert.ok(contract.length < 45_000)
  const index = contract.split('\nCommand index:\n')[1]
  assert.ok(index)
  const reconstructedCommandNames = index.split('\n').flatMap((line) => {
    const match = /^- `(?<family>[^`]+)`: (?<leaves>.+)\.$/u.exec(line)
    assert.ok(match?.groups)
    const family = match.groups.family
    const leaves = match.groups.leaves
    return [...leaves.matchAll(/`(?<leaf>[^`]+)`/gu)].map(({ groups }) => {
      assert.ok(groups)
      return family === 'root' ? groups.leaf : `${family} ${groups.leaf}`
    })
  })

  assert.deepEqual(
    reconstructedCommandNames.sort((left, right) => left.localeCompare(right)),
    [...expectedCommandNames].sort((left, right) => left.localeCompare(right)),
  )
})

test('buildAssistantCliSurfaceContract fails loudly instead of emitting a partial oversized index', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: Array.from({ length: 2_000 }, (_, index) => ({
      name: `event unusually-long-command-token-${index}`,
    })),
  })

  assert.equal(contract, null)
})

test('buildAssistantCliSurfaceContract keeps hot-path option signatures beside a large compact index', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const oversizedDescription = 'Long description '.repeat(400)
  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Create or update one goal from typed command fields.',
        name: 'goal save',
        schema: {
          args: {
            properties: {
              title: {
                type: 'string',
              },
            },
            required: ['title'],
          },
          options: {
            properties: {
              horizon: {
                enum: ['short_term', 'medium_term', 'long_term', 'ongoing'],
              },
              priority: {
                type: 'integer',
              },
              status: {
                enum: ['active', 'paused', 'completed', 'abandoned'],
              },
            },
          },
        },
      },
      ...Array.from({ length: 170 }, (_, index) => ({
        description: oversizedDescription,
        name: `event command-${index}`,
        schema: {
          options: {
            properties: {
              labels: {
                type: 'array',
              },
              verbose: {
                type: 'boolean',
              },
            },
          },
        },
      })),
    ],
  })

  assert.ok(contract)
  assert.doesNotMatch(contract, /Long description/u)
  assert.match(contract, /`command-169`/u)
  assert.ok(contract.length < 8_000)
  const goalSaveLine = contract
    .split('\n')
    .find((line) => line.includes('`goal save`'))
  assert.ok(goalSaveLine)
  assert.match(goalSaveLine, /args <title>/u)
  assert.match(goalSaveLine, /--status=active\|paused\|completed\|abandoned/u)
  assert.match(goalSaveLine, /--horizon=short_term\|medium_term\|long_term\|ongoing/u)
  assert.match(goalSaveLine, /--priority=integer/u)
})
