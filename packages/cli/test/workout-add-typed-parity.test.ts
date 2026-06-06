import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import type { WorkoutSession } from '@murphai/contracts'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

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

interface LlmManifestEnvelope {
  commands: Array<{
    name: string
    schema: CommandSchemaEnvelope
  }>
}

interface WorkoutAddResult {
  eventId: string
  lookupId: string
  kind: 'activity_session'
  title: string
  activityType: string
  durationMinutes: number
  distanceKm: number | null
  workout: WorkoutSession | null
  note: string
}

interface WorkoutShowResult {
  entity: {
    id: string
    kind: string
    title: string
    data: {
      source?: string
      note?: string
      activityType?: string
      durationMinutes?: number
      distanceKm?: number
      workout?: WorkoutSession | null
    }
  }
}

function createWorkoutCli() {
  const cli = Cli.create('vault-cli', {
    description: 'workout add typed parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerWorkoutCommands(cli, createIntegratedVaultServices())
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

function optionDescription(schema: CommandSchemaEnvelope, optionName: string): string {
  const property = schema.options.properties[optionName]
  assert.equal(typeof property, 'object', `missing ${optionName}`)
  assert.notEqual(property, null, `missing ${optionName}`)

  const description = (property as { description?: unknown }).description
  if (typeof description !== 'string') {
    assert.fail(`missing ${optionName} description`)
  }
  return description
}

async function readLlmCommandSchema(
  cli: Cli.Cli,
  commandName: string,
): Promise<CommandSchemaEnvelope> {
  const manifest = JSON.parse(
    await runRawInProcessCli(cli, ['--llms-full', '--format', 'json']),
  ) as LlmManifestEnvelope
  const command = manifest.commands.find((candidate) => candidate.name === commandName)
  if (!command) {
    assert.fail(`missing ${commandName}`)
  }
  return command.schema
}

function workoutSessionFixture(): WorkoutSession {
  return {
    sourceApp: 'strong',
    sourceWorkoutId: 'strong-session-100',
    startedAt: '2026-03-05T12:00:00.000Z',
    endedAt: '2026-03-05T12:45:00.000Z',
    routineId: 'upper-a',
    routineName: 'Upper A',
    sessionNote: 'Top set moved well.',
    media: [
      {
        kind: 'photo',
        relativePath: 'raw/workouts/2026/03/existing/bench.jpg',
        mediaType: 'image/jpeg',
        caption: 'Bench setup',
      },
    ],
    exercises: [
      {
        name: 'Bench press',
        sourceExerciseId: 'ex-bench',
        order: 1,
        mode: 'weight_reps',
        unitOverride: 'lb',
        note: 'Paused reps.',
        sets: [
          {
            order: 1,
            type: 'warmup',
            reps: 5,
            weight: 135,
            weightUnit: 'lb',
          },
          {
            order: 2,
            type: 'normal',
            reps: 5,
            weight: 185,
            weightUnit: 'lb',
            rpe: 8,
          },
        ],
      },
      {
        name: 'Ring row',
        order: 2,
        groupId: 'superset-a',
        mode: 'bodyweight',
        sets: [
          {
            order: 1,
            type: 'normal',
            reps: 10,
            bodyweightKg: 82,
          },
        ],
      },
    ],
  }
}

async function showWorkout(cli: Cli.Cli, vaultRoot: string, id: string) {
  const shown = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'show',
    id,
    '--vault',
    vaultRoot,
  ])
  assert.equal(shown.exitCode, null)
  assert.equal(shown.envelope.ok, true)
  return requireData(shown.envelope)
}

test('workout add schema exposes typed fields without raw input fallback', async () => {
  const cli = createWorkoutCli()

  const schema = await readCommandSchema(cli, ['workout', 'add'])
  assert.deepEqual(schema.args.required ?? [], [])

  for (const field of [
    'note',
    'title',
    'duration',
    'type',
    'distanceKm',
    'occurredAt',
    'source',
    'media',
    'workoutSourceApp',
    'workoutSourceWorkoutId',
    'workoutStartedAt',
    'workoutEndedAt',
    'workoutRoutineId',
    'workoutRoutineName',
    'workoutSessionNote',
    'workoutMedia',
    'workoutExercise',
    'workoutSet',
  ]) {
    assert.equal(field in schema.options.properties, true, `missing ${field}`)
  }
  assert.equal('input' in schema.options.properties, false)

  assert.match(
    optionDescription(schema, 'workoutMedia'),
    /Supported keys: kind, relativePath, mediaType, caption/u,
  )
  assert.match(optionDescription(schema, 'workoutMedia'), /Shell-quote each semicolon-separated value/u)
  assert.match(
    optionDescription(schema, 'workoutExercise'),
    /Supported keys: name, order, sourceExerciseId, groupId, mode, unitOverride, note/u,
  )
  assert.match(optionDescription(schema, 'workoutExercise'), /Shell-quote each semicolon-separated value/u)
  assert.match(
    optionDescription(schema, 'workoutSet'),
    /Supported keys: exercise, order, type, weightUnit, reps, weight, durationSeconds, distanceMeters, rpe, bodyweightKg, assistanceKg, addedWeightKg/u,
  )
  assert.match(optionDescription(schema, 'workoutSet'), /Shell-quote each semicolon-separated value/u)
})

test('workout add and edit help teach compact media, exercise, and set examples', async () => {
  const cli = createWorkoutCli()

  const addHelp = await runRawInProcessCli(cli, ['workout', 'add', '--help'])
  const editHelp = await runRawInProcessCli(cli, ['workout', 'edit', '--help'])
  const llmsFull = await runRawInProcessCli(cli, ['--llms-full'])

  for (const rendered of [addHelp, llmsFull]) {
    assert.match(rendered, /Capture workout media plus one structured exercise and set/u)
    assert.match(rendered, /raw\/workouts\/2026\/03\/upper\/bench\.jpg/u)
    assert.match(rendered, /--workoutExercise 'order=1;name=Bench press;mode=weight_reps;unitOverride=lb'/u)
    assert.match(rendered, /--workoutSet 'exercise=1;order=1;type=normal;reps=5;weight=185;weightUnit=lb'/u)
  }

  for (const rendered of [editHelp, llmsFull]) {
    assert.match(rendered, /Replace workout media plus one structured exercise and set/u)
    assert.match(rendered, /evt_01JQY2Z0R9Z5K6BT4CB4D9F4CA/u)
    assert.match(rendered, /raw\/workouts\/2026\/03\/upper\/bench\.jpg/u)
    assert.match(rendered, /--workoutSet 'exercise=1;order=1;type=normal;reps=5;weight=185;weightUnit=lb'/u)
  }
})

test('workout add and edit LLM schemas expose compact supported keys', async () => {
  const cli = createWorkoutCli()

  const addSchema = await readLlmCommandSchema(cli, 'workout add')
  assert.match(optionDescription(addSchema, 'workoutMedia'), /Compact workoutMedia grammar/u)
  assert.match(optionDescription(addSchema, 'workoutMedia'), /Shell-quote each semicolon-separated value/u)
  assert.match(optionDescription(addSchema, 'workoutExercise'), /Supported keys: name, order/u)
  assert.match(optionDescription(addSchema, 'workoutExercise'), /Shell-quote each semicolon-separated value/u)
  assert.match(optionDescription(addSchema, 'workoutSet'), /bodyweightKg, assistanceKg, addedWeightKg/u)

  const editSchema = await readLlmCommandSchema(cli, 'workout edit')
  assert.match(optionDescription(editSchema, 'workoutMedia'), /compact workoutMedia grammar/u)
  assert.match(optionDescription(editSchema, 'workoutMedia'), /Shell-quote each semicolon-separated value/u)
  assert.match(optionDescription(editSchema, 'workoutExercise'), /Supported keys: name, order/u)
  assert.match(optionDescription(editSchema, 'workoutExercise'), /Shell-quote each semicolon-separated value/u)
  assert.match(optionDescription(editSchema, 'workoutSet'), /bodyweightKg, assistanceKg, addedWeightKg/u)
})

test('workout import-json schema exposes the structured payload escape hatch', async () => {
  const cli = createWorkoutCli()

  const schema = await readCommandSchema(cli, ['workout', 'import-json'])
  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal(schema.options.required?.includes('input') ?? false, true)

  for (const field of [
    'input',
    'note',
    'title',
    'duration',
    'type',
    'distanceKm',
    'occurredAt',
    'source',
    'media',
  ]) {
    assert.equal(field in schema.options.properties, true, `missing ${field}`)
  }
})

test('workout add typed fields persist the same structured strength workout as JSON input', async () => {
  const cli = createWorkoutCli()
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-add-typed-')
  await initializeVault({ vaultRoot, title: 'Workout add typed parity vault' })

  const workout = workoutSessionFixture()
  const payload = {
    title: 'Garage upper body',
    note: 'Garage strength session.',
    activityType: 'strength-training',
    durationMinutes: 45,
    distanceKm: 0.4,
    occurredAt: '2026-03-05T12:00:00.000Z',
    source: 'device',
    workout,
  }
  const payloadPath = path.join(parentRoot, 'workout.json')
  await writeFile(payloadPath, JSON.stringify(payload), 'utf8')

  const jsonCreated = await runInProcessJsonCli<WorkoutAddResult>(cli, [
    'workout',
    'import-json',
    '--input',
    `@${payloadPath}`,
    '--vault',
    vaultRoot,
  ])
  assert.equal(jsonCreated.exitCode, null)
  assert.equal(jsonCreated.envelope.ok, true)

  const typedCreated = await runInProcessJsonCli<WorkoutAddResult>(cli, [
    'workout',
    'add',
    '--note',
    'Garage strength session.',
    '--title',
    'Garage upper body',
    '--type',
    'strength-training',
    '--duration',
    '45',
    '--distance-km',
    '0.4',
    '--occurred-at',
    '2026-03-05T12:00:00.000Z',
    '--source',
    'device',
    '--workout-source-app',
    'strong',
    '--workout-source-workout-id',
    'strong-session-100',
    '--workout-started-at',
    '2026-03-05T12:00:00.000Z',
    '--workout-ended-at',
    '2026-03-05T12:45:00.000Z',
    '--workout-routine-id',
    'upper-a',
    '--workout-routine-name',
    'Upper A',
    '--workout-session-note',
    'Top set moved well.',
    '--workout-media',
    'kind=photo;relativePath=raw/workouts/2026/03/existing/bench.jpg;mediaType=image/jpeg;caption=Bench setup',
    '--workout-exercise',
    'order=1;name=Bench press;sourceExerciseId=ex-bench;mode=weight_reps;unitOverride=lb;note=Paused reps.',
    '--workout-set',
    'exercise=1;order=1;type=warmup;reps=5;weight=135;weightUnit=lb',
    '--workout-set',
    'exercise=1;order=2;type=normal;reps=5;weight=185;weightUnit=lb;rpe=8',
    '--workout-exercise',
    'order=2;name=Ring row;groupId=superset-a;mode=bodyweight',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=10;bodyweightKg=82',
    '--vault',
    vaultRoot,
  ])
  assert.equal(typedCreated.exitCode, null)
  assert.equal(typedCreated.envelope.ok, true)

  const jsonData = requireData(jsonCreated.envelope)
  const typedData = requireData(typedCreated.envelope)
  assert.equal(typedData.title, jsonData.title)
  assert.equal(typedData.activityType, jsonData.activityType)
  assert.equal(typedData.durationMinutes, jsonData.durationMinutes)
  assert.equal(typedData.distanceKm, jsonData.distanceKm)
  assert.equal(typedData.note, jsonData.note)
  assert.deepEqual(typedData.workout, jsonData.workout)

  const jsonShown = await showWorkout(cli, vaultRoot, jsonData.lookupId)
  const typedShown = await showWorkout(cli, vaultRoot, typedData.lookupId)
  assert.equal(typedShown.entity.data.source, jsonShown.entity.data.source)
  assert.equal(typedShown.entity.data.note, jsonShown.entity.data.note)
  assert.equal(typedShown.entity.data.activityType, jsonShown.entity.data.activityType)
  assert.equal(typedShown.entity.data.durationMinutes, jsonShown.entity.data.durationMinutes)
  assert.equal(typedShown.entity.data.distanceKm, jsonShown.entity.data.distanceKm)
  assert.deepEqual(typedShown.entity.data.workout, jsonShown.entity.data.workout)
})

test('workout add and edit reject incomplete or ambiguous typed workout input', async () => {
  const cli = createWorkoutCli()
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-add-invalid-')
  await initializeVault({ vaultRoot, title: 'Workout add invalid typed vault' })

  const duplicateNote = await runInProcessJsonCli(cli, [
    'workout',
    'add',
    '30 minute run.',
    '--note',
    '30 minute run.',
    '--vault',
    vaultRoot,
  ])
  assert.equal(duplicateNote.exitCode, 1)
  assert.equal(duplicateNote.envelope.ok, false)
  assert.match(duplicateNote.envelope.error.message ?? '', /either positional workout text or --note/u)

  const missingExercise = await runInProcessJsonCli(cli, [
    'workout',
    'add',
    '--note',
    'Garage strength session.',
    '--duration',
    '45',
    '--type',
    'strength-training',
    '--workout-set',
    'exercise=1;order=1;reps=5',
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingExercise.exitCode, 1)
  assert.equal(missingExercise.envelope.ok, false)
  assert.match(missingExercise.envelope.error.message ?? '', /no matching --workout-exercise/u)

  const missingSet = await runInProcessJsonCli(cli, [
    'workout',
    'add',
    '--note',
    'Garage strength session.',
    '--duration',
    '45',
    '--type',
    'strength-training',
    '--workout-exercise',
    'order=1;name=Bench press',
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingSet.exitCode, 1)
  assert.equal(missingSet.envelope.ok, false)
  assert.match(missingSet.envelope.error.message ?? '', /Invalid workout session fields/u)

  const misspelledSetField = await runInProcessJsonCli(cli, [
    'workout',
    'add',
    '--note',
    'Garage strength session.',
    '--duration',
    '45',
    '--type',
    'strength-training',
    '--workout-exercise',
    'order=1;name=Bench press',
    '--workout-set',
    'exercise=1;order=1;reps=5;weightUnt=lb',
    '--vault',
    vaultRoot,
  ])
  assert.equal(misspelledSetField.exitCode, 1)
  assert.equal(misspelledSetField.envelope.ok, false)
  assert.match(misspelledSetField.envelope.error.message ?? '', /Unsupported --workout-set field "weightUnt"/u)
  assert.match(
    misspelledSetField.envelope.error.message ?? '',
    /Supported fields: exercise, order, type, weightUnit, reps, weight/u,
  )

  const traversingMediaPath = await runInProcessJsonCli(cli, [
    'workout',
    'add',
    '--note',
    'Garage strength session.',
    '--duration',
    '45',
    '--type',
    'strength-training',
    '--workout-media',
    'kind=photo;relativePath=raw/workouts/../../secrets.jpg',
    '--vault',
    vaultRoot,
  ])
  assert.equal(traversingMediaPath.exitCode, 1)
  assert.equal(traversingMediaPath.envelope.ok, false)
  assert.match(traversingMediaPath.envelope.error.message ?? '', /normalized raw\/workouts\/\*\*/u)

  const payloadPath = path.join(parentRoot, 'structured-workout.json')
  await writeFile(
    payloadPath,
    JSON.stringify({
      title: 'Garage upper body',
      note: 'Garage strength session.',
      activityType: 'strength-training',
      durationMinutes: 45,
      workout: workoutSessionFixture(),
    }),
    'utf8',
  )

  const mixedInputAndNestedSessionFlag = await runInProcessJsonCli(cli, [
    'workout',
    'add',
    '--input',
    `@${payloadPath}`,
    '--workout-source-app',
    'strong',
    '--vault',
    vaultRoot,
  ])
  assert.equal(mixedInputAndNestedSessionFlag.exitCode, 1)
  assert.equal(mixedInputAndNestedSessionFlag.envelope.ok, false)
  assert.match(
    mixedInputAndNestedSessionFlag.envelope.error.message ?? '',
    /input/u,
  )

  const editableWorkout = await runInProcessJsonCli<WorkoutAddResult>(cli, [
    'workout',
    'add',
    '--note',
    'Editable strength session.',
    '--duration',
    '45',
    '--type',
    'strength-training',
    '--vault',
    vaultRoot,
  ])
  assert.equal(editableWorkout.exitCode, null)
  assert.equal(editableWorkout.envelope.ok, true)
  const editableWorkoutData = requireData(editableWorkout.envelope)
  const beforeEdit = await showWorkout(cli, vaultRoot, editableWorkoutData.lookupId)

  const unsupportedEditField = await runInProcessJsonCli(cli, [
    'workout',
    'edit',
    editableWorkoutData.lookupId,
    '--workout-exercise',
    'order=1;name=Bench press;tempo=slow',
    '--vault',
    vaultRoot,
  ])
  assert.equal(unsupportedEditField.exitCode, 1)
  assert.equal(unsupportedEditField.envelope.ok, false)
  assert.match(
    unsupportedEditField.envelope.error.message ?? '',
    /Unsupported --workout-exercise field "tempo"/u,
  )
  assert.match(
    unsupportedEditField.envelope.error.message ?? '',
    /Supported fields: name, order, sourceExerciseId, groupId, mode/u,
  )

  const afterEdit = await showWorkout(cli, vaultRoot, editableWorkoutData.lookupId)
  assert.deepEqual(afterEdit.entity.data, beforeEdit.entity.data)
})
