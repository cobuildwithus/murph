import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Cli } from 'incur'
import { initializeVault } from '@murphai/core'
import { afterEach, test } from 'vitest'
import * as z from '@murphai/contracts/zod-runtime'

import { createVaultCli } from '../src/vault-cli.js'
import {
  createVaultCliVaultContext,
  extractVaultOverride,
  installVaultCliVaultContext,
} from '../src/vault-cli-vault-context.js'
import { runInProcessJsonCli } from './cli-test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) => rm(target, { force: true, recursive: true })),
  )
})

test('vault context hides vault from command schemas and injects it at execution', async () => {
  const { parentRoot, vaultRoot } = await createInitializedVault('murph-vault-context-')
  cleanupPaths.push(parentRoot)
  const cli = createVaultCli()

  const schema = await captureJson(cli, ['measurement', 'list', '--schema', '--format', 'json'])
  const optionsSchema = getRecord(schema, 'options')
  const optionProperties = getRecord(optionsSchema, 'properties')
  assert.equal(Object.hasOwn(optionProperties, 'vault'), false)
  assert.equal(Object.hasOwn(optionProperties, 'requestId'), true)

  const manifest = await captureJson(cli, ['--llms-full', '--format', 'json', 'measurement'])
  const commands = getArray(manifest, 'commands')
  const addCommand = commands.find(
    (entry): entry is Record<string, unknown> =>
      isRecord(entry) && entry.name === 'measurement add',
  )
  assert.ok(addCommand)
  const addSchema = getRecord(addCommand, 'schema')
  const addOptions = getRecord(addSchema, 'options')
  const addProperties = getRecord(addOptions, 'properties')
  assert.equal(Object.hasOwn(addProperties, 'vault'), false)
  assert.equal(JSON.stringify(addCommand.examples ?? []).includes('--vault'), false)

  const missingVault = await runInProcessJsonCli(cli, ['measurement', 'list'])
  assert.equal(missingVault.exitCode, 1)
  assert.equal(missingVault.envelope.ok, false)
  if (!missingVault.envelope.ok) {
    assert.equal(missingVault.envelope.error.code, 'missing_vault')
  }

  const result = await runInProcessJsonCli(cli, [
    'measurement',
    'list',
    '--vault',
    vaultRoot,
  ])
  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
})

test('vault context injects vault for fetch transport without command-level vault schema', async () => {
  const { parentRoot, vaultRoot } = await createInitializedVault('murph-vault-fetch-')
  cleanupPaths.push(parentRoot)
  const cli = createVaultCli()

  const queryResponse = await cli.fetch(
    new Request(`http://localhost/measurement/list?vault=${encodeURIComponent(vaultRoot)}`),
  )
  assert.equal(queryResponse.status, 200)
  assert.equal(await readFetchDataVault(queryResponse), vaultRoot)

  const headerResponse = await cli.fetch(
    new Request('http://localhost/measurement/list', {
      headers: {
        'x-murph-vault': vaultRoot,
      },
    }),
  )
  assert.equal(headerResponse.status, 200)
  assert.equal(await readFetchDataVault(headerResponse), vaultRoot)

  const duplicateResponse = await cli.fetch(
    new Request(`http://localhost/measurement/list?vault=${encodeURIComponent(vaultRoot)}`, {
      headers: {
        'x-murph-vault': vaultRoot,
      },
    }),
  )
  assert.equal(duplicateResponse.status, 400)
  assert.equal(await readFetchErrorCode(duplicateResponse), 'invalid_option')

  const emptyResponse = await cli.fetch(
    new Request('http://localhost/measurement/list?vault='),
  )
  assert.equal(emptyResponse.status, 400)
  assert.equal(await readFetchErrorCode(emptyResponse), 'invalid_option')
})

