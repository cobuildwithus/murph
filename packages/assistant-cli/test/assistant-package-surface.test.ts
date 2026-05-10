import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import { test } from 'vitest'

test('assistant-cli keeps only declared source entrypoints, without a private root barrel', async () => {
  await assert.rejects(
    access(new URL('../src/index.ts', import.meta.url), constants.F_OK),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  )

  await access(new URL('../src/commands/assistant.ts', import.meta.url), constants.F_OK)
  await access(new URL('../src/run-terminal-logging.ts', import.meta.url), constants.F_OK)
})
