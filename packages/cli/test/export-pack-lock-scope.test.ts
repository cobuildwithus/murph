import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { buildExportPack, readVault } from '@murphai/query'
import { withAssistantRuntimeWriteLock } from '@murphai/vault-usecases/assistant-runtime-write-lock'
import { materializeExportPack } from '@murphai/vault-usecases/helpers'
import { afterEach, test, vi } from 'vitest'

const {
  directoriesSharePhysicalIdentityHook,
  loadQueryRuntimeMock,
  materializeExportPackMock,
  readVaultTolerantMock,
  resolveVaultRelativePathHook,
  writeFileHook,
} = vi.hoisted(() => ({
  directoriesSharePhysicalIdentityHook: vi.fn(),
  loadQueryRuntimeMock: vi.fn(),
  materializeExportPackMock: vi.fn(),
  readVaultTolerantMock: vi.fn(),
  resolveVaultRelativePathHook: vi.fn(),
  writeFileHook: vi.fn(),
}))

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>(
    'node:fs/promises',
  )
  return {
    ...actual,
    async writeFile(...args: Parameters<typeof actual.writeFile>) {
      await writeFileHook(...args)
      return await actual.writeFile(...args)
    },
  }
})

vi.mock('@murphai/vault-usecases/runtime', async () => {
  const actual = await vi.importActual<
    typeof import('@murphai/vault-usecases/runtime')
  >('@murphai/vault-usecases/runtime')
  return {
    ...actual,
    loadQueryRuntime: loadQueryRuntimeMock,
  }
})

vi.mock('@murphai/vault-usecases/helpers', async () => {
  const actual = await vi.importActual<
    typeof import('@murphai/vault-usecases/helpers')
  >('@murphai/vault-usecases/helpers')
  return {
    ...actual,
    async directoriesSharePhysicalIdentity(
      ...args: Parameters<typeof actual.directoriesSharePhysicalIdentity>
    ) {
      const result = await actual.directoriesSharePhysicalIdentity(...args)
      await directoriesSharePhysicalIdentityHook(...args)
      return result
    },
    async materializeExportPack(
      ...args: Parameters<typeof actual.materializeExportPack>
    ) {
      materializeExportPackMock(...args)
      return await actual.materializeExportPack(...args)
    },
    async resolveVaultRelativePath(
      ...args: Parameters<typeof actual.resolveVaultRelativePath>
    ) {
      await resolveVaultRelativePathHook(...args)
      return await actual.resolveVaultRelativePath(...args)
    },
  }
})

import {
  exportPackManifestSchema,
  materializeStoredExportPack,
} from '../src/commands/export-intake-read-helpers.js'

loadQueryRuntimeMock.mockResolvedValue({
  buildExportPack,
  readVaultTolerant: readVaultTolerantMock,
})

afterEach(() => {
  directoriesSharePhysicalIdentityHook.mockReset()
  materializeExportPackMock.mockClear()
  readVaultTolerantMock.mockReset()
  resolveVaultRelativePathHook.mockReset()
  writeFileHook.mockReset()
})

async function within<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(label)), 10_000)
      }),
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function deferred(): Promise<void> & { resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((ready) => {
    resolve = ready
  })
  return Object.assign(promise, { resolve })
}

