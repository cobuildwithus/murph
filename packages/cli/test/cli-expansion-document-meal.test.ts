import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { test } from 'vitest'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { registerDocumentCommands } from '../src/commands/document.js'
import { registerMealCommands } from '../src/commands/meal.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import {
  createVaultCliVaultContext,
  installVaultCliVaultContext,
} from '../src/vault-cli-vault-context.js'
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
  occurredAt?: string | null
  note?: string | null
  source?: string | null
  ingredients?: string[] | null
  nutrition?: {
    totals?: {
      calories?: number
      proteinGrams?: number
      carbsGrams?: number
      fatGrams?: number
      fiberGrams?: number
    }
    provenance?: {
      source: string
      confidence?: string
      sourceDetail?: string
    }
  } | null
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

interface MealTotalsEnvelope {
  filters: {
    from: string | null
    to: string | null
  }
  mealCount: number
  totals: {
    calories: {
      total: number | null
      mealCount: number
    }
    proteinGrams: {
      total: number | null
      mealCount: number
    }
    carbsGrams: {
      total: number | null
      mealCount: number
    }
    fatGrams: {
      total: number | null
      mealCount: number
    }
    fiberGrams: {
      total: number | null
      mealCount: number
    }
  }
  days: Array<{
    date: string
    mealCount: number
    totals: {
      calories: {
        total: number | null
        mealCount: number
      }
      proteinGrams: {
        total: number | null
        mealCount: number
      }
      carbsGrams: {
        total: number | null
        mealCount: number
      }
      fatGrams: {
        total: number | null
        mealCount: number
      }
      fiberGrams: {
        total: number | null
        mealCount: number
      }
    }
  }>
}

const runSourceCli = runCli
const runRawSourceCli = runRawCli
const DOCUMENT_MEAL_SCHEMA_TIMEOUT_MS = 45_000

function createDocumentMealSchemaCli(): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: 'document and meal schema expansion cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)

  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerDocumentCommands(cli, services)
  registerMealCommands(cli, services)
  installVaultCliVaultContext(cli, createVaultCliVaultContext())

  return cli
}

