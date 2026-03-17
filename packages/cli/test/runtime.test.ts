import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { repoRoot, requireData, runCli } from './cli-test-helpers.js'
import './cli-expansion-document-meal.test.js'
import './cli-expansion-experiment-journal-vault.test.js'
import './cli-expansion-experiment-journal-vault-phase2.test.js'
import './cli-expansion-export-intake.test.js'
import './cli-expansion-inbox-attachments.test.js'
import './cli-expansion-provider-event-samples.test.js'
import './cli-expansion-samples-audit.test.js'

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
  samples: {
    lookupIds: string[]
    transformId: string
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
const runtimeCliTestTimeoutMs = 20_000

async function makeFixtureVault(): Promise<FixtureVault> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-test-'))
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
  const samples = requireData(
    await runCli<{
      lookupIds: string[]
      transformId: string
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

  return {
    vaultRoot,
    document,
    meal,
    journal,
    samples,
  }
}

async function makeEmptyVaultFixture(): Promise<EmptyVaultFixture> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-test-'))
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

test.sequential(
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
      assert.match(requireData(document).lookupId, /^evt_/u)
      assert.equal(requireData(document).rawFile.length > 0, true)
      assert.equal(requireData(document).manifestFile.length > 0, true)
      await access(path.join(fixture.vaultRoot, requireData(document).manifestFile))

      const meal = await runCli<{
        mealId: string
        manifestFile: string
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
      assert.equal(requireData(meal).manifestFile.length > 0, true)
      await access(path.join(fixture.vaultRoot, requireData(meal).manifestFile))

      const samples = await runCli<{
        lookupIds: string[]
        ledgerFiles: string[]
        manifestFile: string
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
      assert.equal(requireData(samples).manifestFile.length > 0, true)
      await access(path.join(fixture.vaultRoot, requireData(samples).manifestFile))
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
  runtimeCliTestTimeoutMs,
)

test.sequential(
  'show enforces non-queryable related ids and accepts returned lookup ids',
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

      const showSample = await runCli<{
        entity: {
          id: string
          kind: string
        }
      }>([
        'show',
        fixture.samples.lookupIds[0],
        '--vault',
        fixture.vaultRoot,
      ])
      assert.equal(showSample.ok, true)
      assert.equal(requireData(showSample).entity.id, fixture.samples.lookupIds[0])
      assert.equal(requireData(showSample).entity.kind, 'sample')

      for (const invalidId of [
        fixture.meal.mealId,
        fixture.document.documentId,
        fixture.samples.transformId,
        'pack_placeholder',
      ]) {
        const result = await runCli([
          'show',
          invalidId,
          '--vault',
          fixture.vaultRoot,
        ])
        assert.equal(result.ok, false)
        assert.equal(result.error?.code, 'invalid_lookup_id')
        assert.equal(result.meta?.command, 'show')
      }
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
  runtimeCliTestTimeoutMs,
)

test.sequential(
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

test.sequential(
  'export pack materializes the derived five-file pack when --out is set',
  async () => {
    const fixture = await makeFixtureVault()
    const outDir = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-export-'))

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
  runtimeCliTestTimeoutMs,
)