test('vault context keeps overlapping serve invocations isolated', async () => {
  const cli = Cli.create('test-cli')
  const firstMiddlewarePaused = createDeferred()
  const firstMiddlewareGate = createDeferred()
  const secondMiddlewarePaused = createDeferred()
  const secondMiddlewareGate = createDeferred()
  let middlewareEntrances = 0

  cli.use(async (_context, next) => {
    middlewareEntrances += 1
    if (middlewareEntrances === 1) {
      firstMiddlewarePaused.resolve()
      await firstMiddlewareGate.promise
    } else if (middlewareEntrances === 2) {
      secondMiddlewarePaused.resolve()
      await secondMiddlewareGate.promise
    }
    await next()
  })

  cli.command('read-vault', {
    options: z.object({
      vault: z.string().min(1),
    }),
    output: z.object({
      vault: z.string(),
    }),
    run(context) {
      return {
        vault: context.options.vault,
      }
    },
  })

  installVaultCliVaultContext(cli, createVaultCliVaultContext())

  const first = captureJson(cli, [
    'read-vault',
    '--vault',
    '/vaults/first',
    '--format',
    'json',
  ])
  await firstMiddlewarePaused.promise

  const second = captureJson(cli, [
    'read-vault',
    '--vault',
    '/vaults/second',
    '--format',
    'json',
  ])
  await secondMiddlewarePaused.promise

  firstMiddlewareGate.resolve()
  const firstResult = await first
  assert.ok(isRecord(firstResult))
  assert.equal(firstResult.vault, '/vaults/first')

  secondMiddlewareGate.resolve()
  const secondResult = await second
  assert.ok(isRecord(secondResult))
  assert.equal(secondResult.vault, '/vaults/second')
})

test('vault context installation is idempotent and preserves active invocation context', async () => {
  const { parentRoot, vaultRoot } = await createInitializedVault('murph-vault-idempotent-')
  cleanupPaths.push(parentRoot)
  const cli = createVaultCli()

  installVaultCliVaultContext(cli, createVaultCliVaultContext())

  const result = await runInProcessJsonCli(cli, [
    'measurement',
    'list',
    '--vault',
    vaultRoot,
  ])
  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)

  const response = await cli.fetch(
    new Request(`http://localhost/measurement/list?vault=${encodeURIComponent(vaultRoot)}`),
  )
  assert.equal(response.status, 200)
  assert.equal(await readFetchDataVault(response), vaultRoot)
})

test('nested serve and fetch calls inherit the active vault invocation context', async () => {
  const cli = Cli.create('test-cli')

  cli.command('read-vault', {
    options: z.object({
      vault: z.string().min(1),
    }),
    output: z.object({
      vault: z.string(),
    }),
    run(context) {
      return {
        vault: context.options.vault,
      }
    },
  })

  cli.command('nested-serve', {
    options: z.object({
      vault: z.string().min(1),
    }),
    output: z.object({
      vault: z.string(),
    }),
    async run() {
      const result = await captureJson(cli, ['read-vault', '--format', 'json'])
      return {
        vault: getString(result, 'vault'),
      }
    },
  })

  cli.command('nested-fetch', {
    options: z.object({
      vault: z.string().min(1),
    }),
    output: z.object({
      vault: z.string(),
    }),
    async run() {
      const response = await cli.fetch(new Request('http://localhost/read-vault'))
      assert.equal(response.status, 200)
      return {
        vault: await readFetchDataVault(response),
      }
    },
  })

  installVaultCliVaultContext(cli, createVaultCliVaultContext())

  const serveResult = await captureJson(cli, [
    'nested-serve',
    '--vault',
    '/vaults/outer',
    '--format',
    'json',
  ])
  assert.ok(isRecord(serveResult))
  assert.equal(serveResult.vault, '/vaults/outer')

  const fetchResult = await captureJson(cli, [
    'nested-fetch',
    '--vault',
    '/vaults/outer',
    '--format',
    'json',
  ])
  assert.ok(isRecord(fetchResult))
  assert.equal(fetchResult.vault, '/vaults/outer')
})

test('vault override parsing is a single boundary option, not a command option', () => {
  assert.deepEqual(extractVaultOverride(['measurement', 'list']), {
    argv: ['measurement', 'list'],
    explicit: false,
    vault: null,
  })
  assert.deepEqual(extractVaultOverride(['--vault', './vault', 'measurement', 'list']), {
    argv: ['measurement', 'list'],
    explicit: true,
    vault: './vault',
  })
  assert.deepEqual(extractVaultOverride(['measurement', 'list', '--vault=./vault']), {
    argv: ['measurement', 'list'],
    explicit: true,
    vault: './vault',
  })
  assert.deepEqual(extractVaultOverride(['measurement', 'list', '--', '--vault']), {
    argv: ['measurement', 'list', '--', '--vault'],
    explicit: false,
    vault: null,
  })
  assert.throws(() => extractVaultOverride(['--vault']), /Missing value for --vault/u)
  assert.throws(() => extractVaultOverride(['--vault=']), /Missing value for --vault/u)
  assert.throws(
    () => extractVaultOverride(['--vault', './one', '--vault', './two']),
    /Pass --vault only once/u,
  )
  assert.throws(
    () => extractVaultOverride(['--vault', './one', '--vault=./two']),
    /Pass --vault only once/u,
  )
})

