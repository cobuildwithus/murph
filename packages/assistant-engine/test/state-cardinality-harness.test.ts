import { Buffer } from 'node:buffer'
import fs, {
  type Dir,
  createReadStream as preloadedCreateReadStream,
  opendirSync as preloadedOpendirSync,
  readFileSync as preloadedReadFileSync,
  readdirSync as preloadedReaddirSync,
} from 'node:fs'
import {
  mkdir,
  mkdtemp,
  open as preloadedOpen,
  opendir as preloadedOpendir,
  readFile as preloadedReadFile,
  readdir as preloadedReaddir,
  rm,
  stat as preloadedStat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, it, vi } from 'vitest'

import {
  assertStateCardinalityInvariant,
  describeStateCardinality,
  type StateCardinalityProbe,
} from '../../../config/state-cardinality-test.ts'

const cleanupPaths: string[] = []
const FIXED_FALLBACK_READ_LIMIT = 100

type HarnessProbeKind =
  | 'async-directory-scan'
  | 'async-growing-read'
  | 'bounded-exact-reads'
  | 'callback-growing-read'
  | 'callback-opendir-scan'
  | 'compact-growing-read'
  | 'file-handle-growing-read'
  | 'fixed-large-read'
  | 'logarithmic-read-growth'
  | 'metadata-scan'
  | 'opendir-scan'
  | 'promises-object-growing-read'
  | 'sync-directory-scan'
  | 'sync-opendir-scan'
  | 'sync-growing-read'
  | 'unsupported-stream'

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describeStateCardinality('state-cardinality harness', () => {
  it.each([
    ['fixed large exact work', 'fixed-large-read'],
    ['a fixed-cap 100-record fallback', 'bounded-exact-reads'],
  ] as const)('accepts %s after the shared saturation bound', async (_label, kind) => {
    await expect(
      assertStateCardinalityInvariant(createHarnessProbe(kind)),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['preloaded asynchronous directory growth', 'async-directory-scan', /directoryEntries changed/u],
    ['preloaded synchronous directory growth', 'sync-directory-scan', /directoryEntries changed/u],
    ['iterator-based directory growth', 'opendir-scan', /directoryEntries changed/u],
    ['callback directory-handle growth', 'callback-opendir-scan', /directoryEntries changed/u],
    ['synchronous directory-handle growth', 'sync-opendir-scan', /directoryEntries changed/u],
    ['preloaded asynchronous file growth', 'async-growing-read', /readBytes changed/u],
    ['preloaded synchronous file growth', 'sync-growing-read', /readBytes changed/u],
    ['FileHandle reads', 'file-handle-growing-read', /readBytes changed/u],
    ['the node:fs promises object', 'promises-object-growing-read', /readBytes changed/u],
    ['the node:fs callback API', 'callback-growing-read', /readBytes changed/u],
    ['per-record metadata reads', 'metadata-scan', /readOperations changed/u],
    ['compact 16-byte-per-record growth', 'compact-growing-read', /readBytes changed/u],
    ['logarithmic read-count growth', 'logarithmic-read-growth', /readOperations changed/u],
  ] as const)('rejects %s', async (_label, kind, failurePattern) => {
    await expect(
      assertStateCardinalityInvariant(createHarnessProbe(kind)),
    ).rejects.toThrow(failurePattern)
  })

  it('fails closed for an unmetered stream primitive', async () => {
    await expect(
      assertStateCardinalityInvariant(createHarnessProbe('unsupported-stream')),
    ).rejects.toThrow(/does not support createReadStream/u)
  })
})

function createHarnessProbe(kind: HarnessProbeKind): StateCardinalityProbe {
  return {
    name: `harness ${kind} canary`,
    async prepare(cardinality) {
      const root = await mkdtemp(path.join(tmpdir(), 'state-cardinality-canary-'))
      cleanupPaths.push(root)
      const noiseDirectory = path.join(root, 'noise')
      const targetPath = path.join(root, 'target.bin')
      await mkdir(noiseDirectory, { recursive: true })
      const targetBytes = resolveTargetBytes(kind, cardinality)
      await writeFile(targetPath, Buffer.alloc(targetBytes))
      const noisePaths = Array.from(
        { length: cardinality },
        (_, index) => path.join(noiseDirectory, `noise-${index}.txt`),
      )
      await Promise.all(
        noisePaths.map((noisePath) => writeFile(noisePath, 'noise', 'utf8')),
      )

      return {
        root,
        async loadOperation() {
          if (kind === 'async-directory-scan') {
            return async () => {
              await preloadedReaddir(noiseDirectory)
            }
          }
          if (kind === 'sync-directory-scan') {
            return async () => {
              preloadedReaddirSync(noiseDirectory)
            }
          }
          if (kind === 'opendir-scan') {
            return async () => {
              const directory = await preloadedOpendir(noiseDirectory)
              for await (const _entry of directory) {
                // Consume the production iterator; the shared meter owns counts.
              }
            }
          }
          if (kind === 'callback-opendir-scan') {
            return async () => {
              const directory = await openDirectoryWithCallback(noiseDirectory)
              try {
                while (await readDirectoryWithCallback(directory)) {
                  // Consume every entry through the callback API.
                }
              } finally {
                await directory.close()
              }
            }
          }
          if (kind === 'sync-opendir-scan') {
            return async () => {
              const directory = preloadedOpendirSync(noiseDirectory)
              try {
                while (directory.readSync() !== null) {
                  // Consume every entry through the synchronous handle API.
                }
              } finally {
                directory.closeSync()
              }
            }
          }
          if (kind === 'bounded-exact-reads') {
            return async () => {
              for (const noisePath of noisePaths.slice(
                0,
                FIXED_FALLBACK_READ_LIMIT,
              )) {
                await preloadedReadFile(noisePath)
              }
            }
          }
          if (kind === 'logarithmic-read-growth') {
            return async () => {
              const readCount = Math.ceil(Math.log2(cardinality))
              for (const noisePath of noisePaths.slice(0, readCount)) {
                await preloadedReadFile(noisePath)
              }
            }
          }
          if (kind === 'metadata-scan') {
            return async () => {
              for (const noisePath of noisePaths) {
                await preloadedStat(noisePath)
              }
            }
          }
          if (kind === 'promises-object-growing-read') {
            return async () => {
              expect((await fs.promises.readFile(targetPath)).byteLength).toBe(
                targetBytes,
              )
            }
          }
          if (kind === 'callback-growing-read') {
            return async () => {
              expect((await readFileWithCallback(targetPath)).byteLength).toBe(
                targetBytes,
              )
            }
          }
          if (kind === 'file-handle-growing-read') {
            return async () => {
              const handle = await preloadedOpen(targetPath, 'r')
              try {
                const buffer = Buffer.alloc(targetBytes)
                const { bytesRead } = await handle.read(
                  buffer,
                  0,
                  buffer.byteLength,
                  0,
                )
                expect(bytesRead).toBe(targetBytes)
              } finally {
                await handle.close()
              }
            }
          }
          if (kind === 'unsupported-stream') {
            return async () => {
              preloadedCreateReadStream(targetPath)
            }
          }
          if (
            kind === 'async-growing-read' ||
            kind === 'compact-growing-read' ||
            kind === 'fixed-large-read'
          ) {
            return async () => {
              expect((await preloadedReadFile(targetPath)).byteLength).toBe(
                targetBytes,
              )
            }
          }
          return async () => {
            expect(preloadedReadFileSync(targetPath).byteLength).toBe(targetBytes)
          }
        },
      }
    },
  }
}

function openDirectoryWithCallback(directoryPath: string): Promise<Dir> {
  return new Promise((resolve, reject) => {
    fs.opendir(directoryPath, (error, directory) => {
      if (error) {
        reject(error)
        return
      }
      resolve(directory)
    })
  })
}

function readDirectoryWithCallback(directory: Dir): Promise<boolean> {
  return new Promise((resolve, reject) => {
    directory.read((error, entry) => {
      if (error) {
        reject(error)
        return
      }
      resolve(entry !== null)
    })
  })
}

function readFileWithCallback(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (error, result) => {
      if (error) {
        reject(error)
        return
      }
      resolve(result)
    })
  })
}

function resolveTargetBytes(
  kind: HarnessProbeKind,
  cardinality: number,
): number {
  if (kind === 'fixed-large-read') {
    return 128 * 1024
  }
  if (kind === 'compact-growing-read') {
    return cardinality * 16
  }
  if (
    kind === 'async-growing-read' ||
    kind === 'callback-growing-read' ||
    kind === 'file-handle-growing-read' ||
    kind === 'promises-object-growing-read' ||
    kind === 'sync-growing-read'
  ) {
    return cardinality * 4 * 1024
  }
  return 5
}
