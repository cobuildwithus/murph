import assert from 'node:assert/strict'
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { Cli } from 'incur'
import { afterEach } from 'vitest'

import { createIntegratedVaultServices } from '@murphai/vault-usecases'

import {
  createTempVaultContext,
  repoRoot,
  requireData,
  runInProcessJsonCli,
} from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { registerMeasurementCommands } from '../src/commands/measurement.js'
import { registerWorkoutCommands } from '../src/commands/workout.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'

const cleanupPaths: string[] = []
const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)

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

function createWorkoutSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'workout coverage cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerMeasurementCommands(cli)
  registerWorkoutCommands(cli, services)

  return cli
}

async function runWorkoutCli<TData>(
  cli: Cli.Cli,
  args: string[],
) {
  return await runInProcessJsonCli<TData>(cli, args, {
    env: process.env,
  })
}

async function runWorkoutCliRaw(
  cli: Cli.Cli,
  args: string[],
) {
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

test('canonical measurement capture and workout unit preferences round-trip through the registered CLI', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-coverage-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()
  const measurementPayloadPath = path.join(parentRoot, 'measurement.json')

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const updatedUnits = requireData(
    (
      await runWorkoutCli<{
        unitPreferences: {
          bodyMeasurement: string
          weight: string
        }
        preferencesPath: string
        updated: boolean
      }>(cli, [
        'workout',
        'units',
        'set',
        '--vault',
        vaultRoot,
        '--weight',
        'lb',
        '--body-measurement',
        'in',
        '--recorded-at',
        '2026-03-12T07:00:00.000Z',
      ])
    ).envelope,
  )
  assert.equal(updatedUnits.updated, true)
  assert.equal(updatedUnits.preferencesPath, 'bank/preferences.json')
  assert.equal(updatedUnits.unitPreferences.weight, 'lb')
  assert.equal(updatedUnits.unitPreferences.bodyMeasurement, 'in')

  const shownUnits = requireData(
    (
      await runWorkoutCli<{
        preferencesPath: string
        updated: boolean
        unitPreferences: {
          bodyMeasurement: string
          weight: string
        }
      }>(cli, [
        'workout',
        'units',
        'show',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(shownUnits.updated, false)
  assert.equal(shownUnits.preferencesPath, 'bank/preferences.json')
  assert.equal(shownUnits.unitPreferences.bodyMeasurement, 'in')

  const rejectedUnitUpdate = await runWorkoutCli(cli, [
    'workout',
    'units',
    'set',
    '--vault',
    vaultRoot,
  ])
  assert.equal(rejectedUnitUpdate.envelope.ok, false)
  if (rejectedUnitUpdate.envelope.ok) {
    throw new Error('Expected workout units set to reject an empty update.')
  }
  assert.equal(rejectedUnitUpdate.envelope.error.code, 'invalid_option')

  const measurement = requireData(
    (
      await runWorkoutCli<{
        eventId: string
        kind: string
        manifestFile: string | null
        occurredAt: string
        measurements: Array<{
          metric: string
          unit: string
          value: number
        }>
        note: string | null
      }>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'waist',
        '--value',
        '32',
        '--unit',
        'in',
        '--title',
        'Waist check-in',
        '--note',
        'Post-cut check-in.',
        '--source',
        'manual',
        '--media',
        sampleDocumentPath,
        '--occurred-at',
        '2026-03-12',
      ])
    ).envelope,
  )
  assert.equal(measurement.kind, 'measurement')
  assert.equal(measurement.occurredAt, '2026-03-12T19:00:00.000Z')
  assert.match(
    measurement.manifestFile ?? '',
    /^raw\/measurements\/2026\/03\/evt[_A-Z0-9]+\/manifest(?:\.[^/]+)*\.json$/u,
  )
  assert.equal(measurement.note, 'Post-cut check-in.')
  assert.deepEqual(measurement.measurements, [
    {
      note: 'Post-cut check-in.',
      metric: 'waist-circumference',
      unit: 'in',
      value: 32,
    },
  ])

  const shownMeasurement = requireData(
    (
      await runWorkoutCli<{
        entity: {
          id: string
          kind: string
          title: string | null
        }
      }>(cli, [
        'measurement',
        'show',
        measurement.eventId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(shownMeasurement.entity.id, measurement.eventId)
  assert.equal(shownMeasurement.entity.kind, 'measurement')
  assert.equal(shownMeasurement.entity.title, 'Waist check-in')

  const listedMeasurements = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'measurement',
        'list',
        '--vault',
        vaultRoot,
        '--limit',
        '10',
      ])
    ).envelope,
  )
  assert.equal(listedMeasurements.count, 1)
  assert.equal(listedMeasurements.items[0]?.id, measurement.eventId)

  const measurementManifest = await runWorkoutCli<{
    manifest: {
      rawDirectory: string
    }
    manifestFile: string
  }>(cli, [
    'measurement',
    'manifest',
    measurement.eventId,
    '--vault',
    vaultRoot,
  ])
  assert.equal(measurementManifest.envelope.ok, true)
  const manifestData = requireData<{
    manifest: {
      rawDirectory: string
    }
    manifestFile: string
  }>(measurementManifest.envelope)
  assert.match(manifestData.manifestFile, /^raw\/measurements\/2026\/03\/evt[-_]/u)
  assert.match(manifestData.manifest.rawDirectory, /^raw\/measurements\/2026\/03\/evt[-_]/u)

  await writeFile(
    measurementPayloadPath,
    JSON.stringify(
      {
        occurredAt: '2026-03-13T07:30:00.000Z',
        source: 'import',
        title: 'Structured measurement',
        note: 'Imported structured payload.',
        measurements: [
          {
            metric: 'weight',
            value: 182,
            unit: 'lb',
            note: 'Structured payload.',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )

  const structuredMeasurement = requireData(
    (
      await runWorkoutCli<{
        eventId: string
        kind: string
        manifestFile: string | null
        note: string | null
      }>(cli, [
        'measurement',
        'import-json',
        '--input',
        `@${measurementPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(structuredMeasurement.kind, 'measurement')
  assert.equal(structuredMeasurement.note, 'Imported structured payload.')

  const defaultListedMeasurements = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'measurement',
        'list',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(defaultListedMeasurements.count, 2)
  assert.equal(
    defaultListedMeasurements.items.some((item) => item.id === structuredMeasurement.eventId),
    true,
  )
  assert.equal(
    defaultListedMeasurements.items.some((item) => item.id === measurement.eventId),
    true,
  )

  const minimalMeasurement = requireData(
    (
      await runWorkoutCli<{
        eventId: string
        kind: string
        measurements: Array<{
          metric: string
          unit: string
          value: number
        }>
        note: string | null
      }>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'weight',
        '--value',
        '181',
        '--unit',
        'lb',
        '--occurred-at',
        '2026-03-13T07:30:00.000Z',
      ])
    ).envelope,
  )
  assert.equal(minimalMeasurement.kind, 'measurement')
  assert.equal(minimalMeasurement.note, null)
})

test('top-level measurement commands accept open metrics and normalize qualifier-backed slugs', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-measurement-command-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const measurement = requireData(
    (
      await runWorkoutCli<{
        eventId: string
        kind: string
        measurements: Array<{
          metric: string
          qualifiers?: Record<string, string | number | boolean>
          unit: string
          value: number
        }>
      }>(cli, [
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--metric',
        'Grip strength',
        '--value',
        '97.2',
        '--unit',
        'lb',
        '--qualifier',
        'side=right',
        '--qualifier',
        'attempt=2',
        '--occurred-at',
        '2026-03-14T07:30:00.000Z',
      ])
    ).envelope,
  )

  assert.equal(measurement.kind, 'measurement')
  assert.deepEqual(measurement.measurements, [
    {
      metric: 'grip-strength',
      qualifiers: {
        side: 'right',
        attempt: 2,
      },
      unit: 'lb',
      value: 97.2,
    },
  ])

  const shownMeasurement = requireData(
    (
      await runWorkoutCli<{
        entity: {
          id: string
          kind: string
          title: string | null
        }
      }>(cli, [
        'measurement',
        'show',
        measurement.eventId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(shownMeasurement.entity.id, measurement.eventId)
  assert.equal(shownMeasurement.entity.kind, 'measurement')
  assert.equal(shownMeasurement.entity.title, 'Grip Strength (right)')

  const listedMeasurements = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'measurement',
        'list',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(listedMeasurements.count, 1)
  assert.equal(listedMeasurements.items[0]?.id, measurement.eventId)
})

test('measurement help surfaces steer agents toward the canonical command path', async () => {
  const cli = createWorkoutSliceCli()
  const measurementHelp = await runWorkoutCliRaw(cli, [
    'measurement',
    'add',
    '--help',
  ])

  assert.match(
    measurementHelp,
    /Primary write path for scalar measurements\./u,
  )
  assert.match(
    measurementHelp,
    /Prefer this command for all new metrics\./u,
  )
})

test('workout import inspect and raw-only csv import expose the raw batch surfaces', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-import-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const csvPath = path.join(vaultRoot, 'workout-export.csv')
  await writeFile(
    csvPath,
    [
      'Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Reps,Weight,Weight Unit',
      'Push Day,2026-03-12,07:00,45,Bench Press,1,8,100,lb',
      'Push Day,2026-03-12,07:00,45,Bench Press,2,8,100,lb',
      '',
    ].join('\n'),
    'utf8',
  )

  const inspected = requireData(
    (
      await runWorkoutCli<{
        estimatedWorkouts: number
        importable: boolean
        rowCount: number
        source: string
        warnings: string[]
      }>(cli, [
        'workout',
        'import',
        'inspect',
        csvPath,
        '--vault',
        vaultRoot,
        '--source',
        'strong',
      ])
    ).envelope,
  )
  assert.equal(inspected.importable, true)
  assert.equal(inspected.estimatedWorkouts, 1)
  assert.equal(inspected.rowCount, 2)
  assert.equal(inspected.source, 'strong')
  assert.equal('headers' in inspected, false)
  assert.deepEqual(inspected.warnings, [])

  const privateSentinels = [
    'PRIVATE_WORKOUT_TITLE',
    'PRIVATE_WORKOUT_TIMESTAMP',
    'PRIVATE_EXERCISE_NAME',
    'PRIVATE_WORKOUT_NOTE',
  ]
  const headerlessPath = path.join(vaultRoot, 'headerless.csv')
  await writeFile(headerlessPath, privateSentinels.join(','), 'utf8')
  const headerless = await runWorkoutCli(cli, [
    'workout',
    'import',
    'inspect',
    headerlessPath,
    '--vault',
    vaultRoot,
    '--source',
    'strong',
  ])
  const headerlessOutput = JSON.stringify(headerless.envelope)
  for (const sentinel of privateSentinels) {
    assert.equal(headerlessOutput.includes(sentinel), false)
  }

  const largeHeaderPath = path.join(vaultRoot, 'large-header.csv')
  await writeFile(largeHeaderPath, 'x'.repeat(9 * 1024 * 1024), 'utf8')
  const largeHeader = await runWorkoutCli(cli, [
    'workout',
    'import',
    'inspect',
    largeHeaderPath,
    '--vault',
    vaultRoot,
    '--source',
    'strong',
  ])
  const largeHeaderOutput = JSON.stringify(largeHeader.envelope)
  assert.equal(largeHeaderOutput.length < 4096, true)
  assert.equal(largeHeaderOutput.includes('x'.repeat(100)), false)

  const unsupportedSource = await runWorkoutCli(cli, [
    'workout',
    'import',
    'inspect',
    csvPath,
    '--vault',
    vaultRoot,
    '--source',
    'strong-app',
  ])
  assert.equal(unsupportedSource.envelope.ok, false)
  if (unsupportedSource.envelope.ok) {
    throw new Error('Expected an unsupported workout source to fail validation.')
  }
  assert.equal(unsupportedSource.envelope.error.code, 'VALIDATION_ERROR')

  const imported = requireData(
    (
      await runWorkoutCli<{
        importedCount: number
        lookupIds: string[]
        manifestFile: string
        rawFile: string
        rawOnly: boolean
      }>(cli, [
        'workout',
        'import',
        'csv',
        csvPath,
        '--vault',
        vaultRoot,
        '--source',
        'strong',
        '--store-raw-only',
      ])
    ).envelope,
  )
  assert.equal(imported.rawOnly, true)
  assert.equal(imported.importedCount, 0)
  assert.deepEqual(imported.lookupIds, [])
  await access(path.join(vaultRoot, imported.rawFile))
  await access(path.join(vaultRoot, imported.manifestFile))
})

test('Strong CSV import requires weight provenance, commits once, and returns bounded replay output', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-strong-import-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])

  const header = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE'
  const rows = Array.from({ length: 12 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')
    const distance = index === 0 ? 1.5 : 0
    return `2026-04-${day} 07:00:00,Session ${index + 1},45m,Press,1,50,8,${distance},0,,Direct proof,7`
  })
  const csvPath = path.join(parentRoot, 'strong.csv')
  await writeFile(csvPath, [header, ...rows, ''].join('\n'), 'utf8')

  const inspection = requireData(
    (
      await runWorkoutCli<{
        importable: boolean
        requiresDistanceUnit: boolean
        requiresWeightUnit: boolean
        timeZone: string
      }>(cli, [
        'workout',
        'import',
        'inspect',
        csvPath,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(inspection.importable, false)
  assert.equal(inspection.requiresWeightUnit, true)
  assert.equal(inspection.requiresDistanceUnit, true)
  assert.equal(inspection.timeZone, 'America/Los_Angeles')

  const missingUnit = await runWorkoutCli(cli, [
    'workout',
    'import',
    'csv',
    csvPath,
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingUnit.envelope.ok, false)
  if (missingUnit.envelope.ok) {
    throw new Error('Expected Strong CSV import to require an explicit weight unit.')
  }
  assert.equal(missingUnit.envelope.error.code, 'invalid_option')
  assert.deepEqual(await readdir(path.join(vaultRoot, 'raw', 'workouts')), [])

  const missingDistanceUnit = await runWorkoutCli(cli, [
    'workout',
    'import',
    'csv',
    csvPath,
    '--vault',
    vaultRoot,
    '--weight-unit',
    'lb',
  ])
  assert.equal(missingDistanceUnit.envelope.ok, false)
  if (missingDistanceUnit.envelope.ok) {
    throw new Error('Expected Strong CSV import to require an explicit distance unit.')
  }
  assert.equal(missingDistanceUnit.envelope.error.code, 'invalid_option')
  assert.deepEqual(await readdir(path.join(vaultRoot, 'raw', 'workouts')), [])

  const invalidCsvPath = path.join(parentRoot, 'strong-invalid.csv')
  await writeFile(
    invalidCsvPath,
    [
      header,
      rows[0],
      `2026-05-01 07:00:00,${'X'.repeat(161)},45m,Press,1,50,8,0,0,,Direct proof,7`,
      '',
    ].join('\n'),
    'utf8',
  )
  const invalidBatch = await runWorkoutCli(cli, [
    'workout',
    'import',
    'csv',
    invalidCsvPath,
    '--vault',
    vaultRoot,
    '--weight-unit',
    'lb',
    '--distance-unit',
    'km',
  ])
  assert.equal(invalidBatch.envelope.ok, false)
  if (invalidBatch.envelope.ok) {
    throw new Error('Expected one invalid workout to reject the complete batch.')
  }
  assert.equal(invalidBatch.envelope.error.code, 'invalid_payload')
  assert.deepEqual(await readdir(path.join(vaultRoot, 'raw', 'workouts')), [])

  const imported = requireData(
    (
      await runWorkoutCli<{
        createdCount: number
        importedCount: number
        lookupIds: string[]
        lookupIdsTruncated: boolean
        rawStored: boolean
        receivedCount: number
      }>(cli, [
        'workout',
        'import',
        'csv',
        csvPath,
        '--vault',
        vaultRoot,
        '--weight-unit',
        'lb',
        '--distance-unit',
        'km',
      ])
    ).envelope,
  )
  assert.equal(imported.receivedCount, 12)
  assert.equal(imported.createdCount, 12)
  assert.equal(imported.importedCount, 12)
  assert.equal(imported.rawStored, true)
  assert.equal(imported.lookupIds.length, 10)
  assert.equal(imported.lookupIdsTruncated, true)

  const replay = requireData(
    (
      await runWorkoutCli<{
        importedCount: number
        manifestFile: string | null
        rawFile: string | null
        rawStored: boolean
        skippedExistingCount: number
      }>(cli, [
        'workout',
        'import',
        'csv',
        csvPath,
        '--vault',
        vaultRoot,
        '--weight-unit',
        'lb',
        '--distance-unit',
        'km',
      ])
    ).envelope,
  )
  assert.equal(replay.importedCount, 0)
  assert.equal(replay.skippedExistingCount, 12)
  assert.equal(replay.rawStored, false)
  assert.equal(replay.rawFile, null)
  assert.equal(replay.manifestFile, null)

  const rawFilesBeforeConflict = await readdir(
    path.join(vaultRoot, 'raw', 'workouts'),
    { recursive: true },
  )
  const changedCsvPath = path.join(parentRoot, 'strong-changed.csv')
  const firstRow = rows[0]
  assert.ok(firstRow)
  await writeFile(
    changedCsvPath,
    [header, firstRow.replace('Session 1', 'Renamed session'), ...rows.slice(1), ''].join('\n'),
    'utf8',
  )
  const changedSameRevision = await runWorkoutCli(cli, [
    'workout',
    'import',
    'csv',
    changedCsvPath,
    '--vault',
    vaultRoot,
    '--weight-unit',
    'lb',
    '--distance-unit',
    'km',
  ])
  assert.equal(changedSameRevision.envelope.ok, false)
  if (changedSameRevision.envelope.ok) {
    throw new Error('Expected changed content at the same source revision to fail closed.')
  }
  assert.equal(changedSameRevision.envelope.error.code, 'conflict')
  assert.deepEqual(
    await readdir(path.join(vaultRoot, 'raw', 'workouts'), { recursive: true }),
    rawFilesBeforeConflict,
  )

  const unconfirmedUnitChange = await runWorkoutCli(cli, [
    'workout',
    'import',
    'csv',
    csvPath,
    '--vault',
    vaultRoot,
    '--weight-unit',
    'kg',
    '--distance-unit',
    'km',
  ])
  assert.equal(unconfirmedUnitChange.envelope.ok, false)
  if (unconfirmedUnitChange.envelope.ok) {
    throw new Error('Expected an unconfirmed unit change to fail closed.')
  }
  assert.equal(unconfirmedUnitChange.envelope.error.code, 'conflict')

  const expandedUnitChangePath = path.join(parentRoot, 'strong-expanded-unit-change.csv')
  await writeFile(
    expandedUnitChangePath,
    [header, ...rows, '2026-05-01 07:00:00,New Session,45m,Press,1,50,8,0,0,,,', ''].join('\n'),
    'utf8',
  )
  const expandedUnitChange = await runWorkoutCli(cli, [
    'workout',
    'import',
    'csv',
    expandedUnitChangePath,
    '--vault',
    vaultRoot,
    '--weight-unit',
    'kg',
    '--distance-unit',
    'km',
  ])
  assert.equal(expandedUnitChange.envelope.ok, false)
  if (expandedUnitChange.envelope.ok) {
    throw new Error('Expected an expanded snapshot with changed unit semantics to fail closed.')
  }
  assert.equal(expandedUnitChange.envelope.error.code, 'conflict')

  const corrected = requireData(
    (
      await runWorkoutCli<{
        createdCount: number
        rawStored: boolean
        supersededCount: number
      }>(cli, [
        'workout',
        'import',
        'csv',
        csvPath,
        '--vault',
        vaultRoot,
        '--weight-unit',
        'kg',
        '--distance-unit',
        'km',
        '--correct-units',
      ])
    ).envelope,
  )
  assert.equal(corrected.createdCount, 0)
  assert.equal(corrected.supersededCount, 12)
  assert.equal(corrected.rawStored, false)

  const correctedReplay = requireData(
    (
      await runWorkoutCli<{
        importedCount: number
        rawStored: boolean
        skippedExistingCount: number
      }>(cli, [
        'workout',
        'import',
        'csv',
        csvPath,
        '--vault',
        vaultRoot,
        '--weight-unit',
        'kg',
        '--distance-unit',
        'km',
      ])
    ).envelope,
  )
  assert.equal(correctedReplay.importedCount, 0)
  assert.equal(correctedReplay.skippedExistingCount, 12)
  assert.equal(correctedReplay.rawStored, false)
})

test('Strong CSV import keeps structured sets when source duration is unknown', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-strong-duration-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'UTC',
  ])

  const csvPath = path.join(parentRoot, 'strong-duration.csv')
  await writeFile(csvPath, [
    'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE',
    '2026-04-08 10:00:00,Malformed,45m unexpected,Squat,1,100,5,0,0,,,',
    '2026-04-09 10:00:00,Over range,30h 1m,Press,1,80,8,0,0,,,',
    '2026-04-10 10:00:00,Missing,,Row,1,60,10,0,0,,,',
    '',
  ].join('\n'), 'utf8')

  const imported = requireData((await runWorkoutCli<{
    createdCount: number
    lookupIds: string[]
    warnings: string[]
  }>(cli, [
    'workout',
    'import',
    'csv',
    csvPath,
    '--vault',
    vaultRoot,
    '--weight-unit',
    'kg',
  ])).envelope)
  assert.equal(imported.createdCount, 3)
  assert.equal(imported.lookupIds.length, 3)
  assert.match(imported.warnings.join(' '), /duration/u)

  for (const lookupId of imported.lookupIds) {
    const shown = requireData((await runWorkoutCli<{
      entity: {
        data: {
          durationMinutes?: number
          workout?: { exercises?: Array<{ sets?: unknown[] }> }
        }
      }
    }>(cli, [
      'workout',
      'show',
      lookupId,
      '--vault',
      vaultRoot,
    ])).envelope)
    assert.equal(shown.entity.data.durationMinutes, undefined)
    assert.equal(shown.entity.data.workout?.exercises?.[0]?.sets?.length, 1)
  }
})

test('workout CSV manifests omit arbitrary source headers from storage and public output', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-header-privacy-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'UTC',
  ])

  const privateHeader = 'PRIVATE_FREEFORM_HEADER_SENTINEL'
  const privateValue = 'PRIVATE_FREEFORM_VALUE_SENTINEL'
  const csvPath = path.join(parentRoot, 'workout-with-extra-column.csv')
  await writeFile(csvPath, [
    `Workout Name,Date,Start Time,Duration,Exercise Name,Set Order,Weight Kg,Reps,${privateHeader}`,
    `Upper,2026-04-08,10:00,45,Press,1,40,8,${privateValue}`,
  ].join('\n'), 'utf8')

  const inspected = await runWorkoutCli(cli, [
    'workout',
    'import',
    'inspect',
    csvPath,
    '--vault',
    vaultRoot,
    '--source',
    'strong',
  ])
  assert.equal(JSON.stringify(inspected.envelope).includes(privateHeader), false)
  assert.equal(JSON.stringify(inspected.envelope).includes(privateValue), false)

  const imported = requireData((await runWorkoutCli<{
    lookupIds: string[]
    manifestFile: string
  }>(cli, [
    'workout',
    'import',
    'csv',
    csvPath,
    '--vault',
    vaultRoot,
    '--source',
    'strong',
  ])).envelope)
  assert.equal(imported.lookupIds.length, 1)
  const storedManifest = await readFile(path.join(vaultRoot, imported.manifestFile), 'utf8')
  assert.equal(storedManifest.includes(privateHeader), false)
  assert.equal(storedManifest.includes(privateValue), false)

  const publicManifest = await runWorkoutCli(cli, [
    'workout',
    'manifest',
    imported.lookupIds[0]!,
    '--vault',
    vaultRoot,
  ])
  const publicManifestOutput = JSON.stringify(publicManifest.envelope)
  assert.equal(publicManifestOutput.includes(privateHeader), false)
  assert.equal(publicManifestOutput.includes(privateValue), false)

  const replay = requireData((await runWorkoutCli<{
    importedCount: number
    skippedExistingCount: number
  }>(cli, [
    'workout',
    'import',
    'csv',
    csvPath,
    '--vault',
    vaultRoot,
    '--source',
    'strong',
  ])).envelope)
  assert.equal(replay.importedCount, 0)
  assert.equal(replay.skippedExistingCount, 1)
})

test('workout format save rejects missing name or text when --input is absent', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-format-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const missingName = await runWorkoutCli(cli, [
    'workout',
    'format',
    'save',
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingName.envelope.ok, false)
  if (missingName.envelope.ok) {
    throw new Error('Expected the missing-name workout format save call to fail.')
  }
  assert.equal(missingName.envelope.error.code, 'contract_invalid')
  assert.match(
    missingName.envelope.error.message ?? '',
    /Workout format name is required/u,
  )

  const missingText = await runWorkoutCli(cli, [
    'workout',
    'format',
    'save',
    'Push Day A',
    '--vault',
    vaultRoot,
  ])
  assert.equal(missingText.envelope.ok, false)
  if (missingText.envelope.ok) {
    throw new Error('Expected the missing-text workout format save call to fail.')
  }
  assert.equal(missingText.envelope.error.code, 'contract_invalid')
  assert.match(
    missingText.envelope.error.message ?? '',
    /Workout format text is required/u,
  )
})

test('workout add, show, list, edit, delete, and manifest cover the workout session CRUD surface', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-crud-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()
  const workoutPayloadPath = path.join(parentRoot, 'workout.json')

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const created = requireData(
    (
      await runWorkoutCli<{
        durationMinutes: number
        eventId: string
        kind: string
        lookupId: string
        note: string
        occurredAt: string
      }>(cli, [
        'workout',
        'add',
        'Went for a 45-minute ride.',
        '--distance-km',
        '15',
        '--duration',
        '45',
        '--type',
        'ride',
        '--media',
        sampleDocumentPath,
        '--occurred-at',
        '2026-03-12',
        '--source',
        'manual',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(created.kind, 'activity_session')
  assert.equal(created.durationMinutes, 45)
  assert.equal(created.occurredAt, '2026-03-12T19:00:00.000Z')
  const workoutId = created.eventId ?? created.lookupId
  if (typeof workoutId !== 'string') {
    throw new Error('Expected workout add to return a canonical workout id.')
  }

  const shown = requireData(
    (
      await runWorkoutCli<{
        entity: {
          data: {
            distanceKm?: number
            durationMinutes?: number
            note?: string
          }
          id: string
          kind: string
          title: string | null
        }
      }>(cli, [
        'workout',
        'show',
        workoutId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(shown.entity.id, workoutId)
  assert.equal(shown.entity.kind, 'activity_session')

  const listed = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'workout',
        'list',
        '--vault',
        vaultRoot,
        '--limit',
        '10',
      ])
    ).envelope,
  )
  assert.equal(listed.count, 1)
  assert.equal(listed.items[0]?.id, workoutId)

  const defaultListed = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'workout',
        'list',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(defaultListed.count, 1)
  assert.equal(defaultListed.items[0]?.id, workoutId)

  const manifest = requireData(
    (
      await runWorkoutCli<{
        manifest: {
          rawDirectory: string
        }
        manifestFile: string
      }>(cli, [
        'workout',
        'manifest',
        workoutId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.match(manifest.manifestFile, /^raw\/workouts\/2026\/03\/evt[-_]/u)
  assert.match(manifest.manifest.rawDirectory, /^raw\/workouts\/2026\/03\/evt[-_]/u)

  const edited = requireData(
    (
      await runWorkoutCli<{
        entity: {
          data: {
            distanceKm?: number
            durationMinutes?: number
            note?: string
          }
          id: string
          kind: string
          title: string | null
        }
      }>(cli, [
        'workout',
        'edit',
        workoutId,
        '--note',
        'Easy recovery ride.',
        '--duration',
        '50',
        '--title',
        '50-minute ride',
        '--clear-distance',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(edited.entity.id, workoutId)
  assert.equal(edited.entity.data.note, 'Easy recovery ride.')
  assert.equal(edited.entity.data.durationMinutes, 50)
  assert.equal(edited.entity.data.distanceKm, undefined)
  assert.equal(edited.entity.title, '50-minute ride')

  const deleted = requireData(
    (
      await runWorkoutCli<{
        deleted: true
        entityId: string
        kind: string
      }>(cli, [
        'workout',
        'delete',
        workoutId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(deleted.deleted, true)
  assert.equal(deleted.entityId, workoutId)
  assert.equal(deleted.kind, 'activity_session')

  await writeFile(
    workoutPayloadPath,
    JSON.stringify(
      {
        durationMinutes: 35,
        activityType: 'strength-training',
        note: 'Structured workout payload.',
        workout: {
          routineName: 'Structured Push Day',
          sessionNote: 'Structured workout payload.',
          startedAt: '2026-03-13T17:30:00.000Z',
          endedAt: '2026-03-13T18:05:00.000Z',
          exercises: [
            {
              name: 'pushups',
              order: 1,
              sets: [
                {
                  order: 1,
                  reps: 20,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const structuredCreated = requireData(
    (
      await runWorkoutCli<{
        durationMinutes: number
        eventId: string
        kind: string
        lookupId: string
        manifestFile: string | null
      }>(cli, [
        'workout',
        'import-json',
        'Structured workout payload.',
        '--input',
        `@${workoutPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(structuredCreated.kind, 'activity_session')
  assert.equal(structuredCreated.durationMinutes, 35)

  await writeFile(
    workoutPayloadPath,
    JSON.stringify({
      title: 'No duration',
      note: 'Structured workout payload.',
      workout: {
        routineName: 'No duration',
        exercises: [{
          name: 'pushups',
          order: 1,
          sets: [{ order: 1, reps: 20 }],
        }],
      },
    }),
    'utf8',
  )
  const structuredMissingDuration = await runWorkoutCli(cli, [
    'workout',
    'import-json',
    '--input',
    `@${workoutPayloadPath}`,
    '--vault',
    vaultRoot,
  ])
  assert.equal(structuredMissingDuration.envelope.ok, false)
  if (structuredMissingDuration.envelope.ok) {
    throw new Error('Expected structured import-json without a duration to fail.')
  }
  assert.equal(structuredMissingDuration.envelope.error.code, 'invalid_option')
  const afterRejectedStructured = requireData((await runWorkoutCli<{
    count: number
  }>(cli, [
    'workout',
    'list',
    '--vault',
    vaultRoot,
  ])).envelope)
  assert.equal(afterRejectedStructured.count, 1)

  const minimalCreated = (
    await runWorkoutCli(cli, [
      'workout',
      'add',
      'Went for a short walk.',
      '--vault',
      vaultRoot,
    ])
  ).envelope
  assert.equal(minimalCreated.ok, false)
  assert.equal(minimalCreated.error.code, 'invalid_option')
  assert.match(
    minimalCreated.error.message ?? '',
    /Workout duration is missing/u,
  )
})

test('workout format save, show, list, and log handle structured input and media overrides', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-format-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
    '--timezone',
    'America/Los_Angeles',
  ])
  assert.equal(requireData(initResult.envelope).created, true)

  const payloadPath = path.join(parentRoot, 'workout-format.json')
  await writeFile(
    payloadPath,
    JSON.stringify(
      {
        title: 'Push Day A',
        activityType: 'strength-training',
        durationMinutes: 20,
        template: {
          routineNote: 'Strength training block.',
          exercises: [
            {
              name: 'pushups',
              order: 1,
              plannedSets: [
                {
                  order: 1,
                  targetReps: 20,
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
    'utf8',
  )

  const saved = requireData(
    (
      await runWorkoutCli<{
        created: boolean
        name: string
        path: string
        slug: string
      }>(cli, [
        'workout',
        'format',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(saved.created, true)
  assert.equal(saved.name, 'Push Day A')
  assert.equal(saved.slug, 'push-day-a')

  const overriddenSaved = requireData(
    (
      await runWorkoutCli<{
        created: boolean
        name: string
        path: string
        slug: string
      }>(cli, [
        'workout',
        'format',
        'save',
        'Pull Day B',
        '45 min strength training with rows and presses.',
        '--duration',
        '45',
        '--type',
        'strength-training',
        '--distance-km',
        '4',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(overriddenSaved.created, true)
  assert.equal(overriddenSaved.name, 'Pull Day B')

  const shown = requireData(
    (
      await runWorkoutCli<{
        entity: {
          data: {
            templateText?: string
            workoutFormatId: string
          }
          id: string
          kind: string
          path: string
          title: string
        }
      }>(cli, [
        'workout',
        'format',
        'show',
        'push-day-a',
        '--vault',
        vaultRoot,
      ])
  ).envelope,
  )
  assert.equal(shown.entity.kind, 'workout_format')
  assert.equal(shown.entity.data.workoutFormatId, shown.entity.id)
  assert.equal(shown.entity.title, 'Push Day A')

  const listed = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
          kind: string
        }>
      }>(cli, [
        'workout',
        'format',
        'list',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(listed.count, 2)
  assert.equal(listed.items[0]?.kind, 'workout_format')
  assert.equal(listed.items.some((item) => item.id === shown.entity.id), true)

  const limitedListed = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
          kind: string
        }>
      }>(cli, [
        'workout',
        'format',
        'list',
        '--limit',
        '1',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(limitedListed.count, 1)

  const logged = requireData(
    (
      await runWorkoutCli<{
        activityType: string
        durationMinutes: number
        kind: string
        note: string | null
        occurredAt: string
        workout: Record<string, unknown> | null
      }>(cli, [
        'workout',
        'format',
        'log',
        'Push Day A',
        '--duration',
        '25',
        '--type',
        'strength-training',
        '--distance-km',
        '2.5',
        '--source',
        'import',
        '--media',
        sampleDocumentPath,
        '--occurred-at',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(logged.kind, 'activity_session')
  assert.equal(logged.activityType, 'strength-training')
  assert.equal(logged.durationMinutes, 25)
  assert.equal(logged.occurredAt, '2026-03-12T19:00:00.000Z')
  assert.equal(logged.note, 'Strength training block.')
  assert.equal(logged.workout === null, false)

  const freeformSaved = requireData(
    (
      await runWorkoutCli<{
        created: boolean
        name: string
        path: string
        slug: string
      }>(cli, [
        'workout',
        'format',
        'save',
        'Push Day B',
        '25 min strength training. 5 sets of 10 pushups.',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(freeformSaved.name, 'Push Day B')

  const loggedDefault = requireData(
    (
      await runWorkoutCli<{
        activityType: string
        durationMinutes: number
        kind: string
        note: string | null
        workout: Record<string, unknown> | null
      }>(cli, [
        'workout',
        'format',
        'log',
        'Push Day A',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(loggedDefault.kind, 'activity_session')
  assert.equal(loggedDefault.activityType, 'strength-training')
  assert.equal(loggedDefault.durationMinutes, 20)
  assert.equal(loggedDefault.note, 'Strength training block.')

  const noDurationPayloadPath = path.join(parentRoot, 'workout-format-no-duration.json')
  await writeFile(
    noDurationPayloadPath,
    JSON.stringify({
      title: 'No Duration Format',
      activityType: 'strength-training',
      template: {
        routineNote: 'Train hard.',
        exercises: [{
          name: 'squats',
          order: 1,
          plannedSets: [{ order: 1, targetReps: 5 }],
        }],
      },
    }),
    'utf8',
  )
  requireData((await runWorkoutCli(cli, [
    'workout',
    'format',
    'import-json',
    '--input',
    `@${noDurationPayloadPath}`,
    '--vault',
    vaultRoot,
  ])).envelope)
  const rejectedFormatLog = await runWorkoutCli(cli, [
    'workout',
    'format',
    'log',
    'No Duration Format',
    '--vault',
    vaultRoot,
  ])
  assert.equal(rejectedFormatLog.envelope.ok, false)
  if (rejectedFormatLog.envelope.ok) {
    throw new Error('Expected format log without a duration to fail.')
  }
  assert.equal(rejectedFormatLog.envelope.error.code, 'invalid_option')
  const workoutsAfterRejectedFormatLog = requireData((await runWorkoutCli<{
    count: number
  }>(cli, [
    'workout',
    'list',
    '--vault',
    vaultRoot,
  ])).envelope)
  assert.equal(workoutsAfterRejectedFormatLog.count, 2)
})
