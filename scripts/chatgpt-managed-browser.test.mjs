import test from 'node:test'
import assert from 'node:assert/strict'

import { pollUntil } from './chatgpt-managed-browser.mjs'

test('pollUntil returns the first ready value from a custom readiness predicate', async () => {
  let attempts = 0

  const value = await pollUntil(
    async () => ({ attempts: ++attempts }),
    {
      isReady: (state) => state.attempts === 3,
      pollMs: 0,
      timeoutMs: 50,
    },
  )

  assert.deepEqual(value, { attempts: 3 })
  assert.equal(attempts, 3)
})

test('pollUntil surfaces the caller-provided timeout message', async () => {
  await assert.rejects(
    () => pollUntil(
      async () => false,
      {
        pollMs: 0,
        timeoutMs: 5,
        timeoutMessage: 'Timed out waiting for managed browser test state',
      },
    ),
    /Timed out waiting for managed browser test state/,
  )
})
