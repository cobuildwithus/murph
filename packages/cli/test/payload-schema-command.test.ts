import assert from 'node:assert/strict'

import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'

import { registerEncounterCommands } from '../src/commands/encounter.js'
import { registerEventCommands } from '../src/commands/event.js'
import { createHealthEntityCrudGroup } from '../src/commands/health-entity-command-registry.js'
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
  schema: JsonRecord
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
  assert.ok(propertiesOf(condition.schema).title)
  assert.equal(condition.examples.length, 1)

  const bloodTest = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'blood-test',
      'payload-schema',
    ])).envelope,
  )
  assert.equal(bloodTest.command, 'blood-test import-json')
  assert.equal(bloodTest.schemaName, 'blood-test-import-payload')
  assert.ok(propertiesOf(bloodTest.schema).results)
  assert.equal(bloodTest.examples.length, 1)

  const encounter = requireData(
    (await runInProcessJsonCli<PayloadSchemaResult>(cli, [
      'encounter',
      'payload-schema',
    ])).envelope,
  )
  assert.equal(encounter.command, 'encounter import-json')
  assert.equal(encounter.schemaName, 'encounter-import-payload')
  assert.ok(propertiesOf(encounter.schema).encounter)
  assert.ok(propertiesOf(encounter.schema).tests)

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
  assert.equal(eventProperties.id, undefined)
  assert.equal(eventProperties.eventId, undefined)
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
