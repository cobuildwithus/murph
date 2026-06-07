import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerExerciseCommands } from '../src/commands/exercise.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

function createExerciseSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'exercise coverage cli',
    version: '0.0.0-test',
  })

  cli.use(incurErrorBridge)
  registerExerciseCommands(cli)

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
      image: null | { url: string; alt: string }
      sourceIds: number[]
      steps: string[]
      tips: string[]
    }
    sources: Array<{ id: number; url: string }>
  }>(cli, ['exercise', 'show', 'EX001'])

  assert.equal(showResult.envelope.ok, true)
  const showData = requireData(showResult.envelope)
  assert.equal(showData.item.id, 'EX001')
  assert.equal(showData.item.image, null)
  assert.ok(showData.item.sourceIds.length > 0)
  assert.ok(showData.sources.length > 0)
  assert.ok(showData.item.steps.length > 0)
  assert.ok(showData.item.tips.length > 0)

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
  const cli = createExerciseSliceCli()

  const ambiguous = await runInProcessJsonCli(cli, [
    'exercise',
    'show',
    'Scapular Wall Slide',
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
