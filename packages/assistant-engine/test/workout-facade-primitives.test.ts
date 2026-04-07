import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import { initializeVault, readJsonlRecords } from '@murphai/core'

import { addWorkoutRecord } from '../src/usecases/workout.js'
import { importWorkoutCsv } from '../src/usecases/workout-import.js'
import { addWorkoutMeasurementRecord } from '../src/usecases/workout-measurement.js'
import { logWorkoutFormat, saveWorkoutFormat } from '../src/usecases/workout-format.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (targetPath) => {
      await rm(targetPath, { recursive: true, force: true })
    }),
  )
})

async function createTempVault(prefix: string): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), prefix))
  cleanupPaths.push(vaultRoot)
  await initializeVault({
    vaultRoot,
    title: 'Workout Facade Test Vault',
    timezone: 'UTC',
  })
  return vaultRoot
}

async function createFixtureFile(vaultRoot: string, fileName: string, content: string) {
  const fixtureDirectory = path.join(vaultRoot, '.fixtures')
  await mkdir(fixtureDirectory, { recursive: true })
  const sourcePath = path.join(fixtureDirectory, fileName)
  await writeFile(sourcePath, content)
  return sourcePath
}

describe('workout façade flows', () => {
  it('logs quick-capture workouts through the dedicated activity-session core seam', async () => {
    const vault = await createTempVault('murph-workout-facade-')
    const mediaPath = await createFixtureFile(vault, 'run-photo.jpg', 'run-photo')

    const result = await addWorkoutRecord({
      vault,
      text: 'Went for a 28-minute 5k run around the neighborhood.',
      mediaPaths: [mediaPath],
    })

    expect(result.kind).toBe('activity_session')
    expect(result.activityType).toBe('running')
    expect(result.durationMinutes).toBe(28)
    expect(result.distanceKm).toBe(5)
    expect(result.manifestFile).toBeTruthy()
    expect(result.workout?.media).toHaveLength(1)

    const ledgerRecords = await readJsonlRecords({
      vaultRoot: vault,
      relativePath: result.ledgerFile,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'activity_session',
      activityType: 'running',
    })
  })

  it('logs workout measurements through the dedicated body-measurement core seam', async () => {
    const vault = await createTempVault('murph-workout-measurement-facade-')
    const mediaPath = await createFixtureFile(vault, 'waist-photo.jpg', 'waist-photo')

    const result = await addWorkoutMeasurementRecord({
      vault,
      type: 'waist',
      value: 82,
      unit: 'cm',
      note: 'Morning check-in.',
      mediaPaths: [mediaPath],
    })

    expect(result.kind).toBe('body_measurement')
    expect(result.measurements).toEqual([
      expect.objectContaining({
        type: 'waist',
        value: 82,
        unit: 'cm',
      }),
    ])
    expect(result.media).toHaveLength(1)
    expect(result.manifestFile).toBeTruthy()
  })

  it('preserves shared event metadata when structured workout payloads flow through the core activity-session seam', async () => {
    const vault = await createTempVault('murph-workout-structured-facade-')
    const payloadPath = await createFixtureFile(
      vault,
      'structured-workout.json',
      JSON.stringify({
        occurredAt: '2026-04-07T06:00:00.000Z',
        source: 'import',
        title: 'Structured interval run',
        note: 'Tempo intervals on the track.',
        activityType: 'running',
        durationMinutes: 36,
        distanceKm: 6.4,
        rawRefs: ['raw/imports/track/intervals.fit'],
        tags: ['track', 'tempo'],
        timeZone: 'Australia/Melbourne',
        externalRef: {
          system: 'garmin',
          resourceType: 'activity',
          resourceId: 'abc123',
        },
        workout: {
          sessionNote: 'Tempo intervals on the track.',
          exercises: [],
        },
      }),
    )

    const result = await addWorkoutRecord({
      vault,
      inputFile: payloadPath,
    })

    const ledgerRecords = await readJsonlRecords({
      vaultRoot: vault,
      relativePath: result.ledgerFile,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'activity_session',
      source: 'import',
      tags: ['track', 'tempo'],
      timeZone: 'Australia/Melbourne',
      rawRefs: ['raw/imports/track/intervals.fit'],
      externalRef: {
        system: 'garmin',
        resourceType: 'activity',
        resourceId: 'abc123',
      },
    })
  })

  it('logs saved workout formats through the same activity-session core seam', async () => {
    const vault = await createTempVault('murph-workout-format-facade-')
    const mediaPath = await createFixtureFile(vault, 'push-day-photo.jpg', 'push-day-photo')

    await saveWorkoutFormat({
      vault,
      name: 'Push Day A',
      text: '5 sets of 5 bench press. 3 sets of 10 incline dumbbell press.',
      durationMinutes: 50,
      activityType: 'strength-training',
    })

    const result = await logWorkoutFormat({
      vault,
      name: 'Push Day A',
      mediaPaths: [mediaPath],
    })

    expect(result.kind).toBe('activity_session')
    expect(result.activityType).toBe('strength-training')
    expect(result.durationMinutes).toBe(50)
    expect(result.manifestFile).toBeTruthy()
    expect(result.workout?.routineName).toBe('Push Day A')
    expect(result.workout?.media).toHaveLength(1)
  })

  it('imports workout CSV sessions through the workout façade while storing raw CSV once', async () => {
    const vault = await createTempVault('murph-workout-import-facade-')
    const csvPath = await createFixtureFile(
      vault,
      'strong-export.csv',
      [
        'Workout Name,Date,Start Time,End Time,Exercise Name,Set Order,Reps,Weight,Weight Unit',
        'Upper A,2026-04-07,06:00,06:30,Bench Press,1,5,185,lb',
      ].join('\n'),
    )

    const result = await importWorkoutCsv({
      vault,
      file: csvPath,
    })

    expect(result.importedCount).toBe(1)
    expect(result.rawOnly).toBe(false)
    expect(result.lookupIds).toHaveLength(1)
    expect(result.ledgerFiles).toHaveLength(1)

    const manifest = JSON.parse(
      await readFile(path.join(vault, result.manifestFile), 'utf8'),
    ) as { importKind: string; artifacts?: Array<{ relativePath?: string }> }
    expect(manifest.importKind).toBe('workout_batch')
    expect(manifest.artifacts?.[0]?.relativePath).toBe(result.rawFile)

    const ledgerRecords = await readJsonlRecords({
      vaultRoot: vault,
      relativePath: result.ledgerFiles[0]!,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.lookupIds[0],
      kind: 'activity_session',
      rawRefs: expect.arrayContaining([result.rawFile]),
      activityType: 'strength-training',
    })
  })
})
