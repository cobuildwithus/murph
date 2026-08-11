import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { registerEventCommands } from '../src/commands/event.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

interface CommandSchema {
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface EventAddEnvelope {
  eventId: string
  kind: string
}

interface EventShowEnvelope {
  entity: {
    id: string
    kind: string
    title: string | null
    occurredAt: string | null
    data: Record<string, unknown>
  }
}

interface EventListEnvelope {
  count: number
  filters: {
    kind: string | null
    limit: number
  }
  items: Array<{
    id: string
    kind: string
    occurredAt: string | null
    data: Record<string, unknown>
  }>
}

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'typed event kind parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()

  registerVaultCommands(cli, services)
  registerEventCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(args: string[]): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
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

function parseCommandSchema(raw: string): CommandSchema {
  return JSON.parse(raw) as CommandSchema
}

function assertSchemaProperties(
  schema: CommandSchema,
  expectedProperties: readonly string[],
) {
  for (const property of expectedProperties) {
    assert.equal(
      property in schema.options.properties,
      true,
      `expected schema property ${property}`,
    )
  }
}

function assertRequiredOptions(
  schema: CommandSchema,
  expectedRequiredOptions: readonly string[],
) {
  assert.deepEqual(
    [...new Set(schema.options.required ?? [])].sort(),
    [...expectedRequiredOptions].sort(),
  )
}

test('additional typed event schemas expose concrete fields without JSON input', async () => {
  const medicationSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'medication-intake', 'add', '--schema']),
  )
  const encounterSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'encounter', 'add', '--schema']),
  )
  const procedureSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'procedure', 'add', '--schema']),
  )
  const adverseEffectSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'adverse-effect', 'add', '--schema']),
  )
  const exposureSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'exposure', 'add', '--schema']),
  )
  const importJsonSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'import-json', '--schema']),
  )

  for (const schema of [
    medicationSchema,
    encounterSchema,
    procedureSchema,
    adverseEffectSchema,
    exposureSchema,
  ]) {
    assertSchemaProperties(schema, ['occurredAt', 'source', 'title', 'note', 'tag'])
    assert.equal('input' in schema.options.properties, false)
  }

  assertSchemaProperties(medicationSchema, [
    'medicationName',
    'dose',
    'unit',
  ])
  assertRequiredOptions(medicationSchema, [
    'vault',
    'medicationName',
    'dose',
    'unit',
  ])

  assertSchemaProperties(encounterSchema, ['encounterType', 'location', 'providerId'])
  assertRequiredOptions(encounterSchema, ['vault', 'encounterType', 'occurredAt'])

  assertSchemaProperties(procedureSchema, ['procedure', 'status'])
  assertRequiredOptions(procedureSchema, ['vault', 'procedure', 'occurredAt'])

  assertSchemaProperties(adverseEffectSchema, ['substance', 'effect', 'severity'])
  assertRequiredOptions(adverseEffectSchema, ['vault', 'substance', 'effect', 'occurredAt'])

  assertSchemaProperties(exposureSchema, ['exposureType', 'substance', 'duration'])
  assertRequiredOptions(exposureSchema, ['vault', 'exposureType', 'substance', 'occurredAt'])

  assert.equal('input' in importJsonSchema.options.properties, true)
  assertRequiredOptions(importJsonSchema, ['vault', 'input'])
})

