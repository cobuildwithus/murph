import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { normalizeJunctionSnapshot } from '@murphai/importers'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { afterEach } from 'vitest'

import { registerEventCommands } from '../src/commands/event.js'
import { registerMeasurementCommands } from '../src/commands/measurement.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createTempVaultContext,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'

interface CommandSchemaEnvelope {
  args: {
    properties: Record<string, unknown>
    required?: string[]
  }
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getOptionDescription(
  schema: CommandSchemaEnvelope,
  optionName: string,
): string {
  const property = schema.options.properties[optionName]
  if (!isRecord(property)) {
    assert.fail(`${optionName} schema must be an object`)
  }
  const description = property.description
  if (typeof description !== 'string') {
    assert.fail(`${optionName} schema must include a description`)
  }
  return description
}

interface MeasurementAddResult {
  vault: string
  eventId: string
  lookupId: string
  ledgerFile: string
  created: boolean
  occurredAt: string
  kind: 'measurement'
  title: string
  measurements: Array<{
    metric: string
    value: number
    unit: string
    qualifiers?: Record<string, string | number | boolean>
    note?: string
  }>
  media: Array<{
    kind: string
    relativePath: string
    mediaType?: string
    caption?: string
  }>
  manifestFile: string | null
  note: string | null
}

interface MeasurementShowResult {
  entity: {
    id: string
    data: {
      source?: string
      tags?: string[]
      timeZone?: string
      measurements?: MeasurementAddResult['measurements']
      media?: MeasurementAddResult['media']
      rawRefs?: string[]
      relatedIds?: string[]
      links?: Array<{ type: string; targetId: string }>
      externalRef?: {
        system: string
        resourceType: string
        resourceId: string
        version?: string
        facet?: string
      }
    }
  }
}

interface MeasurementEntryListResult {
  filters: {
    metric: string[]
    from?: string
    to?: string
    limit: number
  }
  items: Array<{
    eventId: string
    recordKind: 'measurement' | 'body_measurement' | 'observation'
    measurementIndex: number | null
    occurredAt: string
    source: string | null
    metric: string
    value: number
    unit: string
    qualifiers?: Record<string, string | number | boolean>
    note?: string
  }>
  count: number
  nextCursor: null
}

interface MeasurementListResult {
  items: Array<{
    id: string
    data: Record<string, unknown>
  }>
}

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

function createMeasurementCli() {
  const cli = Cli.create('vault-cli', {
    description: 'measurement add typed parity test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerEventCommands(cli, services)
  registerMeasurementCommands(cli)

  return cli
}

async function runRawInProcessCli(
  cli: Cli.Cli,
  args: string[],
): Promise<string> {
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

  assert.equal(exitCode, null)
  return output.join('').trim()
}

async function readCommandSchema(
  cli: Cli.Cli,
  commandArgs: string[],
): Promise<CommandSchemaEnvelope> {
  return JSON.parse(
    await runRawInProcessCli(cli, [...commandArgs, '--schema', '--format', 'json']),
  ) as CommandSchemaEnvelope
}

async function initVault(cli: Cli.Cli, vaultRoot: string) {
  const initResult = await runInProcessJsonCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)
}

async function importEventPayload(input: {
  cli: Cli.Cli
  parentRoot: string
  vaultRoot: string
  fileName: string
  payload: Record<string, unknown>
}) {
  const payloadPath = path.join(input.parentRoot, input.fileName)
  await writeFile(payloadPath, JSON.stringify(input.payload), 'utf8')

  return requireData(
    (
      await runInProcessJsonCli<{ eventId: string }>(input.cli, [
        'event',
        'import-json',
        '--vault',
        input.vaultRoot,
        '--input',
        `@${payloadPath}`,
      ])
    ).envelope,
  )
}

test('measurement add schema exposes typed single-record and grouped-event fields', async () => {
  const schema = await readCommandSchema(createMeasurementCli(), ['measurement', 'add'])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('input' in schema.options.properties, false)

  for (const field of [
    'metric',
    'value',
    'unit',
    'qualifier',
    'measurementNote',
    'note',
    'title',
    'occurredAt',
    'source',
    'media',
    'tag',
    'timeZone',
  ]) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test('measurement add guidance surfaces teach quoted metrics and indexed grouped qualifiers', async () => {
  const cli = createMeasurementCli()
  const help = await runRawInProcessCli(cli, ['measurement', 'add', '--help'])
  const schema = await readCommandSchema(cli, ['measurement', 'add'])
  const llms = await runRawInProcessCli(cli, ['measurement', 'add', '--llms-full'])

  for (const rendered of [help, llms]) {
    assert.match(rendered, /--metric 'grip strength'/u)
    assert.match(rendered, /--metric 'resting heart rate'/u)
    assert.match(rendered, /Do not comma-delimit multiple metrics/u)
  }

  assert.match(getOptionDescription(schema, 'metric'), /Shell-quote friendly names with spaces/u)
  assert.match(getOptionDescription(schema, 'metric'), /Do not comma-delimit multiple metrics/u)
  assert.match(getOptionDescription(schema, 'qualifier'), /1:side=right/u)
  assert.match(getOptionDescription(schema, 'qualifier'), /2:posture=seated/u)
  assert.match(getOptionDescription(schema, 'measurementNote'), /1:after coffee/u)
  assert.match(getOptionDescription(schema, 'measurementNote'), /2:five quiet minutes/u)
})

test('measurement entry list schema uses canonical metric identity and preserves lossless entry fields', async () => {
  const schema = await readCommandSchema(createMeasurementCli(), [
    'measurement',
    'entry',
    'list',
  ])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal(schema.options.required?.includes('metric') ?? false, true)
  for (const field of ['metric', 'from', 'to', 'limit', 'vault']) {
    assert.equal(field in schema.options.properties, true, field)
  }
  assert.match(getOptionDescription(schema, 'metric'), /canonical metric identity/u)
  assert.match(getOptionDescription(schema, 'metric'), /never fuzzy matching/u)
})

test('measurement entry list returns primary, legacy, and device-observation scalars without changing event list', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-entry-list-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const directBmi = requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'body mass index',
        '--value',
        '17.2',
        '--unit',
        'kg_m2',
        '--occurred-at',
        '2026-07-02T07:30:00.000Z',
        '--source',
        'device',
      ])
    ).envelope,
  )
  const grouped = requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'height',
        '--value',
        '175',
        '--unit',
        'cm',
        '--metric',
        'bodyweight',
        '--value',
        '50',
        '--unit',
        'kg',
        '--occurred-at',
        '2026-07-03T07:30:00.000Z',
        '--source',
        'manual',
      ])
    ).envelope,
  )
  requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'body-weight-estimate',
        '--value',
        '55',
        '--unit',
        'kg',
        '--occurred-at',
        '2026-07-04T07:30:00.000Z',
      ])
    ).envelope,
  )
  const bodyMeasurement = await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'body-measurement.json',
    payload: {
      kind: 'body_measurement',
      occurredAt: '2026-07-05T07:30:00.000Z',
      source: 'manual',
      title: 'Legacy body check-in',
      measurements: [
        {
          type: 'weight',
          value: 49,
          unit: 'kg',
        },
      ],
    },
  })
  const junctionWeight = await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'junction-weight.json',
    payload: {
      kind: 'observation',
      occurredAt: '2026-07-06T07:30:00.000Z',
      source: 'device',
      title: 'Junction body weight',
      metric: 'weight',
      value: 48.5,
      unit: 'kg',
      observationGrain: 'summary',
      externalRef: {
        system: 'junction',
        resourceType: 'junction-body',
        resourceId: 'body-2026-07-06',
        facet: 'weight',
      },
    },
  })
  const whoopBmi = await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'whoop-bmi.json',
    payload: {
      kind: 'observation',
      occurredAt: '2026-07-07T07:30:00.000Z',
      source: 'device',
      title: 'WHOOP BMI',
      metric: 'bmi',
      value: 16.8,
      unit: 'kg_m2',
      observationGrain: 'summary',
      externalRef: {
        system: 'whoop',
        resourceType: 'body-measurement',
        resourceId: 'body-2026-07-07',
        facet: 'bmi',
      },
    },
  })
  const aliasedBmi = await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'aliased-bmi.json',
    payload: {
      kind: 'observation',
      occurredAt: '2026-07-09T07:30:00.000Z',
      source: 'device',
      title: 'Imported BMI alias',
      metric: 'body-mass-index',
      value: 16.7,
      unit: 'kg/m2',
      observationGrain: 'summary',
    },
  })
  const normalBmi = await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'normal-bmi.json',
    payload: {
      kind: 'observation',
      occurredAt: '2026-07-01T07:30:00.000Z',
      source: 'device',
      title: 'Earlier device BMI',
      metric: 'bmi',
      value: 22.1,
      unit: 'kg/m2',
      observationGrain: 'summary',
    },
  })
  await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'stale-observation.json',
    payload: {
      kind: 'observation',
      occurredAt: '2026-05-01T07:30:00.000Z',
      source: 'device',
      title: 'Stale device BMI',
      metric: 'bmi',
      value: 16.4,
      unit: 'kg_m2',
    },
  })
  await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'unrelated-observation.json',
    payload: {
      kind: 'observation',
      occurredAt: '2026-07-08T07:30:00.000Z',
      source: 'device',
      title: 'Device resting heart rate',
      metric: 'resting-heart-rate',
      value: 52,
      unit: 'bpm',
    },
  })
  await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'junction-stale-positive-pregnancy-test.json',
    payload: {
      kind: 'measurement',
      occurredAt: '2025-10-02T07:30:00.000Z',
      source: 'device',
      title: 'Junction pregnancy test',
      measurements: [{
        metric: 'pregnancy-test',
        value: 1,
        unit: 'result',
        qualifiers: { result: 'positive' },
      }],
    },
  })
  const normalizedJunctionSnapshot = normalizeJunctionSnapshot({
    importedAt: '2026-07-11T12:00:00.000Z',
    summaries: {
      menstrual_cycle: [{
        id: 'cycle-2026-07',
        period_start: '2026-07-01',
        home_pregnancy_test: [{
          date: '2026-07-10',
          test_result: 'positive',
        }],
        source: {
          provider: 'apple_health',
          type: 'phone',
        },
      }],
    },
  })
  const normalizedPositivePregnancyTest = normalizedJunctionSnapshot.events?.find(
    (event) => event.title === 'Junction pregnancy test',
  )
  assert.ok(normalizedPositivePregnancyTest)
  assert.equal(normalizedPositivePregnancyTest.kind, 'measurement')
  assert.ok(normalizedPositivePregnancyTest.occurredAt)
  assert.ok(normalizedPositivePregnancyTest.fields)

  const junctionPositivePregnancyTest = await importEventPayload({
    cli,
    parentRoot,
    vaultRoot,
    fileName: 'junction-positive-pregnancy-test.json',
    payload: {
      kind: normalizedPositivePregnancyTest.kind,
      occurredAt: normalizedPositivePregnancyTest.occurredAt,
      source: normalizedPositivePregnancyTest.source,
      title: normalizedPositivePregnancyTest.title,
      ...normalizedPositivePregnancyTest.fields,
      externalRef: normalizedPositivePregnancyTest.externalRef,
    },
  })

  const entries = requireData(
    (
      await runInProcessJsonCli<MeasurementEntryListResult>(cli, [
        'measurement',
        'entry',
        'list',
        '--vault',
        vaultRoot,
        '--metric',
        'BMI',
        '--metric',
        'height',
        '--metric',
        'weight',
        '--metric',
        'body_weight',
        '--from',
        '2026-07-01',
        '--to',
        '2026-07-31',
        '--limit',
        '200',
      ])
    ).envelope,
  )

  assert.deepEqual(entries.filters, {
    metric: ['bmi', 'height', 'weight', 'body-weight'],
    from: '2026-07-01',
    to: '2026-07-31',
    limit: 200,
  })
  assert.equal(entries.count, 8)
  assert.equal(entries.nextCursor, null)
  assert.deepEqual(entries.items, [
    {
      eventId: aliasedBmi.eventId,
      recordKind: 'observation',
      measurementIndex: null,
      occurredAt: '2026-07-09T07:30:00.000Z',
      source: 'device',
      metric: 'body-mass-index',
      value: 16.7,
      unit: 'kg/m2',
    },
    {
      eventId: whoopBmi.eventId,
      recordKind: 'observation',
      measurementIndex: null,
      occurredAt: '2026-07-07T07:30:00.000Z',
      source: 'device',
      metric: 'bmi',
      value: 16.8,
      unit: 'kg_m2',
    },
    {
      eventId: junctionWeight.eventId,
      recordKind: 'observation',
      measurementIndex: null,
      occurredAt: '2026-07-06T07:30:00.000Z',
      source: 'device',
      metric: 'weight',
      value: 48.5,
      unit: 'kg',
    },
    {
      eventId: bodyMeasurement.eventId,
      recordKind: 'body_measurement',
      measurementIndex: 0,
      occurredAt: '2026-07-05T07:30:00.000Z',
      source: 'manual',
      metric: 'weight',
      value: 49,
      unit: 'kg',
    },
    {
      eventId: grouped.eventId,
      recordKind: 'measurement',
      measurementIndex: 0,
      occurredAt: '2026-07-03T07:30:00.000Z',
      source: 'manual',
      metric: 'height',
      value: 175,
      unit: 'cm',
    },
    {
      eventId: grouped.eventId,
      recordKind: 'measurement',
      measurementIndex: 1,
      occurredAt: '2026-07-03T07:30:00.000Z',
      source: 'manual',
      metric: 'bodyweight',
      value: 50,
      unit: 'kg',
    },
    {
      eventId: directBmi.eventId,
      recordKind: 'measurement',
      measurementIndex: 0,
      occurredAt: '2026-07-02T07:30:00.000Z',
      source: 'device',
      metric: 'body-mass-index',
      value: 17.2,
      unit: 'kg_m2',
    },
    {
      eventId: normalBmi.eventId,
      recordKind: 'observation',
      measurementIndex: null,
      occurredAt: '2026-07-01T07:30:00.000Z',
      source: 'device',
      metric: 'bmi',
      value: 22.1,
      unit: 'kg/m2',
    },
  ])

  const pregnancyEntries = requireData(
    (
      await runInProcessJsonCli<MeasurementEntryListResult>(cli, [
        'measurement',
        'entry',
        'list',
        '--vault',
        vaultRoot,
        '--metric',
        'pregnancy-test',
        '--from',
        '2025-10-03',
        '--to',
        '2026-07-30',
        '--limit',
        '200',
      ])
    ).envelope,
  )
  assert.deepEqual(pregnancyEntries.filters, {
    metric: ['pregnancy-test'],
    from: '2025-10-03',
    to: '2026-07-30',
    limit: 200,
  })
  assert.deepEqual(pregnancyEntries.items, [{
    eventId: junctionPositivePregnancyTest.eventId,
    recordKind: 'measurement',
    measurementIndex: 0,
    occurredAt: '2026-07-10T00:00:00.000Z',
    source: 'device',
    metric: 'pregnancy-test',
    value: 1,
    unit: 'result',
    qualifiers: { result: 'positive' },
  }])
  assert.equal(pregnancyEntries.count, 1)
  assert.equal(pregnancyEntries.nextCursor, null)

  const saturated = requireData(
    (
      await runInProcessJsonCli<MeasurementEntryListResult>(cli, [
        'measurement',
        'entry',
        'list',
        '--vault',
        vaultRoot,
        '--metric',
        'bmi',
        '--from',
        '2026-07-01',
        '--to',
        '2026-07-31',
        '--limit',
        '1',
      ])
    ).envelope,
  )
  assert.equal(saturated.count, 1)
  assert.deepEqual(saturated.items, [entries.items[0]])

  const events = requireData(
    (
      await runInProcessJsonCli<MeasurementListResult>(cli, [
        'measurement',
        'list',
        '--vault',
        vaultRoot,
        '--from',
        '2026-07-01',
        '--to',
        '2026-07-31',
        '--limit',
        '10',
      ])
    ).envelope,
  )
  const groupedEvent = events.items.find((item) => item.id === grouped.eventId)
  assert.ok(groupedEvent)
  assert.equal(groupedEvent.data.measurementsCount, 2)
  assert.equal('measurements' in groupedEvent.data, false)
  assert.equal(events.items.some((item) => item.id === whoopBmi.eventId), false)
  assert.equal(events.items.some((item) => item.id === junctionWeight.eventId), false)
})