test('measurement note flags accept prose commas while structured fields stay repeat-only', async () => {
  const { parentRoot, vaultRoot } = await createInitializedVault('murph-measurement-note-')
  cleanupPaths.push(parentRoot)
  const cli = createVaultCli()

  const added = await runInProcessJsonCli(cli, [
    'measurement',
    'add',
    '--vault',
    vaultRoot,
    '--metric',
    'strict pull-ups',
    '--value',
    '26',
    '--unit',
    'reps',
    '--measurement-note',
    'max strict pull-up baseline, dead hang',
  ])
  assert.equal(added.exitCode, null)
  assert.equal(added.envelope.ok, true)

  const rejected = await runInProcessJsonCli(cli, [
    'measurement',
    'add',
    '--vault',
    vaultRoot,
    '--metric',
    'strict pull-ups, bodyweight',
    '--value',
    '26',
    '--unit',
    'reps',
  ])
  assert.equal(rejected.exitCode, 1)
  assert.equal(rejected.envelope.ok, false)
  if (!rejected.envelope.ok) {
    assert.match(rejected.envelope.error.message ?? '', /Comma-delimited values/u)
  }
})

test('scheduled measurement notes share the prose-note parser', async () => {
  const { parentRoot, vaultRoot } = await createInitializedVault('murph-scheduled-note-')
  cleanupPaths.push(parentRoot)
  const cli = createVaultCli()

  const saved = await runInProcessJsonCli(cli, [
    'scheduled-log',
    'save',
    'Pull-up baseline reminder',
    '--vault',
    vaultRoot,
    '--schedule-kind',
    'dailyLocal',
    '--schedule-local-time',
    '08:00',
    '--action-kind',
    'measurement.add',
    '--action-title',
    'Pull-up baseline',
    '--measurement-metric',
    'strict-pull-ups',
    '--measurement-value',
    '26',
    '--measurement-unit',
    'reps',
    '--measurement-note',
    'max strict pull-up baseline, dead hang',
  ])
  assert.equal(saved.exitCode, null)
  assert.equal(saved.envelope.ok, true)
})

async function createInitializedVault(prefix: string): Promise<{
  parentRoot: string
  vaultRoot: string
}> {
  const parentRoot = await mkdtemp(path.join(tmpdir(), prefix))
  const vaultRoot = path.join(parentRoot, 'vault')
  await initializeVault({ vaultRoot })

  return {
    parentRoot,
    vaultRoot,
  }
}

async function captureJson(cli: Cli.Cli, argv: string[]): Promise<unknown> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(argv, {
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  assert.equal(exitCode, null)
  return JSON.parse(output.join('').trim()) as unknown
}

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolvePromise: (() => void) | null = null
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve() {
      if (resolvePromise === null) {
        assert.fail('Deferred promise was not initialized.')
      }
      resolvePromise()
    },
  }
}

async function readFetchDataVault(response: Response): Promise<string> {
  const envelope = await response.json() as unknown
  const data = getRecord(envelope, 'data')
  return getString(data, 'vault')
}

async function readFetchErrorCode(response: Response): Promise<string> {
  const envelope = await response.json() as unknown
  const error = getRecord(envelope, 'error')
  return getString(error, 'code')
}

function getString(source: unknown, key: string): string {
  assert.ok(isRecord(source))
  const value = source[key]
  if (typeof value !== 'string') {
    assert.fail(`Expected ${key} to be a string.`)
  }
  return value
}

function getRecord(source: unknown, key: string): Record<string, unknown> {
  assert.ok(isRecord(source))
  const value = source[key]
  assert.ok(isRecord(value))
  return value
}

function getArray(source: unknown, key: string): unknown[] {
  assert.ok(isRecord(source))
  const value = source[key]
  assert.ok(Array.isArray(value))
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
