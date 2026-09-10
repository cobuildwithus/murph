import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'
import {
  formatForegroundLogLine,
  resolveForegroundTerminalLogOptions,
} from '../src/run-terminal-logging.js'

test('package manifest exposes only the intentional assistant command and runtime logging subpaths without a root fallback', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports?: Record<string, { default?: string; types?: string } | undefined>
    main?: string
    name?: string
    private?: boolean
    type?: string
    types?: string
  }

  assert.equal(packageManifest.name, '@murphai/assistant-cli')
  assert.equal(packageManifest.private, true)
  assert.equal(packageManifest.type, 'module')
  assert.equal(packageManifest.main, undefined)
  assert.equal(packageManifest.types, undefined)
  assert.equal(packageManifest.exports?.['.'], undefined)
  assert.deepEqual(packageManifest.exports?.['./commands/assistant'], {
    types: './dist/commands/assistant.d.ts',
    default: './dist/commands/assistant.js',
  })
  assert.deepEqual(packageManifest.exports?.['./run-terminal-logging'], {
    types: './dist/run-terminal-logging.d.ts',
    default: './dist/run-terminal-logging.js',
  })
  assert.deepEqual(Object.keys(packageManifest.exports ?? {}), [
    './commands/assistant',
    './run-terminal-logging',
  ])
  assert.equal(packageManifest.exports?.['./assistant/*'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/cron'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/daemon-client'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/doctor'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/outbox'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/runtime'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/service'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/status'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/stop'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/store'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/ui/chat-controller-state'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/ui/composer-editor'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/ui/ink'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/ui/model-switcher'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/ui/theme'], undefined)
  assert.equal(packageManifest.exports?.['./assistant/ui/view-model'], undefined)
})

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