test('measurement import-json schema exposes the structured payload escape hatch', async () => {
  const schema = await readCommandSchema(createMeasurementCli(), [
    'measurement',
    'import-json',
  ])

  assert.deepEqual(schema.args.required ?? [], [])
  assert.equal('input' in schema.options.properties, true)
  assert.equal(schema.options.required?.includes('input') ?? false, true)

  for (const field of ['note', 'title', 'occurredAt', 'source', 'media']) {
    assert.equal(field in schema.options.properties, true, field)
  }
})

test('measurement add typed grouped fields persist with the same event shape as JSON input', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-typed-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const typedResult = requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'Grip Strength',
        '--value',
        '97.2',
        '--unit',
        'lb',
        '--qualifier',
        '1:side=right',
        '--qualifier',
        '1:attempt=2',
        '--measurement-note',
        '1:Dynamometer set two.',
        '--metric',
        'Resting HR',
        '--value',
        '54',
        '--unit',
        'bpm',
        '--qualifier',
        '2:posture=seated',
        '--measurement-note',
        '2:After five quiet minutes.',
        '--note',
        'Morning check-in.',
        '--title',
        'Morning metrics',
        '--occurred-at',
        '2026-03-14T07:30:00.000Z',
        '--source',
        'manual',
        '--tag',
        'baseline',
        '--tag',
        'morning',
        '--time-zone',
        'America/Los_Angeles',
      ])
    ).envelope,
  )

  const payloadPath = path.join(parentRoot, 'measurement.json')
  await writeFile(
    payloadPath,
    `${JSON.stringify({
      occurredAt: '2026-03-14T07:30:00.000Z',
      source: 'manual',
      title: 'Morning metrics',
      note: 'Morning check-in.',
      tags: ['baseline', 'morning'],
      timeZone: 'America/Los_Angeles',
      measurements: [
        {
          metric: 'Grip Strength',
          value: 97.2,
          unit: 'lb',
          qualifiers: {
            side: 'right',
            attempt: 2,
          },
          note: 'Dynamometer set two.',
        },
        {
          metric: 'Resting HR',
          value: 54,
          unit: 'bpm',
          qualifiers: {
            posture: 'seated',
          },
          note: 'After five quiet minutes.',
        },
      ],
    })}\n`,
    'utf8',
  )

  const jsonResult = requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'import-json',
        '--vault',
        vaultRoot,
        '--input',
        `@${payloadPath}`,
      ])
    ).envelope,
  )

  assert.deepEqual(typedResult.measurements, jsonResult.measurements)
  assert.equal(typedResult.title, jsonResult.title)
  assert.equal(typedResult.note, jsonResult.note)
  assert.equal(typedResult.occurredAt, jsonResult.occurredAt)

  const shown = requireData(
    (
      await runInProcessJsonCli<MeasurementShowResult>(cli, [
        'measurement',
        'show',
        typedResult.eventId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.deepEqual(shown.entity.data.measurements, typedResult.measurements)
  assert.deepEqual(shown.entity.data.tags, ['baseline', 'morning'])
  assert.equal(shown.entity.data.timeZone, 'America/Los_Angeles')
  assert.equal(shown.entity.data.source, 'manual')
})

test('measurement add typed repeatable qualifiers and media stage onto one event', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-media-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const photoPath = path.join(parentRoot, 'measurement-photo.jpg')
  const videoPath = path.join(parentRoot, 'measurement-video.mp4')
  await writeFile(photoPath, 'photo-bytes', 'utf8')
  await writeFile(videoPath, 'video-bytes', 'utf8')

  const result = requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'waist check',
        '--value',
        '32.5',
        '--unit',
        'in',
        '--qualifier',
        '1:site=navel',
        '--qualifier',
        'fasted=true',
        '--media',
        photoPath,
        '--media',
        videoPath,
        '--occurred-at',
        '2026-03-15T07:30:00.000Z',
      ])
    ).envelope,
  )

  assert.deepEqual(result.measurements, [
    {
      metric: 'waist-check',
      qualifiers: {
        fasted: true,
        site: 'navel',
      },
      unit: 'in',
      value: 32.5,
    },
  ])
  assert.equal(result.media.length, 2)
  assert.ok(result.media.every((entry) => entry.relativePath.startsWith('raw/measurements/2026/03/')))
  assert.ok(result.manifestFile?.startsWith('raw/measurements/2026/03/'))
})

