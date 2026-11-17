import assert from 'node:assert/strict'
import { Cli } from 'incur'
import { test, vi } from 'vitest'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerSupplementCommands } from '../src/commands/supplement.js'
import type { CliEnvelope } from './cli-test-helpers.js'

const vaultRoot = '/tmp/murph-cli-health-command-coverage'

function createSliceCli() {
  const cli = Cli.create('vault-cli', { version: '0.0.0-test' })
  const services = createUnwiredVaultServices()
  cli.use(incurErrorBridge)
  registerReadCommands(cli, services)
  registerSupplementCommands(cli, services)

  async function run(args: string[]): Promise<CliEnvelope<unknown>> {
    const output: string[] = []
    await cli.serve([
      ...args,
      '--vault', vaultRoot,
      '--request-id', 'req-boundary',
      '--full-output',
      '--format', 'json',
    ], {
      env: process.env,
      exit: () => {},
      stdout: (chunk) => {
        output.push(chunk)
      },
    })
    const result = JSON.parse(output.join('').trim()) as CliEnvelope<unknown>
    assert.equal(result.ok, true)
    return result
  }

  return { services, run }
}

test('generic reads preserve the request ID at the service boundary', async () => {
  const { services, run } = createSliceCli()
  const show = vi.spyOn(services.query, 'show').mockResolvedValue({
    vault: vaultRoot,
    entity: {
      id: 'goal_sleep_01',
      kind: 'goal',
      title: 'Sleep',
      occurredAt: null,
      path: 'bank/goals/sleep.md',
      markdown: null,
      data: {},
      links: [],
    },
  })
  const list = vi.spyOn(services.query, 'list').mockResolvedValue({
    vault: vaultRoot,
    filters: { limit: 3 },
    items: [],
    count: 0,
    nextCursor: null,
  })

  await run(['show', 'goal_sleep_01'])
  await run(['list', '--limit', '3'])

  assert.deepEqual(show.mock.calls, [[{
    id: 'goal_sleep_01',
    vault: vaultRoot,
    requestId: 'req-boundary',
  }]])
  assert.equal(list.mock.calls.length, 1)
  assert.equal(list.mock.calls[0]?.[0].requestId, 'req-boundary')
  assert.equal(list.mock.calls[0]?.[0].vault, vaultRoot)
})

test('supplement services receive request IDs and stop returns its result without follow-ups', async () => {
  const { services, run } = createSliceCli()
  const stop = vi.spyOn(services.core, 'stopRegimen').mockResolvedValue({
    vault: vaultRoot,
    regimenId: 'reg_magnesium',
    lookupId: 'reg_magnesium',
    stoppedOn: '2026-03-12',
    status: 'stopped',
  })
  const compound = {
    compound: 'Magnesium Glycinate',
    lookupId: 'magnesium-glycinate',
    totals: [],
    supplementCount: 0,
    supplementIds: [],
    sources: [],
  }
  const list = vi.spyOn(services.query, 'listSupplementCompounds').mockResolvedValue({
    vault: vaultRoot,
    filters: { status: 'stopped', limit: 5 },
    items: [compound],
    count: 1,
    nextCursor: null,
  })
  const show = vi.spyOn(services.query, 'showSupplementCompound').mockResolvedValue({
    vault: vaultRoot,
    filters: { status: 'active', limit: undefined },
    compound,
  })

  const stopped = await run(['supplement', 'stop', 'reg_magnesium', '--stopped-on', '2026-03-12'])
  await run(['supplement', 'compound', 'list', '--status', 'stopped', '--limit', '5'])
  await run(['supplement', 'compound', 'show', 'Magnesium Glycinate', '--status', 'active'])

  assert.deepEqual(stop.mock.calls, [[{
    group: 'supplement',
    regimenId: 'reg_magnesium',
    stoppedOn: '2026-03-12',
    vault: vaultRoot,
    requestId: 'req-boundary',
  }]])
  assert.deepEqual(list.mock.calls, [[{
    limit: 5,
    status: 'stopped',
    vault: vaultRoot,
    requestId: 'req-boundary',
  }]])
  assert.deepEqual(show.mock.calls, [[{
    compound: 'Magnesium Glycinate',
    status: 'active',
    vault: vaultRoot,
    requestId: 'req-boundary',
  }]])
  // The stop result is the readback; it suggests no follow-up commands.
  assert.equal(stopped.meta?.cta, undefined)
})
