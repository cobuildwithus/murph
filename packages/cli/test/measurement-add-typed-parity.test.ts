import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { afterEach } from 'vitest'

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
      metric: 'body-fat-percentage',
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
