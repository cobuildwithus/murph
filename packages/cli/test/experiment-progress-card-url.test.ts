import assert from 'node:assert/strict'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'

async function runProgressCardTombstone(): Promise<CliEnvelope> {
  const cli = Cli.create('vault-cli', {
    description: 'experiment progress-card tombstone test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerExperimentCommands(cli, services)

  const output: string[] = []
  await cli.serve([
    'experiment',
    'progress-card',
    'retired-card',
    '--vault',
    'fixtures/demo-web-vault',
    '--full-output',
    '--format',
    'json',
  ], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope
}

test('progress-card command fails closed without emitting health data or a URL', async () => {
  const result = await runProgressCardTombstone()

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('Expected progress-card tombstone failure.')
  }
  assert.equal(
    result.error.code,
    'EXPERIMENT_PROGRESS_CARD_PRIVATE_DELIVERY_REQUIRED',
  )
  assert.match(result.error.message ?? '', /private attachment delivery/iu)
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//iu)
})