test.sequential(
  'external materialization waits out a manifest-first canonical rewrite',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-writer-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-output-'))
    const aliasParent = `${outRoot}-alias-parent`
    const aliasOut = path.join(aliasParent, path.basename(outRoot))
    const writerRelease = deferred()
    const writerPaused = deferred()
    const externalClassified = deferred()

    try {
      await initializeVault({ vaultRoot })
      await symlink(path.dirname(outRoot), aliasParent, 'dir')
      const pack = buildExportPack(await readVault(vaultRoot), {
        packId: 'external-manifest-first-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)
      const manifestFile = pack.files.find((file) => file.path.endsWith('/manifest.json'))
      assert.ok(manifestFile)
      const parsedManifest = exportPackManifestSchema.parse(
        JSON.parse(manifestFile.contents),
      )
      const newerFiles = pack.files.map((file) => {
        if (file.path === manifestFile.path) {
          return {
            ...file,
            contents: JSON.stringify({
              ...parsedManifest,
              generatedAt: '2026-03-14T12:00:00.000Z',
            }),
          }
        }
        if (file.path.endsWith('/question-pack.json')) {
          return { ...file, contents: `${file.contents}\n${' '.repeat(2 * 1024 * 1024)}` }
        }
        return { ...file, contents: `${file.contents}\n` }
      })
      const canonicalPackRoot = path.join(
        vaultRoot,
        `exports/packs/${pack.packId}`,
      )
      let paused = false
      writeFileHook.mockImplementation(async (filePath) => {
        const candidate = String(filePath)
        if (
          !paused
          && candidate.startsWith(`${canonicalPackRoot}${path.sep}`)
          && path.basename(candidate).startsWith('.question-pack.json.')
          && candidate.endsWith('.tmp')
        ) {
          paused = true
          writerPaused.resolve()
          await writerRelease
        }
      })

      const writer = withAssistantRuntimeWriteLock(vaultRoot, async () => {
        await materializeExportPack(vaultRoot, newerFiles)
      })
      await within(writerPaused, 'canonical writer did not pause after manifest publish')
      let externalSnapshotStarted = false
      resolveVaultRelativePathHook.mockImplementation(async (_vault, relativePath) => {
        if (relativePath === manifestFile.path) {
          externalSnapshotStarted = true
        }
      })
      directoriesSharePhysicalIdentityHook.mockImplementation(async (left, right) => {
        if (left === vaultRoot && right === aliasOut) {
          externalClassified.resolve()
        }
      })
      const external = materializeStoredExportPack({
        out: aliasOut,
        packId: pack.packId,
        vault: vaultRoot,
      })
      await within(externalClassified, 'external output identity was not classified')
      await new Promise<void>((resolve) => setImmediate(resolve))
      assert.equal(externalSnapshotStarted, false)

      writerRelease.resolve()
      await writer
      const result = await external

      assert.equal(result.rebuilt, false)
      assert.equal(externalSnapshotStarted, true)
      for (const file of newerFiles) {
        assert.equal(
          await readFile(path.join(aliasOut, file.path), 'utf8'),
          file.contents,
        )
      }
    } finally {
      writerRelease.resolve()
      await rm(aliasParent, { force: true })
      await rm(vaultRoot, { force: true, recursive: true })
      await rm(outRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'complete external export-pack reads do not hold the assistant runtime lock',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-read-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-output-'))
    const readRelease = deferred()
    const readStarted = deferred()

    try {
      await initializeVault({ vaultRoot })
      const pack = buildExportPack(await readVault(vaultRoot), {
        packId: 'external-complete-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)
      const targetFile = pack.files.find((file) => file.path.endsWith('/entities.json'))
      assert.ok(targetFile)
      let targetResolveCount = 0
      resolveVaultRelativePathHook.mockImplementation(async (_vault, relativePath) => {
        if (relativePath !== targetFile.path) return
        targetResolveCount += 1
        if (targetResolveCount === 2) {
          readStarted.resolve()
          await readRelease
        }
      })

      const materialization = materializeStoredExportPack({
        out: outRoot,
        packId: pack.packId,
        vault: vaultRoot,
      })
      await within(readStarted, 'stored pack read did not start')
      const lockOutcome = await within(
        withAssistantRuntimeWriteLock(vaultRoot, async () => 'acquired' as const),
        'complete external read held the runtime lock',
      )
      readRelease.resolve()

      const result = await materialization
      assert.equal(lockOutcome, 'acquired')
      assert.equal(result.rebuilt, false)
      await access(path.join(outRoot, `exports/packs/${pack.packId}/manifest.json`))
    } finally {
      readRelease.resolve()
      await rm(vaultRoot, { force: true, recursive: true })
      await rm(outRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'complete external export-pack reads reject a concurrent canonical change before writing',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-change-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-output-'))
    const readRelease = deferred()
    const readStarted = deferred()

    try {
      await initializeVault({ vaultRoot })
      const pack = buildExportPack(await readVault(vaultRoot), {
        packId: 'external-changing-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)
      const targetFile = pack.files.find((file) => file.path.endsWith('/entities.json'))
      assert.ok(targetFile)
      let targetResolveCount = 0
      resolveVaultRelativePathHook.mockImplementation(async (_vault, relativePath) => {
        if (relativePath !== targetFile.path) return
        targetResolveCount += 1
        if (targetResolveCount === 2) {
          readStarted.resolve()
          await readRelease
        }
      })

      const materialization = materializeStoredExportPack({
        out: outRoot,
        packId: pack.packId,
        vault: vaultRoot,
      })
      await within(readStarted, 'stored pack read did not start')
      await withAssistantRuntimeWriteLock(vaultRoot, async () => {
        await materializeExportPack(vaultRoot, pack.files.map((file) => (
          file.path === targetFile.path
            ? { ...file, contents: `${file.contents}\n` }
            : file
        )))
      })
      readRelease.resolve()

      await within(
        assert.rejects(materialization, { code: 'export_pack_changed' }),
        'changed external materialization did not reject',
      )
      await assert.rejects(access(path.join(outRoot, 'exports')), { code: 'ENOENT' })
    } finally {
      readRelease.resolve()
      await rm(vaultRoot, { force: true, recursive: true })
      await rm(outRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'external export-pack reconstruction does not hold the assistant runtime lock',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-scope-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-output-'))
    const rebuildRelease = deferred()
    const rebuildStarted = deferred()

    try {
      await initializeVault({ vaultRoot })
      const readModel = await readVault(vaultRoot)
      const pack = buildExportPack(readModel, {
        from: '2026-03-10',
        to: '2026-03-12',
        packId: 'external-rebuild-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)
      const missingFile = pack.files.find(
        (file) => !file.path.endsWith('/manifest.json'),
      )
      assert.ok(missingFile)
      await rm(path.join(vaultRoot, missingFile.path), { force: true })
      await assert.rejects(
        access(path.join(vaultRoot, missingFile.path)),
        { code: 'ENOENT' },
      )
      readVaultTolerantMock.mockImplementation(async () => {
        rebuildStarted.resolve()
        await rebuildRelease
        return readModel
      })

      const materialization = materializeStoredExportPack({
        out: outRoot,
        packId: pack.packId,
        vault: vaultRoot,
      })
      await within(rebuildStarted, 'rebuild did not start')
      const lockAttempt = withAssistantRuntimeWriteLock(vaultRoot, async () => 'acquired' as const)
      const lockOutcome = await within(
        lockAttempt,
        'external reconstruction held the runtime lock',
      )
      rebuildRelease.resolve()

      const result = await materialization
      assert.equal(lockOutcome, 'acquired')
      assert.equal(result.rebuilt, true)
      const externalManifest = path.join(
        outRoot,
        `exports/packs/${pack.packId}/manifest.json`,
      )
      await access(externalManifest)
      assert.equal(
        JSON.parse(await readFile(externalManifest, 'utf8')).packId,
        pack.packId,
      )
    } finally {
      rebuildRelease.resolve()
      await rm(vaultRoot, { force: true, recursive: true })
      await rm(outRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'canonical reconstruction does not resurrect a pack retired while rebuilding',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-retire-'))
    const aliasParent = `${vaultRoot}-alias-parent`
    const aliasVault = path.join(aliasParent, path.basename(vaultRoot))
    const rebuildRelease = deferred()
    const rebuildStarted = deferred()

    try {
      await initializeVault({ vaultRoot })
      await symlink(path.dirname(vaultRoot), aliasParent, 'dir')
      const readModel = await readVault(vaultRoot)
      const pack = buildExportPack(readModel, {
        from: '2026-03-10',
        to: '2026-03-12',
        packId: 'canonical-rebuild-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)
      const missingFile = pack.files.find(
        (file) => !file.path.endsWith('/manifest.json'),
      )
      assert.ok(missingFile)
      await rm(path.join(vaultRoot, missingFile.path), { force: true })
      await assert.rejects(
        access(path.join(vaultRoot, missingFile.path)),
        { code: 'ENOENT' },
      )
      readVaultTolerantMock.mockImplementation(async () => {
        rebuildStarted.resolve()
        await rebuildRelease
        return readModel
      })

      const materialization = materializeStoredExportPack({
        out: aliasVault,
        packId: pack.packId,
        vault: vaultRoot,
      })
      await within(
        Promise.race([
          rebuildStarted,
          materialization.then(() => {
            throw new Error('canonical materialization completed before rebuild')
          }),
        ]),
        'canonical rebuild did not start',
      )
      const packDirectory = path.join(
        vaultRoot,
        `exports/packs/${pack.packId}`,
      )
      await within(
        withAssistantRuntimeWriteLock(vaultRoot, async () => {
          await rm(packDirectory, { force: true, recursive: true })
        }),
        'retirement did not acquire the runtime lock',
      )
      rebuildRelease.resolve()

      await within(
        assert.rejects(materialization, { code: 'not_found' }),
        'canonical materialization did not reject after retirement',
      )
      await assert.rejects(access(packDirectory), { code: 'ENOENT' })
    } finally {
      rebuildRelease.resolve()
      await rm(aliasParent, { force: true })
      await rm(vaultRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'canonical reconstruction does not overwrite a newer complete same-manifest pack',
  async () => {
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-export-lock-newer-'),
    )
    const aliasParent = `${vaultRoot}-alias-parent`
    const aliasVault = path.join(aliasParent, path.basename(vaultRoot))
    const rebuildRelease = deferred()
    const rebuildStarted = deferred()

    try {
      await initializeVault({ vaultRoot })
      await symlink(path.dirname(vaultRoot), aliasParent, 'dir')
      const journalPath = path.join(
        vaultRoot,
        'journal/2026/2026-03-10.md',
      )
      await mkdir(path.dirname(journalPath), { recursive: true })
      const journalPrefix = `---
schemaVersion: murph.frontmatter.journal-day.v1
docType: journal_day
dayKey: 2026-03-10
eventIds: []
sampleStreams: []
---
# March 10

`
      await writeFile(journalPath, `${journalPrefix}Older journal details.\n`)
      const olderReadModel = await readVault(vaultRoot)
      const packOptions = {
        packId: 'canonical-generation-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      }
      const olderPack = buildExportPack(olderReadModel, packOptions)
      await materializeExportPack(vaultRoot, olderPack.files)
      const missingFile = olderPack.files.find(
        (file) => !file.path.endsWith('/manifest.json'),
      )
      assert.ok(missingFile)
      await rm(path.join(vaultRoot, missingFile.path), { force: true })
      let rebuildReadCount = 0
      let newerReadModel = olderReadModel
      readVaultTolerantMock.mockImplementation(async () => {
        rebuildReadCount += 1
        if (rebuildReadCount === 1) {
          rebuildStarted.resolve()
          await rebuildRelease
          return olderReadModel
        }
        return newerReadModel
      })

      const materialization = materializeStoredExportPack({
        out: aliasVault,
        packId: olderPack.packId,
        vault: vaultRoot,
      })
      await within(rebuildStarted, 'same-id rebuild did not start')
      await writeFile(journalPath, `${journalPrefix}Newer journal details.\n`)
      newerReadModel = await readVault(vaultRoot)
      const newerPack = buildExportPack(newerReadModel, packOptions)
      const olderManifest = olderPack.files.find(
        (file) => file.path.endsWith('/manifest.json'),
      )
      const newerManifest = newerPack.files.find(
        (file) => file.path.endsWith('/manifest.json'),
      )
      assert.ok(olderManifest)
      assert.ok(newerManifest)
      assert.equal(newerManifest.contents, olderManifest.contents)
      const newerContentsByPath = new Map(
        newerPack.files.map((file) => [file.path, file.contents]),
      )
      assert.equal(olderPack.files.some((file) => (
        !file.path.endsWith('/manifest.json')
        && newerContentsByPath.get(file.path) !== file.contents
      )), true)

      const newerMaterialization = await materializeStoredExportPack({
        out: aliasVault,
        packId: olderPack.packId,
        vault: vaultRoot,
      })
      assert.equal(newerMaterialization.rebuilt, true)
      rebuildRelease.resolve()

      await within(
        assert.rejects(materialization, { code: 'export_pack_changed' }),
        'stale canonical materialization did not reject',
      )
      const manifestPath = path.join(
        vaultRoot,
        `exports/packs/${olderPack.packId}/manifest.json`,
      )
      assert.equal(
        await readFile(manifestPath, 'utf8'),
        newerManifest.contents,
      )
      for (const file of newerPack.files) {
        assert.equal(
          await readFile(path.join(vaultRoot, file.path), 'utf8'),
          file.contents,
        )
      }
    } finally {
      rebuildRelease.resolve()
      await rm(aliasParent, { force: true })
      await rm(vaultRoot, { force: true, recursive: true })
    }
  },
)

test.sequential(
  'an exact canonical snapshot writes once through the selected vault path',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-exact-'))
    const aliasParent = `${vaultRoot}-alias-parent`
    const aliasVault = path.join(aliasParent, path.basename(vaultRoot))

    try {
      await initializeVault({ vaultRoot })
      await symlink(path.dirname(vaultRoot), aliasParent, 'dir')
      const pack = buildExportPack(await readVault(vaultRoot), {
        packId: 'canonical-exact-pack',
        generatedAt: '2026-03-13T12:00:00.000Z',
      })
      await materializeExportPack(vaultRoot, pack.files)

      await materializeStoredExportPack({
        out: aliasVault,
        packId: pack.packId,
        vault: vaultRoot,
      })

      assert.deepEqual(
        materializeExportPackMock.mock.calls.map(([outDir]) => outDir),
        [vaultRoot, vaultRoot],
      )
    } finally {
      await rm(aliasParent, { force: true })
      await rm(vaultRoot, { force: true, recursive: true })
    }
  },
)
