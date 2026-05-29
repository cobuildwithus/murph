import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { createRuntimeUnavailableError } from '@murphai/vault-usecases/runtime'
import {
  ensureCliRuntimeArtifactsWithOptions,
  repoRoot,
  requireData,
  runCli,
} from './cli-test-helpers.js'

interface FixtureVault {
  vaultRoot: string
  document: {
    documentId: string
    lookupId: string
  }
  meal: {
    mealId: string
  }
  journal: {
    lookupId: string
  }
  metricSample: {
    id: string
  }
  samples: {
    lookupIds: string[]
  }
}

interface EmptyVaultFixture {
  vaultRoot: string
  csvPath: string
}

const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)
const runtimeCliTestTimeoutMs = 60_000
const exportPackCliTestTimeoutMs = 180_000

test('runtime unavailable error preserves the shared vault runtime guidance payload', () => {
  const result = createRuntimeUnavailableError(
    'samples/audit query reads',
    new Error('module missing'),
  )

  assert.equal(result.code, 'runtime_unavailable')
  assert.equal(
    result.message,
    'Local runtime for samples/audit query reads is unavailable until the integrating workspace installs incur and links @murphai/core, @murphai/importers, and @murphai/query.',
  )
  assert.deepEqual(result.context, {
    cause: 'module missing',
    packages: [
      '@murphai/core',
      '@murphai/importers',
      '@murphai/query',
      'incur',
    ],
  })
})

async function makeFixtureVault(): Promise<FixtureVault> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-test-'))
  const csvPath = path.join(vaultRoot, 'samples.csv')
  const metricSampleId = 'smp_cli_metric_heart_rate_summary'

  await writeFile(
    csvPath,
    [
      'timestamp,bpm',
      '2026-03-12T08:00:00Z,61',
      '2026-03-12T08:01:00Z,63',
      '',
    ].join('\n'),
    'utf8',
  )

  await runCli(['init', '--vault', vaultRoot])

  const document = requireData(
    await runCli<{
      documentId: string
      lookupId: string
    }>([
      'document',
      'import',
      sampleDocumentPath,
      '--vault',
      vaultRoot,
    ]),
  )
  const meal = requireData(
    await runCli<{
      mealId: string
    }>([
      'meal',
      'add',
      '--photo',
      sampleDocumentPath,
      '--vault',
      vaultRoot,
    ]),
  )
  const journal = requireData(
    await runCli<{
      lookupId: string
    }>([
      'journal',
      'ensure',
      '2026-03-12',
      '--vault',
      vaultRoot,
    ]),
  )
  await ensureCliRuntimeArtifactsWithOptions({ forceReverify: true })
  const samples = requireData(
    await runCli<{
      imports: Array<{
        transformId: string | null
      }>
      lookupIds: string[]
    }>([
      'samples',
      'import-csv',
      csvPath,
      '--stream',
      'heart_rate',
      '--ts-column',
      'timestamp',
      '--value-column',
      'bpm',
      '--unit',
      'bpm',
      '--vault',
      vaultRoot,
    ]),
  )
  await writeVaultFile(
    vaultRoot,
    'ledger/metric-samples/heart_rate/2026/2026-03.jsonl',
    [
      JSON.stringify({
        schemaVersion: 'murph.metric-sample.v1',
        id: metricSampleId,
        metric: 'heart_rate',
        recordedAt: '2026-03-12T21:00:00.000Z',
        dayKey: '2026-03-12',
        source: 'manual',
        quality: 'normalized',
        qualifiers: { summary: true },
        value: 69,
        unit: 'bpm',
      }),
      '',
    ].join('\n'),
    'utf8',
  )

  return {
    vaultRoot,
    document,
    meal,
    journal,
    metricSample: {
      id: metricSampleId,
    },
    samples,
  }
}

async function writeVaultFile(
  vaultRoot: string,
  relativePath: string,
  contents: string,
  encoding: BufferEncoding = 'utf8',
) {
  await mkdir(path.dirname(path.join(vaultRoot, relativePath)), {
    recursive: true,
  })
  await writeFile(path.join(vaultRoot, relativePath), contents, encoding)
}

async function makeEmptyVaultFixture(): Promise<EmptyVaultFixture> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-test-'))
  const csvPath = path.join(vaultRoot, 'samples.csv')

  await writeFile(
    csvPath,
    [
      'timestamp,bpm',
      '2026-03-12T08:00:00Z,61',
      '2026-03-12T08:01:00Z,63',
      '',
    ].join('\n'),
    'utf8',
  )

  const initResult = await runCli<{
    created: boolean
  }>(['init', '--vault', vaultRoot])
  assert.equal(initResult.ok, true)
  assert.equal(requireData(initResult).created, true)

  return {
    vaultRoot,
    csvPath,
  }
}

