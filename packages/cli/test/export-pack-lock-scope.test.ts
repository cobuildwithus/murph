import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { buildExportPack, readVault } from '@murphai/query'
import { withAssistantRuntimeWriteLock } from '@murphai/vault-usecases/assistant-runtime-write-lock'
import { materializeExportPack } from '@murphai/vault-usecases/helpers'
import { afterEach, test, vi } from 'vitest'

const {
  loadQueryRuntimeMock,
  materializeExportPackMock,
  readVaultTolerantMock,
} = vi.hoisted(() => ({
  loadQueryRuntimeMock: vi.fn(),
  materializeExportPackMock: vi.fn(),
  readVaultTolerantMock: vi.fn(),
}))

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
    async materializeExportPack(
      ...args: Parameters<typeof actual.materializeExportPack>
    ) {
      materializeExportPackMock(...args)
      return await actual.materializeExportPack(...args)
    },
  }
})

import { materializeStoredExportPack } from '../src/commands/export-intake-read-helpers.js'

loadQueryRuntimeMock.mockResolvedValue({
  buildExportPack,
  readVaultTolerant: readVaultTolerantMock,
})

afterEach(() => {
  materializeExportPackMock.mockClear()
  readVaultTolerantMock.mockReset()
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

test.sequential(
  'external export-pack reconstruction does not hold the assistant runtime lock',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-scope-'))
    const outRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-lock-output-'))
    let releaseRebuild!: () => void
    const rebuildRelease = new Promise<void>((resolve) => {
      releaseRebuild = resolve
    })
    let reportRebuildStarted!: () => void
    const rebuildStarted = new Promise<void>((resolve) => {
      reportRebuildStarted = resolve
    })

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
        reportRebuildStarted()
        await rebuildRelease
        return readModel
      })

      const materialization = materializeStoredExportPack({
        out: outRoot,
        packId: pack.packId,
        vault: vaultRoot,
      })
      await within(rebuildStarted, 'rebuild did not start')
      let releaseTimeout!: () => void
      const timeout = new Promise<'timeout'>((resolve) => {
        const timeoutId = setTimeout(() => resolve('timeout'), 500)
        releaseTimeout = () => clearTimeout(timeoutId)
      })
      const lockAttempt = withAssistantRuntimeWriteLock(vaultRoot, async () => 'acquired' as const)
      const lockOutcome = await Promise.race([lockAttempt, timeout])
      releaseTimeout()
      releaseRebuild()

      const result = await materialization
      await lockAttempt
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
      releaseRebuild()
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
    let releaseRebuild!: () => void
    const rebuildRelease = new Promise<void>((resolve) => {
      releaseRebuild = resolve
    })
    let reportRebuildStarted!: () => void
    const rebuildStarted = new Promise<void>((resolve) => {
      reportRebuildStarted = resolve
    })

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
        reportRebuildStarted()
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
      releaseRebuild()

      await within(
        assert.rejects(materialization, { code: 'not_found' }),
        'canonical materialization did not reject after retirement',
      )
      await assert.rejects(access(packDirectory), { code: 'ENOENT' })
    } finally {
      releaseRebuild()
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
