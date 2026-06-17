import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { test } from 'vitest'

import { parseFrontmatterDocument } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { registerMedicationCommands } from '../src/commands/medication.js'
import { registerProtocolCommands } from '../src/commands/protocol.js'
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

interface SaveResult {
  vault: string
  regimenId: string
  lookupId: string
  path?: string
  created: boolean
}

function createTypedSaveCli() {
  const cli = Cli.create('vault-cli', {
    description: 'supplement/regimen typed save test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerMedicationCommands(cli, services)
  registerSupplementCommands(cli, services)
  registerProtocolCommands(cli, services)

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

function requireSavedPath(result: SaveResult): string {
  if (!result.path) {
    throw new Error('Expected save result to include a relative path.')
  }

  return result.path
}

async function listRelativeFiles(root: string, relativePath = ''): Promise<string[]> {
  const directory = path.join(root, relativePath)
  if (!existsSync(directory)) {
    return []
  }

  const entries = await readdir(directory, {
    withFileTypes: true,
  })
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(relativePath, entry.name)
      if (entry.isDirectory()) {
        return listRelativeFiles(root, entryPath)
      }

      return [entryPath]
    }),
  )

  return nestedFiles.flat().sort()
}

test('supplement and regimen save schemas expose typed fields while regimen JSON import remains explicit', async () => {
  const cli = createTypedSaveCli()

  const supplementSave = await readCommandSchema(cli, ['supplement', 'save'])
  assert.deepEqual(supplementSave.args.required, ['title'])
  assert.equal('input' in supplementSave.options.properties, false)
  assert.equal(supplementSave.options.required?.includes('input') ?? false, false)
  for (const field of [
    'id',
    'slug',
    'status',
    'startedOn',
    'stoppedOn',
    'schedule',
    'brand',
    'manufacturer',
    'servingSize',
    'ingredient',
    'relatedGoalId',
    'relatedConditionId',
    'relatedRegimenId',
  ]) {
    assert.equal(field in supplementSave.options.properties, true, field)
  }
  for (const staleField of [
    'compound',
    'ingredientLabel',
    'amount',
    'unit',
    'ingredientActive',
    'note',
  ]) {
    assert.equal(staleField in supplementSave.options.properties, false, staleField)
  }

  const regimenSave = await readCommandSchema(cli, ['regimen', 'save'])
  assert.deepEqual(regimenSave.args.required, ['title'])
  assert.equal('input' in regimenSave.options.properties, false)
  assert.equal(regimenSave.options.required?.includes('input') ?? false, false)
  assert.equal(regimenSave.options.required?.includes('kind') ?? false, true)
  for (const field of [
    'id',
    'slug',
    'kind',
    'status',
    'startedOn',
    'stoppedOn',
    'schedule',
    'substance',
    'dose',
    'unit',
    'note',
    'group',
    'relatedGoalId',
    'relatedConditionId',
    'relatedRegimenId',
  ]) {
    assert.equal(field in regimenSave.options.properties, true, field)
  }

  const medicationHistoryAdd = await readCommandSchema(cli, ['medication', 'history', 'add'])
  assert.deepEqual(medicationHistoryAdd.args.required, ['title'])
  assert.equal('status' in medicationHistoryAdd.options.properties, false)
  assert.equal(medicationHistoryAdd.options.required?.includes('startedOn') ?? false, true)
  for (const field of [
    'stoppedOn',
    'schedule',
    'substance',
    'dose',
    'unit',
    'group',
    'note',
  ]) {
    assert.equal(field in medicationHistoryAdd.options.properties, true, field)
  }

  const regimenJsonFallback = await readCommandSchema(cli, ['regimen', 'import-json'])
  assert.equal('input' in regimenJsonFallback.options.properties, true)
  assert.equal(regimenJsonFallback.options.required?.includes('input') ?? false, true)
  assert.deepEqual(regimenJsonFallback.args.required ?? [], [])
})