test(
  'importer-backed CLI commands return direct runtime payloads',
  async () => {
    const fixture = await makeEmptyVaultFixture()

    try {
      const document = await runCli<{
        documentId: string
        lookupId: string
        rawFile: string
        manifestFile: string
      }>([
        'document',
        'import',
        sampleDocumentPath,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(document.ok, true)
      assert.equal(document.meta?.command, 'document import')
      assert.match(requireData(document).documentId, /^doc_/u)
      assert.equal(requireData(document).lookupId, requireData(document).documentId)
      assert.equal(requireData(document).rawFile.length > 0, true)
      assert.equal(requireData(document).manifestFile.length > 0, true)
      await access(path.join(fixture.vaultRoot, requireData(document).manifestFile))

      const meal = await runCli<{
        mealId: string
        lookupId: string
        manifestFile: string
        source: string | null
        ingredients: string[] | null
        nutrition: Record<string, unknown> | null
      }>([
        'meal',
        'add',
        '--photo',
        sampleDocumentPath,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(meal.ok, true)
      assert.equal(meal.meta?.command, 'meal add')
      assert.match(requireData(meal).mealId, /^meal_/u)
      assert.equal(requireData(meal).lookupId, requireData(meal).mealId)
      assert.equal(requireData(meal).manifestFile.length > 0, true)
      assert.equal(requireData(meal).source, 'manual')
      assert.equal(requireData(meal).ingredients, null)
      assert.equal(requireData(meal).nutrition, null)
      await access(path.join(fixture.vaultRoot, requireData(meal).manifestFile))

      const noteOnlyMeal = await runCli<{
        mealId: string
        manifestFile: string
        photoPath: string | null
        note: string | null
        source: string | null
        ingredients: string[] | null
        nutrition: Record<string, unknown> | null
      }>([
        'meal',
        'add',
        '--note',
        'Coffee and toast.',
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(noteOnlyMeal.ok, true)
      assert.equal(noteOnlyMeal.meta?.command, 'meal add')
      assert.match(requireData(noteOnlyMeal).mealId, /^meal_/u)
      assert.equal(requireData(noteOnlyMeal).photoPath, null)
      assert.equal(requireData(noteOnlyMeal).note, 'Coffee and toast.')
      assert.equal(requireData(noteOnlyMeal).source, 'manual')
      assert.equal(requireData(noteOnlyMeal).ingredients, null)
      assert.equal(requireData(noteOnlyMeal).nutrition, null)
      assert.equal(requireData(noteOnlyMeal).manifestFile.length > 0, true)
      await access(path.join(fixture.vaultRoot, requireData(noteOnlyMeal).manifestFile))

      const mealPayloadPath = path.join(fixture.vaultRoot, 'meal.json')
      await writeFile(
        mealPayloadPath,
        JSON.stringify({
          note: 'Salmon rice bowl.',
          source: 'derived',
          ingredients: ['salmon', 'rice'],
          nutrition: {
            totals: {
              calories: 690,
              proteinGrams: 42,
            },
            provenance: {
              source: 'estimated',
              confidence: 'medium',
            },
          },
        }),
        'utf8',
      )

      const structuredMeal = await runCli<{
        mealId: string
        note: string | null
        source: string | null
        ingredients: string[] | null
        nutrition: {
          totals?: Record<string, number>
          provenance?: Record<string, string>
        } | null
      }>([
        'meal',
        'import-json',
        '--input',
        `@${mealPayloadPath}`,
        '--note',
        'Salmon rice bowl with extra lemon.',
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(structuredMeal.ok, true)
      assert.equal(requireData(structuredMeal).note, 'Salmon rice bowl with extra lemon.')
      assert.equal(requireData(structuredMeal).source, 'derived')
      assert.deepEqual(requireData(structuredMeal).ingredients, ['salmon', 'rice'])
      assert.deepEqual(requireData(structuredMeal).nutrition, {
        totals: {
          calories: 690,
          proteinGrams: 42,
        },
        provenance: {
          source: 'estimated',
          confidence: 'medium',
        },
      })

      const samples = await runCli<{
        imports: Array<{
          manifestFile: string | null
        }>
        lookupIds: string[]
        ledgerFiles: string[]
      }>([
        'samples',
        'import-csv',
        fixture.csvPath,
        '--stream',
        'heart_rate',
        '--ts-column',
        'timestamp',
        '--value-column',
        'bpm',
        '--unit',
        'bpm',
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(samples.ok, true)
      assert.equal(samples.meta?.command, 'samples import-csv')
      assert.equal(requireData(samples).lookupIds.length, 2)
      assert.equal(requireData(samples).ledgerFiles.length > 0, true)
      assert.equal(String(requireData(samples).imports[0]?.manifestFile).length > 0, true)
      await access(path.join(fixture.vaultRoot, requireData(samples).imports[0]?.manifestFile ?? ''))
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
  runtimeCliTestTimeoutMs,
)

test(
  'show accepts canonical family ids and still rejects non-record ids',
  async () => {
    const fixture = await makeFixtureVault()

    try {
      const showDocument = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'show',
        fixture.document.lookupId,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showDocument.ok, true)
      assert.equal(showDocument.meta?.command, 'show')
      assert.equal(requireData(showDocument).entity.id, fixture.document.documentId)
      assert.equal(requireData(showDocument).entity.kind, 'document')

      const showJournal = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'show',
        fixture.journal.lookupId,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showJournal.ok, true)
      assert.equal(requireData(showJournal).entity.id, fixture.journal.lookupId)
      assert.equal(requireData(showJournal).entity.kind, 'journal_day')

      const showRawSample = await runCli([
        'show',
        fixture.samples.lookupIds[0],
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showRawSample.ok, false)
      assert.equal(showRawSample.error?.code, 'not_found')

      const showRawSampleViaSamplesCommand = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'samples',
        'show',
        fixture.samples.lookupIds[0],
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showRawSampleViaSamplesCommand.ok, true)
      assert.equal(requireData(showRawSampleViaSamplesCommand).entity.id, fixture.samples.lookupIds[0])
      assert.equal(requireData(showRawSampleViaSamplesCommand).entity.kind, 'sample')

      const showMetricSample = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'show',
        fixture.metricSample.id,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showMetricSample.ok, true)
      assert.equal(requireData(showMetricSample).entity.id, fixture.metricSample.id)
      assert.equal(requireData(showMetricSample).entity.kind, 'metric_sample')

      const showMeal = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'show',
        fixture.meal.mealId,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showMeal.ok, true)
      assert.equal(showMeal.meta?.command, 'show')
      assert.equal(requireData(showMeal).entity.id, fixture.meal.mealId)
      assert.equal(requireData(showMeal).entity.kind, 'meal')

      const showDocumentByFamilyId = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'show',
        fixture.document.documentId,
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showDocumentByFamilyId.ok, true)
      assert.equal(showDocumentByFamilyId.meta?.command, 'show')
      assert.equal(requireData(showDocumentByFamilyId).entity.id, fixture.document.documentId)
      assert.equal(requireData(showDocumentByFamilyId).entity.kind, 'document')

      const invalidLookups = [
        [
          'xfm_placeholder',
          'Transform ids identify an import batch, not a query-layer record. Use returned sample ids with `samples show` or inspect them with `samples list` instead.',
        ],
        [
          'pack_placeholder',
          'Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`.',
        ],
      ] as const

      for (const [invalidId, expectedMessage] of invalidLookups) {
        const result = await runCli([
          'show',
          invalidId,
          '--vault',
          fixture.vaultRoot,
        ])
        assert.equal(result.ok, false)
        assert.equal(result.error?.code, 'invalid_lookup_id')
        assert.equal(result.error?.message, expectedMessage)
        assert.equal(result.meta?.command, 'show')
      }
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
  runtimeCliTestTimeoutMs,
)

test(
  'full CLI registers audit tail/show and reads init-created audit entries',
  async () => {
    const fixture = await makeEmptyVaultFixture()

    try {
      const tailResult = await runCli<{
        items: Array<{
          id: string
          kind: string
        }>
      }>([
        'audit',
        'tail',
        '--vault',
        fixture.vaultRoot,
      ])

      assert.equal(tailResult.ok, true)
      assert.equal(tailResult.meta?.command, 'audit tail')
      assert.equal(requireData(tailResult).items.length >= 1, true)
      assert.equal(requireData(tailResult).items[0]?.kind, 'audit')

      const firstAuditId = requireData(tailResult).items[0]?.id
      assert.equal(typeof firstAuditId, 'string')

      const showResult = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'audit',
        'show',
        firstAuditId as string,
        '--vault',
        fixture.vaultRoot,
      ])

      assert.equal(showResult.ok, true)
      assert.equal(showResult.meta?.command, 'audit show')
      assert.equal(requireData(showResult).entity.id, firstAuditId)
      assert.equal(requireData(showResult).entity.kind, 'audit')
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
  runtimeCliTestTimeoutMs,
)

test(
  'export pack materializes the derived five-file pack when --out is set',
  async () => {
    const fixture = await makeFixtureVault()
    const outDir = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-'))

    try {
      const result = await runCli<{
        files: string[]
      }>([
        'export',
        'pack',
        'create',
        '--from',
        '2026-03-12',
        '--to',
        '2026-03-12',
        '--out',
        outDir,
        '--vault',
        fixture.vaultRoot,
      ])

      assert.equal(result.ok, true)
      assert.equal(result.meta?.command, 'export pack create')
      assert.equal(requireData(result).files.length, 5)

      for (const relativePath of requireData(result).files) {
        await access(path.join(outDir, relativePath))
      }
    } finally {
      await rm(outDir, { recursive: true, force: true })
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
  exportPackCliTestTimeoutMs,
)
