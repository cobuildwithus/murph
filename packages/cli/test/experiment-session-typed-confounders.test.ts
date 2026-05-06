import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerReadCommands } from '../src/commands/read.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

interface CommandSchema {
  args: {
    properties: Record<string, unknown>
    required?: string[]
  }
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

function createExperimentConfounderSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'experiment session confounder slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerExperimentCommands(cli, services)
  registerReadCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: readonly string[],
): Promise<CliEnvelope<TData>> {
  const cli = createExperimentConfounderSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runRawSliceCli(args: readonly string[]): Promise<string> {
  const cli = createExperimentConfounderSliceCli()
  const output: string[] = []

  await cli.serve([...args], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('experiment session log schema exposes typed confounder map entries', async () => {
  const schema = JSON.parse(
    await runRawSliceCli([
      'experiment',
      'session',
      'log',
      '--schema',
      '--format',
      'json',
    ]),
  ) as CommandSchema

  assert.equal('lookup' in schema.args.properties, true)
  assert.equal('confounders' in schema.options.properties, true)
  assert.equal('confounder' in schema.options.properties, true)
  assert.equal('input' in schema.options.properties, false)
})

test.sequential(
  'experiment session log persists typed confounder map values and rejects ambiguous forms',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-session-confounders-'),
    )

    try {
      await runSliceCli([
        'init',
        '--vault',
        vaultRoot,
        '--timezone',
        'America/Los_Angeles',
      ])
      const created = await runSliceCli<{
        experimentId: string
        slug: string
      }>([
        'experiment',
        'start',
        'typed-confounders',
        '--custom',
        '--title',
        'Typed Confounders',
        '--started-on',
        '2026-04-01',
        '--status',
        'active',
        '--intervention-start',
        '2026-04-08',
        '--intervention-days',
        '14',
        '--primary-biomarker-key',
        'biomarker:resting-heart-rate',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const malformed = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'typed-confounders',
        '--intervention-type',
        'sauna',
        '--confounder',
        'travel',
        '--vault',
        vaultRoot,
      ])
      const mixed = await runSliceCli<unknown>([
        'experiment',
        'session',
        'log',
        'typed-confounders',
        '--intervention-type',
        'sauna',
        '--confounders',
        'travel',
        '--confounder',
        'travel=true',
        '--vault',
        vaultRoot,
      ])

      assert.equal(malformed.ok, false)
      assert.match(malformed.error.message ?? '', /key=value/u)
      assert.equal(mixed.ok, false)
      assert.match(mixed.error.message ?? '', /--confounders.*--confounder/u)

      const logged = await runSliceCli<{
        eventId: string
        kind: string
      }>([
        'experiment',
        'session',
        'log',
        'typed-confounders',
        '--occurred-at',
        '2026-04-09T18:30:00.000Z',
        '--title',
        'Evening sauna',
        '--intervention-type',
        'sauna',
        '--duration-minutes',
        '18',
        '--confounder',
        'travel=true',
        '--confounder',
        'sleepScore=72.5',
        '--confounder',
        'supplement=null',
        '--confounder',
        'lateMeal=airport dinner',
        '--confounder',
        'highStress=false',
        '--vault',
        vaultRoot,
      ])
      assert.equal(logged.ok, true)
      assert.equal(requireData(logged).kind, 'intervention_session')

      const shown = await runSliceCli<{
        entity: {
          kind: string
          data: Record<string, unknown>
        }
      }>(['show', requireData(logged).eventId, '--vault', vaultRoot])

      assert.equal(shown.ok, true)
      assert.equal(requireData(shown).entity.kind, 'intervention_session')
      assert.deepEqual(requireData(shown).entity.data.confounders, {
        travel: true,
        sleepScore: 72.5,
        supplement: null,
        lateMeal: 'airport dinner',
        highStress: false,
      })
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