test.sequential('additional typed event commands persist canonical event records', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-event-kind-parity-'))

  try {
    const initResult = await runSliceCli<{ created: boolean }>([
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.ok, true)

    const addResult = await runSliceCli<EventAddEnvelope>([
      'event',
      'medication-intake',
      'add',
      '--medication-name',
      'Metformin',
      '--dose',
      '500',
      '--unit',
      'mg',
      '--title',
      'Morning medication',
      '--note',
      'Taken with breakfast.',
      '--occurred-at',
      '2026-03-12T08:00:00.000Z',
      '--vault',
      vaultRoot,
    ])
    const encounterResult = await runSliceCli<EventAddEnvelope>([
      'event',
      'encounter',
      'add',
      '--encounter-type',
      'office_visit',
      '--location',
      'Primary care clinic',
      '--title',
      'Primary care visit',
      '--occurred-at',
      '2026-03-13T09:00:00.000Z',
      '--vault',
      vaultRoot,
    ])
    const procedureResult = await runSliceCli<EventAddEnvelope>([
      'event',
      'procedure',
      'add',
      '--procedure',
      'Roux-en-Y gastric bypass',
      '--status',
      'completed',
      '--title',
      'Completed bariatric procedure',
      '--occurred-at',
      '2026-03-14T10:00:00.000Z',
      '--vault',
      vaultRoot,
    ])
    const adverseEffectResult = await runSliceCli<EventAddEnvelope>([
      'event',
      'adverse-effect',
      'add',
      '--substance',
      'magnesium glycinate',
      '--effect',
      'nausea',
      '--severity',
      'mild',
      '--title',
      'Nausea after magnesium',
      '--occurred-at',
      '2026-03-15T19:00:00.000Z',
      '--vault',
      vaultRoot,
    ])
    const exposureResult = await runSliceCli<EventAddEnvelope>([
      'event',
      'exposure',
      'add',
      '--exposure-type',
      'environmental',
      '--substance',
      'wildfire smoke',
      '--duration',
      '45 minutes',
      '--title',
      'Smoke exposure',
      '--occurred-at',
      '2026-03-16T18:30:00.000Z',
      '--vault',
      vaultRoot,
    ])

    assert.equal(addResult.ok, true, JSON.stringify(addResult))
    assert.equal(addResult.meta?.command, 'event medication-intake add')
    assert.equal(requireData(addResult).kind, 'medication_intake')
    assert.match(requireData(addResult).eventId, /^evt_/u)
    assert.equal(encounterResult.ok, true, JSON.stringify(encounterResult))
    assert.equal(encounterResult.meta?.command, 'event encounter add')
    assert.equal(requireData(encounterResult).kind, 'encounter')
    assert.match(requireData(encounterResult).eventId, /^evt_/u)
    assert.equal(procedureResult.ok, true, JSON.stringify(procedureResult))
    assert.equal(procedureResult.meta?.command, 'event procedure add')
    assert.equal(requireData(procedureResult).kind, 'procedure')
    assert.equal(adverseEffectResult.ok, true, JSON.stringify(adverseEffectResult))
    assert.equal(adverseEffectResult.meta?.command, 'event adverse-effect add')
    assert.equal(requireData(adverseEffectResult).kind, 'adverse_effect')
    assert.equal(exposureResult.ok, true, JSON.stringify(exposureResult))
    assert.equal(exposureResult.meta?.command, 'event exposure add')
    assert.equal(requireData(exposureResult).kind, 'exposure')

    const showResult = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(addResult).eventId,
      '--vault',
      vaultRoot,
    ])
    const encounterShow = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(encounterResult).eventId,
      '--vault',
      vaultRoot,
    ])
    const procedureShow = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(procedureResult).eventId,
      '--vault',
      vaultRoot,
    ])
    const procedureList = await runSliceCli<EventListEnvelope>([
      'event',
      'list',
      '--kind',
      'procedure',
      '--limit',
      '200',
      '--vault',
      vaultRoot,
    ])
    const adverseEffectShow = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(adverseEffectResult).eventId,
      '--vault',
      vaultRoot,
    ])
    const exposureShow = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(exposureResult).eventId,
      '--vault',
      vaultRoot,
    ])

    assert.equal(showResult.ok, true)
    assert.equal(requireData(showResult).entity.kind, 'medication_intake')
    assert.equal(requireData(showResult).entity.title, 'Morning medication')
    assert.equal(requireData(showResult).entity.data.medicationName, 'Metformin')
    assert.equal(requireData(showResult).entity.data.dose, 500)
    assert.equal(requireData(showResult).entity.data.unit, 'mg')
    assert.equal(requireData(showResult).entity.data.note, 'Taken with breakfast.')

    assert.equal(encounterShow.ok, true)
    assert.equal(requireData(encounterShow).entity.kind, 'encounter')
    assert.equal(requireData(encounterShow).entity.data.encounterType, 'office_visit')
    assert.equal(requireData(encounterShow).entity.data.location, 'Primary care clinic')

    assert.equal(procedureShow.ok, true)
    assert.equal(requireData(procedureShow).entity.kind, 'procedure')
    assert.equal(
      requireData(procedureShow).entity.data.procedure,
      'Roux-en-Y gastric bypass',
    )
    assert.equal(requireData(procedureShow).entity.data.status, 'completed')

    assert.equal(procedureList.ok, true)
    assert.equal(requireData(procedureList).filters.kind, 'procedure')
    assert.equal(requireData(procedureList).filters.limit, 200)
    assert.equal(requireData(procedureList).count, 1)
    assert.equal(
      requireData(procedureList).items[0]?.id,
      requireData(procedureResult).eventId,
    )
    assert.equal(requireData(procedureList).items[0]?.kind, 'procedure')
    assert.equal(
      requireData(procedureList).items[0]?.occurredAt,
      '2026-03-14T10:00:00.000Z',
    )
    assert.equal(
      requireData(procedureList).items[0]?.data.procedure,
      'Roux-en-Y gastric bypass',
    )
    assert.equal(requireData(procedureList).items[0]?.data.status, 'completed')

    assert.equal(adverseEffectShow.ok, true)
    assert.equal(requireData(adverseEffectShow).entity.kind, 'adverse_effect')
    assert.equal(
      requireData(adverseEffectShow).entity.data.substance,
      'magnesium glycinate',
    )
    assert.equal(requireData(adverseEffectShow).entity.data.effect, 'nausea')
    assert.equal(requireData(adverseEffectShow).entity.data.severity, 'mild')

    assert.equal(exposureShow.ok, true)
    assert.equal(requireData(exposureShow).entity.kind, 'exposure')
    assert.equal(requireData(exposureShow).entity.data.exposureType, 'environmental')
    assert.equal(requireData(exposureShow).entity.data.substance, 'wildfire smoke')
    assert.equal(requireData(exposureShow).entity.data.duration, '45 minutes')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
