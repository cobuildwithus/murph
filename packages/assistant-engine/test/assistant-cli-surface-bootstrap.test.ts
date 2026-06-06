import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, test, vi } from 'vitest'

import {
  resolveAssistantStateDocumentPath,
} from '../src/assistant/state.ts'
import {
  resolveAssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []
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

test('buildAssistantCliSurfaceBootstrapDocId is stable for a session', async () => {
  const {
    buildAssistantCliSurfaceBootstrapDocId,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  assert.equal(
    buildAssistantCliSurfaceBootstrapDocId('session-123'),
    'sessions/session-123/cli-surface-bootstrap',
  )
})

test('readPersistedAssistantCliSurfaceBootstrapContext returns a valid persisted contract without manifest generation', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-read-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const docPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-read/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(docPath), {
    recursive: true,
  })
  const persistedContract = 'Murph CLI Contract:\nPersisted assistant cli contract'
  await writeFile(
    docPath,
    JSON.stringify({
      contract: persistedContract,
      manifestFingerprint: '1'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
    }),
    'utf8',
  )
  const readAssistantCliLlmsManifest = vi.fn().mockRejectedValue(
    new Error('manifest should not be read'),
  )
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    readPersistedAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await readPersistedAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-read',
    vault: vaultRoot,
  })

  assert.equal(contract, persistedContract)
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 0)
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
      manifestFingerprint: '4'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v2',
    }),
    'utf8',
  )

  const {
    readPrebuiltAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const artifact = await readPrebuiltAssistantCliSurfaceContract({
    artifactPath,
  })

  assert.deepEqual(artifact, {
    contract: prebuiltContract,
    manifestFingerprint: '4'.repeat(64),
  })
})

