import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { EventEmitter } from 'node:events'
import { afterEach, vi } from 'vitest'
import { localParallelCliTest as test } from './local-parallel-test.js'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return { ...actual, spawn: spawnMock }
})

import {
  packageDir,
  prepareBuiltCliRuntime,
  resolveIncurBinPathFromManifest,
  resolveInstalledIncurBinPath,
} from '../scripts/incur-config-schema.js'

afterEach(() => {
  vi.clearAllMocks()
})

test('prepares the dependency-aware CLI runtime before schema generation', async () => {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('exit', 0, null))
    return child
  })
  await prepareBuiltCliRuntime()

  assert.equal(spawnMock.mock.calls.length, 1)
  assert.equal(spawnMock.mock.calls[0]?.[0], 'pnpm')
  assert.deepEqual(spawnMock.mock.calls[0]?.[1], [
    'build:test-runtime:prepared',
  ])
  assert.equal(spawnMock.mock.calls[0]?.[2].stdio, 'inherit')
  const execOptions = spawnMock.mock.calls[0]?.[2]
  assert.ok(
    typeof execOptions === 'object' && execOptions !== null && 'cwd' in execOptions,
  )
  assert.equal(
    path.resolve(String(execOptions.cwd)),
    path.resolve(fileURLToPath(new URL('../../../', import.meta.url))),
  )
})

test('resolves the installed generator through the declared Incur package bin', async () => {
  const generatorPath = await resolveInstalledIncurBinPath()
  const incurPackageDirectory = path.join(packageDir, 'node_modules', 'incur')
  const relativePath = path.relative(incurPackageDirectory, generatorPath)

  assert.notEqual(relativePath, '')
  assert.equal(relativePath.startsWith(`..${path.sep}`), false)
  assert.equal(path.isAbsolute(relativePath), false)
})

test('keeps the declared Incur generator inside its package', () => {
  const packageDirectory = path.resolve('synthetic-incur-package')

  assert.equal(
    resolveIncurBinPathFromManifest(packageDirectory, {
      bin: { incur: './dist/cli/index.js' },
    }),
    path.join(packageDirectory, 'dist', 'cli', 'index.js'),
  )
  assert.throws(
    () =>
      resolveIncurBinPathFromManifest(packageDirectory, {
        bin: { incur: '../outside.mjs' },
      }),
    /must be package-relative and stay inside its package/u,
  )
  assert.throws(
    () =>
      resolveIncurBinPathFromManifest(packageDirectory, {
        bin: { incur: path.join(packageDirectory, 'dist', 'cli', 'index.js') },
      }),
    /must be package-relative and stay inside its package/u,
  )
  assert.throws(
    () => resolveIncurBinPathFromManifest(packageDirectory, { bin: {} }),
    /must declare bin\.incur/u,
  )
})

test.each([1, 17])('propagates prepared-runtime exit %s', async (code) => {
  spawnMock.mockImplementationOnce(() => {
    const child = new EventEmitter()
    queueMicrotask(() => child.emit('exit', code, null))
    return child
  })
  await assert.rejects(prepareBuiltCliRuntime(), new RegExp(`failed \\(${code}\\)`))
})
