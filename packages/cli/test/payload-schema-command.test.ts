import assert from 'node:assert/strict'

import { Validator, type Schema } from '@cfworker/json-schema'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

import { registerEncounterCommands } from '../src/commands/encounter.js'
import { registerEventCommands } from '../src/commands/event.js'
import { createHealthEntityCrudGroup } from '../src/commands/health-entity-command-registry.js'
import { payloadSchemaEnvelopeSchema } from '../src/commands/command-factory-primitives.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { vaultCliCommandDescriptors } from '../src/vault-cli-command-manifest.js'
import {
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'

interface PayloadSchemaResult {
  schemaVersion: 'murph.payload-schema.v1'
  command: string
  mediaType: 'application/json' | 'application/jsonl'
  schemaName?: string
  lineSchemaName?: string
  schema: Schema & JsonRecord
  examples: unknown[]
}

interface CommandSchemaEnvelope {
  args?: JsonRecord
  options?: JsonRecord
  output?: JsonRecord
}

interface RawCliResult {
  exitCode: number | null
  output: string
}

type JsonRecord = Record<string, unknown>

function schemaHasFormat(schema: JsonRecord | undefined, format: string): boolean {
  if (!schema) {
    return false
  }

  if (schema.format === format) {
    return true
  }

  const anyOf = schema.anyOf
  if (!Array.isArray(anyOf)) {
    return false
  }

  return anyOf.some((branch) =>
    typeof branch === 'object' &&
    branch !== null &&
    !Array.isArray(branch) &&
    schemaHasFormat(branch as JsonRecord, format),
  )
}

function createPayloadSchemaCli() {
  const cli = Cli.create('vault-cli', {
    description: 'payload-schema test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createUnwiredVaultServices()
  cli.command(createHealthEntityCrudGroup(services, 'goal'))
  cli.command(createHealthEntityCrudGroup(services, 'condition'))
  cli.command(createHealthEntityCrudGroup(services, 'blood-test'))
  registerEncounterCommands(cli)
  registerEventCommands(cli, services)

  return cli
}

function propertiesOf(schema: JsonRecord): JsonRecord {
  const properties = schema.properties
  assert.equal(typeof properties, 'object')
  assert.notEqual(properties, null)
  assert.equal(Array.isArray(properties), false)

  return properties as JsonRecord
}

function assertJsonSchemaValidation(schema: Schema, value: unknown, expectedValid: boolean) {
  const result = new Validator(schema).validate(value)
  assert.equal(result.valid, expectedValid, JSON.stringify(result.errors))
}

function findManifestLeafCommand(path: string) {
  for (const descriptor of vaultCliCommandDescriptors) {
    if (!('leafCommands' in descriptor) || !descriptor.leafCommands) {
      continue
    }

    const leafCommand = descriptor.leafCommands.find(
      (candidate) => candidate.path.join(' ') === path,
    )
    if (leafCommand) {
      return leafCommand
    }
  }

  return undefined
}

function manifestLeafHint(path: string): string {
  const leafCommand = findManifestLeafCommand(path)

  if (!leafCommand || !('hint' in leafCommand)) {
    return ''
  }

  return String(leafCommand.hint ?? '')
}

function manifestLeafOutput(path: string): unknown {
  const leafCommand = findManifestLeafCommand(path)

  return leafCommand && 'output' in leafCommand ? leafCommand.output : undefined
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<RawCliResult> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve(args, {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    exitCode,
    output: output.join('').trim(),
  }
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  const result = await runRawInProcessCli(cli, [
    ...commandArgs,
    '--schema',
    '--format',
    'json',
  ])
  assert.equal(result.exitCode, null)

  return JSON.parse(result.output) as CommandSchemaEnvelope
}

test('payload-schema commands emit import body schemas without requiring vault state', async () => {
  const cli = createPayloadSchemaCli()

  const condition = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'condition',
      'payload-schema',
    ])).envelope,
  )
  assert.equal(condition.schemaVersion, 'murph.payload-schema.v1')
  assert.equal(condition.command, 'condition import-json')
  assert.equal(condition.mediaType, 'application/json')
  assert.equal(condition.schemaName, 'condition-import-payload')
  assert.equal(condition.schema.$id, '@murphai/contracts/condition-import-payload.schema.json')
  assert.equal(condition.schema.title, 'Murph Condition Import Payload')
  const conditionBranches = condition.schema.anyOf as JsonRecord[] | undefined
  assert.ok(conditionBranches?.some((branch) =>
    (branch.required as unknown[] | undefined)?.includes('conditionId'),
  ))
  assert.ok(conditionBranches?.some((branch) =>
    (branch.required as unknown[] | undefined)?.includes('slug'),
  ))
  assert.ok(conditionBranches?.some((branch) =>
    (branch.required as unknown[] | undefined)?.includes('title'),
  ))
  assert.equal(condition.examples.length, 1)

  const bloodTest = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'blood-test',
      'payload-schema',
    ])).envelope,
  )
  assert.equal(bloodTest.command, 'blood-test import-json')
  assert.equal(bloodTest.schemaName, 'blood-test-import-payload')
  const bloodTestProperties = propertiesOf(bloodTest.schema)
  assert.equal(schemaHasFormat(bloodTestProperties.occurredAt as JsonRecord | undefined, 'date'), true)
  assert.equal(schemaHasFormat(bloodTestProperties.occurredAt as JsonRecord | undefined, 'date-time'), true)
  assert.ok(bloodTestProperties.results)
  assert.equal(bloodTest.examples.length, 1)
  assertJsonSchemaValidation(bloodTest.schema, {
    occurredAt: '2026-03-12T11:15:00.000Z',
    title: 'Functional health panel',
    testName: 'functional_health_panel',
  }, true)
  assertJsonSchemaValidation(bloodTest.schema, {
    occurredAt: '2026-03-12',
    title: 'Functional health panel',
    testName: 'functional_health_panel',
  }, true)
  assertJsonSchemaValidation(bloodTest.schema, {
    occurredAt: '2026-03-12T11:15:00.123456Z',
    title: 'Functional health panel',
    testName: 'functional_health_panel',
  }, true)
  assertJsonSchemaValidation(bloodTest.schema, {
    occurredAt: '2026-03-12t11:15:00.123456z',
    title: 'Functional health panel',
    testName: 'functional_health_panel',
  }, true)
  assertJsonSchemaValidation(bloodTest.schema, {
    occurredAt: 'not-a-date',
    title: 'Functional health panel',
    testName: 'functional_health_panel',
  }, false)

  const encounter = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'encounter',
      'payload-schema',
    ])).envelope,
  )
  assert.equal(encounter.command, 'encounter import-json')
  assert.equal(encounter.schemaName, 'encounter-import-payload')
  const encounterProperties = propertiesOf(encounter.schema)
  assert.ok(encounterProperties.encounter)
  const encounterBodyProperties = propertiesOf(encounterProperties.encounter as JsonRecord)
  assert.equal(schemaHasFormat(encounterBodyProperties.occurredAt as JsonRecord | undefined, 'date'), true)
  assert.equal(schemaHasFormat(encounterBodyProperties.occurredAt as JsonRecord | undefined, 'date-time'), true)
  assert.ok(encounterBodyProperties.providerId)
  assert.ok(encounterBodyProperties.timeZone)
  assert.ok(encounterBodyProperties.rawRefs)
  assert.ok(propertiesOf(encounter.schema).tests)
  const validEncounterPayload = {
    encounter: {
      eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F0',
      occurredAt: '2026-03-12t11:15:00.123456z',
      encounterType: 'office_visit',
    },
  }
  assertJsonSchemaValidation(encounter.schema, validEncounterPayload, true)
  assertJsonSchemaValidation(encounter.schema, {
    encounter: {
      ...validEncounterPayload.encounter,
      occurredAt: '2026-03-12',
    },
  }, true)
  assertJsonSchemaValidation(encounter.schema, {
    encounter: {
      ...validEncounterPayload.encounter,
      occurredAt: '2026-03-12T11:15:00',
    },
  }, false)
  assertJsonSchemaValidation(encounter.schema, {
    encounter: {
      ...validEncounterPayload.encounter,
      assessmentText: 'x'.repeat(4001),
    },
  }, false)
  assertJsonSchemaValidation(encounter.schema, {
    ...validEncounterPayload,
    measurements: [
      {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F1',
        measurements: Array.from({ length: 26 }, (_value, index) => ({
          metric: `metric-${index + 1}`,
          value: index + 1,
          unit: 'count',
        })),
      },
    ],
  }, false)
  assertJsonSchemaValidation(encounter.schema, {
    ...validEncounterPayload,
    tests: [
      {
        eventId: 'evt_01JQ9R7WF97M1WAB2B4QF2Q1F2',
        testName: 'CBC',
        results: Array.from({ length: 501 }, (_value, index) => ({
          analyte: `Analyte ${index + 1}`,
          value: index + 1,
          unit: 'mg/dL',
        })),
      },
    ],
  }, false)

  const event = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'event',
      'payload-schema',
      '--for',
      'import-jsonl',
      '--kind',
      'symptom',
    ])).envelope,
  )
  assert.equal(event.command, 'event import-jsonl')
  assert.equal(event.mediaType, 'application/jsonl')
  assert.equal(event.lineSchemaName, 'event-import-jsonl-row-symptom')
  const eventProperties = propertiesOf(event.schema)
  assert.ok(eventProperties.kind)
  assert.equal(schemaHasFormat(eventProperties.occurredAt as JsonRecord | undefined, 'date'), true)
  assert.equal(schemaHasFormat(eventProperties.occurredAt as JsonRecord | undefined, 'date-time'), true)
  assert.match(JSON.stringify(eventProperties.recordedAt), /"type":"null"/u)
  assert.equal(eventProperties.dayKey, undefined)
  assert.ok(eventProperties.externalRef)
  assert.equal((event.schema.required as unknown[] | undefined)?.includes('externalRef'), false)
  assert.equal(eventProperties.id, undefined)
  assert.equal(eventProperties.eventId, undefined)
  const validSymptomRow = {
    kind: 'symptom',
    occurredAt: '2026-03-12T11:15:00.000Z',
    title: 'Headache',
    symptom: 'headache',
    intensity: 4,
  }
  assertJsonSchemaValidation(event.schema, validSymptomRow, true)
  assertJsonSchemaValidation(event.schema, {
    ...validSymptomRow,
    occurredAt: '2026-03-12',
  }, true)
  assertJsonSchemaValidation(event.schema, {
    ...validSymptomRow,
    occurredAt: '2026-03-12T11:15:00.123456Z',
  }, true)
  assertJsonSchemaValidation(event.schema, {
    ...validSymptomRow,
    occurredAt: '2026-03-12t11:15:00.123456z',
  }, true)
  assertJsonSchemaValidation(event.schema, {
    ...validSymptomRow,
    occurredAt: 'not-a-date',
  }, false)
  assertJsonSchemaValidation(event.schema, {
    ...validSymptomRow,
    dayKey: '2026-03-12',
  }, false)

  const activitySession = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'event',
      'payload-schema',
      '--for',
      'import-jsonl',
      '--kind',
      'activity_session',
    ])).envelope,
  )
  const activitySessionRow = {
    kind: 'activity_session',
    occurredAt: '2026-03-12T11:15:00.000Z',
    title: 'Strength training',
    activityType: 'strength-training',
    workout: {
      exercises: [
        {
          name: 'Squat',
          order: 1,
          sets: [{ order: 1, reps: 5 }],
        },
      ],
    },
  }
  assert.equal(
    (activitySession.schema.required as unknown[] | undefined)?.includes('durationMinutes'),
    true,
  )
  assertJsonSchemaValidation(activitySession.schema, activitySessionRow, false)
  assertJsonSchemaValidation(activitySession.schema, {
    ...activitySessionRow,
    durationMinutes: 45,
  }, true)
})

