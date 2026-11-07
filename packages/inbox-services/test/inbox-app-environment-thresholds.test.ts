import assert from 'node:assert/strict'

import { test } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createInboxAppEnvironment } from '../src/inbox-app/environment.ts'

test('requireParsers wraps non-Error runtime failures with parser package guidance', async () => {
  const env = createInboxAppEnvironment({
    loadParsersModule: async () => {
      throw 'parsers unavailable'
    },
  })

  await assert.rejects(
    () => env.requireParsers('media transcription'),
    (error: unknown) => {
      assert.ok(error instanceof VaultCliError)
      assert.equal(error.code, 'runtime_unavailable')
      assert.equal(
        error.message,
        'packages/cli can describe media transcription, but local execution is blocked until the integrating workspace builds and links @murphai/inboxd and @murphai/parsers.',
      )
      assert.deepEqual(error.context, {
        packages: ['@murphai/inboxd', '@murphai/parsers'],
      })
      return true
    },
  )
})