test('readPrebuiltAssistantCliSurfaceContract rejects malformed generated artifacts', async () => {
  const { parentRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-invalid-prebuilt-',
  )
  cleanupPaths.push(parentRoot)

  const artifactPath = path.join(parentRoot, 'cli-surface-contract.generated.json')
  await writeFile(
    artifactPath,
    JSON.stringify({
      contract: 'Murph CLI Contract:\nPrebuilt assistant cli contract',
      manifestFingerprint: '4'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-prebuilt.v2',
      sourceDetail: 'compact',
    }),
    'utf8',
  )

  const {
    readPrebuiltAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  await assert.rejects(
    () => readPrebuiltAssistantCliSurfaceContract({
      artifactPath,
    }),
    /Generated assistant CLI surface contract artifact is invalid/u,
  )
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
            manifestFingerprint: '4'.repeat(64),
            schemaVersion: 'murph.assistant-cli-surface-prebuilt.v2',
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

  assert.deepEqual(await readPrebuiltAssistantCliSurfaceContract(), {
    contract: distContract,
    manifestFingerprint: '4'.repeat(64),
  })
})

test('buildAssistantCliSurfaceContract normalizes commands and renders detailed option signatures', async () => {
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
  assert.match(contract, /Detailed entries include enough args\/options to run directly/u)
  assert.match(contract, /Bare command-name entries are low-frequency routes/u)
  assert.doesNotMatch(contract, /Family Index:/u)
  assert.doesNotMatch(contract, /- search \(1\): docs/u)
  assert.doesNotMatch(contract, /- root \(1\): search/u)
  assert.match(contract, /search:/u)
  assert.match(contract, /root:/u)
  assert.match(contract, /assistant:/u)
  assert.match(contract, /document:/u)
  assert.doesNotMatch(contract, /^age:/mu)
  assert.match(
    contract,
    /- `search docs`: Search the indexed documents for matching records\.; args <query>; options --format=json\|text, --limit=integer, repeat --tags=value, --verbose\./u,
  )
  assert.match(contract, /- `search`: Root command help\./u)
  assert.match(contract, /- `assistant onboarding complete`: Mark onboarding complete\./u)
  assert.match(contract, /- `document import`\./u)
  assert.doesNotMatch(contract, /Import a document into the vault/u)
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
  assert.match(
    readAssistantCliLlmsFullManifest.mock.calls[0]?.[0]?.workingDirectory ?? '',
    /murph$/u,
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
    manifestFingerprint: string
    schemaVersion: string
  }
  assert.equal(
    artifact.schemaVersion,
    'murph.assistant-cli-surface-prebuilt.v2',
  )
  assert.match(artifact.manifestFingerprint, /^[a-f0-9]{64}$/u)
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

test('buildAssistantCliSurfaceContract renders optional string option signatures when the schema provides them', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Inspect command options',
        name: 'inspect',
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

test('buildAssistantCliSurfaceContract renders array options as repeated flags with hints', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = buildAssistantCliSurfaceContract({
    commands: [
      {
        description: 'Search several supplement label queries.',
        hint: 'Repeat --query for each supplement.',
        name: 'supplement search-labels-batch',
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

test('buildAssistantCliSurfaceContract renders low-frequency families as bare command names', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const nameOnlyFamilies = [
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
      ...nameOnlyFamilies.map((family) => ({
        description: `${family} detailed route`,
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
  for (const family of nameOnlyFamilies) {
    assert.match(contract, new RegExp(`- \`${family} inspect\`\\.`, 'u'))
    assert.doesNotMatch(contract, new RegExp(`${family} detailed route`, 'u'))
  }
  assert.match(
    contract,
    /- `event inspect`: Event detail route; args <target>; options --format=json\|text\./u,
  )
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

test('buildAssistantCliSurfaceContract falls back to a truncated description-only contract for oversized manifests', async () => {
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
  assert.ok(contract.length <= 40_000)
  assert.match(
    contract,
    /- `event command-0`: Long description Long description/u,
  )
  assert.doesNotMatch(contract, /args <query>/u)
  assert.doesNotMatch(contract, /common --verbose/u)
  assert.equal(contract.endsWith(' '), false)
})

test('resolveAssistantCliSurfaceBootstrapContext reuses a persisted contract payload when manifest fingerprints match', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-persisted-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const docPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-1/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(docPath), {
    recursive: true,
  })
  const manifest = {
    commands: [
      {
        description: 'Current status',
        name: 'vault show',
      },
    ],
  }
  const manifestFingerprint = createAssistantCliSurfaceManifestFingerprint(manifest)
  const persistedContract = 'Murph CLI Contract:\nPersisted assistant cli contract'
  await writeFile(
    docPath,
    JSON.stringify({
      contract: persistedContract,
      manifestFingerprint,
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi.fn().mockResolvedValue(manifest)
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-1',
    vault: vaultRoot,
  })

  assert.equal(contract, persistedContract)
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 1)
})

test('resolveAssistantCliSurfaceBootstrapContext rewrites stale persisted contracts when manifest fingerprints change', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-stale-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const docPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-stale/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(docPath), {
    recursive: true,
  })
  await writeFile(
    docPath,
    JSON.stringify({
      contract: 'Murph CLI Contract:\nStale assistant cli contract',
      manifestFingerprint: '0'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi.fn().mockResolvedValue({
    commands: [
      {
        description: 'Fresh manifest command',
        name: 'search docs',
      },
    ],
  })
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-stale',
    vault: vaultRoot,
  })

  assert.match(contract ?? '', /Fresh manifest command/u)
  assert.doesNotMatch(contract ?? '', /Stale assistant cli contract/u)
  const persisted = JSON.parse(await readFile(docPath, 'utf8')) as {
    contract: string
    manifestFingerprint: string
  }
  assert.equal(persisted.contract, contract)
  assert.notEqual(persisted.manifestFingerprint, '0'.repeat(64))
})

test('resolveAssistantCliSurfaceBootstrapContext rewrites legacy render-policy contracts', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-render-policy-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const docPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-render-policy/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(docPath), {
    recursive: true,
  })

  const manifest = {
    commands: [
      {
        description: 'Age report should stay hidden',
        name: 'age report',
      },
      {
        description: 'Provider search should be name-only',
        name: 'provider search',
      },
      {
        description: 'Event inspect should stay described',
        name: 'event inspect',
      },
    ],
  }
  const legacyManifestFingerprint = '5'.repeat(64)
  const legacyContract = [
    'Murph CLI Contract:',
    'age:',
    '- `age report`: Old age report route.',
    '',
    'provider:',
    '- `provider search`: Old described provider route.',
  ].join('\n')
  await writeFile(
    docPath,
    JSON.stringify({
      contract: legacyContract,
      manifestFingerprint: legacyManifestFingerprint,
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi.fn().mockResolvedValue(manifest)
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-render-policy',
    vault: vaultRoot,
  })

  assert.ok(contract)
  assert.notEqual(contract, legacyContract)
  assert.doesNotMatch(contract, /^age:/mu)
  assert.doesNotMatch(contract, /`age report`/u)
  assert.match(contract, /- `provider search`\./u)
  assert.doesNotMatch(contract, /Provider search should be name-only/u)
  assert.match(contract, /- `event inspect`: Event inspect should stay described\./u)
  assert.match(contract, /Bare command-name entries are low-frequency routes/u)

  const persisted = JSON.parse(await readFile(docPath, 'utf8')) as {
    contract: string
    manifestFingerprint: string
    schemaVersion: string
  }
  assert.equal(persisted.contract, contract)
  assert.equal(persisted.schemaVersion, 'murph.assistant-cli-surface-bootstrap.v4')
  assert.notEqual(persisted.manifestFingerprint, legacyManifestFingerprint)
})

test('resolveAssistantCliSurfaceBootstrapContext ignores persisted summary-only docs and rewrites them with a generated contract', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-generated-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const summaryDocPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-summary/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(summaryDocPath), {
    recursive: true,
  })
  await writeFile(
    summaryDocPath,
    JSON.stringify({
      summary: 'Persisted summary contract',
      schemaVersion: 'test',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi.fn().mockResolvedValue({
    commands: [
      {
        description: 'Search everything',
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
        },
      },
    ],
  })
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const generatedContract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-summary',
    vault: vaultRoot,
  })

  assert.ok(generatedContract)
  assert.match(generatedContract, /`search docs`/u)
  assert.deepEqual(readAssistantCliLlmsManifest.mock.calls, [
    [
      {
        cliEnv: undefined,
        executionContext: undefined,
        workingDirectory: undefined,
      },
    ],
  ])

  const persisted = JSON.parse(await readFile(summaryDocPath, 'utf8')) as {
    contract: string
    generatedAt: string
    manifestFingerprint: string
    schemaVersion: string
  }
  assert.equal(persisted.contract, generatedContract)
  assert.match(persisted.manifestFingerprint, /^[a-f0-9]{64}$/u)
  assert.equal(persisted.schemaVersion, 'murph.assistant-cli-surface-bootstrap.v4')
  assert.match(persisted.generatedAt, /^\d{4}-\d{2}-\d{2}T/u)
})

test('resolveAssistantCliSurfaceBootstrapContext uses compact manifests when no prebuilt artifact is available', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-fallback-',
  )
  cleanupPaths.push(parentRoot)

  const readAssistantCliLlmsManifest = vi.fn().mockResolvedValueOnce({
    commands: [
      {
        description: 'Compact manifest command',
        name: 'search docs',
      },
    ],
  })

  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const compactContract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-compact',
    vault: vaultRoot,
  })
  assert.ok(compactContract)
  assert.match(
    compactContract,
    /compiled automatically from `vault-cli --llms` \/ `--llms-full` manifest data/u,
  )
  assert.deepEqual(
    readAssistantCliLlmsManifest.mock.calls,
    [
      [
        {
          cliEnv: undefined,
          executionContext: undefined,
          workingDirectory: undefined,
        },
      ],
    ],
  )
})

test('resolveAssistantCliSurfaceBootstrapContext reuses persisted contract when manifest generation fails', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-generation-failed-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const docPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-generation-failed/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(docPath), {
    recursive: true,
  })
  const persistedContract = 'Murph CLI Contract:\nPersisted assistant cli contract'
  await writeFile(
    docPath,
    JSON.stringify({
      contract: persistedContract,
      generatedAt: '2026-01-01T00:00:00.000Z',
      manifestFingerprint: '1'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi
    .fn()
    .mockRejectedValueOnce(new Error('compact manifest unavailable'))

  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-generation-failed',
    vault: vaultRoot,
  })

  assert.equal(contract, persistedContract)
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 1)
  assert.deepEqual(JSON.parse(await readFile(docPath, 'utf8')), {
    contract: persistedContract,
    generatedAt: '2026-01-01T00:00:00.000Z',
    manifestFingerprint: '1'.repeat(64),
    schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
  })
})

test('resolveAssistantCliSurfaceBootstrapContext ignores legacy mode-bearing persisted contracts when manifest generation fails', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-generation-failed-compact-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const docPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-generation-failed-compact/cli-surface-bootstrap',
  )
  await mkdir(path.dirname(docPath), {
    recursive: true,
  })
  const persistedContract = 'Murph CLI Contract:\nPersisted assistant cli contract'
  await writeFile(
    docPath,
    JSON.stringify({
      contract: persistedContract,
      generatedAt: '2026-01-01T00:00:00.000Z',
      manifestFingerprint: '3'.repeat(64),
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v3',
      sourceDetail: 'compact',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi
    .fn()
    .mockRejectedValueOnce(new Error('compact manifest unavailable'))

  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-generation-failed-compact',
    vault: vaultRoot,
  })

  assert.equal(contract, null)
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 1)
})

