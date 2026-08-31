import assert from 'node:assert/strict'
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterEach, test } from 'vitest'

import { initializeVault } from '@murphai/core'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  registerWearablesCommands,
  wearablesViewDeleteResultSchema,
  wearablesViewEditResultSchema,
  wearablesViewListResultSchema,
  wearablesViewSaveResultSchema,
  wearablesViewShowResultSchema,
} from '../src/commands/wearables.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { vaultCliCommandDescriptors } from '../src/vault-cli-command-manifest.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

interface SavedHealthViewResult {
  preferencesPath: string
  recordedAt: string | null
  view: {
    savedViewId: string
    name: string
    metricKeys: string[]
  }
}

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, { force: true, recursive: true }),
    ),
  )
})

function createWearablesCli() {
  const cli = Cli.create('vault-cli', {
    description: 'saved health view test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  registerWearablesCommands(cli, createIntegratedVaultServices())
  return cli
}

test('wearables view commands preserve order and never create an automation', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-saved-health-view-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({
    vaultRoot,
    title: 'Saved health view test vault',
    timezone: 'UTC',
  })
  const cli = createWearablesCli()
  const automationsPath = path.join(vaultRoot, 'bank', 'automations')
  assert.deepEqual(await readdir(automationsPath), [])

  const save = await runInProcessJsonCli<SavedHealthViewResult & { created: boolean }>(
    cli,
    [
      'wearables',
      'view',
      'save',
      'Morning',
      '--vault',
      vaultRoot,
      '--metric',
      'steps',
      '--metric',
      'total-sleep-minutes',
      '--metric',
      'hrv-rmssd',
    ],
  )
  assert.equal(save.exitCode, null)
  const saved = requireData(save.envelope)
  assert.equal('vault' in saved, false)
  assert.equal(saved.created, true)
  assert.match(saved.view.savedViewId, /^hview_[0-9A-HJKMNP-TV-Z]{26}$/u)
  assert.deepEqual(saved.view.metricKeys, [
    'steps',
    'total-sleep-minutes',
    'hrv-rmssd',
  ])

  const list = await runInProcessJsonCli<{
    count: number
    views: SavedHealthViewResult['view'][]
  }>(cli, ['wearables', 'view', 'list', '--vault', vaultRoot])
  assert.equal(list.exitCode, null)
  assert.equal(requireData(list.envelope).count, 1)
  assert.deepEqual(requireData(list.envelope).views, [saved.view])

  const show = await runInProcessJsonCli<SavedHealthViewResult>(cli, [
    'wearables',
    'view',
    'show',
    'morning',
    '--vault',
    vaultRoot,
  ])
  assert.equal(show.exitCode, null)
  assert.equal(requireData(show.envelope).view.savedViewId, saved.view.savedViewId)

  const edit = await runInProcessJsonCli<SavedHealthViewResult & { updated: boolean }>(
    cli,
    [
      'wearables',
      'view',
      'edit',
      saved.view.savedViewId,
      '--vault',
      vaultRoot,
      '--name',
      'Daily',
      '--metric',
      'resting-heart-rate',
      '--metric',
      'steps',
    ],
  )
  assert.equal(edit.exitCode, null)
  assert.equal(requireData(edit.envelope).updated, true)
  assert.deepEqual(requireData(edit.envelope).view.metricKeys, [
    'resting-heart-rate',
    'steps',
  ])

  const remove = await runInProcessJsonCli<SavedHealthViewResult & { deleted: boolean }>(
    cli,
    ['wearables', 'view', 'delete', 'daily', '--vault', vaultRoot],
  )
  assert.equal(remove.exitCode, null)
  assert.equal(requireData(remove.envelope).deleted, true)
  const empty = await runInProcessJsonCli<{ count: number; views: unknown[] }>(
    cli,
    ['wearables', 'view', 'list', '--vault', vaultRoot],
  )
  assert.equal(requireData(empty.envelope).count, 0)
  assert.deepEqual(requireData(empty.envelope).views, [])
  assert.deepEqual(await readdir(automationsPath), [])
})

test('wearables view validates metric sets and non-empty edits', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'murph-cli-saved-health-view-invalid-',
  )
  cleanupPaths.push(parentRoot)
  await initializeVault({
    vaultRoot,
    title: 'Saved health view validation vault',
    timezone: 'UTC',
  })
  const cli = createWearablesCli()

  const missingMetric = await runInProcessJsonCli(cli, [
    'wearables',
    'view',
    'save',
    'Daily',
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingMetric.exitCode, 1)

  const duplicateMetric = await runInProcessJsonCli(cli, [
    'wearables',
    'view',
    'save',
    'Daily',
    '--vault',
    vaultRoot,
    '--metric',
    'steps',
    '--metric',
    'steps',
  ])
  assert.equal(duplicateMetric.exitCode, 1)

  const emptyEdit = await runInProcessJsonCli(cli, [
    'wearables',
    'view',
    'edit',
    'missing',
    '--vault',
    vaultRoot,
  ])
  assert.equal(emptyEdit.exitCode, 1)
})

test('wearables manifest publishes all saved health view leaves', () => {
  const descriptor = vaultCliCommandDescriptors.find(
    (candidate) => candidate.id === 'wearables',
  )
  assert.ok(descriptor && 'leafCommands' in descriptor)
  const leaves = new Map<string, unknown>()
  for (const leaf of descriptor.leafCommands ?? []) {
    if ('output' in leaf) {
      leaves.set(leaf.path.join(' '), leaf.output)
    }
  }
  assert.equal(leaves.get('wearables view list'), wearablesViewListResultSchema)
  assert.equal(leaves.get('wearables view show'), wearablesViewShowResultSchema)
  assert.equal(leaves.get('wearables view save'), wearablesViewSaveResultSchema)
  assert.equal(leaves.get('wearables view edit'), wearablesViewEditResultSchema)
  assert.equal(leaves.get('wearables view delete'), wearablesViewDeleteResultSchema)
})
