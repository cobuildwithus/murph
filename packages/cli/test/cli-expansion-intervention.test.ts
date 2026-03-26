import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerInterventionCommands } from '../src/commands/intervention.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { createIntegratedVaultCliServices } from '../src/vault-cli-services.js'
import { requireData, runCli } from './cli-test-helpers.js'

interface SchemaEnvelope {
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface InterventionAddEnvelope {
  eventId: string
  lookupId: string
  ledgerFile: string
  created: boolean
  occurredAt: string
  kind: 'intervention_session'
  title: string
  interventionType: string
  durationMinutes: number | null
  protocolId: string | null
  note: string
}

interface EventScaffoldEnvelope {
  noun: 'event'
  kind: 'intervention_session'
  payload: Record<string, unknown>
}

interface ShowEnvelope {
  entity: {
    id: string
    kind: string
    title: string | null
    occurredAt: string | null
    data: Record<string, unknown>
  }
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'intervention slice test cli',
    version: '0.0.0-test',
  })
  const services = createIntegratedVaultCliServices()

  registerVaultCommands(cli, services)
  registerInterventionCommands(cli, services)

  return cli
}

async function runSliceCliRaw(args: string[]) {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('intervention add schema exposes the freeform intervention capture surface', async () => {
  const schema = JSON.parse(
    await runSliceCliRaw(['intervention', 'add', '--schema']),
  ) as SchemaEnvelope

  assert.equal('duration' in schema.options.properties, true)
  assert.equal('type' in schema.options.properties, true)
  assert.equal('protocolId' in schema.options.properties, true)
  assert.equal('occurredAt' in schema.options.properties, true)
  assert.equal('source' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('intervention add help uses a positional text argument', async () => {
  const help = await runSliceCliRaw(['intervention', 'add', '--help'])

  assert.match(help, /Usage: vault-cli intervention add <text> \[options\]/u)
})

test.sequential(
  'intervention add captures intervention_session events and fails fast on ambiguous types and durations',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'healthybob-cli-intervention-'),
    )

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const scaffold = await runCli<EventScaffoldEnvelope>([
        'event',
        'scaffold',
        '--kind',
        'intervention_session',
        '--vault',
        vaultRoot,
      ])
      assert.equal(scaffold.ok, true)
      assert.equal(requireData(scaffold).kind, 'intervention_session')
      assert.equal(
        requireData(scaffold).payload.interventionType,
        'sauna',
      )
      assert.equal(requireData(scaffold).payload.durationMinutes, 20)

      const sauna = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(sauna.ok, true)
      assert.equal(sauna.meta?.command, 'intervention add')
      assert.match(requireData(sauna).eventId, /^evt_/u)
      assert.equal(requireData(sauna).lookupId, requireData(sauna).eventId)
      assert.equal(requireData(sauna).kind, 'intervention_session')
      assert.equal(requireData(sauna).interventionType, 'sauna')
      assert.equal(requireData(sauna).durationMinutes, 20)
      assert.equal(requireData(sauna).protocolId, null)
      assert.equal(requireData(sauna).title, '20-minute sauna')
      assert.equal(requireData(sauna).note, '20 min sauna after lifting.')

      const showSauna = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(sauna).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showSauna.ok, true)
      assert.equal(requireData(showSauna).entity.kind, 'intervention_session')
      assert.equal(requireData(showSauna).entity.title, '20-minute sauna')
      assert.equal(requireData(showSauna).entity.data.interventionType, 'sauna')
      assert.equal(requireData(showSauna).entity.data.durationMinutes, 20)
      assert.equal(requireData(showSauna).entity.data.protocolId, undefined)
      assert.equal(
        requireData(showSauna).entity.data.note,
        '20 min sauna after lifting.',
      )

      const hbot = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        'HBOT session at the clinic.',
        '--duration',
        '60',
        '--protocol-id',
        'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
        '--vault',
        vaultRoot,
      ])
      assert.equal(hbot.ok, true)
      assert.equal(requireData(hbot).interventionType, 'hbot')
      assert.equal(requireData(hbot).durationMinutes, 60)
      assert.equal(
        requireData(hbot).protocolId,
        'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
      )
      assert.equal(requireData(hbot).title, '60-minute HBOT')

      const showHbot = await runCli<ShowEnvelope>([
        'event',
        'show',
        requireData(hbot).lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showHbot.ok, true)
      assert.equal(requireData(showHbot).entity.data.interventionType, 'hbot')
      assert.equal(requireData(showHbot).entity.data.durationMinutes, 60)
      assert.equal(
        requireData(showHbot).entity.data.protocolId,
        'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
      )
      assert.deepEqual(requireData(showHbot).entity.data.relatedIds, [
        'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
      ])

      const noDuration = await runCli<InterventionAddEnvelope>([
        'intervention',
        'add',
        'Recovery session at the clinic.',
        '--type',
        'skin laser therapy',
        '--vault',
        vaultRoot,
      ])
      assert.equal(noDuration.ok, true)
      assert.equal(requireData(noDuration).interventionType, 'skin-laser-therapy')
      assert.equal(requireData(noDuration).durationMinutes, null)
      assert.equal(requireData(noDuration).title, 'Skin laser therapy')

      const ambiguousType = await runCli([
        'intervention',
        'add',
        'Contrast session with sauna and cold plunge.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(ambiguousType.ok, false)
      assert.equal(ambiguousType.error.code, 'invalid_option')
      assert.match(
        ambiguousType.error.message ?? '',
        /Pass --type <type> to record it explicitly/u,
      )

      const ambiguousDuration = await runCli([
        'intervention',
        'add',
        'Sauna for 10 or 20 minutes after training.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(ambiguousDuration.ok, false)
      assert.equal(ambiguousDuration.error.code, 'invalid_option')
      assert.match(
        ambiguousDuration.error.message ?? '',
        /Pass --duration <minutes> to record it explicitly/u,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intervention add surfaces invalid timestamps without needing a custom intervention read surface',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'healthybob-cli-intervention-'),
    )

    try {
      const initResult = await runCli<{ created: boolean }>([
        'init',
        '--vault',
        vaultRoot,
      ])
      assert.equal(initResult.ok, true)
      assert.equal(requireData(initResult).created, true)

      const invalidTimestamp = await runCli([
        'intervention',
        'add',
        '20 min sauna after lifting.',
        '--occurred-at',
        'not-a-timestamp',
        '--vault',
        vaultRoot,
      ])

      assert.equal(invalidTimestamp.ok, false)
      assert.equal(invalidTimestamp.error.code, 'VALIDATION_ERROR')
      assert.match(invalidTimestamp.error.message ?? '', /Invalid ISO datetime/u)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
