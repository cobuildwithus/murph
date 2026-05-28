import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, test, vi } from 'vitest'

import {
  resolveAssistantStateDocumentPath,
} from '../src/assistant/state.ts'
import {
  resolveAssistantStatePaths,
} from '../src/assistant/store/paths.ts'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
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
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
      sourceDetail: 'full',
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

test('buildAssistantCliSurfaceContract normalizes commands and renders family, args, and common option summaries', async () => {
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
        description: 'Mark onboarding complete',
        name: 'assistant onboarding complete',
      },
      {
        description: 'Runtime attachment plumbing',
        name: 'inbox attachment list',
      },
      {
        description: 'Runtime parser plumbing',
        name: 'inbox parse',
      },
      {
        description: 'Runtime source plumbing',
        name: 'inbox source list',
      },
      {
        description: 'Runtime daemon status',
        name: 'inbox status',
      },
      {
        description: 'Inbox model audit bundle',
        name: 'inbox model bundle',
      },
      {
        description: 'User-facing inbox search',
        name: 'inbox search',
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
  assert.doesNotMatch(contract, /Family Index:/u)
  assert.doesNotMatch(contract, /- search \(1\): docs/u)
  assert.doesNotMatch(contract, /- root \(1\): search/u)
  assert.match(contract, /search:/u)
  assert.match(contract, /root:/u)
  assert.match(contract, /assistant:/u)
  assert.match(contract, /inbox:/u)
  assert.match(
    contract,
    /- `search docs`: Search the indexed documents for matching records\.; args <query>; required --format=json\|text\./u,
  )
  assert.match(contract, /- `search`: Root command help\./u)
  assert.match(contract, /- `assistant onboarding complete`: Mark onboarding complete\./u)
  assert.match(contract, /- `inbox search`: User-facing inbox search\./u)
  assert.doesNotMatch(contract, /requestId/u)
  assert.doesNotMatch(contract, /--limit/u)
  assert.doesNotMatch(contract, /--tags/u)
  assert.doesNotMatch(contract, /--verbose/u)
  assert.doesNotMatch(contract, /--vault/u)
  assert.doesNotMatch(contract, /Duplicate name/u)
  assert.doesNotMatch(contract, /`assistant run`/u)
  assert.doesNotMatch(contract, /`assistant deliver`/u)
  assert.doesNotMatch(contract, /`assistant status`/u)
  assert.doesNotMatch(contract, /`assistant session list`/u)
  assert.doesNotMatch(contract, /`assistant self-target set`/u)
  assert.doesNotMatch(contract, /`assistant onboarding status`/u)
  assert.doesNotMatch(contract, /`inbox attachment list`/u)
  assert.doesNotMatch(contract, /`inbox parse`/u)
  assert.doesNotMatch(contract, /`inbox source list`/u)
  assert.doesNotMatch(contract, /`inbox status`/u)
  assert.doesNotMatch(contract, /`inbox model bundle`/u)
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

test('buildAssistantCliSurfaceContract renders required string option signatures when the schema provides them', async () => {
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
  assert.match(contract, /required --label=string\./u)
  assert.doesNotMatch(contract, /--freeform/u)
})

test('buildAssistantCliSurfaceContract falls back to a truncated description-only contract for oversized manifests', async () => {
  const {
    buildAssistantCliSurfaceContract,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const oversizedDescription = 'Long description '.repeat(400)
  const contract = buildAssistantCliSurfaceContract({
    commands: Array.from({ length: 220 }, (_, index) => ({
      description: oversizedDescription,
      name: `family command-${index}`,
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
    /- `family command-0`: Long description Long description/u,
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
  const manifestFingerprint = createHash('sha256')
    .update('full')
    .update('\0')
    .update(JSON.stringify(manifest))
    .digest('hex')
  const persistedContract = 'Murph CLI Contract:\nPersisted assistant cli contract'
  await writeFile(
    docPath,
    JSON.stringify({
      contract: persistedContract,
      manifestFingerprint,
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
      sourceDetail: 'full',
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
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
      sourceDetail: 'full',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi.fn().mockResolvedValue({
    commands: [
      {
        description: 'Fresh manifest command',
        name: 'vault show',
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
        detail: 'full',
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
  assert.equal(persisted.schemaVersion, 'murph.assistant-cli-surface-bootstrap.v2')
  assert.match(persisted.generatedAt, /^\d{4}-\d{2}-\d{2}T/u)
})

test('resolveAssistantCliSurfaceBootstrapContext falls back from full to compact manifests', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-fallback-',
  )
  cleanupPaths.push(parentRoot)

  const readAssistantCliLlmsManifest = vi
    .fn()
    .mockRejectedValueOnce(new Error('full manifest unavailable'))
    .mockResolvedValueOnce({
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
    /compiled automatically from `vault-cli --llms --format json`/u,
  )
  assert.deepEqual(
    readAssistantCliLlmsManifest.mock.calls.map(([input]) => input.detail),
    ['full', 'compact'],
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
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
      sourceDetail: 'full',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi
    .fn()
    .mockRejectedValueOnce(new Error('full manifest unavailable'))
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
  assert.deepEqual(
    readAssistantCliLlmsManifest.mock.calls.map(([input]) => input.detail),
    ['full', 'compact'],
  )
  assert.deepEqual(JSON.parse(await readFile(docPath, 'utf8')), {
    contract: persistedContract,
    generatedAt: '2026-01-01T00:00:00.000Z',
    manifestFingerprint: '1'.repeat(64),
    schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
    sourceDetail: 'full',
  })
})

test('resolveAssistantCliSurfaceBootstrapContext reuses compact persisted contracts when manifest generation fails', async () => {
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
      schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
      sourceDetail: 'compact',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi
    .fn()
    .mockRejectedValueOnce(new Error('full manifest unavailable'))
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

  assert.equal(contract, persistedContract)
  assert.deepEqual(
    readAssistantCliLlmsManifest.mock.calls.map(([input]) => input.detail),
    ['full', 'compact'],
  )
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
        sourceDetail: 'full',
      },
    },
    {
      sessionId: 'legacy-schema-version',
      document: {
        contract: validPersistedContract,
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v1',
        sourceDetail: 'full',
      },
    },
    {
      sessionId: 'missing-fingerprint',
      document: {
        contract: validPersistedContract,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
        sourceDetail: 'full',
      },
    },
    {
      sessionId: 'invalid-source-detail',
      document: {
        contract: validPersistedContract,
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
        sourceDetail: 'summary',
      },
    },
    {
      sessionId: 'invalid-contract-shape',
      document: {
        contract: 'Persisted assistant cli contract',
        manifestFingerprint: validManifestFingerprint,
        schemaVersion: 'murph.assistant-cli-surface-bootstrap.v2',
        sourceDetail: 'full',
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

  const readAssistantCliLlmsManifest = vi.fn(
    async (_input: { detail: 'compact' | 'full' }) => {
      throw new Error('manifest unavailable')
    },
  )
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

  assert.deepEqual(
    readAssistantCliLlmsManifest.mock.calls.map(([input]) => input.detail),
    cases.flatMap(() => ['full', 'compact']),
  )
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
    .mockRejectedValueOnce(new Error('full manifest unavailable again'))
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

  assert.deepEqual(
    readAssistantCliLlmsManifest.mock.calls.map(([input]) => input.detail),
    ['full', 'full', 'compact', 'full'],
  )
})

test('resolveAssistantCliSurfaceBootstrapContext keys the in-memory cache by manifest context', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-assistant-cli-surface-contract-keyed-cache-',
  )
  cleanupPaths.push(parentRoot)

  vi.resetModules()

  const readAssistantCliLlmsManifest = vi.fn(async (input: {
    cliEnv?: NodeJS.ProcessEnv
    detail: 'compact' | 'full'
  }) => ({
    commands: [
      {
        description: `Command for ${input.cliEnv?.MURPH_TEST_SURFACE_KEY ?? 'none'}`,
        name: 'vault show',
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
