import path from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  addActivitySession,
  addBodyMeasurement,
  addCapture,
  addCaptureWithLookup,
  addMeasurement,
  deleteEvent,
  findCaptureByLookup,
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

async function readAuditRecords(vaultRoot: string, occurredAt: string) {
  return readJsonlRecords({
    vaultRoot,
    relativePath: `audit/${occurredAt.slice(0, 4)}/${occurredAt.slice(0, 7)}.jsonl`,
  })
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
    const auditRecords = await readAuditRecords(vaultRoot, result.event.occurredAt)
    const auditRecord = auditRecords.find(
      (record) =>
        (record as { action?: string }).action === 'event_upsert' &&
        Array.isArray((record as { targetIds?: unknown }).targetIds) &&
        (record as { targetIds: string[] }).targetIds.includes(result.eventId),
    ) as
      | {
          commandName?: string
          changes?: Array<{ path?: string }>
        }
      | undefined
    expect(manifest.importKind).toBe('workout_batch')
    expect(manifest.provenance).toMatchObject({
      eventId: result.eventId,
      family: 'workout',
      mediaCount: 1,
    })
    expect(auditRecord?.commandName).toBe('core.addActivitySession')
    expect(auditRecord?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: result.ledgerFile,
        }),
      ]),
    )
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
    const auditRecords = await readAuditRecords(vaultRoot, result.event.occurredAt)
    const auditRecord = auditRecords.find(
      (record) =>
        (record as { action?: string }).action === 'event_upsert' &&
        Array.isArray((record as { targetIds?: unknown }).targetIds) &&
        (record as { targetIds: string[] }).targetIds.includes(result.eventId),
    ) as
      | {
          commandName?: string
          changes?: Array<{ path?: string }>
        }
      | undefined
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'body_measurement',
    })
    expect(auditRecord?.commandName).toBe('core.addBodyMeasurement')
    expect(auditRecord?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: result.ledgerFile,
        }),
      ]),
    )
  })

  it('adds captures through the dedicated core seam and always tags them as capture', async () => {
    const vaultRoot = await createTempVault('murph-core-capture-')
    const sourcePath = await createSourceFile(vaultRoot, 'capture-photo.jpg', 'capture-photo')

    const result = await addCapture({
      vaultRoot,
      draft: {
        occurredAt: '2026-04-08T07:30:00.000Z',
        source: 'manual',
        title: 'Left forearm baseline',
        note: 'Reference photo for later comparison.',
      },
      attachments: [{
        role: 'photo_1',
        sourcePath,
      }],
    })

    expect(result.created).toBe(true)
    expect(result.event.kind).toBe('note')
    expect(result.manifestPath).toBeTruthy()
    expect(result.event.tags).toEqual(expect.arrayContaining(['capture']))
    expect(result.event.attachments).toHaveLength(1)

    const attachment = result.event.attachments?.[0]
    expect(attachment).toBeDefined()
    expect(attachment!.relativePath).toContain('raw/captures/')
    expect(result.event.rawRefs).toEqual(
      expect.arrayContaining([attachment!.relativePath]),
    )

    const ledgerRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: result.ledgerFile,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'note',
      tags: expect.arrayContaining(['capture']),
      rawRefs: expect.arrayContaining([attachment!.relativePath]),
    })

    const manifest = JSON.parse(
      await readFile(path.join(vaultRoot, result.manifestPath!), 'utf8'),
    ) as {
      importKind: string
      provenance?: Record<string, unknown>
      rawDirectory: string
    }
    const auditRecords = await readAuditRecords(vaultRoot, result.event.occurredAt)
    const auditRecord = auditRecords.find(
      (record) =>
        (record as { action?: string }).action === 'event_upsert' &&
        Array.isArray((record as { targetIds?: unknown }).targetIds) &&
        (record as { targetIds: string[] }).targetIds.includes(result.eventId),
    ) as
      | {
          commandName?: string
          changes?: Array<{ path?: string }>
        }
      | undefined

    expect(manifest.importKind).toBe('capture')
    expect(manifest.rawDirectory).toContain('raw/captures/')
    expect(manifest.provenance).toMatchObject({
      eventId: result.eventId,
      family: 'capture',
      mediaCount: 1,
    })
    expect(auditRecord?.commandName).toBe('core.addCapture')
    expect(auditRecord?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: result.ledgerFile,
        }),
      ]),
    )
  })

  it('resolves capture lookup records through the live event spine', async () => {
    const vaultRoot = await createTempVault('murph-core-capture-lookup-')
    const sourcePath = await createSourceFile(vaultRoot, 'lookup-photo.jpg', 'lookup-photo')

    const result = await addCaptureWithLookup({
      vaultRoot,
      lookupAttachmentRole: 'media_1',
      lookupKey: 'test.capture.lookup:one',
      draft: {
        occurredAt: '2026-04-08T08:30:00.000Z',
        source: 'manual',
        title: 'Lookup-backed capture',
        note: 'Reference photo with a stable lookup.',
      },
      attachments: [{
        role: 'media_1',
        sourcePath,
      }],
    })

    expect(result.created).toBe(true)
    expect(result.lookupPath).toMatch(
      /^derived\/captures\/lookups\/[0-9a-f]{2}\/[0-9a-f]{64}\.json$/u,
    )

    const live = await findCaptureByLookup({
      vaultRoot,
      lookupKey: 'test.capture.lookup:one',
    })
    expect(live).toMatchObject({
      status: 'live',
      eventId: result.eventId,
      ledgerFile: result.ledgerFile,
      attachmentRef: result.event.attachments?.[0]?.relativePath,
    })

    await deleteEvent({
      vaultRoot,
      eventId: result.eventId,
    })

    const deleted = await findCaptureByLookup({
      vaultRoot,
      lookupKey: 'test.capture.lookup:one',
    })
    expect(deleted).toMatchObject({
      status: 'deleted',
      eventId: result.eventId,
      ledgerFile: result.ledgerFile,
    })
  })

  it('adds canonical measurements through the open core seam and preserves qualifiers', async () => {
    const vaultRoot = await createTempVault('murph-core-canonical-measurement-')
    const sourcePath = await createSourceFile(vaultRoot, 'grip-strength.jpg', 'grip-strength-photo')
    const existingRawRef = 'raw/imports/device/grip-strength-001.json'

    const result = await addMeasurement({
      vaultRoot,
      draft: {
        occurredAt: '2026-04-08T07:00:00.000Z',
        source: 'manual',
        title: 'Grip strength',
        note: 'Weekly performance check-in.',
        rawRefs: [existingRawRef],
        measurements: [{
          metric: 'grip-strength',
          value: 97.2,
          unit: 'lb',
          qualifiers: {
            side: 'right',
          },
        }],
      },
      attachments: [{
        role: 'media_1',
        sourcePath,
      }],
    })

    expect(result.created).toBe(true)
    expect(result.event.kind).toBe('measurement')
    expect(result.event.measurements).toEqual([
      expect.objectContaining({
        metric: 'grip-strength',
        qualifiers: {
          side: 'right',
        },
        unit: 'lb',
        value: 97.2,
      }),
    ])
    expect(result.event.attachments).toHaveLength(1)
    expect(result.event.media).toHaveLength(1)
    expect(result.event.rawRefs).toEqual(
      expect.arrayContaining([
        existingRawRef,
        expect.stringContaining('raw/measurements/'),
      ]),
    )

    const ledgerRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: result.ledgerFile,
    })
    expect(ledgerRecords).toHaveLength(1)
    expect(ledgerRecords[0]).toMatchObject({
      id: result.eventId,
      kind: 'measurement',
      measurements: [
        {
          metric: 'grip-strength',
          unit: 'lb',
          value: 97.2,
          qualifiers: {
            side: 'right',
          },
        },
      ],
    })
  })

  it('rehydrates prior evidence across specialized event rewrites', async () => {
    const vaultRoot = await createTempVault('murph-core-specialized-rewrite-evidence-')
    const activityFirstSource = await createSourceFile(vaultRoot, 'activity-first.jpg', 'activity-first')
    const activitySecondSource = await createSourceFile(vaultRoot, 'activity-second.jpg', 'activity-second')
    const bodyFirstSource = await createSourceFile(vaultRoot, 'body-first.jpg', 'body-first')
    const bodySecondSource = await createSourceFile(vaultRoot, 'body-second.jpg', 'body-second')
    const captureFirstSource = await createSourceFile(vaultRoot, 'capture-first.jpg', 'capture-first')
    const captureSecondSource = await createSourceFile(vaultRoot, 'capture-second.jpg', 'capture-second')
    const measurementFirstSource = await createSourceFile(vaultRoot, 'measurement-first.jpg', 'measurement-first')
    const measurementSecondSource = await createSourceFile(vaultRoot, 'measurement-second.jpg', 'measurement-second')

    vi.useFakeTimers()
    let activityFirst
    let activityRewrite
    try {
      vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))
      activityFirst = await addActivitySession({
        vaultRoot,
        draft: {
          id: 'evt_01JSHY3D0V5A8XJQF8M0Q0Q0A1',
          occurredAt: '2026-04-08T06:15:00.000Z',
          source: 'manual',
          title: 'Morning intervals',
          activityType: 'running',
          durationMinutes: 31,
          workout: {
            exercises: [],
          },
        },
        attachments: [{
          role: 'media_1',
          sourcePath: activityFirstSource,
        }],
      })
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'))
      activityRewrite = await addActivitySession({
        vaultRoot,
        draft: {
          id: activityFirst.eventId,
          occurredAt: '2026-05-08T06:20:00.000Z',
          source: 'manual',
          title: 'Morning intervals revised',
          activityType: 'running',
          durationMinutes: 33,
          workout: {
            exercises: [],
          },
        },
        attachments: [{
          role: 'media_2',
          sourcePath: activitySecondSource,
        }],
      })
    } finally {
      vi.useRealTimers()
    }
    const activityPaths = activityRewrite.event.attachments?.map((attachment) => attachment.relativePath) ?? []
    expect(activityRewrite.created).toBe(false)
    expect(activityPaths).toHaveLength(2)
    expect(activityRewrite.event.dayKey).toBe('2026-05-08')
    expect(activityRewrite.event.recordedAt).toBe('2026-05-08T12:00:00.000Z')
    expect(activityRewrite.event.workout.media?.map((media) => media.relativePath)).toEqual(
      expect.arrayContaining(activityPaths),
    )
    expect(activityRewrite.event.rawRefs).toEqual(expect.arrayContaining(activityPaths))

    const deletedActivity = await deleteEvent({
      vaultRoot,
      eventId: activityFirst.eventId,
    })
    expect(deletedActivity.retainedPaths).toEqual(expect.arrayContaining(activityPaths))

    const bodyFirst = await addBodyMeasurement({
      vaultRoot,
      draft: {
        id: 'evt_01JSHY3D0V5A8XJQF8M0Q0Q0A2',
        occurredAt: '2026-04-08T07:00:00.000Z',
        source: 'manual',
        title: 'Body check-in',
        measurements: [{
          type: 'weight',
          value: 180.4,
          unit: 'lb',
        }],
      },
      attachments: [{
        role: 'media_1',
        sourcePath: bodyFirstSource,
      }],
    })
    const bodyRewrite = await addBodyMeasurement({
      vaultRoot,
      draft: {
        id: bodyFirst.eventId,
        occurredAt: '2026-05-08T07:10:00.000Z',
        source: 'manual',
        title: 'Body check-in revised',
        measurements: [{
          type: 'weight',
          value: 179.8,
          unit: 'lb',
        }],
      },
      attachments: [{
        role: 'media_2',
        sourcePath: bodySecondSource,
      }],
    })
    const bodyPaths = bodyRewrite.event.attachments?.map((attachment) => attachment.relativePath) ?? []
    expect(bodyRewrite.created).toBe(false)
    expect(bodyPaths).toHaveLength(2)
    expect(bodyRewrite.event.media?.map((media) => media.relativePath)).toEqual(
      expect.arrayContaining(bodyPaths),
    )
    expect(bodyRewrite.event.rawRefs).toEqual(expect.arrayContaining(bodyPaths))

    const captureFirst = await addCapture({
      vaultRoot,
      draft: {
        id: 'evt_01JSHY3D0V5A8XJQF8M0Q0Q0A3',
        occurredAt: '2026-04-08T08:00:00.000Z',
        source: 'manual',
        title: 'Baseline capture',
        note: 'Baseline image.',
        tags: ['baseline'],
      },
      attachments: [{
        role: 'photo_1',
        sourcePath: captureFirstSource,
      }],
    })
    const captureRewrite = await addCapture({
      vaultRoot,
      draft: {
        id: captureFirst.eventId,
        occurredAt: '2026-05-08T08:05:00.000Z',
        source: 'manual',
        title: 'Baseline capture revised',
        note: 'Follow-up image.',
      },
      attachments: [{
        role: 'photo_2',
        sourcePath: captureSecondSource,
      }],
    })
    const capturePaths = captureRewrite.event.attachments?.map((attachment) => attachment.relativePath) ?? []
    expect(captureRewrite.created).toBe(false)
    expect(capturePaths).toHaveLength(2)
    expect(captureRewrite.event.rawRefs).toEqual(expect.arrayContaining(capturePaths))
    expect(captureRewrite.event.tags).toEqual(expect.arrayContaining(['baseline', 'capture']))

    const measurementFirst = await addMeasurement({
      vaultRoot,
      draft: {
        id: 'evt_01JSHY3D0V5A8XJQF8M0Q0Q0A4',
        occurredAt: '2026-04-08T09:00:00.000Z',
        source: 'manual',
        title: 'Grip strength',
        measurements: [{
          metric: 'grip-strength',
          value: 97.2,
          unit: 'lb',
        }],
      },
      attachments: [{
        role: 'media_1',
        sourcePath: measurementFirstSource,
      }],
    })
    const measurementRewrite = await addMeasurement({
      vaultRoot,
      draft: {
        id: measurementFirst.eventId,
        occurredAt: '2026-05-08T09:05:00.000Z',
        source: 'manual',
        title: 'Grip strength revised',
        measurements: [{
          metric: 'grip-strength',
          value: 99.1,
          unit: 'lb',
        }],
      },
      attachments: [{
        role: 'media_2',
        sourcePath: measurementSecondSource,
      }],
    })
    const measurementPaths = measurementRewrite.event.attachments?.map((attachment) => attachment.relativePath) ?? []
    expect(measurementRewrite.created).toBe(false)
    expect(measurementPaths).toHaveLength(2)
    expect(measurementRewrite.event.media?.map((media) => media.relativePath)).toEqual(
      expect.arrayContaining(measurementPaths),
    )
    expect(measurementRewrite.event.rawRefs).toEqual(expect.arrayContaining(measurementPaths))
  })
})
