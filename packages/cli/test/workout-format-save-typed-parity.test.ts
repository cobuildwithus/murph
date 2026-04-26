import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterEach, test } from 'vitest'

import { initializeVault, parseFrontmatterDocument } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWorkoutCommands } from '../src/commands/workout.js'
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

interface WorkoutFormatSaveResult {
  name: string
  slug: string
  path: string
  created: boolean
}

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, { force: true, recursive: true })
    }),
  )
})

function createWorkoutFormatCli() {
  const cli = Cli.create('vault-cli', {
    description: 'workout format typed parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerWorkoutCommands(cli, services)

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

async function readSavedAttributes(vaultRoot: string, relativePath: string) {
  const parsed = parseFrontmatterDocument(
    await readFile(path.join(vaultRoot, relativePath), 'utf8'),
  )
  return parsed.attributes
}

test('workout format save schema exposes typed routine-template parity fields', async () => {
  const cli = createWorkoutFormatCli()
  const schema = await readCommandSchema(cli, ['workout', 'format', 'save'])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('input' in schema.options.properties, true)
  assert.equal(schema.options.required?.includes('input') ?? false, false)

  for (const field of [
    'workoutFormatId',
    'slug',
    'status',
    'summary',
    'tag',
    'note',
    'templateText',
    'routineNote',
    'exercise',
    'setTemplate',
    'duration',
    'type',
    'distanceKm',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test.sequential('workout format save typed fields persist the same first-class document shape as JSON input', async () => {
  const jsonContext = await createTempVaultContext('murph-workout-format-json-')
  const typedContext = await createTempVaultContext('murph-workout-format-typed-')
  cleanupPaths.push(jsonContext.parentRoot, typedContext.parentRoot)

  const cli = createWorkoutFormatCli()
  await initializeVault({ vaultRoot: jsonContext.vaultRoot })
  await initializeVault({ vaultRoot: typedContext.vaultRoot })

  const payload = {
    workoutFormatId: 'wfmt_01JQY2Z0R9Z5K6BT4CB4D9F4CA',
    slug: 'upper-body-a',
    title: 'Upper Body A',
    status: 'active',
    summary: 'Default upper-body lift with push and row work.',
    activityType: 'strength-training',
    durationMinutes: 45,
    distanceKm: 0.5,
    tags: ['gym', 'strength'],
    note: 'Keep one rep in reserve.',
    templateText: '45 min strength training with pushups and rows.',
    template: {
      routineNote: 'Usual upper-body session.',
      exercises: [
        {
          name: 'pushups',
          order: 1,
          groupId: 'push',
          mode: 'bodyweight',
          note: 'Slow reps',
          plannedSets: [
            {
              order: 1,
              type: 'normal',
              targetReps: 20,
              targetRpe: 7,
            },
          ],
        },
        {
          name: 'row',
          order: 2,
          groupId: 'pull',
          mode: 'weight_reps',
          unitOverride: 'lb',
          note: 'Controlled tempo',
          plannedSets: [
            {
              order: 1,
              targetReps: 12,
              targetWeight: 40,
              targetWeightUnit: 'lb',
            },
          ],
        },
      ],
    },
  }
  const payloadPath = path.join(jsonContext.parentRoot, 'workout-format.json')
  await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8')

  const jsonSave = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    '--input',
    `@${payloadPath}`,
    '--vault',
    jsonContext.vaultRoot,
  ])
  const typedSave = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    'Upper Body A',
    '--workout-format-id',
    'wfmt_01JQY2Z0R9Z5K6BT4CB4D9F4CA',
    '--slug',
    'upper-body-a',
    '--summary',
    'Default upper-body lift with push and row work.',
    '--type',
    'strength-training',
    '--duration',
    '45',
    '--distance-km',
    '0.5',
    '--tag',
    'gym',
    '--tag',
    'strength',
    '--note',
    'Keep one rep in reserve.',
    '--template-text',
    '45 min strength training with pushups and rows.',
    '--routine-note',
    'Usual upper-body session.',
    '--exercise',
    'order=1;name=pushups;groupId=push;mode=bodyweight;note=Slow reps',
    '--set-template',
    'exercise=1;order=1;type=normal;targetReps=20;targetRpe=7',
    '--exercise',
    'order=2;name=row;groupId=pull;mode=weight_reps;unitOverride=lb;note=Controlled tempo',
    '--set-template',
    'exercise=2;order=1;targetReps=12;targetWeight=40;targetWeightUnit=lb',
    '--vault',
    typedContext.vaultRoot,
  ])

  const jsonResult = requireData(jsonSave.envelope)
  const typedResult = requireData(typedSave.envelope)
  assert.equal(jsonResult.created, true)
  assert.equal(typedResult.created, true)
  assert.equal(typedResult.slug, jsonResult.slug)
  assert.equal(typedResult.name, jsonResult.name)

  assert.deepEqual(
    await readSavedAttributes(typedContext.vaultRoot, typedResult.path),
    await readSavedAttributes(jsonContext.vaultRoot, jsonResult.path),
  )
})

test.sequential('workout format save rejects typed workout-format fields without a name', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-workout-format-typed-missing-name-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createWorkoutFormatCli()
  await initializeVault({ vaultRoot })

  const result = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    '--exercise',
    'order=1;name=pushups',
    '--vault',
    vaultRoot,
  ])

  assert.equal(result.envelope.ok, false)
  if (result.envelope.ok) {
    throw new Error('Expected the typed workout-format save call to fail.')
  }
  assert.equal(result.envelope.error.code, 'invalid_option')
  assert.match(
    result.envelope.error.message ?? '',
    /typed workout-format fields are provided/u,
  )
})

