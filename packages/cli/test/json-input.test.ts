import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { loadJsonInputObject } from '@murphai/vault-inbox/json-input'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

test('loadJsonInputObject surfaces the stdin hint when stdin is interactive', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: true,
  })

  try {
    await assert.rejects(
      () => loadJsonInputObject('-', 'payload'),
      (error: unknown) => {
        assert.equal(error instanceof VaultCliError, true)
        assert.equal((error as { code?: string }).code, 'command_failed')
        assert.equal(
          (error as { message?: string }).message,
          'No payload was piped to stdin.',
        )
        assert.equal(
          (error as { context?: { hint?: string } }).context?.hint,
          'Pass --input @file.json or pipe a JSON object to --input -.',
        )
        return true
      },
    )
  } finally {
    if (descriptor) {
      Object.defineProperty(process.stdin, 'isTTY', descriptor)
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  }
})

test.sequential('loadJsonInputObject keeps @- bound to a literal file path', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'murph-json-input-'))
  const hyphenPath = path.join(tempRoot, '-')

  try {
    await writeFile(
      hyphenPath,
      JSON.stringify({
        title: 'Sleep longer',
        status: 'active',
      }),
      'utf8',
    )

    assert.deepEqual(
      await loadJsonInputObject(`@${hyphenPath}`, 'payload'),
      {
        title: 'Sleep longer',
        status: 'active',
      },
    )
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
