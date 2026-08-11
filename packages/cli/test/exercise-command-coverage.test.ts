import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { exerciseRoutineResponseCardV1Schema } from '@murphai/contracts'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerExerciseCommands } from '../src/commands/exercise.js'
import {
  getGeneratedExerciseCatalogReader,
  type ExerciseCatalogReader,
} from '@murphai/exercise-library/runtime'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

function createExerciseSliceCli(options: { getCatalogReader?: () => ExerciseCatalogReader } = {}) {
  const cli = Cli.create('vault-cli', {
    description: 'exercise coverage cli',
    version: '0.0.0-test',
  })

  cli.use(incurErrorBridge)
  registerExerciseCommands(cli, options)

  return cli
}

test('exercise list show and facets expose the public movement catalog', async () => {
  const cli = createExerciseSliceCli()

  const listResult = await runInProcessJsonCli<{
    items: Array<{
      id: string
      kind: string
      name: string
      slug: string
    }>
    total: number
  }>(cli, [
    'exercise',
    'list',
    '--query',
    'bodyweight squat',
    '--kind',
    'exercise',
    '--equipment',
    'none',
    '--limit',
    '5',
  ])

  assert.equal(listResult.envelope.ok, true)
  const listData = requireData(listResult.envelope)
  assert.ok(listData.total > 0)
  assert.equal(listData.items[0]?.id, 'EX001')
  assert.equal(listData.items[0]?.slug, 'bodyweight-squat')

  const showResult = await runInProcessJsonCli<{
    item: {
      id: string
      images: Array<{ url: string; step: string; alt: string }>
      sourceIds: number[]
      steps: string[]
      tips: string[]
    }
    sources: Array<{ id: number; url: string }>
  }>(cli, ['exercise', 'show', 'EX001'])

  assert.equal(showResult.envelope.ok, true)
  const showData = requireData(showResult.envelope)
  assert.equal(showData.item.id, 'EX001')
  assert.equal(showData.item.images.length, 3)
  assert.equal(showData.item.images[0]?.step, 'Setup')
  assert.match(showData.item.images[0]?.url ?? '', /^https:\/\/imagedelivery\.net\//u)
  assert.ok(showData.item.sourceIds.length > 0)
  assert.ok(showData.sources.length > 0)
  assert.ok(showData.item.steps.length > 0)
  assert.ok(showData.item.tips.length > 0)

  const secondImage = showData.item.images[1]
  assert.ok(secondImage)
  assert.equal(secondImage.step, 'Bottom position')
  const routineCard = exerciseRoutineResponseCardV1Schema.parse({
    exercises: [{
      dose: '5 repetitions',
      estimatedSeconds: 30,
      images: [{
        ...secondImage,
        source: `exercise_catalog:${showData.item.id}:2`,
      }],
      instructions: ['Sit the hips back and keep the heels down.'],
      name: 'Bodyweight squat',
    }],
    footer: null,
    intensity: 'Easy',
    kind: 'exercise_routine',
    labels: {
      dose: 'Dose',
      exercise: 'Exercise',
      time: 'Time',
      visualGuide: 'Visual guide',
    },
    safety: 'Stop if pain increases.',
    subtitle: null,
    title: 'Squat practice',
    totalSeconds: 30,
    transitionSeconds: 0,
    version: 1,
  })
  assert.equal(routineCard.exercises[0]?.images[0]?.source, 'exercise_catalog:EX001:2')
  assert.equal(routineCard.exercises[0]?.images[0]?.step, 'Bottom position')

  const longAltResult = await runInProcessJsonCli<{
    item: {
      id: string
      images: Array<{ url: string; step: string; alt: string }>
    }
  }>(cli, ['exercise', 'show', 'EX664'])
  assert.equal(longAltResult.envelope.ok, true)
  const longAltData = requireData(longAltResult.envelope)
  const longAltImage = longAltData.item.images[2]
  assert.ok(longAltImage)
  assert.equal(longAltImage.alt.length, 500)
  const longAltRoutine = exerciseRoutineResponseCardV1Schema.parse({
    ...routineCard,
    exercises: [{
      ...routineCard.exercises[0],
      images: [{
        ...longAltImage,
        source: `exercise_catalog:${longAltData.item.id}:3`,
      }],
    }],
  })
  assert.equal(longAltRoutine.exercises[0]?.images[0]?.alt.length, 500)
  assert.equal(longAltRoutine.exercises[0]?.images[0]?.source, 'exercise_catalog:EX664:3')

  const catCowResult = await runInProcessJsonCli<{
    item: {
      id: string
      images: Array<{ url: string; step: string; alt: string }>
    }
  }>(cli, ['exercise', 'show', 'stretch-cat-cow'])

  assert.equal(catCowResult.envelope.ok, true)
  const catCowData = requireData(catCowResult.envelope)
  assert.equal(catCowData.item.id, 'ST170')
  assert.equal(catCowData.item.images.length, 4)
  assert.equal(catCowData.item.images[0]?.step, 'Tabletop setup')
  assert.match(catCowData.item.images[0]?.url ?? '', /^https:\/\/imagedelivery\.net\//u)

  const facetsResult = await runInProcessJsonCli<{
    facets: {
      equipment: string[]
      kinds: string[]
      targets: string[]
    }
  }>(cli, ['exercise', 'facets'])

  assert.equal(facetsResult.envelope.ok, true)
  const facetsData = requireData(facetsResult.envelope)
  assert.deepEqual(facetsData.facets.kinds, ['exercise', 'stretch'])
  assert.ok(facetsData.facets.equipment.includes('none'))
  assert.ok(facetsData.facets.targets.includes('hips'))
})

test('exercise show rejects ambiguous exact names and unknown lookups', async () => {
  const generatedReader = getGeneratedExerciseCatalogReader()
  const duplicateMatches = generatedReader.listExercises({ limit: 2 }).items.map((item, index) => ({
    ...item,
    name: 'Duplicate Movement',
    slug: `duplicate-movement-${index + 1}`,
  }))
  assert.equal(duplicateMatches.length, 2)

  const cli = createExerciseSliceCli({
    getCatalogReader: () => ({
      ...generatedReader,
      findByLookup(lookup) {
        if (lookup === 'Duplicate Movement') {
          return {
            kind: 'ambiguous',
            matches: duplicateMatches,
          }
        }
        return generatedReader.findByLookup(lookup)
      },
    }),
  })

  const ambiguous = await runInProcessJsonCli(cli, [
    'exercise',
    'show',
    'Duplicate Movement',
  ])
  assert.equal(ambiguous.exitCode, 1)
  assert.equal(ambiguous.envelope.ok, false)
  assert.match(ambiguous.envelope.error.message ?? '', /ambiguous/u)

  const missing = await runInProcessJsonCli(cli, [
    'exercise',
    'show',
    'not-a-real-exercise',
  ])
  assert.equal(missing.exitCode, 1)
  assert.equal(missing.envelope.ok, false)
  assert.match(missing.envelope.error.message ?? '', /No public exercise catalog item/u)
})
