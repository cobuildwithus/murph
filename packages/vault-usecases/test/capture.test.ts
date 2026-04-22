import { afterEach, describe, expect, it, vi } from 'vitest'

import { importWithMocks } from './mock-import.ts'
import type { QueryCanonicalEntity } from '../src/query-runtime.ts'

type QueryRecord = QueryCanonicalEntity

function createCaptureRecord(overrides: Partial<QueryRecord> = {}): QueryRecord {
  return {
    entityId: 'evt_capture_1',
    primaryLookupId: 'evt_capture_1',
    lookupIds: ['evt_capture_1', 'mole-left-forearm-1'],
    family: 'event',
    recordClass: 'ledger',
    kind: 'note',
    status: null,
    occurredAt: '2026-04-08T12:00:00Z',
    date: '2026-04-08',
    path: 'raw/captures/2026/04/evt_capture_1/note.md',
    title: 'Mole capture',
    body: 'Capture body',
    attributes: {
      rawRefs: ['raw/captures/2026/04/evt_capture_1/manifest.json'],
    },
    frontmatter: null,
    links: [],
    relatedIds: [],
    stream: null,
    experimentSlug: null,
    tags: ['capture', 'mole-left-forearm-1'],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../src/captures.ts')
  vi.doUnmock('../src/commands/query-record-command-helpers.js')
  vi.doUnmock('../src/usecases/shared.js')
})

describe('capture usecases', () => {
  it('resolves event ids directly for show lookups', async () => {
    const captureRecord = createCaptureRecord()
    const readModel = { kind: 'query-read-model' }
    const lookupEntityById = vi.fn((_, lookup: string) =>
      lookup === 'evt_capture_1' ? captureRecord : null,
    )
    const listEntities = vi.fn(() => [])
    const readRawImportManifest = vi.fn()

    const capturesModule = await importWithMocks<typeof import('../src/captures.ts')>(
      '../src/captures.ts',
      {
        '../src/commands/query-record-command-helpers.js': async () => {
          const actual = await vi.importActual<
            typeof import('../src/commands/query-record-command-helpers.ts')
          >('../src/commands/query-record-command-helpers.ts')

          return {
            ...actual,
            loadQueryRuntime: vi.fn(async () => ({
              readVault: vi.fn(async () => readModel),
              lookupEntityById,
              listEntities,
            })),
          }
        },
        '../src/usecases/shared.js': async () => {
          const actual = await vi.importActual<typeof import('../src/usecases/shared.ts')>(
            '../src/usecases/shared.ts',
          )

          return {
            ...actual,
            readRawImportManifest,
          }
        },
      },
    )

    const result = await capturesModule.showCaptureRecord('/vault', 'evt_capture_1')

    expect(lookupEntityById).toHaveBeenCalledWith(readModel, 'evt_capture_1')
    expect(listEntities).not.toHaveBeenCalled()
    expect(result.entity).toMatchObject({
      id: 'evt_capture_1',
      kind: 'capture',
      title: 'Mole capture',
      data: {
        captureKind: 'note',
      },
    })
    expect(readRawImportManifest).not.toHaveBeenCalled()
  })

  it('resolves stable labels to the latest capture for show and manifest', async () => {
    const olderCapture = createCaptureRecord({
      entityId: 'evt_capture_0',
      occurredAt: '2026-04-08T11:00:00Z',
      title: 'Older capture',
    })
    const latestCapture = createCaptureRecord({
      entityId: 'evt_capture_1',
      occurredAt: '2026-04-08T12:00:00Z',
      title: 'Latest capture',
    })
    const readModel = { kind: 'query-read-model' }
    const lookupEntityById = vi.fn((_, lookup: string) =>
      lookup === 'evt_capture_1' ? latestCapture : null,
    )
    const listEntities = vi.fn(() => [olderCapture, latestCapture])
    const manifest = {
      artifacts: [],
      importId: 'imp_capture_1',
      importKind: 'capture',
      provenance: {
        lookupId: 'mole-left-forearm-1',
        title: 'Latest capture',
      },
      rawDirectory: 'raw/captures/2026/04/evt_capture_1',
      schemaVersion: 'murph.raw-import.v1',
      source: null,
    }
    const readRawImportManifest = vi.fn(async () => manifest)

    const capturesModule = await importWithMocks<typeof import('../src/captures.ts')>(
      '../src/captures.ts',
      {
        '../src/commands/query-record-command-helpers.js': async () => {
          const actual = await vi.importActual<
            typeof import('../src/commands/query-record-command-helpers.ts')
          >('../src/commands/query-record-command-helpers.ts')

          return {
            ...actual,
            loadQueryRuntime: vi.fn(async () => ({
              readVault: vi.fn(async () => readModel),
              lookupEntityById,
              listEntities,
            })),
          }
        },
        '../src/usecases/shared.js': async () => {
          const actual = await vi.importActual<typeof import('../src/usecases/shared.ts')>(
            '../src/usecases/shared.ts',
          )

          return {
            ...actual,
            readRawImportManifest,
          }
        },
      },
    )

    const showResult = await capturesModule.showCaptureRecord('/vault', 'mole-left-forearm-1')
    const manifestResult = await capturesModule.showCaptureManifest(
      '/vault',
      'mole-left-forearm-1',
    )

    expect(lookupEntityById).toHaveBeenCalledWith(readModel, 'mole-left-forearm-1')
    expect(listEntities).toHaveBeenCalledWith(readModel, {
      families: ['event'],
      kinds: ['note'],
    })
    expect(showResult.entity).toMatchObject({
      id: 'evt_capture_1',
      kind: 'capture',
      title: 'Latest capture',
      data: {
        captureKind: 'note',
      },
    })
    expect(readRawImportManifest).toHaveBeenCalledWith(
      '/vault',
      'raw/captures/2026/04/evt_capture_1/manifest.json',
    )
    expect(manifestResult).toMatchObject({
      entityId: 'evt_capture_1',
      kind: 'capture',
      lookupId: 'evt_capture_1',
      manifestFile: 'raw/captures/2026/04/evt_capture_1/manifest.json',
      manifest,
    })
  })
})
