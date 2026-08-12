import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  JUNCTION_WEARABLE_TAG_NOTE_TYPE,
} from '@murphai/contracts'
import * as coreRuntime from '@murphai/core'
import { importDeviceProviderSnapshot } from '@murphai/importers'
import {
  buildPersonalPatternReportRuntime,
  listCanonicalEntities,
  rebuildQueryProjection,
} from '@murphai/query'
import type { CanonicalEntity } from '@murphai/query'
import { expect, test } from 'vitest'

const SENSITIVE_NOTE_VALUE = 'SENSITIVE_VALUE_SENTINEL'
const INITIAL_OURA_TAGS = ['sauna', 'headache', 'late meal', 'recovery', 'custom tag']
const EDITED_OURA_TAGS = ['headache', 'late meal', 'recovery', 'custom tag']
const PATTERN_AS_OF = '2026-03-15T12:00:00.000Z'

test('replayed Junction tags persist neutrally and Oura sauna reaches Personal Patterns', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'junction-oura-tags-patterns-'))
  const vaultRoot = path.join(parentRoot, 'vault')
  const start = '2026-01-05'
  const ouraDates = Array.from({ length: 5 }, (_, index) => addDays(start, index * 14))
  const initialSnapshot = buildSnapshot({
    includeSleep: true,
    importedAt: '2026-04-28T12:00:00.000Z',
    noteValue: `${SENSITIVE_NOTE_VALUE}_INITIAL`,
    ouraDates,
    ouraTags: INITIAL_OURA_TAGS,
    start,
  })
  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-01-01T00:00:00.000Z',
      timezone: 'UTC',
      vaultRoot,
    })

    const initialImport = await importSnapshot(vaultRoot, initialSnapshot)
    const initialReplay = await importSnapshot(vaultRoot, initialSnapshot)
    expect(initialImport.applied).toBe(true)
    expect(initialReplay.applied).toBe(false)

    await rebuildQueryProjection(vaultRoot)
    const initialEvents = await listAllEvents(vaultRoot)
    const initialNotes = initialEvents.filter(isJunctionWearableTagNote)
    const initialOuraNotes = initialNotes.filter((entity) =>
      readExternalResourceType(entity) === 'junction-oura-note'
    )
    const initialGarminNotes = initialNotes.filter((entity) =>
      readExternalResourceType(entity) === 'junction-garmin-note'
    )

    expect(initialNotes).toHaveLength(10)
    expect(initialOuraNotes).toHaveLength(5)
    expect(initialGarminNotes).toHaveLength(5)
    expect(initialEvents.filter((entity) => entity.kind === 'intervention_session'))
      .toHaveLength(0)
    expect(initialNotes.every((entity) => entity.body === 'Wearable tags')).toBe(true)
    expect(initialOuraNotes.every((entity) =>
      JSON.stringify(entity.tags) === JSON.stringify(['custom-tag', 'headache', 'late-meal', 'recovery', 'sauna'])
    )).toBe(true)
    expect(initialGarminNotes.every((entity) =>
      JSON.stringify(entity.tags) === JSON.stringify(['sauna'])
    )).toBe(true)

    const initialReport = await buildPersonalPatternReportRuntime(vaultRoot, {
      asOf: PATTERN_AS_OF,
    })
    expect(initialReport.factors).toEqual([
      expect.objectContaining({ id: 'sauna', kind: 'intervention', observedDays: 5 }),
    ])
    expect(initialReport.cells.some((cell) =>
      cell.factorId === 'sauna' && cell.stage === 'new_clue'
    )).toBe(true)

    await expect(directoryContainsText(vaultRoot, SENSITIVE_NOTE_VALUE))
      .resolves.toBe(false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

test('edited and cleared Junction tags revise the same neutral notes', async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), 'junction-tag-revisions-'))
  const vaultRoot = path.join(parentRoot, 'vault')
  const start = '2026-01-05'
  const ouraDates = [start]
  const buildTagSnapshot = (
    importedAt: string,
    noteValue: string,
    ouraTags: readonly string[],
  ) => buildSnapshot({
    includeSleep: false,
    importedAt,
    noteValue,
    ouraDates,
    ouraTags,
    start,
  })

  try {
    await coreRuntime.initializeVault({
      createdAt: '2026-01-01T00:00:00.000Z',
      timezone: 'UTC',
      vaultRoot,
    })

    const initialSnapshot = buildTagSnapshot(
      '2026-04-28T12:00:00.000Z',
      `${SENSITIVE_NOTE_VALUE}_INITIAL`,
      INITIAL_OURA_TAGS,
    )
    expect((await importSnapshot(vaultRoot, initialSnapshot)).applied).toBe(true)
    expect((await importSnapshot(vaultRoot, initialSnapshot)).applied).toBe(false)
    await rebuildQueryProjection(vaultRoot)

    const initialEvents = await listAllEvents(vaultRoot)
    const initialNotes = initialEvents.filter(isJunctionWearableTagNote)
    const initialNoteIds = initialNotes.map((entity) => entity.entityId).sort()
    expect(initialNotes).toHaveLength(2)
    expect(initialEvents.filter((entity) => entity.kind === 'intervention_session'))
      .toHaveLength(0)

    const editedSnapshot = buildTagSnapshot(
      '2026-04-29T12:00:00.000Z',
      `${SENSITIVE_NOTE_VALUE}_EDITED`,
      EDITED_OURA_TAGS,
    )
    expect((await importSnapshot(vaultRoot, editedSnapshot)).applied).toBe(true)
    expect((await importSnapshot(vaultRoot, editedSnapshot)).applied).toBe(false)
    await rebuildQueryProjection(vaultRoot)

    const editedEvents = await listAllEvents(vaultRoot)
    const editedNotes = editedEvents.filter(isJunctionWearableTagNote)
    const editedOuraNotes = editedNotes.filter((entity) =>
      readExternalResourceType(entity) === 'junction-oura-note'
    )
    expect(editedNotes.map((entity) => entity.entityId).sort()).toEqual(initialNoteIds)
    expect(editedOuraNotes).toHaveLength(1)
    expect(editedOuraNotes[0]?.tags).toEqual(['custom-tag', 'headache', 'late-meal', 'recovery'])
    expect(editedEvents.filter((entity) => entity.kind === 'intervention_session'))
      .toHaveLength(0)

    const clearedSnapshot = buildTagSnapshot(
      '2026-04-30T12:00:00.000Z',
      `${SENSITIVE_NOTE_VALUE}_CLEARED`,
      [],
    )
    expect((await importSnapshot(vaultRoot, clearedSnapshot)).applied).toBe(true)
    expect((await importSnapshot(vaultRoot, clearedSnapshot)).applied).toBe(false)
    await rebuildQueryProjection(vaultRoot)

    const clearedEvents = await listAllEvents(vaultRoot)
    const clearedNotes = clearedEvents.filter(isJunctionWearableTagNote)
    const clearedOuraNotes = clearedNotes.filter((entity) =>
      readExternalResourceType(entity) === 'junction-oura-note'
    )
    expect(clearedNotes.map((entity) => entity.entityId).sort()).toEqual(initialNoteIds)
    expect(clearedOuraNotes).toHaveLength(1)
    expect(clearedOuraNotes[0]?.tags).toEqual([])
    expect(clearedEvents.filter((entity) => entity.kind === 'intervention_session'))
      .toHaveLength(0)
    await expect(directoryContainsText(vaultRoot, SENSITIVE_NOTE_VALUE))
      .resolves.toBe(false)
  } finally {
    await rm(parentRoot, { force: true, recursive: true })
  }
})

