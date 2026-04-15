import assert from 'node:assert/strict'

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

import { rebuildCliRuntimeArtifacts } from './cli-test-helpers.js'

afterEach(() => {
  vi.clearAllMocks()
})

test('rebuildCliRuntimeArtifacts verifies package shape with node --import=tsx', async () => {
  await rebuildCliRuntimeArtifacts()

  assert.equal(execFileMock.mock.calls.length, 2)
  assert.deepEqual(execFileMock.mock.calls[0]?.[0], 'pnpm')
  assert.deepEqual(execFileMock.mock.calls[0]?.[1], ['build:test-runtime:prepared'])
  assert.deepEqual(execFileMock.mock.calls[1]?.[0], 'pnpm')
  assert.deepEqual(execFileMock.mock.calls[1]?.[1], [
    'exec',
    'node',
    '--import=tsx',
    'packages/cli/scripts/verify-package-shape.ts',
  ])
})
