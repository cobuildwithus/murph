import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  manifestFile: string
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

interface DeleteEnvelope {
  entityId: string
  lookupId: string
  kind: string
  deleted: true
  retainedPaths: string[]
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
    excerpt?: string | null
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
    schemaVersion: string
    importId: string
    importKind: string
    owner?: {
      kind: string
      id: string
      partition?: string
    }
    rawDirectory: string
    source: string | null
    artifacts: Array<{
      role: string
      relativePath: string
      originalFileName: string
      mediaType: string
      byteSize: number
      sha256: string
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
const DOCUMENT_MEAL_SCHEMA_TIMEOUT_MS = 45_000

async function createVault(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-doc-meal-'))
  const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)
  return vaultRoot
}

test(
  'document and meal command schemas expose the expansion and mutation surfaces',
  async () => {
    const documentImportSchema = JSON.parse(
      await runRawSourceCli(['document', 'import', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const documentEditSchema = JSON.parse(
      await runRawSourceCli(['document', 'edit', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const documentDeleteSchema = JSON.parse(
      await runRawSourceCli(['document', 'delete', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const documentListSchema = JSON.parse(
      await runRawSourceCli(['document', 'list', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const mealAddSchema = JSON.parse(
      await runRawSourceCli(['meal', 'add', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const mealEditSchema = JSON.parse(
      await runRawSourceCli(['meal', 'edit', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const mealDeleteSchema = JSON.parse(
      await runRawSourceCli(['meal', 'delete', '--schema', '--format', 'json']),
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

    assert.equal('input' in documentEditSchema.options.properties, true)
    assert.equal('set' in documentEditSchema.options.properties, true)
    assert.equal('clear' in documentEditSchema.options.properties, true)
    assert.equal('dayKeyPolicy' in documentEditSchema.options.properties, true)
    assert.deepEqual(documentEditSchema.options.required, ['vault'])
    assert.deepEqual(documentDeleteSchema.options.required, ['vault'])

    assert.equal('source' in mealAddSchema.options.properties, true)
    assert.deepEqual([...(mealAddSchema.options.required ?? [])].sort(), ['vault'])

    assert.equal('input' in mealEditSchema.options.properties, true)
    assert.equal('set' in mealEditSchema.options.properties, true)
    assert.equal('clear' in mealEditSchema.options.properties, true)
    assert.equal('dayKeyPolicy' in mealEditSchema.options.properties, true)
    assert.deepEqual(mealEditSchema.options.required, ['vault'])
    assert.deepEqual(mealDeleteSchema.options.required, ['vault'])

    assert.equal('from' in mealListSchema.options.properties, true)
    assert.equal('to' in mealListSchema.options.properties, true)
    assert.equal('kind' in mealListSchema.options.properties, false)
    assert.deepEqual(mealListSchema.options.required, ['vault'])
  },
  DOCUMENT_MEAL_SCHEMA_TIMEOUT_MS,
)

test.sequential(
  'document import/show/list/manifest use stable document ids for canonical reads',
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
      assert.deepEqual(requireData(showByDocumentId).entity.links, [])

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
      assert.match(requireData(listedDocuments).items[0]?.excerpt ?? '', /Fasted lipid panel/u)
      assert.equal('markdown' in (requireData(listedDocuments).items[0] ?? {}), false)
      assert.equal(requireData(listedDocuments).items[0]?.data.source, 'device')
      assert.deepEqual(requireData(listedDocuments).items[0]?.links, [])
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
      assert.equal(requireData(manifest).manifest.schemaVersion, 'murph.raw-import-manifest.v1')
      assert.equal(requireData(manifest).manifest.importKind, 'document')
      assert.equal(requireData(manifest).manifest.importId, currentDocument.documentId)
      assert.deepEqual(requireData(manifest).manifest.owner, {
        kind: 'document',
        id: currentDocument.documentId,
      })
      assert.equal(requireData(manifest).manifest.source, 'device')
      assert.equal(
        requireData(manifest).manifest.rawDirectory,
        path.posix.dirname(requireData(manifest).manifest.artifacts[0]?.relativePath ?? ''),
      )
      assert.equal(requireData(manifest).manifest.provenance.lookupId, currentDocument.lookupId)
      assert.equal(requireData(manifest).manifest.provenance.title, 'Lab Report')
      assert.equal(requireData(manifest).manifest.provenance.note, 'Fasted lipid panel.')
      assert.equal(requireData(manifest).manifest.artifacts[0]?.role, 'source_document')
      assert.match(
        requireData(manifest).manifest.artifacts[0]?.relativePath ?? '',
        /^raw\/documents\/\d{4}\/\d{2}\/doc_/u,
      )
      assert.equal(
        requireData(manifest).manifest.artifacts[0]?.originalFileName,
        path.basename(sampleDocumentPath),
      )
      assert.equal(requireData(manifest).manifest.artifacts[0]?.mediaType, 'text/markdown')
      assert.equal(
        Number.isInteger(requireData(manifest).manifest.artifacts[0]?.byteSize),
        true,
      )
      assert.equal((requireData(manifest).manifest.artifacts[0]?.byteSize ?? 0) > 0, true)
      assert.match(
        requireData(manifest).manifest.artifacts[0]?.sha256 ?? '',
        /^[a-f0-9]{64}$/u,
      )

      const manifestPath = path.join(vaultRoot, currentDocument.manifestFile)
      const tamperedManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        artifacts: Array<{
          role: string
          relativePath: string
          originalFileName: string
          mediaType: string
          byteSize: number
        }>
      }
      const firstArtifact = tamperedManifest.artifacts[0]
      assert.ok(firstArtifact)

      tamperedManifest.artifacts[0] = {
        role: firstArtifact.role,
        relativePath: firstArtifact.relativePath,
        originalFileName: firstArtifact.originalFileName,
        mediaType: firstArtifact.mediaType,
        byteSize: firstArtifact.byteSize,
      }
      await writeFile(manifestPath, `${JSON.stringify(tamperedManifest, null, 2)}\n`, 'utf8')

      const invalidManifest = await runSourceCli([
        'document',
        'manifest',
        currentDocument.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(invalidManifest.ok, false)
      if (invalidManifest.ok) {
        throw new Error('expected tampered document manifest to be rejected')
      }
      assert.equal(invalidManifest.error.code, 'manifest_invalid')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'document and meal edit/delete reuse the saved records while preserving immutable artifacts',
  async () => {
    const vaultRoot = await createVault()

    try {
      const documentRecord = requireData(
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
          '--vault',
          vaultRoot,
        ]),
      )
      const mealRecord = requireData(
        await runSourceCli<MealAddEnvelope>([
          'meal',
          'add',
          '--photo',
          sampleDocumentPath,
          '--occurred-at',
          '2026-03-12T12:15:00Z',
          '--note',
          'Smoothie after training.',
          '--vault',
          vaultRoot,
        ]),
      )
      const mealManifest = requireData(
        await runSourceCli<ManifestEnvelope>([
          'meal',
          'manifest',
          mealRecord.lookupId,
          '--vault',
          vaultRoot,
        ]),
      )

      const editedDocument = await runSourceCli<ShowEnvelope>([
        'document',
        'edit',
        documentRecord.documentId,
        '--set',
        'title=Updated Lab Report',
        '--set',
        'note=Reviewed with PCP.',
        '--vault',
        vaultRoot,
      ])
      assert.equal(editedDocument.ok, true)
      assert.equal(editedDocument.meta?.command, 'document edit')
      assert.equal(requireData(editedDocument).entity.title, 'Updated Lab Report')
      assert.equal(requireData(editedDocument).entity.data.note, 'Reviewed with PCP.')

      const editedMeal = await runSourceCli<ShowEnvelope>([
        'meal',
        'edit',
        mealRecord.mealId,
        '--set',
        'note=Green smoothie after training.',
        '--set',
        'ingredients=[\"spinach\",\"banana\",\"greek yogurt\"]',
        '--vault',
        vaultRoot,
      ])
      assert.equal(editedMeal.ok, true)
      assert.equal(editedMeal.meta?.command, 'meal edit')
      assert.equal(requireData(editedMeal).entity.data.note, 'Green smoothie after training.')
      assert.deepEqual(requireData(editedMeal).entity.data.ingredients, [
        'spinach',
        'banana',
        'greek yogurt',
      ])

      const deletedDocument = await runSourceCli<DeleteEnvelope>([
        'document',
        'delete',
        documentRecord.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(deletedDocument.ok, true)
      assert.equal(deletedDocument.meta?.command, 'document delete')
      assert.equal(requireData(deletedDocument).entityId, documentRecord.documentId)
      assert.equal(requireData(deletedDocument).kind, 'document')
      assert.equal(requireData(deletedDocument).deleted, true)
      assert.equal(requireData(deletedDocument).retainedPaths.length > 0, true)
      await access(path.join(vaultRoot, documentRecord.manifestFile))

      const missingDocument = await runSourceCli([
        'document',
        'show',
        documentRecord.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(missingDocument.ok, false)
      assert.equal(missingDocument.error?.code, 'not_found')

      const deletedMeal = await runSourceCli<DeleteEnvelope>([
        'meal',
        'delete',
        mealRecord.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(deletedMeal.ok, true)
      assert.equal(deletedMeal.meta?.command, 'meal delete')
      assert.equal(requireData(deletedMeal).entityId, mealRecord.mealId)
      assert.equal(requireData(deletedMeal).kind, 'meal')
      assert.equal(requireData(deletedMeal).deleted, true)
      assert.equal(requireData(deletedMeal).retainedPaths.length > 0, true)
      await access(path.join(vaultRoot, mealManifest.manifestFile))

      const missingMeal = await runSourceCli([
        'meal',
        'show',
        mealRecord.lookupId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(missingMeal.ok, false)
      assert.equal(missingMeal.error?.code, 'not_found')
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'meal add/show/list/manifest use stable meal ids for canonical reads',
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

      const showByMealId = await runSourceCli<ShowEnvelope>([
        'meal',
        'show',
        currentMeal.mealId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(showByMealId.ok, true)
      assert.equal(showByMealId.meta?.command, 'meal show')
      assert.equal(requireData(showByMealId).entity.id, currentMeal.mealId)
      assert.equal(requireData(showByMealId).entity.kind, 'meal')
      assert.equal(requireData(showByMealId).entity.occurredAt, '2026-03-12T12:15:00.000Z')
      assert.equal(requireData(showByMealId).entity.data.source, 'device')
      assert.equal(requireData(showByMealId).entity.data.note, 'Eggs and avocado.')
      assert.deepEqual(requireData(showByMealId).entity.links, [])

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
      assert.match(requireData(listedMeals).items[0]?.excerpt ?? '', /Eggs and avocado/u)
      assert.equal('markdown' in (requireData(listedMeals).items[0] ?? {}), false)
      assert.equal(requireData(listedMeals).items[0]?.data.source, 'device')
      assert.deepEqual(requireData(listedMeals).items[0]?.links, [])
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
  60_000,
)
