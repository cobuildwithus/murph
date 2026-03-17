import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import {
  repoRoot,
  requireData,
  runCli,
  runRawCli,
} from './cli-test-helpers.js'

const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)

interface SchemaEnvelope {
  options: {
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface DocumentImportEnvelope {
  documentId: string
  eventId: string
  lookupId: string
}

interface MealAddEnvelope {
  mealId: string
  eventId: string
  lookupId: string
}

interface ShowEnvelope {
  entity: {
    id: string
    kind: string
    title: string | null
    occurredAt: string | null
    data: Record<string, unknown>
    links: Array<{
      id: string
      kind: string
      queryable: boolean
    }>
  }
}

interface ListEnvelope {
  filters: {
    kind?: string
    from?: string
    to?: string
    limit: number
  }
  count: number
  items: Array<{
    id: string
    kind: string
    data: Record<string, unknown>
    links: Array<{
      id: string
      kind: string
      queryable: boolean
    }>
  }>
}

interface ManifestEnvelope {
  entityId: string
  lookupId: string
  kind: string
  manifestFile: string
  manifest: {
    importId: string
    importKind: string
    source: string | null
    artifacts: Array<{
      role?: string
    }>
    provenance: {
      lookupId?: string
      title?: string
      note?: string
    }
  }
}

const runSourceCli = runCli
const runRawSourceCli = runRawCli

async function createVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-doc-meal-'))
  const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)
  return vaultRoot
}

test('document and meal command schemas expose the expansion surface', async () => {
  const documentImportSchema = JSON.parse(
    await runRawSourceCli(['document', 'import', '--schema', '--format', 'json']),
  ) as SchemaEnvelope
  const documentListSchema = JSON.parse(
    await runRawSourceCli(['document', 'list', '--schema', '--format', 'json']),
  ) as SchemaEnvelope
  const mealAddSchema = JSON.parse(
    await runRawSourceCli(['meal', 'add', '--schema', '--format', 'json']),
  ) as SchemaEnvelope
  const mealListSchema = JSON.parse(
    await runRawSourceCli(['meal', 'list', '--schema', '--format', 'json']),
  ) as SchemaEnvelope

  assert.equal('title' in documentImportSchema.options.properties, true)
  assert.equal('occurredAt' in documentImportSchema.options.properties, true)
  assert.equal('note' in documentImportSchema.options.properties, true)
  assert.equal('source' in documentImportSchema.options.properties, true)
  assert.deepEqual(documentImportSchema.options.required, ['vault'])

  assert.equal('from' in documentListSchema.options.properties, true)
  assert.equal('to' in documentListSchema.options.properties, true)
  assert.equal('kind' in documentListSchema.options.properties, false)
  assert.deepEqual(documentListSchema.options.required, ['vault'])

  assert.equal('source' in mealAddSchema.options.properties, true)
  assert.deepEqual([...(mealAddSchema.options.required ?? [])].sort(), ['photo', 'vault'])

  assert.equal('from' in mealListSchema.options.properties, true)
  assert.equal('to' in mealListSchema.options.properties, true)
  assert.equal('kind' in mealListSchema.options.properties, false)
  assert.deepEqual(mealListSchema.options.required, ['vault'])
})

