import assert from 'node:assert/strict'

import { initializeVault } from '@murphai/core'
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

interface WorkoutAddResult {
  lookupId: string
}

interface WorkoutShowResult {
  entity: {
    data: {
      workout?: {
        exercises?: Array<{
          groupId?: string
          name: string
          order: number
          sets?: Array<{ order: number; reps?: number }>
          targetWeightPerSet?: number
          targetWeightUnit?: string
        }>
      } | null
    }
  }
}

interface WorkoutStartResult {
  eventId: string
}

function createWorkoutCli() {
  const cli = Cli.create('vault-cli', {
    description: 'workout edit structure guard test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerWorkoutCommands(cli, createIntegratedVaultServices())
  return cli
}

async function addWorkout(
  cli: ReturnType<typeof createWorkoutCli>,
  vaultRoot: string,
  structuredArgs: string[],
): Promise<string> {
  const created = await runInProcessJsonCli<WorkoutAddResult>(cli, [
    'workout',
    'add',
    '--note',
    'Strength practice.',
    '--duration',
    '15',
    '--type',
    'strength-training',
    ...structuredArgs,
    '--vault',
    vaultRoot,
  ])
  assert.equal(created.exitCode, null)
  assert.equal(created.envelope.ok, true)
  return requireData(created.envelope).lookupId
}

test('workout edit rejects accidental set loss and accepts a complete replacement', async () => {
  const cli = createWorkoutCli()
  const { vaultRoot } = await createTempVaultContext('murph-workout-edit-guard-')
  await initializeVault({ vaultRoot, title: 'Workout edit guard vault' })

  const workoutId = await addWorkout(cli, vaultRoot, [
    '--workout-exercise',
    'order=1;name=Pull-up;mode=bodyweight',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=5',
    '--workout-set',
    'exercise=1;order=2;type=normal;reps=5',
  ])

  const partialReplacement = await runInProcessJsonCli(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Pull-up;mode=bodyweight',
    '--workout-set',
    'exercise=1;order=3;type=normal;reps=5',
    '--vault',
    vaultRoot,
  ])
  assert.equal(partialReplacement.exitCode, 1)
  assert.equal(partialReplacement.envelope.ok, false)
  assert.match(
    partialReplacement.envelope.error.message ?? '',
    /would remove saved set 1/u,
  )

  const unchanged = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'show',
    workoutId,
    '--vault',
    vaultRoot,
  ])
  assert.deepEqual(
    requireData(unchanged.envelope).entity.data.workout?.exercises?.[0]?.sets?.map(
      (set) => set.order,
    ),
    [1, 2],
  )

  const completeReplacement = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Pull-up;mode=bodyweight',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=5',
    '--workout-set',
    'exercise=1;order=2;type=normal;reps=5',
    '--workout-set',
    'exercise=1;order=3;type=normal;reps=5',
    '--vault',
    vaultRoot,
  ])
  assert.equal(completeReplacement.exitCode, null)
  assert.deepEqual(
    requireData(completeReplacement.envelope).entity.data.workout?.exercises?.[0]?.sets?.map(
      (set) => set.order,
    ),
    [1, 2, 3],
  )
})

test('workout edit can add the first structured exercise to an unstructured workout', async () => {
  const cli = createWorkoutCli()
  const { vaultRoot } = await createTempVaultContext('murph-workout-edit-first-structure-')
  await initializeVault({ vaultRoot, title: 'Workout first structure vault' })

  const workoutId = await addWorkout(cli, vaultRoot, [])
  const structured = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Pull-up;mode=bodyweight',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=5',
    '--vault',
    vaultRoot,
  ])

  assert.equal(structured.exitCode, null)
  assert.deepEqual(
    requireData(structured.envelope).entity.data.workout?.exercises?.map(
      (exercise) => ({
        name: exercise.name,
        order: exercise.order,
        sets: exercise.sets?.map((set) => set.order),
      }),
    ),
    [{ name: 'Pull-up', order: 1, sets: [1] }],
  )
})

test('workout edit matches saved exercises one-to-one', async () => {
  const cli = createWorkoutCli()
  const { vaultRoot } = await createTempVaultContext('murph-workout-edit-one-to-one-')
  await initializeVault({ vaultRoot, title: 'Workout edit one-to-one vault' })

  const workoutId = await addWorkout(cli, vaultRoot, [
    '--workout-exercise',
    'order=1;name=Single-arm row;groupId=left;mode=weight_reps',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=8',
    '--workout-exercise',
    'order=2;name=Single-arm row;groupId=right;mode=weight_reps',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=8',
  ])

  const destructiveReplacement = await runInProcessJsonCli(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Single-arm row;groupId=left;mode=weight_reps',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=8',
    '--vault',
    vaultRoot,
  ])

  assert.equal(destructiveReplacement.exitCode, 1)
  assert.equal(destructiveReplacement.envelope.ok, false)
  assert.match(
    destructiveReplacement.envelope.error.message ?? '',
    /would remove saved exercise 2/u,
  )
})