test('resolveAssistantCliSurfaceBootstrapContext rejects invalid persisted contracts when manifest generation fails', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-invalid-persisted-',
  )
  cleanupPaths.push(parentRoot)

  const stateDirectory = resolveAssistantStatePaths(vaultRoot).stateDirectory
  const validPersistedContract = 'Murph CLI Contract:\nPersisted assistant cli contract'
  const validManifestFingerprint = '2'.repeat(64)
  const cases: Array<{
    document: Record<string, unknown>
    sessionId: string
  }> = [
    {
      sessionId: 'invalid-schema',
      document: {
        contract: validPersistedContract,
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'test',
      },
    },
    {
      sessionId: 'legacy-schema-version',
      document: {
        contract: validPersistedContract,
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v1',
      },
    },
    {
      sessionId: 'missing-fingerprint',
      document: {
        contract: validPersistedContract,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
      },
    },
    {
      sessionId: 'legacy-source-detail',
      document: {
        contract: validPersistedContract,
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
        sourceDetail: 'compact',
      },
    },
    {
      sessionId: 'invalid-contract-shape',
      document: {
        contract: 'Persisted assistant cli contract',
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v4',
      },
    },
  ]

  for (const entry of cases) {
    const docPath = resolveAssistantStateDocumentPath(
      {
        stateDirectory,
      },
      `sessions/${entry.sessionId}/cli-surface-bootstrap`,
    )
    await mkdir(path.dirname(docPath), {
      recursive: true,
    })
    await writeFile(docPath, JSON.stringify(entry.document), 'utf8')
  }

  const readAssistantCliLlmsManifest = vi.fn(async () => {
    throw new Error('manifest unavailable')
  })
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  for (const entry of cases) {
    assert.equal(
      await resolveAssistantCliSurfaceBootstrapContext({
        sessionId: entry.sessionId,
        vault: vaultRoot,
      }),
      null,
      entry.sessionId,
    )
  }

  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, cases.length)
})

