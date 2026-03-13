import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

interface CliResult<TData = Record<string, unknown>> {
  ok: boolean
  data?: TData
  error?: {
    code?: string
  }
}

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

const execFileAsync = promisify(execFile)
const packageDir = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = path.resolve(packageDir, '../..')
const binPath = path.join(packageDir, 'dist/bin.js')
const sampleDocumentPath = path.join(
  repoRoot,
  'fixtures/sample-imports/README.md',
)

async function runCli<TData = Record<string, unknown>>(
  args: string[],
): Promise<CliResult<TData>> {
  const { stdout } = await execFileAsync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
  })

  return JSON.parse(stdout) as CliResult<TData>
}

function requireData<TData>(result: CliResult<TData>): TData {
  if (result.data === undefined) {
    throw new Error('CLI result did not include a data payload.')
  }

  return result.data
}

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

  await runCli(['init', '--vault', vaultRoot, '--format', 'json'])

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
      '--format',
      'json',
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
      '--format',
      'json',
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
      '--format',
      'json',
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
      '--format',
      'json',
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
  }>(['init', '--vault', vaultRoot, '--format', 'json'])
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
      }>([
        'document',
        'import',
        sampleDocumentPath,
        '--vault',
        fixture.vaultRoot,
        '--format',
        'json',
      ])
      assert.equal(document.ok, true)
      assert.match(requireData(document).documentId, /^doc_/u)
      assert.match(requireData(document).lookupId, /^evt_/u)
      assert.equal(requireData(document).rawFile.length > 0, true)

      const samples = await runCli<{
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
        '--format',
        'json',
      ])
      assert.equal(samples.ok, true)
      assert.equal(requireData(samples).lookupIds.length, 2)
      assert.equal(requireData(samples).ledgerFiles.length > 0, true)
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'show enforces non-queryable related ids and accepts returned lookup ids',
  async () => {
    const fixture = await makeFixtureVault()

    try {
      const showDocument = await runCli<{
        entity: {
          kind: string
        }
      }>([
        'show',
        fixture.document.lookupId,
        '--vault',
        fixture.vaultRoot,
        '--format',
        'json',
      ])
      assert.equal(showDocument.ok, true)
      assert.equal(requireData(showDocument).entity.kind, 'document')

      const showJournal = await runCli<{
        entity: {
          kind: string
        }
      }>([
        'show',
        fixture.journal.lookupId,
        '--vault',
        fixture.vaultRoot,
        '--format',
        'json',
      ])
      assert.equal(showJournal.ok, true)
      assert.equal(requireData(showJournal).entity.kind, 'journal_day')

      const showSample = await runCli<{
        entity: {
          kind: string
        }
      }>([
        'show',
        fixture.samples.lookupIds[0],
        '--vault',
        fixture.vaultRoot,
        '--format',
        'json',
      ])
      assert.equal(showSample.ok, true)
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
          '--format',
          'json',
        ])
        assert.equal(result.ok, false)
        assert.equal(result.error?.code, 'invalid_lookup_id')
      }
    } finally {
      await rm(fixture.vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential('export pack materializes the derived five-file pack when --out is set', async () => {
  const fixture = await makeFixtureVault()
  const outDir = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-export-'))

  try {
    const result = await runCli<{
      files: string[]
    }>([
      'export',
      'pack',
      '--from',
      '2026-03-12',
      '--to',
      '2026-03-12',
      '--out',
      outDir,
      '--vault',
      fixture.vaultRoot,
      '--format',
      'json',
    ])

    assert.equal(result.ok, true)
    assert.equal(requireData(result).files.length, 5)

    for (const relativePath of requireData(result).files) {
      await access(path.join(outDir, relativePath))
    }
  } finally {
    await rm(outDir, { recursive: true, force: true })
    await rm(fixture.vaultRoot, { recursive: true, force: true })
  }
})