test('measurement add rejects incomplete typed measurement groups before writing', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-invalid-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const result = await runInProcessJsonCli<MeasurementAddResult>(cli, [
    'measurement',
    'add',
    '--vault',
    vaultRoot,
    '--metric',
    'grip-strength',
    '--value',
    '97.2',
    '--occurred-at',
    '2026-03-15T07:30:00.000Z',
  ])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  if (!result.envelope.ok) {
    assert.equal(result.envelope.error.code, 'invalid_option')
    assert.match(result.envelope.error.message ?? '', /--metric, --value, and --unit/u)
  }
})

test('measurement add rejects non-slug typed tags before writing', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-tag-invalid-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const result = await runInProcessJsonCli<MeasurementAddResult>(cli, [
    'measurement',
    'add',
    '--vault',
    vaultRoot,
    '--metric',
    'resting-heart-rate',
    '--value',
    '54',
    '--unit',
    'bpm',
    '--tag',
    'contains spaces',
    '--occurred-at',
    '2026-03-15T07:30:00.000Z',
  ])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  if (!result.envelope.ok) {
    assert.equal(result.envelope.error.code, 'VALIDATION_ERROR')
    assert.match(result.envelope.error.message ?? '', /lowercase kebab-case slug/u)
  }
})

test('measurement add reports indexed qualifier and note shape mistakes directly', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-indexed-invalid-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const malformedQualifier = await runInProcessJsonCli<MeasurementAddResult>(cli, [
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
    '--metric',
    'resting-heart-rate',
    '--value',
    '54',
    '--unit',
    'bpm',
    '--qualifier',
    '1:after coffee',
  ])

  assert.equal(malformedQualifier.exitCode, 1)
  assert.equal(malformedQualifier.envelope.ok, false)
  if (!malformedQualifier.envelope.ok) {
    assert.equal(malformedQualifier.envelope.error.code, 'invalid_option')
    assert.match(malformedQualifier.envelope.error.message ?? '', /N:key=value/u)
    assert.match(malformedQualifier.envelope.error.message ?? '', /1:side=right/u)
  }

  const missingNoteText = await runInProcessJsonCli<MeasurementAddResult>(cli, [
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
    '--metric',
    'resting-heart-rate',
    '--value',
    '54',
    '--unit',
    'bpm',
    '--measurement-note',
    '1:',
  ])

  assert.equal(missingNoteText.exitCode, 1)
  assert.equal(missingNoteText.envelope.ok, false)
  if (!missingNoteText.envelope.ok) {
    assert.equal(missingNoteText.envelope.error.code, 'invalid_option')
    assert.match(missingNoteText.envelope.error.message ?? '', /note text after N:/u)
    assert.match(missingNoteText.envelope.error.message ?? '', /1:after coffee/u)
  }
})

