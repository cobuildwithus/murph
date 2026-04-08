import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { initializeVault } from '@murphai/core'
import { buildExportPack, readVault } from '@murphai/query'
import { Cli } from 'incur'
import { test } from 'vitest'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { registerExportCommands } from '../src/commands/export.js'
import {
  materializeStoredExportPack,
  pruneStoredExportPack,
  showAssessmentRaw,
  showStoredExportPack,
} from '../src/commands/export-intake-read-helpers.js'
import { registerIntakeCommands } from '../src/commands/intake.js'
import { materializeExportPack } from '@murphai/vault-usecases/helpers'
import {
  createIntegratedVaultServices,
  createUnwiredVaultServices,
} from '@murphai/vault-usecases'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

function createSliceCli() {
  const cli = Cli.create('vault-cli', {
    description: 'export/intake slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createUnwiredVaultServices()

  registerExportCommands(cli, services)
  registerIntakeCommands(cli, services)

  return cli
}

async function runSliceCli<TData>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

async function runRawSliceCli(args: string[]): Promise<string> {
  const cli = createSliceCli()
  const output: string[] = []

  await cli.serve(args, {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test('intake import schema exposes the richer importer-backed metadata options', async () => {
  const schema = JSON.parse(
    await runRawSliceCli(['intake', 'import', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
      required?: string[]
    }
  }

  assert.equal('title' in schema.options.properties, true)
  assert.equal('occurredAt' in schema.options.properties, true)
  assert.equal('importedAt' in schema.options.properties, true)
  assert.equal('source' in schema.options.properties, true)
  assert.deepEqual(schema.options.required, ['vault'])
})

test('intake and export pack help use generic id selectors plus from/to list filters', async () => {
  const intakeShowHelp = await runRawSliceCli(['intake', 'show', '--help'])
  const intakeListSchema = JSON.parse(
    await runRawSliceCli(['intake', 'list', '--schema', '--format', 'json']),
  ) as {
    options: {
      properties: Record<string, unknown>
    }
  }
  const exportPackShowHelp = await runRawSliceCli(['export', 'pack', 'show', '--help'])
  const exportPackMaterializeHelp = await runRawSliceCli([
    'export',
    'pack',
    'materialize',
    '--help',
  ])

  assert.match(intakeShowHelp, /Usage: vault-cli intake show <id> \[options\]/u)
  assert.equal('from' in intakeListSchema.options.properties, true)
  assert.equal('to' in intakeListSchema.options.properties, true)
  assert.equal('dateFrom' in intakeListSchema.options.properties, false)
  assert.equal('dateTo' in intakeListSchema.options.properties, false)
  assert.match(exportPackShowHelp, /Usage: vault-cli export pack show <id> \[options\]/u)
  assert.match(
    exportPackMaterializeHelp,
    /Usage: vault-cli export pack materialize <id> \[options\]/u,
  )
})

test.sequential(
  'intake import forwards richer metadata and exposes manifest/raw follow-up commands',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-'))
    const assessmentPath = path.join(vaultRoot, 'assessment.json')

    try {
      await initializeVault({ vaultRoot })
      await writeFile(
        assessmentPath,
        JSON.stringify({
          questionnaireSlug: 'baseline-intake',
          responses: {
            sleep: {
              averageHours: 7,
            },
            symptoms: ['fatigue'],
          },
        }),
        'utf8',
      )

      const imported = await runSliceCli<{
        assessmentId: string
        manifestFile: string
        rawFile: string
      }>([
        'intake',
        'import',
        assessmentPath,
        '--vault',
        vaultRoot,
        '--title',
        'Baseline Intake',
        '--occurred-at',
        '2026-03-11T08:15:00Z',
        '--imported-at',
        '2026-03-12T09:45:00Z',
        '--source',
        'manual',
      ])

      assert.equal(imported.ok, true)
      assert.equal(imported.meta?.command, 'intake import')
      assert.match(requireData(imported).assessmentId, /^asmt_/u)

      const manifestResult = await runSliceCli<{
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
            title?: string
            lookupId?: string
          }
        }
      }>([
        'intake',
        'manifest',
        requireData(imported).assessmentId,
        '--vault',
        vaultRoot,
      ])
      const rawResult = await runSliceCli<{
        entityId: string
        lookupId: string
        kind: string
        rawFile: string
        mediaType: string
        raw: {
          questionnaireSlug?: string
          responses?: {
            sleep?: {
              averageHours?: number
            }
          }
        }
      }>([
        'intake',
        'raw',
        requireData(imported).assessmentId,
        '--vault',
        vaultRoot,
      ])

      assert.equal(manifestResult.ok, true)
      assert.equal(manifestResult.meta?.command, 'intake manifest')
      assert.equal(requireData(manifestResult).entityId, requireData(imported).assessmentId)
      assert.equal(requireData(manifestResult).lookupId, requireData(imported).assessmentId)
      assert.equal(requireData(manifestResult).kind, 'assessment')
      assert.equal(requireData(manifestResult).manifestFile, requireData(imported).manifestFile)
      assert.equal(requireData(manifestResult).manifest.schemaVersion, 'murph.raw-import-manifest.v2')
      assert.equal(requireData(manifestResult).manifest.importId, requireData(imported).assessmentId)
      assert.equal(requireData(manifestResult).manifest.importKind, 'assessment')
      assert.deepEqual(requireData(manifestResult).manifest.owner, {
        kind: 'assessment',
        id: requireData(imported).assessmentId,
      })
      assert.equal(requireData(manifestResult).manifest.source, 'manual')
      assert.equal(
        requireData(manifestResult).manifest.rawDirectory,
        path.posix.dirname(requireData(manifestResult).manifest.artifacts[0]?.relativePath ?? ''),
      )
      assert.equal(requireData(manifestResult).manifest.artifacts[0]?.role, 'source_assessment')
      assert.equal(
        requireData(manifestResult).manifest.artifacts[0]?.relativePath,
        requireData(imported).rawFile,
      )
      assert.equal(
        requireData(manifestResult).manifest.artifacts[0]?.originalFileName,
        path.basename(assessmentPath),
      )
      assert.equal(
        requireData(manifestResult).manifest.artifacts[0]?.mediaType,
        'application/json',
      )
      assert.equal(
        Number.isInteger(requireData(manifestResult).manifest.artifacts[0]?.byteSize),
        true,
      )
      assert.equal((requireData(manifestResult).manifest.artifacts[0]?.byteSize ?? 0) > 0, true)
      assert.match(
        requireData(manifestResult).manifest.artifacts[0]?.sha256 ?? '',
        /^[a-f0-9]{64}$/u,
      )
      assert.equal(requireData(manifestResult).manifest.provenance.title, 'Baseline Intake')
      assert.equal(
        requireData(manifestResult).manifest.provenance.lookupId,
        requireData(imported).assessmentId,
      )

      assert.equal(rawResult.ok, true)
      assert.equal(rawResult.meta?.command, 'intake raw')
      assert.equal(requireData(rawResult).entityId, requireData(imported).assessmentId)
      assert.equal(requireData(rawResult).lookupId, requireData(imported).assessmentId)
      assert.equal(requireData(rawResult).kind, 'assessment')
      assert.equal(requireData(rawResult).rawFile, requireData(imported).rawFile)
      assert.equal(requireData(rawResult).mediaType, 'application/json')
      assert.equal(requireData(rawResult).raw.questionnaireSlug, 'baseline-intake')
      assert.equal(
        requireData(rawResult).raw.responses?.sleep?.averageHours,
        7,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'export pack create stores the pack under the vault even without --out',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-pack-vault-'))

    try {
      await initializeVault({ vaultRoot })

      const services = createIntegratedVaultServices()
      const packResult = await services.query.exportPack({
        vault: vaultRoot,
        requestId: 'test-export-pack-vault-only',
        from: '2026-03-10',
        to: '2026-03-12',
      })

      assert.equal(packResult.outDir, null)
      assert.ok(packResult.packId.length > 0)
      assert.equal(packResult.files.length, 5)

      for (const relativePath of packResult.files) {
        await access(path.join(vaultRoot, relativePath))
      }

      const showResult = await showStoredExportPack(vaultRoot, packResult.packId)

      assert.equal(showResult.packId, packResult.packId)
      assert.equal(
        showResult.manifestFile,
        `exports/packs/${packResult.packId}/manifest.json`,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'intake raw rejects assessment artifacts that escape the vault through symlinks',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-raw-symlink-'))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-intake-raw-outside-'))
    const assessmentPath = path.join(vaultRoot, 'assessment.json')

    try {
      await initializeVault({ vaultRoot })
      await writeFile(
        assessmentPath,
        JSON.stringify({
          questionnaireSlug: 'baseline-intake',
          responses: {
            symptoms: ['fatigue'],
          },
        }),
        'utf8',
      )

      const imported = await runSliceCli<{
        assessmentId: string
        rawFile: string
      }>([
        'intake',
        'import',
        assessmentPath,
        '--vault',
        vaultRoot,
      ])

      const rawFile = requireData(imported).rawFile
      const rawAbsolutePath = path.join(vaultRoot, rawFile)
      const outsideJsonPath = path.join(outsideRoot, 'secret.json')
      await writeFile(outsideJsonPath, JSON.stringify({ leaked: true }), 'utf8')
      await rm(rawAbsolutePath, { force: true })
      await symlink(outsideJsonPath, rawAbsolutePath)

      await assert.rejects(
        () => showAssessmentRaw(vaultRoot, requireData(imported).assessmentId),
        {
          name: 'VaultCliError',
          code: 'invalid_path',
          message:
            `Vault-relative path "${rawFile}" may not traverse symbolic links inside the selected vault root.`,
        },
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'export pack create stores the pack under the vault and treats --out as an additional copy target',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-pack-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-pack-out-'))

    try {
      await initializeVault({ vaultRoot })

      const services = createIntegratedVaultServices()
      const packResult = await services.query.exportPack({
        vault: vaultRoot,
        requestId: 'test-export-pack',
        from: '2026-03-10',
        to: '2026-03-12',
        out: outRoot,
      })

      assert.equal(packResult.outDir, outRoot)
      assert.ok(packResult.packId.length > 0)
      assert.equal(packResult.files.length, 5)

      for (const relativePath of packResult.files) {
        await access(path.join(vaultRoot, relativePath))
        await access(path.join(outRoot, relativePath))
      }

      const showResult = await showStoredExportPack(vaultRoot, packResult.packId)

      assert.equal(showResult.packId, packResult.packId)
      assert.equal(
        showResult.manifestFile,
        `exports/packs/${packResult.packId}/manifest.json`,
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
      await rm(outRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'export pack show/list/materialize/prune operate on stored pack manifests under exports/packs',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-out-'))

    try {
      await initializeVault({ vaultRoot })

      const readModel = await readVault(vaultRoot)
      const pack = buildExportPack(readModel, {
        from: '2026-03-10',
        to: '2026-03-12',
        packId: 'focus-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)

      const showResult = await runSliceCli<{
        packId: string
        manifestFile: string
        basePath: string
        filters: {
          from: string | null
          to: string | null
          experiment: string | null
        }
        counts: {
          files: number
          questions: number
        }
        files: Array<{
          path: string
        }>
        manifest: {
          packId: string
        }
      }>([
        'export',
        'pack',
        'show',
        'focus-pack',
        '--vault',
        vaultRoot,
      ])
      const listResult = await runSliceCli<{
        filters: {
          from: string | null
          to: string | null
          experiment: string | null
          limit: number
        }
        items: Array<{
          packId: string
          recordCount: number
          questionCount: number
          fileCount: number
        }>
      }>([
        'export',
        'pack',
        'list',
        '--vault',
        vaultRoot,
        '--from',
        '2026-03-10',
        '--to',
        '2026-03-12',
      ])
      const materializeResult = await runSliceCli<{
        packId: string
        manifestFile: string
        outDir: string
        rebuilt: boolean
        files: string[]
      }>([
        'export',
        'pack',
        'materialize',
        'focus-pack',
        '--vault',
        vaultRoot,
        '--out',
        outRoot,
      ])
      const pruneResult = await runSliceCli<{
        packId: string
        packDirectory: string
        fileCount: number
        pruned: boolean
      }>([
        'export',
        'pack',
        'prune',
        'focus-pack',
        '--vault',
        vaultRoot,
      ])

      assert.equal(showResult.ok, true)
      assert.equal(showResult.meta?.command, 'export pack show')
      assert.equal(requireData(showResult).packId, 'focus-pack')
      assert.equal(requireData(showResult).basePath, 'exports/packs/focus-pack')
      assert.equal(
        requireData(showResult).manifestFile,
        'exports/packs/focus-pack/manifest.json',
      )
      assert.equal(requireData(showResult).filters.from, '2026-03-10')
      assert.equal(requireData(showResult).filters.to, '2026-03-12')
      assert.equal(requireData(showResult).filters.experiment, null)
      assert.equal(requireData(showResult).counts.files, pack.files.length)
      assert.equal(requireData(showResult).counts.questions, pack.manifest.questionCount)
      assert.equal(requireData(showResult).files.length, pack.files.length)
      assert.equal(requireData(showResult).manifest.packId, 'focus-pack')

      assert.equal(listResult.ok, true)
      assert.deepEqual(requireData(listResult).filters, {
        from: '2026-03-10',
        to: '2026-03-12',
        experiment: null,
        limit: 50,
      })
      assert.deepEqual(
        requireData(listResult).items.map((item) => item.packId),
        ['focus-pack'],
      )
      assert.equal(
        requireData(listResult).items[0]?.questionCount,
        pack.manifest.questionCount,
      )
      assert.equal(requireData(listResult).items[0]?.fileCount, pack.files.length)

      assert.equal(materializeResult.ok, true)
      assert.equal(materializeResult.meta?.command, 'export pack materialize')
      assert.equal(requireData(materializeResult).packId, 'focus-pack')
      assert.equal(requireData(materializeResult).outDir, outRoot)
      assert.equal(requireData(materializeResult).rebuilt, false)
      assert.equal(requireData(materializeResult).files.length, pack.files.length)
      await access(path.join(outRoot, 'exports/packs/focus-pack/manifest.json'))
      const copiedManifest = JSON.parse(
        await readFile(path.join(outRoot, 'exports/packs/focus-pack/manifest.json'), 'utf8'),
      ) as {
        packId: string
      }
      assert.equal(copiedManifest.packId, 'focus-pack')

      assert.equal(pruneResult.ok, true)
      assert.equal(pruneResult.meta?.command, 'export pack prune')
      assert.equal(requireData(pruneResult).packId, 'focus-pack')
      assert.equal(requireData(pruneResult).packDirectory, 'exports/packs/focus-pack')
      assert.equal(requireData(pruneResult).fileCount, pack.files.length)
      assert.equal(requireData(pruneResult).pruned, true)

      await assert.rejects(
        access(path.join(vaultRoot, 'exports/packs/focus-pack/manifest.json')),
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
      await rm(outRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'export pack helpers rebuild or reject when stored pack paths traverse symlinks',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-pack-symlink-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-pack-symlink-out-'))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-export-pack-symlink-outside-'))

    try {
      await initializeVault({ vaultRoot })

      const readModel = await readVault(vaultRoot)
      const pack = buildExportPack(readModel, {
        from: '2026-03-10',
        to: '2026-03-12',
        packId: 'focus-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)

      const linkedFile = pack.files.find((file) => file.path.endsWith('.md')) ?? pack.files[0]
      assert.ok(linkedFile)
      const storedPackFile = path.join(vaultRoot, linkedFile.path)
      const outsideFile = path.join(outsideRoot, 'secret.md')
      await writeFile(outsideFile, 'outside-vault export content', 'utf8')
      await rm(storedPackFile, { force: true })
      await symlink(outsideFile, storedPackFile)

      const materialized = await materializeStoredExportPack({
        vault: vaultRoot,
        packId: 'focus-pack',
        out: outRoot,
      })

      assert.equal(materialized.rebuilt, true)
      assert.equal(
        await readFile(path.join(outRoot, linkedFile.path), 'utf8'),
        linkedFile.contents,
      )

      await rm(path.join(vaultRoot, 'exports', 'packs'), { recursive: true, force: true })
      await mkdir(path.join(outsideRoot, 'focus-pack'), { recursive: true })
      await symlink(outsideRoot, path.join(vaultRoot, 'exports', 'packs'))

      await assert.rejects(
        () => pruneStoredExportPack(vaultRoot, 'focus-pack'),
        {
          name: 'VaultCliError',
          code: 'invalid_path',
          message:
            'Vault-relative path "exports/packs/focus-pack/manifest.json" may not traverse symbolic links inside the selected vault root.',
        },
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
      await rm(outRoot, { recursive: true, force: true })
      await rm(outsideRoot, { recursive: true, force: true })
    }
  },
)
