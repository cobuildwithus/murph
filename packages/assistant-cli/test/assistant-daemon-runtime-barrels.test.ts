import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import { test } from 'vitest'

test('assistant runtime private source barrel stays removed', async () => {
  await assert.rejects(
    access(new URL('../src/assistant/runtime.ts', import.meta.url), constants.F_OK),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  )
})
