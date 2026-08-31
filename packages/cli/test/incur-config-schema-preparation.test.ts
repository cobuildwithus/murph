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

import { prepareBuiltCliRuntime } from '../scripts/incur-config-schema.js'

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
