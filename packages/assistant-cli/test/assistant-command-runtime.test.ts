import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  formatForegroundLogLine,
  resolveForegroundTerminalLogOptions,
} from '../src/run-terminal-logging.js'

test('resolveForegroundTerminalLogOptions follows the unsafe details flag and formats a stable log line', () => {
  assert.deepEqual(resolveForegroundTerminalLogOptions({}), {
    unsafeDetails: false,
  })
  assert.deepEqual(
    resolveForegroundTerminalLogOptions({
      UNSAFE_FOREGROUND_LOG_DETAILS: '1',
    }),
    {
      unsafeDetails: true,
    },
  )

  const now = new Date('2026-03-28T00:00:00.000Z')
  now.getHours = () => 1
  now.getMinutes = () => 2
  now.getSeconds = () => 3

  assert.equal(
    formatForegroundLogLine('assistant', 'ready to run', now),
    '[assistant 01:02:03] ready to run',
  )
})