test('payload-schema discovery copy is limited to supported import nouns', async () => {
  const cli = createPayloadSchemaCli()

  const conditionHelp = await runRawInProcessCli(cli, [
    'condition',
    'import-json',
    '--help',
  ])
  assert.equal(conditionHelp.exitCode ?? 0, 0)
  assert.match(conditionHelp.output, /condition payload-schema --format json/u)

  const goalHelp = await runRawInProcessCli(cli, [
    'goal',
    'import-json',
    '--help',
  ])
  assert.equal(goalHelp.exitCode ?? 0, 0)
  assert.match(goalHelp.output, /goal scaffold/u)
  assert.doesNotMatch(goalHelp.output, /goal payload-schema/u)

  for (const path of [
    'condition payload-schema',
    'blood-test payload-schema',
    'encounter payload-schema',
    'event payload-schema',
  ]) {
    assert.notEqual(findManifestLeafCommand(path), undefined, `expected ${path}`)
  }

  for (const path of [
    'goal payload-schema',
    'allergy payload-schema',
    'family payload-schema',
    'genetics payload-schema',
    'immunization payload-schema',
  ]) {
    assert.equal(findManifestLeafCommand(path), undefined, `unexpected ${path}`)
  }

  assert.match(
    manifestLeafHint('condition import-json'),
    /condition payload-schema --format json/u,
  )
  assert.doesNotMatch(
    manifestLeafHint('goal import-json'),
    /payload-schema/u,
  )
})

test('payload-schema manifest leaves share the canonical envelope output schema', () => {
  for (const path of [
    'condition payload-schema',
    'blood-test payload-schema',
    'encounter payload-schema',
    'event payload-schema',
    'workout payload-schema',
  ]) {
    assert.equal(
      manifestLeafOutput(path),
      payloadSchemaEnvelopeSchema,
      path,
    )
  }
})

test('payload-schema --schema remains an Incur command schema', async () => {
  const cli = createPayloadSchemaCli()

  const bloodTestSchema = await readCommandSchema(cli, ['blood-test', 'payload-schema'])
  assert.ok(bloodTestSchema.args)
  assert.ok(bloodTestSchema.output)
  assert.equal(JSON.stringify(bloodTestSchema).includes('bloodTest'), false)
  assert.equal(JSON.stringify(bloodTestSchema).includes('results'), false)

  const eventSchema = await readCommandSchema(cli, ['event', 'payload-schema'])
  const eventOptions = propertiesOf(eventSchema.options ?? {})
  assert.ok(eventOptions.for)
  assert.ok(eventOptions.kind)
})
