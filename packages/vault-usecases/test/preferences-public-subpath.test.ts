import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { test } from 'vitest'

test('package manifest exposes the dedicated preferences subpath', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports?: Record<string, { default?: string; types?: string } | undefined>
  }

  assert.deepEqual(manifest.exports?.['./preferences'], {
    types: './dist/preferences.d.ts',
    default: './dist/preferences.js',
  })
})