test('typed save commands write supplement and regimen records without JSON payload files', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-supplement-regimen-save-',
  )

  try {
    const cli = createTypedSaveCli()

    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    const supplementResult = await runInProcessJsonCli<SaveResult>(cli, [
      'supplement',
      'save',
      'Liposomal Vitamin C',
      '--slug',
      'liposomal-vitamin-c',
      '--status',
      'active',
      '--started-on',
      '2026-03-01',
      '--schedule',
      'with breakfast',
      '--brand',
      'LivOn Labs',
      '--manufacturer',
      'LivOn Laboratories',
      '--serving-size',
      '1 packet',
      '--ingredient',
      '{"compound":"Vitamin C","label":"Ascorbic acid","amount":500,"unit":"mg","note":"Use with breakfast."}',
      '--related-goal-id',
      'goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8',
      '--related-condition-id',
      'cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9',
      '--vault',
      vaultRoot,
    ])
    assert.equal(supplementResult.exitCode, null)
    const savedSupplement = requireData(supplementResult.envelope)
    assert.equal(savedSupplement.created, true)

    const supplementMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(savedSupplement)),
      'utf8',
    )
    const supplementDocument = parseFrontmatterDocument(supplementMarkdown)
    assert.equal(supplementDocument.attributes.title, 'Liposomal Vitamin C')
    assert.equal(supplementDocument.attributes.kind, 'supplement')
    assert.equal(supplementDocument.attributes.status, 'active')
    assert.equal(supplementDocument.attributes.startedOn, '2026-03-01')
    assert.equal(supplementDocument.attributes.schedule, 'with breakfast')
    assert.equal(supplementDocument.attributes.brand, 'LivOn Labs')
    assert.equal(supplementDocument.attributes.manufacturer, 'LivOn Laboratories')
    assert.equal(supplementDocument.attributes.servingSize, '1 packet')
    assert.deepEqual(supplementDocument.attributes.ingredients, [
      {
        compound: 'Vitamin C',
        label: 'Ascorbic acid',
        amount: 500,
        unit: 'mg',
        note: 'Use with breakfast.',
      },
    ])
    assert.deepEqual(supplementDocument.attributes.relatedGoalIds, [
      'goal_01JNW7YJ7MNE7M9Q2QWQK4Z3F8',
    ])
    assert.deepEqual(supplementDocument.attributes.relatedConditionIds, [
      'cond_01JNW7YJ7MNE7M9Q2QWQK4Z3F9',
    ])

    const regimenResult = await runInProcessJsonCli<SaveResult>(cli, [
      'regimen',
      'save',
      'Morning light walk',
      '--slug',
      'morning-light-walk',
      '--kind',
      'habit',
      '--status',
      'active',
      '--started-on',
      '2026-03-02',
      '--schedule',
      '10 minutes after waking',
      '--substance',
      'Outdoor light',
      '--dose',
      '10',
      '--unit',
      'min',
      '--note',
      'Recorded from morning routine plan.',
      '--group',
      'light',
      '--related-regimen-id',
      savedSupplement.regimenId,
      '--vault',
      vaultRoot,
    ])
    assert.equal(regimenResult.exitCode, null)
    const savedRegimen = requireData(regimenResult.envelope)
    assert.equal(savedRegimen.created, true)

    const regimenMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(savedRegimen)),
      'utf8',
    )
    const regimenDocument = parseFrontmatterDocument(regimenMarkdown)
    assert.equal(regimenDocument.attributes.title, 'Morning light walk')
    assert.equal(regimenDocument.attributes.kind, 'habit')
    assert.equal(regimenDocument.attributes.status, 'active')
    assert.equal(regimenDocument.attributes.startedOn, '2026-03-02')
    assert.equal(regimenDocument.attributes.schedule, '10 minutes after waking')
    assert.equal(regimenDocument.attributes.substance, 'Outdoor light')
    assert.equal(regimenDocument.attributes.dose, 10)
    assert.equal(regimenDocument.attributes.unit, 'min')
    assert.equal(regimenDocument.attributes.note, 'Recorded from morning routine plan.')
    assert.deepEqual(regimenDocument.attributes.relatedRegimenIds, [
      savedSupplement.regimenId,
    ])

    const medicationHistoryResult = await runInProcessJsonCli<SaveResult>(cli, [
      'medication',
      'history',
      'add',
      'Antibiotic course',
      '--started-on',
      '2019-04-10',
      '--stopped-on',
      '2019-04-20',
      '--substance',
      'amoxicillin',
      '--dose',
      '875',
      '--unit',
      'mg',
      '--schedule',
      'twice daily',
      '--note',
      'Copied from imported record.',
      '--vault',
      vaultRoot,
    ])
    assert.equal(medicationHistoryResult.exitCode, null)
    const savedMedicationHistory = requireData(medicationHistoryResult.envelope)
    assert.equal(savedMedicationHistory.created, true)
    assert.match(requireSavedPath(savedMedicationHistory), /^bank\/regimens\/medication\/history\//u)

    const medicationHistoryMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(savedMedicationHistory)),
      'utf8',
    )
    const medicationHistoryDocument = parseFrontmatterDocument(medicationHistoryMarkdown)
    assert.equal(medicationHistoryDocument.attributes.title, 'Antibiotic course')
    assert.equal(medicationHistoryDocument.attributes.kind, 'medication')
    assert.equal(medicationHistoryDocument.attributes.status, 'completed')
    assert.equal(medicationHistoryDocument.attributes.startedOn, '2019-04-10')
    assert.equal(medicationHistoryDocument.attributes.stoppedOn, '2019-04-20')
    assert.equal(medicationHistoryDocument.attributes.substance, 'amoxicillin')
    assert.equal(medicationHistoryDocument.attributes.dose, 875)
    assert.equal(medicationHistoryDocument.attributes.unit, 'mg')
    assert.equal(medicationHistoryDocument.attributes.schedule, 'twice daily')
    assert.equal(medicationHistoryDocument.attributes.note, 'Copied from imported record.')

    const collidingGeneratedMedicationHistoryResult = await runInProcessJsonCli<SaveResult>(cli, [
      'medication',
      'history',
      'add',
      'Antibiotic course',
      '--started-on',
      '2019-04-10',
      '--stopped-on',
      '2019-04-20',
      '--substance',
      'azithromycin',
      '--dose',
      '250',
      '--unit',
      'mg',
      '--vault',
      vaultRoot,
    ])
    assert.equal(collidingGeneratedMedicationHistoryResult.exitCode, 1)
    assert.equal(collidingGeneratedMedicationHistoryResult.envelope.ok, false)
    if (!collidingGeneratedMedicationHistoryResult.envelope.ok) {
      assert.match(
        collidingGeneratedMedicationHistoryResult.envelope.error.message ?? '',
        /Medication history course already exists/u,
      )
    }

    const medicationHistoryMarkdownAfterCollision = await readFile(
      path.join(vaultRoot, requireSavedPath(savedMedicationHistory)),
      'utf8',
    )
    const medicationHistoryDocumentAfterCollision = parseFrontmatterDocument(
      medicationHistoryMarkdownAfterCollision,
    )
    assert.equal(medicationHistoryDocumentAfterCollision.attributes.substance, 'amoxicillin')
    assert.equal(medicationHistoryDocumentAfterCollision.attributes.dose, 875)

    const secondMedicationHistoryResult = await runInProcessJsonCli<SaveResult>(cli, [
      'medication',
      'history',
      'add',
      'Antibiotic course',
      '--started-on',
      '2020-05-01',
      '--stopped-on',
      '2020-05-10',
      '--substance',
      'amoxicillin',
      '--dose',
      '875',
      '--unit',
      'mg',
      '--vault',
      vaultRoot,
    ])
    assert.equal(secondMedicationHistoryResult.exitCode, null)
    const secondSavedMedicationHistory = requireData(secondMedicationHistoryResult.envelope)
    assert.equal(secondSavedMedicationHistory.created, true)
    assert.equal(
      requireSavedPath(savedMedicationHistory),
      'bank/regimens/medication/history/antibiotic-course-2019-04-10-2019-04-20.md',
    )
    assert.equal(
      requireSavedPath(secondSavedMedicationHistory),
      'bank/regimens/medication/history/antibiotic-course-2020-05-01-2020-05-10.md',
    )

    const explicitIdMedicationHistoryResult = await runInProcessJsonCli<SaveResult>(cli, [
      'medication',
      'history',
      'add',
      'Antibiotic course',
      '--id',
      'reg_01JNYB6M9A6W4K2N8P3Q7R5S7A',
      '--started-on',
      '2021-06-01',
      '--stopped-on',
      '2021-06-10',
      '--substance',
      'amoxicillin',
      '--dose',
      '875',
      '--unit',
      'mg',
      '--vault',
      vaultRoot,
    ])
    assert.equal(explicitIdMedicationHistoryResult.exitCode, null)
    const explicitIdMedicationHistory = requireData(explicitIdMedicationHistoryResult.envelope)
    assert.equal(explicitIdMedicationHistory.created, true)

    const secondExplicitIdMedicationHistoryResult = await runInProcessJsonCli<SaveResult>(cli, [
      'medication',
      'history',
      'add',
      'Antibiotic course',
      '--id',
      'reg_01JNYB6M9A6W4K2N8P3Q7R5S7B',
      '--started-on',
      '2022-07-01',
      '--stopped-on',
      '2022-07-10',
      '--substance',
      'amoxicillin',
      '--dose',
      '875',
      '--unit',
      'mg',
      '--vault',
      vaultRoot,
    ])
    assert.equal(secondExplicitIdMedicationHistoryResult.exitCode, null)
    const secondExplicitIdMedicationHistory = requireData(
      secondExplicitIdMedicationHistoryResult.envelope,
    )
    assert.equal(secondExplicitIdMedicationHistory.created, true)
    assert.equal(
      requireSavedPath(explicitIdMedicationHistory),
      'bank/regimens/medication/history/antibiotic-course-2021-06-01-2021-06-10.md',
    )
    assert.equal(
      requireSavedPath(secondExplicitIdMedicationHistory),
      'bank/regimens/medication/history/antibiotic-course-2022-07-01-2022-07-10.md',
    )

    const collidingExplicitIdMedicationHistoryResult = await runInProcessJsonCli<SaveResult>(cli, [
      'medication',
      'history',
      'add',
      'Antibiotic course',
      '--id',
      'reg_01JNYB6M9A6W4K2N8P3Q7R5S7C',
      '--started-on',
      '2021-06-01',
      '--stopped-on',
      '2021-06-10',
      '--substance',
      'azithromycin',
      '--dose',
      '250',
      '--unit',
      'mg',
      '--vault',
      vaultRoot,
    ])
    assert.equal(collidingExplicitIdMedicationHistoryResult.exitCode, 1)
    assert.equal(collidingExplicitIdMedicationHistoryResult.envelope.ok, false)
    if (!collidingExplicitIdMedicationHistoryResult.envelope.ok) {
      assert.match(
        collidingExplicitIdMedicationHistoryResult.envelope.error.message ?? '',
        /regimenId and slug resolve to different regimen records/u,
      )
    }

    const explicitIdMedicationHistoryMarkdown = await readFile(
      path.join(vaultRoot, requireSavedPath(explicitIdMedicationHistory)),
      'utf8',
    )
    const explicitIdMedicationHistoryDocument = parseFrontmatterDocument(
      explicitIdMedicationHistoryMarkdown,
    )
    assert.equal(
      explicitIdMedicationHistoryDocument.attributes.regimenId,
      'reg_01JNYB6M9A6W4K2N8P3Q7R5S7A',
    )
    assert.equal(explicitIdMedicationHistoryDocument.attributes.substance, 'amoxicillin')
    assert.equal(explicitIdMedicationHistoryDocument.attributes.dose, 875)
    assert.deepEqual(
      await listRelativeFiles(path.join(vaultRoot, 'ledger', 'events')),
      [],
    )
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})

