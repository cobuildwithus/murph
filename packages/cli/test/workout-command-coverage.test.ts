import assert from 'node:assert/strict'
import { access, rm, writeFile } from 'node:fs/promises'
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

test('workout measurement capture and unit preferences round-trip through the registered CLI', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-coverage-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()
  const measurementPayloadPath = path.join(parentRoot, 'measurement.json')

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
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
        measurements: Array<{
          type: string
          unit: string
          value: number
        }>
        note: string | null
      }>(cli, [
        'workout',
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--type',
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
        '2026-03-12T07:30:00.000Z',
      ])
    ).envelope,
  )
  assert.equal(measurement.kind, 'body_measurement')
  assert.match(
    measurement.manifestFile ?? '',
    /^raw\/measurements\/2026\/03\/evt[_A-Z0-9]+\/manifest\.json$/u,
  )
  assert.equal(measurement.note, 'Post-cut check-in.')
  assert.deepEqual(measurement.measurements, [
    {
      note: 'Post-cut check-in.',
      type: 'waist',
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
        'workout',
        'measurement',
        'show',
        measurement.eventId,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(shownMeasurement.entity.id, measurement.eventId)
  assert.equal(shownMeasurement.entity.kind, 'body_measurement')
  assert.equal(shownMeasurement.entity.title, 'Waist check-in')

  const listedMeasurements = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'workout',
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
    'workout',
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
        title: 'Structured body measurement',
        note: 'Imported structured payload.',
        measurements: [
          {
            type: 'weight',
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
        'workout',
        'measurement',
        'add',
        '--input',
        `@${measurementPayloadPath}`,
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(structuredMeasurement.kind, 'body_measurement')
  assert.equal(structuredMeasurement.note, 'Imported structured payload.')

  const defaultListedMeasurements = requireData(
    (
      await runWorkoutCli<{
        count: number
        items: Array<{
          id: string
        }>
      }>(cli, [
        'workout',
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
          type: string
          unit: string
          value: number
        }>
        note: string | null
      }>(cli, [
        'workout',
        'measurement',
        'add',
        '--vault',
        vaultRoot,
        '--type',
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
  assert.equal(minimalMeasurement.kind, 'body_measurement')
  assert.equal(minimalMeasurement.note, null)
})

test('workout import inspect and raw-only csv import expose the raw batch surfaces', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-import-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
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
        headers: string[]
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
      ])
    ).envelope,
  )
  assert.equal(inspected.importable, true)
  assert.equal(inspected.estimatedWorkouts, 1)
  assert.equal(inspected.rowCount, 2)
  assert.equal(inspected.source, 'strong')
  assert.equal(inspected.headers.includes('Workout Name'), true)
  assert.deepEqual(inspected.warnings, [])

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

test('workout format save rejects missing name or text when --input is absent', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-format-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
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
        '2026-03-12T17:30:00Z',
        '--source',
        'manual',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(created.kind, 'activity_session')
  assert.equal(created.durationMinutes, 45)
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
        '--set',
        'note=Easy recovery ride.',
        '--set',
        'durationMinutes=50',
        '--set',
        'title=50-minute ride',
        '--clear',
        'distanceKm',
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
        'add',
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

  const minimalCreated = requireData(
    (
      await runWorkoutCli<{
        eventId: string
        kind: string
        lookupId: string
      }>(cli, [
        'workout',
        'add',
        'Went for a short walk.',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(minimalCreated.kind, 'activity_session')
  assert.equal(minimalCreated.eventId, minimalCreated.lookupId)
})

test('workout format save, show, list, and log handle structured input and media overrides', async () => {
  const { parentRoot, vaultRoot } = await createTempVaultContext('murph-workout-format-')
  cleanupPaths.push(parentRoot)
  const cli = createWorkoutSliceCli()

  const initResult = await runWorkoutCli<{ created: boolean }>(cli, [
    'init',
    '--vault',
    vaultRoot,
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
        'save',
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
        '2026-03-12T17:30:00Z',
        '--vault',
        vaultRoot,
      ])
    ).envelope,
  )
  assert.equal(logged.kind, 'activity_session')
  assert.equal(logged.activityType, 'strength-training')
  assert.equal(logged.durationMinutes, 25)
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
})