test.sequential(
  'document import/show/list/manifest support document ids, event ids, and manifest inspection',
  async () => {
    const vaultRoot = await createVault()

    try {
      const currentDocument = requireData(
        await runSourceCli<DocumentImportEnvelope>([
          'document',
          'import',
          sampleDocumentPath,
          '--title',
          'Lab Report',
          '--occurred-at',
          '2026-03-12T09:30:00Z',
          '--note',
          'Fasted lipid panel.',
          '--source',
          'device',
          '--vault',
          vaultRoot,
        ]),
      )
      const olderDocument = requireData(
        await runSourceCli<DocumentImportEnvelope>([
          'document',
          'import',
          sampleDocumentPath,
          '--title',
          'Older Report',
          '--occurred-at',
          '2026-03-10T07:15:00Z',
          '--vault',
          vaultRoot,
        ]),
      )

      const showByDocumentId = await runSourceCli<ShowEnvelope>([
        'document',
        'show',
        currentDocument.documentId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showByDocumentId.ok, true)
      assert.equal(showByDocumentId.meta?.command, 'document show')
      assert.equal(requireData(showByDocumentId).entity.id, currentDocument.documentId)
      assert.equal(requireData(showByDocumentId).entity.kind, 'document')
      assert.equal(requireData(showByDocumentId).entity.title, 'Lab Report')
      assert.equal(requireData(showByDocumentId).entity.occurredAt, '2026-03-12T09:30:00.000Z')
      assert.equal(requireData(showByDocumentId).entity.data.source, 'device')
      assert.equal(requireData(showByDocumentId).entity.data.note, 'Fasted lipid panel.')
      assert.deepEqual(requireData(showByDocumentId).entity.links, [
        {
          id: currentDocument.lookupId,
          kind: 'event',
          queryable: true,
        },
      ])

      const showByEventId = await runSourceCli<ShowEnvelope>([
        'document',
        'show',
        currentDocument.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showByEventId.ok, true)
      assert.equal(requireData(showByEventId).entity.id, currentDocument.documentId)

      const listedDocuments = await runSourceCli<ListEnvelope>([
        'document',
        'list',
        '--from',
        '2026-03-12',
        '--to',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])
      assert.equal(listedDocuments.ok, true)
      assert.equal(listedDocuments.meta?.command, 'document list')
      assert.equal(requireData(listedDocuments).filters.kind, 'document')
      assert.equal(requireData(listedDocuments).filters.from, '2026-03-12')
      assert.equal(requireData(listedDocuments).filters.to, '2026-03-12')
      assert.equal(requireData(listedDocuments).filters.limit, 50)
      assert.equal(requireData(listedDocuments).count, 1)
      assert.deepEqual(
        requireData(listedDocuments).items.map((item) => item.id),
        [currentDocument.documentId],
      )
      assert.equal(requireData(listedDocuments).items[0]?.data.source, 'device')
      assert.equal(requireData(listedDocuments).items[0]?.links[0]?.id, currentDocument.lookupId)
      assert.equal(
        requireData(listedDocuments).items.some((item) => item.id === olderDocument.documentId),
        false,
      )

      const manifest = await runSourceCli<ManifestEnvelope>([
        'document',
        'manifest',
        currentDocument.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(manifest.ok, true)
      assert.equal(manifest.meta?.command, 'document manifest')
      assert.equal(requireData(manifest).entityId, currentDocument.documentId)
      assert.equal(requireData(manifest).lookupId, currentDocument.lookupId)
      assert.equal(requireData(manifest).kind, 'document')
      assert.match(requireData(manifest).manifestFile, /\/manifest\.json$/u)
      assert.equal(requireData(manifest).manifest.importKind, 'document')
      assert.equal(requireData(manifest).manifest.importId, currentDocument.documentId)
      assert.equal(requireData(manifest).manifest.source, 'device')
      assert.equal(requireData(manifest).manifest.provenance.lookupId, currentDocument.lookupId)
      assert.equal(requireData(manifest).manifest.provenance.title, 'Lab Report')
      assert.equal(requireData(manifest).manifest.provenance.note, 'Fasted lipid panel.')
      assert.equal(requireData(manifest).manifest.artifacts[0]?.role, 'source_document')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'meal add/show/list/manifest support meal ids, event ids, and manifest inspection',
  async () => {
    const vaultRoot = await createVault()

    try {
      const currentMeal = requireData(
        await runSourceCli<MealAddEnvelope>([
          'meal',
          'add',
          '--photo',
          sampleDocumentPath,
          '--occurred-at',
          '2026-03-12T12:15:00Z',
          '--note',
          'Eggs and avocado.',
          '--source',
          'device',
          '--vault',
          vaultRoot,
        ]),
      )
      const olderMeal = requireData(
        await runSourceCli<MealAddEnvelope>([
          'meal',
          'add',
          '--photo',
          sampleDocumentPath,
          '--occurred-at',
          '2026-03-10T18:00:00Z',
          '--vault',
          vaultRoot,
        ]),
      )

      const showByEventId = await runSourceCli<ShowEnvelope>([
        'meal',
        'show',
        currentMeal.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showByEventId.ok, true)
      assert.equal(showByEventId.meta?.command, 'meal show')
      assert.equal(requireData(showByEventId).entity.id, currentMeal.mealId)
      assert.equal(requireData(showByEventId).entity.kind, 'meal')
      assert.equal(requireData(showByEventId).entity.occurredAt, '2026-03-12T12:15:00.000Z')
      assert.equal(requireData(showByEventId).entity.data.source, 'device')
      assert.equal(requireData(showByEventId).entity.data.note, 'Eggs and avocado.')
      assert.deepEqual(requireData(showByEventId).entity.links, [
        {
          id: currentMeal.lookupId,
          kind: 'event',
          queryable: true,
        },
      ])

      const showByMealId = await runSourceCli<ShowEnvelope>([
        'meal',
        'show',
        currentMeal.mealId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showByMealId.ok, true)
      assert.equal(requireData(showByMealId).entity.id, currentMeal.mealId)

      const listedMeals = await runSourceCli<ListEnvelope>([
        'meal',
        'list',
        '--from',
        '2026-03-12',
        '--to',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])
      assert.equal(listedMeals.ok, true)
      assert.equal(listedMeals.meta?.command, 'meal list')
      assert.equal(requireData(listedMeals).filters.kind, 'meal')
      assert.equal(requireData(listedMeals).filters.from, '2026-03-12')
      assert.equal(requireData(listedMeals).filters.to, '2026-03-12')
      assert.equal(requireData(listedMeals).filters.limit, 50)
      assert.equal(requireData(listedMeals).count, 1)
      assert.deepEqual(
        requireData(listedMeals).items.map((item) => item.id),
        [currentMeal.mealId],
      )
      assert.equal(requireData(listedMeals).items[0]?.data.source, 'device')
      assert.equal(requireData(listedMeals).items[0]?.links[0]?.id, currentMeal.lookupId)
      assert.equal(
        requireData(listedMeals).items.some((item) => item.id === olderMeal.mealId),
        false,
      )

      const manifest = await runSourceCli<ManifestEnvelope>([
        'meal',
        'manifest',
        currentMeal.mealId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(manifest.ok, true)
      assert.equal(manifest.meta?.command, 'meal manifest')
      assert.equal(requireData(manifest).entityId, currentMeal.mealId)
      assert.equal(requireData(manifest).lookupId, currentMeal.lookupId)
      assert.equal(requireData(manifest).kind, 'meal')
      assert.match(requireData(manifest).manifestFile, /\/manifest\.json$/u)
      assert.equal(requireData(manifest).manifest.importKind, 'meal')
      assert.equal(requireData(manifest).manifest.importId, currentMeal.mealId)
      assert.equal(requireData(manifest).manifest.source, 'device')
      assert.equal(requireData(manifest).manifest.provenance.lookupId, currentMeal.lookupId)
      assert.equal(requireData(manifest).manifest.provenance.note, 'Eggs and avocado.')
      assert.equal(requireData(manifest).manifest.artifacts[0]?.role, 'photo')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