test('resolveAssistantCliSurfaceBootstrapContext clears the cached promise after null or failed manifest generation', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-cache-reset-',
  )
  cleanupPaths.push(parentRoot)

  vi.resetModules()

  const readAssistantCliLlmsManifest = vi
    .fn()
    .mockResolvedValueOnce({
      commands: [],
    })
    .mockRejectedValueOnce(new Error('compact manifest unavailable again'))
    .mockResolvedValueOnce({
      commands: [
        {
          description: 'Recovered manifest command',
          name: 'search docs',
        },
      ],
    })
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: () => ({}),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  assert.equal(
    await resolveAssistantCliSurfaceBootstrapContext({
      sessionId: 'session-empty',
      vault: vaultRoot,
    }),
    null,
  )
  assert.equal(
    await resolveAssistantCliSurfaceBootstrapContext({
      sessionId: 'session-failed',
      vault: vaultRoot,
    }),
    null,
  )

  const recoveredContract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-recovered',
    vault: vaultRoot,
  })
  assert.ok(recoveredContract)
  assert.match(recoveredContract, /Recovered manifest command/u)

  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 3)
})

test('resolveAssistantCliSurfaceBootstrapContext keys the in-memory cache by manifest context', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-keyed-cache-',
  )
  cleanupPaths.push(parentRoot)

  vi.resetModules()

  const readAssistantCliLlmsManifest = vi.fn(async (input: {
    cliEnv?: NodeJS.ProcessEnv
  }) => ({
    commands: [
      {
        description: `Command for ${input.cliEnv?.MURPH_TEST_SURFACE_KEY ?? 'none'}`,
        name: 'search docs',
      },
    ],
  }))
  vi.doMock('../src/assistant/cli-surface-manifest.js', () => ({
    readAssistantCliLlmsManifest,
    buildAssistantCliProcessEnv: ({ cliEnv }: { cliEnv?: NodeJS.ProcessEnv }) => ({
      ...(cliEnv ?? {}),
    }),
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const firstContract = await resolveAssistantCliSurfaceBootstrapContext({
    cliEnv: {
      MURPH_TEST_SURFACE_KEY: 'one',
    },
    sessionId: 'session-keyed-cache-one',
    vault: vaultRoot,
  })
  const secondContract = await resolveAssistantCliSurfaceBootstrapContext({
    cliEnv: {
      MURPH_TEST_SURFACE_KEY: 'two',
    },
    sessionId: 'session-keyed-cache-two',
    vault: vaultRoot,
  })

  assert.match(firstContract ?? '', /Command for one/u)
  assert.match(secondContract ?? '', /Command for two/u)
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 2)
})

function createAssistantCliSurfaceManifestFingerprint(manifest: unknown): string {
  return createHash('sha256')
    .update('murph.assistant-cli-surface-render-policy.v2')
    .update('\0')
    .update(JSON.stringify(manifest))
    .digest('hex')
}