test('regimen import-json accepts explicit JSON payload files', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-regimen-import-',
  )
  const regimenPayloadPath = path.join(parentRoot, 'regimen.json')

  try {
    const cli = createTypedSaveCli()

    const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.exitCode, null)
    assert.equal(requireData(initResult.envelope).created, true)

    await writeFile(
      regimenPayloadPath,
      JSON.stringify(
        {
          title: 'Morning light walk',
          kind: 'habit',
          status: 'active',
          startedOn: '2026-03-01',
          schedule: '10 minutes after waking',
          substance: 'walking',
        },
        null,
        2,
      ),
      'utf8',
    )
    const regimenImport = await runInProcessJsonCli<SaveResult>(cli, [
      'regimen',
      'import-json',
      '--input',
      `@${regimenPayloadPath}`,
      '--vault',
      vaultRoot,
    ])

    assert.equal(regimenImport.exitCode, null)
    const savedRegimen = requireData(regimenImport.envelope)
    assert.equal(savedRegimen.created, true)
    const regimenPath = requireSavedPath(savedRegimen)

    const regimenMarkdown = await readFile(
      path.join(vaultRoot, regimenPath),
      'utf8',
    )
    const regimenDocument = parseFrontmatterDocument(regimenMarkdown)
    assert.equal(regimenDocument.attributes.title, 'Morning light walk')
    assert.equal(regimenDocument.attributes.kind, 'habit')
    assert.equal(regimenDocument.attributes.status, 'active')
    assert.equal(regimenDocument.attributes.startedOn, '2026-03-01')
    assert.equal(regimenDocument.attributes.schedule, '10 minutes after waking')
    assert.equal(regimenDocument.attributes.substance, 'walking')
  } finally {
    await rm(parentRoot, {
      force: true,
      recursive: true,
    })
  }
})