test('workout edit uses group ids to reorder same-name exercises without false set loss', async () => {
  const cli = createWorkoutCli()
  const { vaultRoot } = await createTempVaultContext(
    'murph-workout-edit-group-reorder-',
  )
  await initializeVault({
    vaultRoot,
    title: 'Workout grouped exercise reorder vault',
  })

  const workoutId = await addWorkout(cli, vaultRoot, [
    '--workout-exercise',
    'order=1;name=Single-arm row;groupId=left;mode=weight_reps',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=8',
    '--workout-set',
    'exercise=1;order=2;type=normal;reps=8',
    '--workout-exercise',
    'order=2;name=Single-arm row;groupId=right;mode=weight_reps',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=8',
  ])

  const reordered = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Single-arm row;groupId=right;mode=weight_reps',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=8',
    '--workout-exercise',
    'order=2;name=Single-arm row;groupId=left;mode=weight_reps',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=8',
    '--workout-set',
    'exercise=2;order=2;type=normal;reps=8',
    '--vault',
    vaultRoot,
  ])

  assert.equal(reordered.exitCode, null)
  assert.deepEqual(
    requireData(reordered.envelope).entity.data.workout?.exercises?.map(
      (exercise) => ({
        groupId: exercise.groupId,
        order: exercise.order,
        sets: exercise.sets?.map((set) => set.order),
      }),
    ),
    [
      { groupId: 'right', order: 1, sets: [1] },
      { groupId: 'left', order: 2, sets: [1, 2] },
    ],
  )
})

test('workout edit allows exercises to be reordered without losing their sets', async () => {
  const cli = createWorkoutCli()
  const { vaultRoot } = await createTempVaultContext('murph-workout-edit-reorder-')
  await initializeVault({ vaultRoot, title: 'Workout edit reorder vault' })

  const workoutId = await addWorkout(cli, vaultRoot, [
    '--workout-exercise',
    'order=1;name=Pull-up;mode=bodyweight',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=5',
    '--workout-set',
    'exercise=1;order=2;type=normal;reps=5',
    '--workout-exercise',
    'order=2;name=Push-up;mode=bodyweight',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=10',
  ])

  const reordered = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Push-up;mode=bodyweight',
    '--workout-set',
    'exercise=1;order=1;type=normal;reps=10',
    '--workout-exercise',
    'order=2;name=Pull-up;mode=bodyweight',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=5',
    '--workout-set',
    'exercise=2;order=2;type=normal;reps=5',
    '--vault',
    vaultRoot,
  ])

  assert.equal(reordered.exitCode, null)
  assert.deepEqual(
    requireData(reordered.envelope).entity.data.workout?.exercises?.map(
      (exercise) => ({
        name: exercise.name,
        order: exercise.order,
        sets: exercise.sets?.map((set) => set.order),
      }),
    ),
    [
      { name: 'Push-up', order: 1, sets: [1] },
      { name: 'Pull-up', order: 2, sets: [1, 2] },
    ],
  )
})

test('workout edit preserves an exact planned load and rejects an incompatible unit', async () => {
  const cli = createWorkoutCli()
  const { vaultRoot } = await createTempVaultContext('murph-workout-edit-target-')
  await initializeVault({ vaultRoot, title: 'Workout edit target vault' })

  const started = await runInProcessJsonCli<WorkoutStartResult>(cli, [
    'workout',
    'start',
    'Press session',
    '--exercise',
    'name=Bench press;sets=3;reps=8;targetWeight=135;targetWeightUnit=lb;mode=weight_reps',
    '--vault',
    vaultRoot,
  ])
  const workoutId = requireData(started.envelope).eventId

  const edited = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Bench press;mode=weight_reps;unitOverride=lb',
    '--workout-set',
    'exercise=1;order=1;type=normal',
    '--workout-set',
    'exercise=1;order=2;type=normal',
    '--workout-set',
    'exercise=1;order=3;type=normal',
    '--workout-exercise',
    'order=2;name=Push-up;mode=bodyweight',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=10',
    '--vault',
    vaultRoot,
  ])
  assert.equal(edited.exitCode, null)
  assert.deepEqual(
    requireData(edited.envelope).entity.data.workout?.exercises?.[0],
    {
      memberRepsPerSet: 8,
      mode: 'weight_reps',
      name: 'Bench press',
      order: 1,
      setPlanIsFinite: true,
      sets: [
        { order: 1, type: 'normal' },
        { order: 2, type: 'normal' },
        { order: 3, type: 'normal' },
      ],
      targetWeightPerSet: 135,
      targetWeightUnit: 'lb',
      unitOverride: 'lb',
    },
  )

  const incompatible = await runInProcessJsonCli(cli, [
    'workout',
    'edit',
    workoutId,
    '--workout-exercise',
    'order=1;name=Bench press;mode=weight_reps;unitOverride=kg',
    '--workout-set',
    'exercise=1;order=1;type=normal',
    '--workout-set',
    'exercise=1;order=2;type=normal',
    '--workout-set',
    'exercise=1;order=3;type=normal',
    '--workout-exercise',
    'order=2;name=Push-up;mode=bodyweight',
    '--workout-set',
    'exercise=2;order=1;type=normal;reps=10',
    '--vault',
    vaultRoot,
  ])
  assert.equal(incompatible.exitCode, 1)
  if (incompatible.envelope.ok) {
    assert.fail('Expected an incompatible planned-load unit to be rejected.')
  }
  assert.match(
    incompatible.envelope.error.message ?? '',
    /cannot change the weight unit/u,
  )

  const unchanged = await runInProcessJsonCli<WorkoutShowResult>(cli, [
    'workout',
    'show',
    workoutId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(
    requireData(unchanged.envelope).entity.data.workout?.exercises?.[0]
      ?.targetWeightPerSet,
    135,
  )
  assert.equal(
    requireData(unchanged.envelope).entity.data.workout?.exercises?.[0]
      ?.targetWeightUnit,
    'lb',
  )
})
