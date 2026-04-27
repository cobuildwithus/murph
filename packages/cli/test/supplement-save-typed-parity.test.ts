import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { test } from 'vitest'

import { parseFrontmatterDocument } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { registerSupplementCommands } from '../src/commands/supplement.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>
    required?: string[]
  }
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface SupplementSaveResult {
  vault: string
  regimenId: string
  lookupId: string
  path?: string
  created: boolean
}

function createSupplementCli() {
  const cli = Cli.create('vault-cli', {
    description: 'supplement typed save parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerSupplementCommands(cli, services)

  return cli
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<string> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  assert.equal(exitCode, null)
  return output.join('').trim()
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, '--schema', '--format', 'json']),
  ) as CommandSchemaEnvelope
}

function requireSavedPath(result: SupplementSaveResult): string {
  if (!result.path) {
    throw new Error('Expected supplement save result to include a relative path.')
  }

  return result.path
}

test('supplement save schema exposes typed top-level dose fields and ingredient active', async () => {
  const schema = await readCommandSchema(createSupplementCli(), ['supplement', 'save'])

  assert.deepEqual(schema.args.required, ['title'])
  assert.equal('input' in schema.options.properties, false)
  assert.equal(schema.options.required?.includes('input') ?? false, false)

  for (const field of [
    'group',
    'substance',
    'dose',
    'doseUnit',
    'compound',
    'ingredientLabel',
    'amount',
    'unit',
    'ingredientActive',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test('supplement save persists top-level dose fields and one typed ingredient active flag', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-parity-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const saveResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Magnesium glycinate',
      '--slug',
      'magnesium-glycinate',
      '--status',
      'active',
      '--started-on',
      '2026-04-01',
      '--schedule',
      'before bed',
      '--group',
      'sleep/supplements',
      '--substance',
      'Magnesium glycinate',
      '--dose',
      '200',
      '--dose-unit',
      'mg',
      '--brand',
      'Test Brand',
      '--serving-size',
      '2 capsules',
      '--compound',
      'Magnesium',
      '--ingredient-label',
      'Magnesium glycinate',
      '--amount',
      '200',
      '--unit',
      'mg',
      '--no-ingredient-active',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, null)
    const saved = requireData(saveResult.envelope)
    assert.equal(saved.created, true)
    const relativePath = requireSavedPath(saved)
    assert.match(relativePath, /^bank\/regimens\/sleep\/supplements\/.+\.md$/u)

    const markdown = await readFile(path.join(vaultRoot, relativePath), 'utf8')
    const document = parseFrontmatterDocument(markdown)
    assert.equal(document.attributes.title, 'Magnesium glycinate')
    assert.equal(document.attributes.kind, 'supplement')
    assert.equal(document.attributes.status, 'active')
    assert.equal(document.attributes.startedOn, '2026-04-01')
    assert.equal(document.attributes.schedule, 'before bed')
    assert.equal(document.attributes.substance, 'Magnesium glycinate')
    assert.equal(document.attributes.dose, 200)
    assert.equal(document.attributes.unit, 'mg')
    assert.deepEqual(document.attributes.ingredients, [
      {
        compound: 'Magnesium',
        label: 'Magnesium glycinate',
        amount: 200,
        unit: 'mg',
        active: false,
      },
    ])
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('supplement save rejects conflicting top-level and ingredient dose units', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-save-conflict-',
  )

  try {
    const cli = createSupplementCli()
    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const saveResult = await runInProcessJsonCli<SupplementSaveResult>(cli, [
      'supplement',
      'save',
      'Vitamin D3',
      '--substance',
      'Vitamin D3',
      '--dose',
      '1000',
      '--dose-unit',
      'IU',
      '--compound',
      'Vitamin D3',
      '--amount',
      '1000',
      '--unit',
      'mcg',
      '--vault',
      vaultRoot,
    ])

    assert.equal(saveResult.exitCode, 1)
    assert.equal(saveResult.envelope.ok, false)
    if (!saveResult.envelope.ok) {
      assert.equal(saveResult.envelope.error.code, 'invalid_option')
      assert.match(saveResult.envelope.error.message ?? '', /--dose-unit and --unit/u)
    }
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