test('measurement import-json preserves nested links and import metadata', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-raw-input-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const payloadPath = path.join(parentRoot, 'measurement-import.json')
  await writeFile(
    payloadPath,
    `${JSON.stringify({
      occurredAt: '2026-03-16T08:00:00.000Z',
      source: 'import',
      title: 'Imported metrics',
      note: 'Advanced raw payload.',
      tags: ['imported', 'lab-export'],
      timeZone: 'America/Los_Angeles',
      measurements: [
        {
          metric: 'body-fat-pct',
          value: 18.4,
          unit: 'percent',
          qualifiers: {
            device: 'dexa',
          },
          note: 'Imported from lab export.',
        },
      ],
      media: [
        {
          kind: 'photo',
          relativePath: 'raw/measurements/2026/03/evt_01JNV422Y2M5ZBV64ZP4N1DRB1/front.jpg',
          mediaType: 'image/jpeg',
          caption: 'Front photo from import.',
        },
      ],
      rawRefs: ['raw/measurements/2026/03/evt_01JNV422Y2M5ZBV64ZP4N1DRB1/import.json'],
      relatedIds: ['goal_01JNV422Y2M5ZBV64ZP4N1DRB1'],
      links: [
        {
          type: 'related_to',
          targetId: 'goal_01JNV422Y2M5ZBV64ZP4N1DRB1',
        },
      ],
      externalRef: {
        system: 'labcorp',
        resourceType: 'measurement-export',
        resourceId: 'panel-2026-03-16',
        version: 'v1',
      },
    })}\n`,
    'utf8',
  )

  const added = requireData(
    (
      await runInProcessJsonCli<MeasurementAddResult>(cli, [
        'measurement',
        'import-json',
        '--vault',
        vaultRoot,
        '--input',
        `@${payloadPath}`,
      ])
    ).envelope,
  )

  assert.deepEqual(added.measurements, [
    {
      metric: 'body-fat-pct',
      value: 18.4,
      unit: 'percent',
      qualifiers: {
        device: 'dexa',
      },
      note: 'Imported from lab export.',
    },
  ])
  assert.deepEqual(added.media, [
    {
      kind: 'photo',
      relativePath: 'raw/measurements/2026/03/evt_01JNV422Y2M5ZBV64ZP4N1DRB1/front.jpg',
      mediaType: 'image/jpeg',
      caption: 'Front photo from import.',
    },
  ])

  const shown = requireData(
    (
      await runInProcessJsonCli<MeasurementShowResult>(cli, [
        'measurement',
        'show',
        added.eventId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )

  assert.deepEqual(shown.entity.data.rawRefs, [
    'raw/measurements/2026/03/evt_01JNV422Y2M5ZBV64ZP4N1DRB1/import.json',
  ])
  assert.deepEqual(shown.entity.data.links, [
    {
      type: 'related_to',
      targetId: 'goal_01JNV422Y2M5ZBV64ZP4N1DRB1',
    },
  ])
  assert.deepEqual(shown.entity.data.externalRef, {
    system: 'labcorp',
    resourceType: 'measurement-export',
    resourceId: 'panel-2026-03-16',
    version: 'v1',
  })
  assert.deepEqual(shown.entity.data.tags, ['imported', 'lab-export'])
  assert.equal(shown.entity.data.timeZone, 'America/Los_Angeles')
})

test('measurement add rejects raw --input because JSON imports are explicit', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-input-flags-')
  cleanupPaths.push(parentRoot)
  const cli = createMeasurementCli()
  await initVault(cli, vaultRoot)

  const payloadPath = path.join(parentRoot, 'measurement.json')
  await writeFile(
    payloadPath,
    `${JSON.stringify({
      occurredAt: '2026-03-16T08:00:00.000Z',
      measurements: [
        {
          metric: 'resting-hr',
          value: 54,
          unit: 'bpm',
        },
      ],
    })}\n`,
    'utf8',
  )

  const result = await runInProcessJsonCli<MeasurementAddResult>(cli, [
    'measurement',
    'add',
    '--vault',
    vaultRoot,
    '--input',
    `@${payloadPath}`,
    '--tag',
    'baseline',
    '--time-zone',
    'America/Los_Angeles',
  ])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  if (!result.envelope.ok) {
    assert.match(result.envelope.error.message ?? '', /input/u)
  }
})
