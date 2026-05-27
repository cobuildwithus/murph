import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerEventCommands } from '../src/commands/event.js'
import { registerVaultCommands } from '../src/commands/vault.js'
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

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'typed event slice test cli',
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

test('typed event write schemas expose concrete fields and keep JSON input on explicit import only', async () => {
  const noteSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'note', 'add', '--schema']),
  )
  const symptomSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'symptom', 'add', '--schema']),
  )
  const observationSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'observation', 'add', '--schema']),
  )
  const supplementIntakeSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'supplement-intake', 'add', '--schema']),
  )
  const importJsonSchema = parseCommandSchema(
    await runSliceCliRaw(['event', 'import-json', '--schema']),
  )

  for (const schema of [
    noteSchema,
    symptomSchema,
    observationSchema,
    supplementIntakeSchema,
  ]) {
    assertSchemaProperties(schema, ['occurredAt', 'source', 'title'])
    assert.equal('input' in schema.options.properties, false)
  }

  assertSchemaProperties(noteSchema, ['note', 'tag'])
  assertRequiredOptions(noteSchema, ['vault', 'note'])

  assertSchemaProperties(symptomSchema, ['symptom', 'severity', 'bodyRegion', 'note', 'tag'])
  assertRequiredOptions(symptomSchema, ['vault', 'symptom', 'severity'])

  assertSchemaProperties(observationSchema, ['metric', 'value', 'unit', 'note', 'tag'])
  assertRequiredOptions(observationSchema, ['vault', 'metric', 'value', 'unit'])

  assertSchemaProperties(supplementIntakeSchema, [
    'supplementName',
    'dose',
    'unit',
    'note',
    'tag',
  ])
  assertRequiredOptions(supplementIntakeSchema, [
    'vault',
    'supplementName',
    'dose',
    'unit',
  ])

  assert.equal('input' in importJsonSchema.options.properties, true)
  assertRequiredOptions(importJsonSchema, ['vault', 'input'])
})

test.sequential('typed event write commands persist common event records without JSON input', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-event-typed-'))

  try {
    const initResult = await runSliceCli<{ created: boolean }>([
      'init',
      '--vault',
      vaultRoot,
    ])
    assert.equal(initResult.ok, true)

    const note = await runSliceCli<EventAddEnvelope>([
      'event',
      'note',
      'add',
      '--note',
      'Felt steady after lunch.',
      '--title',
      'Lunch note',
      '--occurred-at',
      '2026-03-12T12:15:00.000Z',
      '--tag',
      'reflection',
      '--vault',
      vaultRoot,
    ])
    const symptom = await runSliceCli<EventAddEnvelope>([
      'event',
      'symptom',
      'add',
      '--symptom',
      'headache',
      '--severity',
      '4',
      '--body-region',
      'temple',
      '--note',
      'Resolved after breakfast.',
      '--occurred-at',
      '2026-03-12T08:15:00.000Z',
      '--vault',
      vaultRoot,
    ])
    const observation = await runSliceCli<EventAddEnvelope>([
      'event',
      'observation',
      'add',
      '--metric',
      'resting-heart-rate',
      '--value',
      '55',
      '--unit',
      'bpm',
      '--note',
      'Morning wearable reading.',
      '--occurred-at',
      '2026-03-13T07:30:00.000Z',
      '--vault',
      vaultRoot,
    ])
    const supplement = await runSliceCli<EventAddEnvelope>([
      'event',
      'supplement-intake',
      'add',
      '--supplement-name',
      'Magnesium glycinate',
      '--dose',
      '200',
      '--unit',
      'mg',
      '--note',
      'Taken with dinner.',
      '--occurred-at',
      '2026-03-13T19:00:00.000Z',
      '--vault',
      vaultRoot,
    ])

    assert.equal(note.ok, true, JSON.stringify(note))
    assert.equal(note.meta?.command, 'event note add')
    assert.equal(requireData(note).kind, 'note')
    assert.match(requireData(note).eventId, /^evt_/u)

    assert.equal(symptom.ok, true, JSON.stringify(symptom))
    assert.equal(symptom.meta?.command, 'event symptom add')
    assert.equal(requireData(symptom).kind, 'symptom')

    assert.equal(observation.ok, true, JSON.stringify(observation))
    assert.equal(observation.meta?.command, 'event observation add')
    assert.equal(requireData(observation).kind, 'observation')

    assert.equal(supplement.ok, true, JSON.stringify(supplement))
    assert.equal(supplement.meta?.command, 'event supplement-intake add')
    assert.equal(requireData(supplement).kind, 'supplement_intake')

    const shownNote = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(note).eventId,
      '--vault',
      vaultRoot,
    ])
    const shownSymptom = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(symptom).eventId,
      '--vault',
      vaultRoot,
    ])
    const shownObservation = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(observation).eventId,
      '--vault',
      vaultRoot,
    ])
    const shownSupplement = await runSliceCli<EventShowEnvelope>([
      'event',
      'show',
      requireData(supplement).eventId,
      '--vault',
      vaultRoot,
    ])

    assert.equal(shownNote.ok, true)
    assert.equal(requireData(shownNote).entity.kind, 'note')
    assert.equal(requireData(shownNote).entity.title, 'Lunch note')
    assert.equal(requireData(shownNote).entity.data.note, 'Felt steady after lunch.')
    assert.deepEqual(requireData(shownNote).entity.data.tags, ['reflection'])

    assert.equal(shownSymptom.ok, true)
    assert.equal(requireData(shownSymptom).entity.kind, 'symptom')
    assert.equal(requireData(shownSymptom).entity.data.symptom, 'headache')
    assert.equal(requireData(shownSymptom).entity.data.intensity, 4)
    assert.equal(requireData(shownSymptom).entity.data.bodySite, 'temple')

    assert.equal(shownObservation.ok, true)
    assert.equal(requireData(shownObservation).entity.kind, 'observation')
    assert.equal(requireData(shownObservation).entity.data.metric, 'resting-heart-rate')
    assert.equal(requireData(shownObservation).entity.data.queryVisibility, 'default')
    assert.equal(requireData(shownObservation).entity.data.value, 55)
    assert.equal(requireData(shownObservation).entity.data.unit, 'bpm')

    assert.equal(shownSupplement.ok, true)
    assert.equal(requireData(shownSupplement).entity.kind, 'supplement_intake')
    assert.equal(
      requireData(shownSupplement).entity.data.supplementName,
      'Magnesium glycinate',
    )
    assert.equal(requireData(shownSupplement).entity.data.dose, 200)
    assert.equal(requireData(shownSupplement).entity.data.unit, 'mg')
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
