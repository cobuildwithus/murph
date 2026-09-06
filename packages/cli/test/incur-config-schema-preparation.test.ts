import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, test, vi } from 'vitest'

const execFileMock = vi.hoisted(() =>
  vi.fn((...args: unknown[]) => {
    const callback = args[args.length - 1]

    if (typeof callback === 'function') {
      callback(null, '', '')
    }
  }),
)

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  )

  return {
    ...actual,
    execFile: execFileMock,
  }
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
  await prepareBuiltCliRuntime()

  assert.equal(execFileMock.mock.calls.length, 1)
  assert.equal(execFileMock.mock.calls[0]?.[0], 'pnpm')
  assert.deepEqual(execFileMock.mock.calls[0]?.[1], [
    'build:test-runtime:prepared',
  ])
  const execOptions = execFileMock.mock.calls[0]?.[2]
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
