import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { afterEach, test } from 'vitest'

import { createVaultCli } from '../src/vault-cli.js'
import { extractVaultOverride } from '../src/vault-cli-vault-context.js'
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
  assert.throws(
    () => extractVaultOverride(['--vault', './one', '--vault', './two']),
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

async function captureJson(cli: ReturnType<typeof createVaultCli>, argv: string[]): Promise<unknown> {
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
