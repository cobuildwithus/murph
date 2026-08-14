import assert from 'node:assert/strict'

import { test, vi } from 'vitest'

import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { createInboxAppEnvironment } from '../src/inbox-app/environment.ts'

test('default helper methods expose live process values and the no-op auto-reply default', async () => {
  const env = createInboxAppEnvironment()

  assert.ok(env.clock() instanceof Date)
  assert.equal(env.getPid(), process.pid)
  assert.equal(env.getPlatform(), process.platform)
  assert.ok(env.getHomeDirectory().length > 0)
  assert.equal(env.usesInjectedTelegramDriver, false)

  const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
  try {
    env.killProcess(123, 'SIGTERM')
    assert.deepEqual(killSpy.mock.calls[0], [123, 'SIGTERM'])
  } finally {
    killSpy.mockRestore()
  }

  await env.sleep(0)
  assert.equal(
    await env.enableAssistantAutoReplyChannel('/tmp/vault', 'telegram'),
    false,
  )
})

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