async function readCommandSchema(
  cli: Cli.Cli,
  args: string[],
): Promise<SchemaEnvelope> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve([...args, '--schema', '--format', 'json'], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  assert.equal(exitCode, null)
  return JSON.parse(output.join('').trim()) as SchemaEnvelope
}

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
    const cli = createDocumentMealSchemaCli()
    const documentImportSchema = JSON.parse(
      await runRawSourceCli(['document', 'import', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const documentEditSchema = await readCommandSchema(cli, ['document', 'edit'])
    const documentDeleteSchema = await readCommandSchema(cli, ['document', 'delete'])
    const documentListSchema = await readCommandSchema(cli, ['document', 'list'])
    const mealAddSchema = JSON.parse(
      await runRawSourceCli(['meal', 'add', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const mealImportJsonSchema = JSON.parse(
      await runRawSourceCli(['meal', 'import-json', '--schema', '--format', 'json']),
    ) as SchemaEnvelope
    const mealEditSchema = await readCommandSchema(cli, ['meal', 'edit'])
    const mealDeleteSchema = await readCommandSchema(cli, ['meal', 'delete'])
    const mealListSchema = await readCommandSchema(cli, ['meal', 'list'])
    const mealTotalsSchema = await readCommandSchema(cli, ['meal', 'totals'])

    assert.equal('title' in documentImportSchema.options.properties, true)
    assert.equal('occurredAt' in documentImportSchema.options.properties, true)
    assert.equal('note' in documentImportSchema.options.properties, true)
    assert.equal('source' in documentImportSchema.options.properties, true)
    assert.deepEqual(documentImportSchema.options.required ?? [], ['reuseExact'])

    assert.equal('from' in documentListSchema.options.properties, true)
    assert.equal('to' in documentListSchema.options.properties, true)
    assert.equal('limit' in documentListSchema.options.properties, true)
    assert.equal('kind' in documentListSchema.options.properties, false)
    assert.deepEqual(documentListSchema.options.required ?? [], ['limit'])

    assert.equal('input' in documentEditSchema.options.properties, false)
    assert.equal('set' in documentEditSchema.options.properties, false)
    assert.equal('clear' in documentEditSchema.options.properties, false)
    assert.equal('title' in documentEditSchema.options.properties, true)
    assert.equal('note' in documentEditSchema.options.properties, true)
    assert.equal('dayKeyPolicy' in documentEditSchema.options.properties, true)
    assert.deepEqual(documentEditSchema.options.required ?? [], [])
    assert.deepEqual(documentDeleteSchema.options.required ?? [], [])

    assert.equal('input' in mealAddSchema.options.properties, false)
    assert.equal('source' in mealAddSchema.options.properties, true)
    assert.deepEqual([...(mealAddSchema.options.required ?? [])].sort(), [])

    assert.equal('input' in mealImportJsonSchema.options.properties, true)
    assert.equal('source' in mealImportJsonSchema.options.properties, true)
    assert.match(
      String((mealImportJsonSchema.options.properties.input as { description?: unknown }).description),
      /Structured meal payload in @file\.json form or - for stdin/u,
    )
    assert.equal('input' in mealEditSchema.options.properties, false)
    assert.equal('set' in mealEditSchema.options.properties, false)
    assert.equal('clear' in mealEditSchema.options.properties, false)
    assert.equal('ingredient' in mealEditSchema.options.properties, true)
    assert.equal('nutritionCalories' in mealEditSchema.options.properties, true)
    assert.equal('dayKeyPolicy' in mealEditSchema.options.properties, true)
    assert.match(
      String((mealImportJsonSchema.options.properties.input as { description?: unknown }).description),
      /Structured payload object keys:.*ingredients.*nutrition/u,
    )
    assert.deepEqual([...(mealImportJsonSchema.options.required ?? [])].sort(), [
      'input',
    ])

    assert.equal('input' in mealEditSchema.options.properties, false)
    assert.equal('set' in mealEditSchema.options.properties, false)
    assert.equal('clear' in mealEditSchema.options.properties, false)
    assert.equal('dayKeyPolicy' in mealEditSchema.options.properties, true)
    assert.deepEqual(mealEditSchema.options.required ?? [], [])
    assert.deepEqual(mealDeleteSchema.options.required ?? [], [])

    assert.equal('from' in mealListSchema.options.properties, true)
    assert.equal('limit' in mealListSchema.options.properties, true)
    assert.equal('to' in mealListSchema.options.properties, true)
    assert.equal('kind' in mealListSchema.options.properties, false)
    assert.deepEqual(mealListSchema.options.required, ['limit'])
    assert.equal('from' in mealTotalsSchema.options.properties, true)
    assert.equal('to' in mealTotalsSchema.options.properties, true)
    assert.deepEqual(mealTotalsSchema.options.required ?? [], [])
  },
  DOCUMENT_MEAL_SCHEMA_TIMEOUT_MS,
)

test('meal import-json help documents the structured payload path and override rule', async () => {
  const help = await runRawSourceCli(['meal', 'import-json', '--help'])

  assert.match(help, /--input/u)
  assert.match(help, /--input @meal\.json/u)
  assert.match(help, /Explicit flags.*override payload fields/u)
  assert.match(help, /structured JSON payload file or stdin/u)
  assert.match(help, /--ingredient/u)
  assert.match(help, /--nutrition-calories/u)
  assert.match(help, /Structured payload object keys:/u)
  assert.match(help, /sourceDetail/u)
})

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
      assert.equal(requireData(listedDocuments).filters.limit, 10)
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
      assert.match(requireData(manifest).manifestFile, /\/manifest(?:\.[^/]+)*\.json$/u)
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
        '--title',
        'Updated Lab Report',
        '--note',
        'Reviewed with PCP.',
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
        '--note',
        'Green smoothie after training.',
        '--ingredient',
        'spinach',
        '--ingredient',
        'banana',
        '--ingredient',
        'greek yogurt',
        '--nutrition-calories',
        '430',
        '--nutrition-protein-grams',
        '32',
        '--nutrition-carbs-grams',
        '46',
        '--nutrition-fat-grams',
        '14',
        '--nutrition-fiber-grams',
        '9',
        '--nutrition-source',
        'estimated',
        '--nutrition-confidence',
        'medium',
        '--nutrition-source-detail',
        'Recipe estimate',
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
      assert.deepEqual(requireData(editedMeal).entity.data.nutrition, {
        totals: {
          calories: 430,
          proteinGrams: 32,
          carbsGrams: 46,
          fatGrams: 14,
          fiberGrams: 9,
        },
        provenance: {
          source: 'estimated',
          confidence: 'medium',
          sourceDetail: 'Recipe estimate',
        },
      })

      const mealTotals = await runSourceCli<MealTotalsEnvelope>([
        'meal',
        'totals',
        '--from',
        '2026-03-12',
        '--to',
        '2026-03-12',
        '--vault',
        vaultRoot,
      ])
      assert.equal(mealTotals.ok, true)
      assert.equal(mealTotals.meta?.command, 'meal totals')
      assert.deepEqual(requireData(mealTotals).filters, {
        from: '2026-03-12',
        to: '2026-03-12',
      })
      assert.equal(requireData(mealTotals).mealCount, 1)
      assert.deepEqual(requireData(mealTotals).totals, {
        calories: { total: 430, mealCount: 1 },
        proteinGrams: { total: 32, mealCount: 1 },
        carbsGrams: { total: 46, mealCount: 1 },
        fatGrams: { total: 14, mealCount: 1 },
        fiberGrams: { total: 9, mealCount: 1 },
      })
      assert.deepEqual(requireData(mealTotals).days, [
        {
          date: '2026-03-12',
          mealCount: 1,
          totals: {
            calories: { total: 430, mealCount: 1 },
            proteinGrams: { total: 32, mealCount: 1 },
            carbsGrams: { total: 46, mealCount: 1 },
            fatGrams: { total: 14, mealCount: 1 },
            fiberGrams: { total: 9, mealCount: 1 },
          },
        },
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
      const whitespaceOnlyMeal = await runSourceCli([
        'meal',
        'add',
        '--note',
        '   ',
        '--vault',
        vaultRoot,
      ])
      assert.equal(whitespaceOnlyMeal.ok, false)
      assert.equal(whitespaceOnlyMeal.error?.code, 'VALIDATION_ERROR')
      assert.match(whitespaceOnlyMeal.error?.message ?? '', /Too small/u)

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
      assert.equal(requireData(listedMeals).filters.limit, 10)
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

      const limitedMeals = await runSourceCli<ListEnvelope>([
        'meal',
        'list',
        '--limit',
        '1',
        '--vault',
        vaultRoot,
      ])
      assert.equal(limitedMeals.ok, true)
      assert.equal(requireData(limitedMeals).filters.limit, 1)
      assert.equal(requireData(limitedMeals).count, 1)
      assert.equal(
        [currentMeal.mealId, olderMeal.mealId].includes(
          requireData(limitedMeals).items[0]?.id ?? '',
        ),
        true,
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
      assert.match(requireData(manifest).manifestFile, /\/manifest(?:\.[^/]+)*\.json$/u)
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

test.sequential(
  'meal import-json accepts structured payloads with ingredients and nutrition only',
  async () => {
    const vaultRoot = await createVault()
    const payloadPath = path.join(vaultRoot, 'meal-structured.json')

    try {
      await writeFile(
        payloadPath,
        JSON.stringify({
          occurredAt: '2026-03-14T08:30:00Z',
          source: 'manual',
          ingredients: ['rolled oats', 'blueberries', 'chia seeds'],
          nutrition: {
            totals: {
              calories: 390,
              proteinGrams: 15,
              carbsGrams: 56,
              fatGrams: 11,
              fiberGrams: 12,
            },
            provenance: {
              source: 'estimated',
              confidence: 'medium',
              sourceDetail: 'Recipe estimate',
            },
          },
        }),
        'utf8',
      )

      const createdMeal = await runSourceCli<MealAddEnvelope>([
        'meal',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])
      assert.equal(createdMeal.ok, true)
      assert.equal(createdMeal.meta?.command, 'meal import-json')
      assert.equal(requireData(createdMeal).occurredAt, '2026-03-14T08:30:00.000Z')
      assert.equal(requireData(createdMeal).note, null)
      assert.equal(requireData(createdMeal).source, 'manual')
      assert.deepEqual(requireData(createdMeal).ingredients, [
        'rolled oats',
        'blueberries',
        'chia seeds',
      ])
      assert.deepEqual(requireData(createdMeal).nutrition, {
        totals: {
          calories: 390,
          proteinGrams: 15,
          carbsGrams: 56,
          fatGrams: 11,
          fiberGrams: 12,
        },
        provenance: {
          source: 'estimated',
          confidence: 'medium',
          sourceDetail: 'Recipe estimate',
        },
      })

      const shownMeal = await runSourceCli<ShowEnvelope>([
        'meal',
        'show',
        requireData(createdMeal).mealId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shownMeal.ok, true)
      assert.equal(
        requireData(shownMeal).entity.occurredAt,
        '2026-03-14T08:30:00.000Z',
      )
      assert.equal(requireData(shownMeal).entity.data.note, undefined)
      assert.equal(requireData(shownMeal).entity.data.source, 'manual')
      assert.deepEqual(requireData(shownMeal).entity.data.ingredients, [
        'rolled oats',
        'blueberries',
        'chia seeds',
      ])
      assert.deepEqual(requireData(shownMeal).entity.data.nutrition, {
        totals: {
          calories: 390,
          proteinGrams: 15,
          carbsGrams: 56,
          fatGrams: 11,
          fiberGrams: 12,
        },
        provenance: {
          source: 'estimated',
          confidence: 'medium',
          sourceDetail: 'Recipe estimate',
        },
      })
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
  60_000,
)

test.sequential(
  'meal import-json lets explicit flags override structured payload fields',
  async () => {
    const vaultRoot = await createVault()

    try {
      const overriddenMeal = await runSourceCli<MealAddEnvelope>(
        [
          'meal',
          'import-json',
          '--input',
          '-',
          '--note',
          'Override note from flags.',
          '--occurred-at',
          '2026-03-15T13:45:00Z',
          '--source',
          'derived',
          '--vault',
          vaultRoot,
        ],
        {
          stdin: JSON.stringify({
            note: 'Payload note that should be replaced.',
            occurredAt: '2026-03-15T08:00:00Z',
            source: 'import',
            ingredients: ['salmon', 'rice', 'broccoli'],
            nutrition: {
              totals: {
                calories: 610,
                proteinGrams: 42,
                carbsGrams: 51,
                fatGrams: 22,
                fiberGrams: 8,
              },
              provenance: {
                source: 'label',
                confidence: 'high',
                sourceDetail: 'Packaged meal label',
              },
            },
          }),
        },
      )

      assert.equal(overriddenMeal.ok, true)
      assert.equal(requireData(overriddenMeal).occurredAt, '2026-03-15T13:45:00.000Z')
      assert.equal(requireData(overriddenMeal).note, 'Override note from flags.')
      assert.equal(requireData(overriddenMeal).source, 'derived')
      assert.deepEqual(requireData(overriddenMeal).ingredients, [
        'salmon',
        'rice',
        'broccoli',
      ])
      assert.deepEqual(requireData(overriddenMeal).nutrition, {
        totals: {
          calories: 610,
          proteinGrams: 42,
          carbsGrams: 51,
          fatGrams: 22,
          fiberGrams: 8,
        },
        provenance: {
          source: 'label',
          confidence: 'high',
          sourceDetail: 'Packaged meal label',
        },
      })

      const shownMeal = await runSourceCli<ShowEnvelope>([
        'meal',
        'show',
        requireData(overriddenMeal).mealId,
        '--vault',
        vaultRoot,
      ])
      assert.equal(shownMeal.ok, true)
      assert.equal(
        requireData(shownMeal).entity.occurredAt,
        '2026-03-15T13:45:00.000Z',
      )
      assert.equal(requireData(shownMeal).entity.data.note, 'Override note from flags.')
      assert.equal(requireData(shownMeal).entity.data.source, 'derived')
      assert.deepEqual(requireData(shownMeal).entity.data.ingredients, [
        'salmon',
        'rice',
        'broccoli',
      ])
      assert.deepEqual(requireData(shownMeal).entity.data.nutrition, {
        totals: {
          calories: 610,
          proteinGrams: 42,
          carbsGrams: 51,
          fatGrams: 22,
          fiberGrams: 8,
        },
        provenance: {
          source: 'label',
          confidence: 'high',
          sourceDetail: 'Packaged meal label',
        },
      })
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
  60_000,
)

test.sequential(
  'meal import-json rejects an empty structured payload',
  async () => {
    const vaultRoot = await createVault()
    const payloadPath = path.join(vaultRoot, 'meal-empty.json')

    try {
      await writeFile(payloadPath, JSON.stringify({}), 'utf8')

      const result = await runSourceCli([
        'meal',
        'import-json',
        '--input',
        `@${payloadPath}`,
        '--vault',
        vaultRoot,
      ])

      assert.equal(result.ok, false)
      assert.equal(result.error?.code, 'invalid_option')
      assert.match(
        result.error?.message ?? '',
        /Meal capture requires --photo, --audio, --note, --ingredient, nutrition options, or meal import-json --input @meal\.json with ingredients and\/or nutrition\./u,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
  60_000,
)
