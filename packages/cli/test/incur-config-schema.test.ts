import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { runIncurGeneratorCommand } from '../scripts/incur-config-schema.js'

test('Incur artifact generation terminates a wedged generator with an actionable error', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'murph-incur-timeout-'))
  const fixturePath = path.join(tempDir, 'wedged-incur.mjs')

  try {
    await writeFile(fixturePath, "setInterval(() => {}, 1_000)\n", 'utf8')

    await assert.rejects(
      runIncurGeneratorCommand({
        cwd: tempDir,
        entryPath: fixturePath,
        generatorPath: fixturePath,
        outputPath: path.join(tempDir, 'incur.generated.ts'),
        repoDir: tempDir,
        timeoutMs: 50,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(
          error.message,
          /Incur CLI artifact generation timed out after 1 second while importing the built CLI/u,
        )
        assert.match(error.message, /pnpm --dir packages\/cli gen:config-schema/u)
        assert.equal(error.message.includes(tempDir), false)
        return true
      },
    )
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
})
