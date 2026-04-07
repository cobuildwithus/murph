import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import {
  addActivitySession,
  addBodyMeasurement,
  initializeVault,
  readJsonlRecords,
} from '@murphai/core'

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
    title: 'Workout Primitive Test Vault',
    timezone: 'UTC',
  })
  return vaultRoot
}

async function createSourceFile(vaultRoot: string, fileName: string, content: string) {
  const fixtureDirectory = path.join(vaultRoot, '.fixtures')
  await mkdir(fixtureDirectory, { recursive: true })
  const sourcePath = path.join(fixtureDirectory, fileName)
  await writeFile(sourcePath, content)
  return sourcePath
}

describe('workout primitive core mutations', () => {
  it('adds activity sessions through a dedicated core seam and stages workout media in one write', async () => {
    const vaultRoot = await createTempVault('murph-core-activity-')
    const sourcePath = await createSourceFile(vaultRoot, 'session-photo.jpg', 'workout-photo')
    const existingRawRef = 'raw/imports/strong/session-001.json'

    const result = await addActivitySession({
      vaultRoot,
      draft: {
        occurredAt: '2026-04-07T06:15:00.000Z',
        source: 'manual',
        title: 'Morning strength session',
        activityType: 'strength-training',
        durationMinutes: 45,
        rawRefs: [existingRawRef],
        workout: {
          routineName: 'Upper A',
          sessionNote: 'Felt strong today.',
          exercises: [],
        },
      },
      attachments: [{
        role: 'media_1',
        sourcePath,
      }],
    })

    expect(result.created).toBe(true)
    expect(result.event.kind).toBe('activity_session')
    expect(result.manifestPath).toBeTruthy()
    expect(result.event.attachments).toHaveLength(1)
    expect(result.event.workout.media).toHaveLength(1)

    const attachment = result.event.attachments?.[0]
    expect(attachment).toBeDefined()
    const stagedRelativePath = attachment!.relativePath
    expect(stagedRelativePath).toContain('raw/workouts/')
    expect(result.event.rawRefs).toEqual(
      expect.arrayContaining([existingRawRef, stagedRelativePath]),
    )
    expect(result.event.workout.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: stagedRelativePath,
          mediaType: attachment!.mediaType,
        }),
      ]),
    )

    const ledgerRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: result.ledgerFile,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'activity_session',
      rawRefs: expect.arrayContaining([existingRawRef, stagedRelativePath]),
    })

    const manifest = JSON.parse(
      await readFile(path.join(vaultRoot, result.manifestPath!), 'utf8'),
    ) as { importKind: string; provenance?: Record<string, unknown> }
    expect(manifest.importKind).toBe('workout_batch')
    expect(manifest.provenance).toMatchObject({
      eventId: result.eventId,
      family: 'workout',
      mediaCount: 1,
    })
  })

  it('merges existing workout raw refs and media with newly staged attachments', async () => {
    const vaultRoot = await createTempVault('murph-core-activity-merge-')
    const sourcePath = await createSourceFile(vaultRoot, 'existing-photo.jpg', 'workout-photo-2')
    const preservedMedia = {
      kind: 'photo' as const,
      relativePath: 'raw/workouts/existing/photo-existing.jpg',
      mediaType: 'image/jpeg',
    }

    const result = await addActivitySession({
      vaultRoot,
      draft: {
        occurredAt: '2026-04-07T18:30:00.000Z',
        source: 'manual',
        title: 'Evening run',
        activityType: 'running',
        durationMinutes: 28,
        distanceKm: 5,
        rawRefs: [preservedMedia.relativePath, 'raw/imports/garmin/activity.json'],
        workout: {
          sessionNote: 'Neighborhood 5k',
          media: [preservedMedia],
          exercises: [],
        },
      },
      attachments: [{
        role: 'media_1',
        sourcePath,
      }],
    })

    expect(result.event.rawRefs).toEqual(
      expect.arrayContaining([
        preservedMedia.relativePath,
        'raw/imports/garmin/activity.json',
      ]),
    )
    expect(result.event.workout.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: preservedMedia.relativePath }),
      ]),
    )
    expect(result.event.workout.media).toHaveLength(2)
  })

  it('adds body measurements through the dedicated core seam and projects measurement media', async () => {
    const vaultRoot = await createTempVault('murph-core-measurement-')
    const sourcePath = await createSourceFile(vaultRoot, 'measurement-photo.jpg', 'measurement-photo')
    const existingRawRef = 'raw/imports/device/measurement-001.json'

    const result = await addBodyMeasurement({
      vaultRoot,
      draft: {
        occurredAt: '2026-04-07T07:00:00.000Z',
        source: 'manual',
        title: 'Weight check-in',
        note: 'Post-workout measurement.',
        rawRefs: [existingRawRef],
        measurements: [{
          type: 'weight',
          value: 180,
          unit: 'lb',
        }],
      },
      attachments: [{
        role: 'media_1',
        sourcePath,
      }],
    })

    expect(result.created).toBe(true)
    expect(result.event.kind).toBe('body_measurement')
    expect(result.manifestPath).toBeTruthy()
    expect(result.event.attachments).toHaveLength(1)
    expect(result.event.media).toHaveLength(1)

    const attachment = result.event.attachments?.[0]
    expect(attachment).toBeDefined()
    const stagedRelativePath = attachment!.relativePath
    expect(stagedRelativePath).toContain('raw/measurements/')
    expect(result.event.rawRefs).toEqual(
      expect.arrayContaining([existingRawRef, stagedRelativePath]),
    )
    expect(result.event.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: stagedRelativePath }),
      ]),
    )

    const ledgerRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: result.ledgerFile,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'body_measurement',
    })
  })
})