function buildSnapshot(input: {
  includeSleep: boolean
  importedAt: string
  noteValue: string
  ouraDates: readonly string[]
  ouraTags: readonly string[]
  start: string
}) {
  return {
    importedAt: input.importedAt,
    summaries: input.includeSleep ? {
      sleep: Array.from({ length: 70 }, (_, index) => {
        const date = addDays(input.start, index)
        const followsSauna = input.ouraDates.includes(addDays(date, -1))
        return {
          average_hrv: followsSauna ? 70 : 50,
          bedtime_start: `${date}T00:00:00.000Z`,
          bedtime_stop: `${date}T08:00:00.000Z`,
          calendar_date: date,
          duration: 28_800,
          id: `sleep-${date}`,
          recovery_readiness_score: followsSauna ? 90 : 70,
          score: followsSauna ? 92 : 78,
          sourceProviderSlug: 'oura',
          sourceType: 'ring',
          total: 25_200,
        }
      }),
    } : {},
    timeseries: {
      note: [
        ...input.ouraDates.map((date, index) => ({
          end: `${date}T18:10:00.000Z`,
          id: `oura-note-${index}`,
          sourceProviderSlug: 'oura',
          sourceType: 'ring',
          start: `${date}T18:05:00.000Z`,
          tags: input.ouraTags,
          value: input.noteValue,
        })),
        ...input.ouraDates.map((date, index) => {
          const garminDate = addDays(date, 7)
          return {
            end: `${garminDate}T18:10:00.000Z`,
            id: `garmin-note-${index}`,
            sourceProviderSlug: 'garmin',
            sourceType: 'watch',
            start: `${garminDate}T18:05:00.000Z`,
            tags: ['sauna'],
            value: input.noteValue,
          }
        }),
      ],
    },
  }
}

async function importSnapshot(vaultRoot: string, snapshot: ReturnType<typeof buildSnapshot>) {
  return importDeviceProviderSnapshot<Awaited<ReturnType<typeof coreRuntime.importDeviceBatch>>>(
    {
      deliveryMode: 'scheduled_reconcile',
      provider: 'junction',
      snapshot,
      sourceKind: 'poll',
      vaultRoot,
    },
    { corePort: coreRuntime },
  )
}

async function listAllEvents(vaultRoot: string): Promise<CanonicalEntity[]> {
  return listCanonicalEntities(vaultRoot, {
    family: 'event',
    limit: null,
  })
}

function isJunctionWearableTagNote(entity: CanonicalEntity): boolean {
  return entity.kind === 'note'
    && entity.attributes.noteType === JUNCTION_WEARABLE_TAG_NOTE_TYPE
}

function readExternalResourceType(entity: CanonicalEntity): string | null {
  const externalRef = entity.attributes.externalRef
  if (typeof externalRef !== 'object' || externalRef === null || Array.isArray(externalRef)) {
    return null
  }
  const resourceType = (externalRef as Record<string, unknown>).resourceType
  return typeof resourceType === 'string' ? resourceType : null
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

async function directoryContainsText(root: string, expected: string): Promise<boolean> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (await directoryContainsText(absolutePath, expected)) return true
      continue
    }
    if (entry.isFile() && (await readFile(absolutePath)).includes(expected)) return true
  }
  return false
}
