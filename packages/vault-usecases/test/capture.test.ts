import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { importWithMocks } from './mock-import.ts'
import type { QueryCanonicalEntity } from '../src/query-runtime.ts'
import { addCaptureRecord } from '../src/usecases/capture.js'

type QueryRecord = QueryCanonicalEntity

const mocks = vi.hoisted(() => ({
  addCapture: vi.fn(),
  callIndex: 0,
}))

vi.mock('../src/runtime-import.js', () => ({
  loadRuntimeModule: vi.fn(async () => ({
    addCapture: mocks.addCapture,
  })),
}))

interface MockAddCaptureInput {
  draft: {
    occurredAt: string
    title: string
    tags?: string[]
    note: string
  }
  attachments: Array<{
    role: string
  }>
}

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

function installAddCaptureMock() {
  mocks.addCapture.mockImplementation(async (input: MockAddCaptureInput) => {
    const index = ++mocks.callIndex
    const eventId = `evt_capture_${index}`

    return {
      eventId,
      ledgerFile: 'ledger/events/2026/2026-04.jsonl',
      created: true,
      manifestPath: `raw/captures/2026/04/${eventId}/manifest.json`,
      event: {
        kind: 'note',
        id: eventId,
        occurredAt: input.draft.occurredAt,
        title: input.draft.title,
        tags: input.draft.tags,
        note: input.draft.note,
        attachments: input.attachments.map((attachment, attachmentIndex: number) => ({
          role: attachment.role,
          kind: 'photo',
          relativePath: `raw/captures/2026/04/${eventId}/media-${attachmentIndex + 1}.jpg`,
          mediaType: 'image/jpeg',
        })),
      },
    }
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('../src/captures.ts')
  vi.doUnmock('../src/commands/query-record-command-helpers.js')
  vi.doUnmock('../src/usecases/shared.js')
})

describe('capture usecases', () => {
  beforeEach(() => {
    mocks.addCapture.mockReset()
    mocks.callIndex = 0
    installAddCaptureMock()
  })

  it('merges command-level defaults into structured batch captures', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'murph-capture-'))
    const inputFile = path.join(tempDir, 'captures.json')
    await writeFile(inputFile, JSON.stringify({
      captures: [
        {
          media: ['left-forearm.jpg'],
          label: 'mole left forearm 1',
          bodySite: 'Left forearm',
        },
        {
          media: ['right-shoulder.jpg'],
          label: 'mole-right-shoulder-1',
          tags: ['right side'],
        },
      ],
    }))

    const result = await addCaptureRecord({
      vault: tempDir,
      inputFile,
      collection: 'dermatology baseline',
      tags: ['mole'],
      occurredAt: '2026-04-21T09:00:00.000Z',
    })

    expect(result.addedCount).toBe(2)
    expect(result.captures.map((capture) => capture.lookupId)).toEqual([
      'evt_capture_1',
      'evt_capture_2',
    ])
    expect(result.captures.map((capture) => capture.stableLookupId)).toEqual([
      'mole-left-forearm-1',
      'mole-right-shoulder-1',
    ])
    expect(mocks.addCapture).toHaveBeenCalledTimes(2)

    const firstInput = mocks.addCapture.mock.calls[0]?.[0]
    const secondInput = mocks.addCapture.mock.calls[1]?.[0]
    expect(firstInput?.draft.occurredAt).toBe('2026-04-21T09:00:00.000Z')
    expect(firstInput?.draft.tags).toEqual(expect.arrayContaining([
      'capture',
      'collection-dermatology-baseline',
      'mole',
      'mole-left-forearm-1',
      'site-left-forearm',
    ]))
    expect(secondInput?.draft.tags).toEqual(expect.arrayContaining([
      'capture',
      'collection-dermatology-baseline',
      'mole',
      'mole-right-shoulder-1',
      'right-side',
    ]))
  })

  it('merges structured root defaults into child captures while allowing per-entry overrides', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'murph-capture-'))
    const inputFile = path.join(tempDir, 'captures.json')
    await writeFile(inputFile, JSON.stringify({
      occurredAt: '2026-04-21T09:00:00.000Z',
      collection: 'dermatology baseline',
      tags: ['mole'],
      captures: [
        {
          media: ['left-forearm.jpg'],
          label: 'mole-left-forearm-1',
        },
        {
          media: ['right-shoulder.jpg'],
          label: 'mole-right-shoulder-1',
          collection: 'follow-up',
          tags: ['right side'],
        },
      ],
    }))

    const result = await addCaptureRecord({
      vault: tempDir,
      inputFile,
    })

    expect(result.captures.map((capture) => capture.lookupId)).toEqual([
      'evt_capture_1',
      'evt_capture_2',
    ])
    expect(result.captures.map((capture) => capture.stableLookupId)).toEqual([
      'mole-left-forearm-1',
      'mole-right-shoulder-1',
    ])

    const firstInput = mocks.addCapture.mock.calls[0]?.[0]
    const secondInput = mocks.addCapture.mock.calls[1]?.[0]
    expect(firstInput?.draft.occurredAt).toBe('2026-04-21T09:00:00.000Z')
    expect(firstInput?.draft.tags).toEqual(expect.arrayContaining([
      'capture',
      'collection-dermatology-baseline',
      'mole',
      'mole-left-forearm-1',
    ]))
    expect(secondInput?.draft.tags).toEqual(expect.arrayContaining([
      'capture',
      'collection-follow-up',
      'mole',
      'mole-right-shoulder-1',
      'right-side',
    ]))
    expect(secondInput?.draft.tags).not.toContain('collection-dermatology-baseline')
  })

  it('rejects duplicate labels inside one batch before writing any capture', async () => {
    await expect(addCaptureRecord({
      vault: '/tmp/murph-vault',
      captures: [
        { media: ['first.jpg'], label: 'mole left forearm 1' },
        { media: ['second.jpg'], label: 'mole-left-forearm-1' },
      ],
    })).rejects.toMatchObject({
      code: 'invalid_payload',
    })

    expect(mocks.addCapture).not.toHaveBeenCalled()
  })

  it('treats an explicit empty direct captures array like the single-capture fallback', async () => {
    const result = await addCaptureRecord({
      vault: '/tmp/murph-vault',
      captures: [],
      media: ['left-forearm.jpg'],
      label: 'mole-left-forearm-1',
      collection: 'dermatology baseline',
    })

    expect(result.addedCount).toBe(1)
    expect(result.captures[0]).toMatchObject({
      lookupId: 'evt_capture_1',
      stableLookupId: 'mole-left-forearm-1',
      label: 'mole-left-forearm-1',
      collection: 'dermatology-baseline',
    })
    expect(mocks.addCapture).toHaveBeenCalledTimes(1)
  })

  it('rejects a structured captures payload when captures is not an array', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'murph-capture-'))
    const inputFile = path.join(tempDir, 'captures.json')
    await writeFile(inputFile, JSON.stringify({
      captures: {
        media: ['left-forearm.jpg'],
        label: 'mole-left-forearm-1',
      },
    }))

    await expect(addCaptureRecord({
      vault: tempDir,
      inputFile,
    })).rejects.toMatchObject({
      code: 'invalid_payload',
    })

    expect(mocks.addCapture).not.toHaveBeenCalled()
  })

  it('rejects non-string entries in structured string-array fields before writing', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'murph-capture-'))
    const inputFile = path.join(tempDir, 'captures.json')
    await writeFile(inputFile, JSON.stringify({
      captures: [
        {
          media: ['left-forearm.jpg'],
          label: 'mole-left-forearm-1',
          tags: ['right side', 42],
        },
      ],
    }))

    await expect(addCaptureRecord({
      vault: tempDir,
      inputFile,
    })).rejects.toMatchObject({
      code: 'invalid_payload',
    })

    expect(mocks.addCapture).not.toHaveBeenCalled()
  })

  it('lists captures newest-first before applying the limit', async () => {
    const oldestCapture = createCaptureRecord({
      entityId: 'evt_capture_0',
      occurredAt: '2026-04-08T11:00:00Z',
      title: 'Oldest capture',
    })
    const middleCapture = createCaptureRecord({
      entityId: 'evt_capture_1',
      occurredAt: '2026-04-08T12:00:00Z',
      title: 'Middle capture',
    })
    const newestCapture = createCaptureRecord({
      entityId: 'evt_capture_2',
      occurredAt: '2026-04-08T13:00:00Z',
      title: 'Newest capture',
    })
    const readModel = { kind: 'query-read-model' }
    const lookupEntityById = vi.fn(() => null)
    const listEntities = vi.fn(() => [middleCapture, oldestCapture, newestCapture])
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

    const result = await capturesModule.listCaptureRecords({
      vault: '/vault',
      limit: 2,
    })

    expect(listEntities).toHaveBeenCalledWith(readModel, {
      families: ['event'],
      kinds: ['note'],
      from: undefined,
      to: undefined,
    })
    expect(result.items.map((item) => item.id)).toEqual([
      'evt_capture_2',
      'evt_capture_1',
    ])
  })

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
    const manifestFile =
      'raw/captures/2026/04/evt_capture_1/manifest.evt_capture_1.20260408T120000000Z.json'
    const readRawImportManifest = vi.fn(async () => manifest)
    const resolveRawImportManifestFile = vi.fn(async () => manifestFile)

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
            resolveRawImportManifestFile,
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
      manifestFile,
    )
    expect(resolveRawImportManifestFile).toHaveBeenCalledWith(
      '/vault',
      'raw/captures/2026/04/evt_capture_1',
    )
    expect(manifestResult).toMatchObject({
      entityId: 'evt_capture_1',
      kind: 'capture',
      lookupId: 'evt_capture_1',
      manifestFile,
      manifest,
    })
  })
})
