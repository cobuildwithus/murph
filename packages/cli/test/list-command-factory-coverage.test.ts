import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterEach } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { registerCaptureCommands } from '../src/commands/capture.js'
import { registerMeasurementCommands } from '../src/commands/measurement.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { registerWorkoutCommands } from '../src/commands/workout.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        force: true,
        recursive: true,
      })
    }),
  )
})

function createListSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'list command factory coverage cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerCaptureCommands(cli, services)
  registerMeasurementCommands(cli)
  registerWorkoutCommands(cli, services)

  return cli
}

async function runListCli<TData>(
  cli: Cli.Cli,
  args: string[],
) {
  return await runInProcessJsonCli<TData>(cli, args, {
    env: process.env,
  })
}

test('capture, measurement, and workout list commands keep their filters and date bounds through the common factory', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-list-factory-')
  cleanupPaths.push(parentRoot)

  const cli = createListSliceCli()
  const captureMediaPath = path.join(parentRoot, 'capture.jpg')
  await writeFile(captureMediaPath, 'capture-bytes', 'utf8')

  const initResult = await runListCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const captureAddResult = await runListCli<{
    addedCount: number
    captures: Array<{ eventId: string }>
  }>(cli, [
    'capture',
    'add',
    '--vault',
    vaultRoot,
    '--media',
    captureMediaPath,
    '--label',
    'mole-left-forearm-1',
    '--body-site',
    'Left forearm',
    '--collection',
    'skin-check-2026-03',
    '--tag',
    'mole',
    '--occurred-at',
    '2026-03-12T07:00:00.000Z',
  ])
  assert.equal(requireData(captureAddResult.envelope).addedCount, 1)
  assert.equal(requireData(captureAddResult.envelope).captures.length, 1)
  assert.equal(requireData(captureAddResult.envelope).captures[0]?.eventId.length > 0, true)

  const measurementAddResult = await runListCli<{ eventId: string }>(cli, [
    'measurement',
    'add',
    '--vault',
    vaultRoot,
    '--metric',
    'grip-strength',
    '--value',
    '97.2',
    '--unit',
    'lb',
    '--occurred-at',
    '2026-03-12T08:00:00.000Z',
  ])
  assert.equal(requireData(measurementAddResult.envelope).eventId.length > 0, true)

  const workoutAddResult = await runListCli<{ eventId: string }>(cli, [
    'workout',
    'add',
    'Went for a 30-minute run.',
    '--vault',
    vaultRoot,
    '--occurred-at',
    '2026-03-12T09:00:00.000Z',
  ])
  assert.equal(requireData(workoutAddResult.envelope).eventId.length > 0, true)

  const captureListResult = await runListCli<{
    items: Array<Record<string, unknown>>
  }>(cli, [
    'capture',
    'list',
    '--vault',
    vaultRoot,
    '--from',
    '2026-03-12',
    '--to',
    '2026-03-12',
    '--label',
    'mole-left-forearm-1',
    '--body-site',
    'Left forearm',
    '--collection',
    'skin-check-2026-03',
    '--tag',
    ' mole ',
    '--tag',
    'mole',
    '--limit',
    '1',
  ])
  assert.equal(requireData(captureListResult.envelope).items.length, 1)

  const measurementListResult = await runListCli<{
    items: Array<Record<string, unknown>>
  }>(cli, [
    'measurement',
    'list',
    '--vault',
    vaultRoot,
    '--from',
    '2026-03-12',
    '--to',
    '2026-03-12',
    '--limit',
    '1',
  ])
  assert.equal(requireData(measurementListResult.envelope).items.length, 1)

  const workoutListResult = await runListCli<{
    items: Array<Record<string, unknown>>
  }>(cli, [
    'workout',
    'list',
    '--vault',
    vaultRoot,
    '--from',
    '2026-03-12',
    '--to',
    '2026-03-12',
    '--limit',
    '1',
  ])
  assert.equal(requireData(workoutListResult.envelope).items.length, 1)
})
