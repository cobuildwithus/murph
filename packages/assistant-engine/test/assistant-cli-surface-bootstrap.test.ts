import assert from 'node:assert/strict'
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
  vi.doUnmock('../src/assistant-cli-tools.js')
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
        description: '   ',
        name: '   ',
      },
    ],
  })

  assert.ok(contract)
  assert.match(contract, /^Murph CLI Contract:/u)
  assert.match(contract, /Family Index:/u)
  assert.match(contract, /- search \(1\): docs/u)
  assert.match(contract, /- root \(1\): search/u)
  assert.match(contract, /search:/u)
  assert.match(
    contract,
    /- `search docs`: Search the indexed documents for matching records\.; args <query>; required --format=json\|text; common --limit=integer, --tags=list, --verbose\./u,
  )
  assert.match(contract, /- `search`: Root command help\./u)
  assert.doesNotMatch(contract, /requestId/u)
  assert.doesNotMatch(contract, /--vault/u)
  assert.doesNotMatch(contract, /Duplicate name/u)
})

test('buildAssistantCliSurfaceContract renders option signatures without suffixes for unknown or string option types', async () => {
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
          },
        },
      },
    ],
  })

  assert.ok(contract)
  assert.match(contract, /common --freeform, --label\./u)
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

test('resolveAssistantCliSurfaceBootstrapContext reuses a persisted contract payload', async () => {
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
  await writeFile(
    docPath,
    JSON.stringify({
      contract: 'Persisted assistant cli contract',
      schemaVersion: 'test',
    }),
    'utf8',
  )

  const readAssistantCliLlmsManifest = vi.fn()
  vi.doMock('../src/assistant-cli-tools.js', () => ({
    readAssistantCliLlmsManifest,
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const contract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-1',
    vault: vaultRoot,
  })

  assert.equal(contract, 'Persisted assistant cli contract')
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 0)
})

test('resolveAssistantCliSurfaceBootstrapContext falls back to a persisted summary and writes newly generated full manifests', async () => {
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
  vi.doMock('../src/assistant-cli-tools.js', () => ({
    readAssistantCliLlmsManifest,
  }))
  const {
    resolveAssistantCliSurfaceBootstrapContext,
  } = await import('../src/assistant/cli-surface-bootstrap.ts')

  const summaryContract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-summary',
    vault: vaultRoot,
  })
  assert.equal(summaryContract, 'Persisted summary contract')
  assert.equal(readAssistantCliLlmsManifest.mock.calls.length, 0)

  const generatedContract = await resolveAssistantCliSurfaceBootstrapContext({
    sessionId: 'session-generated',
    vault: vaultRoot,
  })

  assert.ok(generatedContract)
  assert.match(generatedContract, /`search docs`/u)
  assert.deepEqual(readAssistantCliLlmsManifest.mock.calls, [
    [
      {
        cliEnv: undefined,
        detail: 'full',
        vault: vaultRoot,
        workingDirectory: undefined,
      },
    ],
  ])

  const generatedDocPath = resolveAssistantStateDocumentPath(
    {
      stateDirectory,
    },
    'sessions/session-generated/cli-surface-bootstrap',
  )
  const persisted = JSON.parse(await readFile(generatedDocPath, 'utf8')) as {
    contract: string
    generatedAt: string
    schemaVersion: string
  }
  assert.equal(persisted.contract, generatedContract)
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

  vi.doMock('../src/assistant-cli-tools.js', () => ({
    readAssistantCliLlmsManifest,
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
  vi.doMock('../src/assistant-cli-tools.js', () => ({
    readAssistantCliLlmsManifest,
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