test.sequential('workout format save rejects conflicting typed template text inputs', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-workout-format-conflicting-text-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createWorkoutFormatCli()
  await initializeVault({ vaultRoot })

  const result = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    'Upper Body A',
    'Positional workout text.',
    '--template-text',
    'Option workout text.',
    '--exercise',
    'order=1;name=pushups',
    '--set-template',
    'exercise=1;order=1;targetReps=20',
    '--vault',
    vaultRoot,
  ])

  assert.equal(result.envelope.ok, false)
  if (result.envelope.ok) {
    throw new Error('Expected the conflicting template text call to fail.')
  }
  assert.equal(result.envelope.error.code, 'invalid_option')
  assert.match(
    result.envelope.error.message ?? '',
    /Pass either positional workout text or --template-text/u,
  )
})

test.sequential('workout format save supports metadata-only typed templates without text', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-workout-format-metadata-only-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createWorkoutFormatCli()
  await initializeVault({ vaultRoot })

  const result = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    'Zone 2 Ride',
    '--slug',
    'zone-2-ride',
    '--type',
    'cycling',
    '--duration',
    '45',
    '--distance-km',
    '18',
    '--vault',
    vaultRoot,
  ])

  assert.equal(result.exitCode, null)
  const saved = requireData(result.envelope)
  assert.equal(saved.slug, 'zone-2-ride')
  const attributes = await readSavedAttributes(vaultRoot, saved.path)
  assert.equal(attributes.schemaVersion, 'murph.frontmatter.workout-format.v1')
  assert.equal(attributes.docType, 'workout_format')
  assert.match(String(attributes.workoutFormatId), /^wfmt_/u)
  assert.equal(attributes.title, 'Zone 2 Ride')
  assert.equal(attributes.activityType, 'cycling')
  assert.equal(attributes.durationMinutes, 45)
  assert.equal(attributes.distanceKm, 18)
  assert.deepEqual(attributes.template, { exercises: [] })
})

test.sequential('workout format save rejects typed fields combined with raw input', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-workout-format-input-mix-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createWorkoutFormatCli()
  await initializeVault({ vaultRoot })

  const payloadPath = path.join(parentRoot, 'workout-format.json')
  await writeFile(
    payloadPath,
    JSON.stringify({
      title: 'Input Routine',
      activityType: 'strength-training',
      template: {
        exercises: [],
      },
    }),
    'utf8',
  )

  const result = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    '--input',
    `@${payloadPath}`,
    '--slug',
    'typed-slug',
    '--vault',
    vaultRoot,
  ])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  if (!result.envelope.ok) {
    assert.equal(result.envelope.error.code, 'invalid_option')
    assert.match(result.envelope.error.message ?? '', /cannot combine --input with --slug/u)
  }
})

test.sequential('workout format save rejects incomplete typed exercise templates before writing', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-workout-format-invalid-',
  )
  cleanupPaths.push(parentRoot)

  const cli = createWorkoutFormatCli()
  await initializeVault({ vaultRoot })

  const result = await runInProcessJsonCli<WorkoutFormatSaveResult>(cli, [
    'workout',
    'format',
    'save',
    'Broken Upper',
    '--type',
    'strength-training',
    '--exercise',
    'order=1;name=pushups',
    '--vault',
    vaultRoot,
  ])

  assert.notEqual(result.exitCode, null)
  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error.code, 'invalid_option')
  assert.match(result.envelope.error.message ?? '', /plannedSets/u)
})
