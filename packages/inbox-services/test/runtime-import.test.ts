import assert from 'node:assert/strict'

import { test } from 'vitest'

import { loadRuntimeModule } from '../src/runtime-import.ts'

test('loadRuntimeModule resolves dynamic specifiers', async () => {
  const pathModule = await loadRuntimeModule<typeof import('node:path')>('node:path')

  assert.equal(typeof pathModule.join, 'function')
  assert.equal(pathModule.basename('/tmp/report.txt'), 'report.txt')
})
