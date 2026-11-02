import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { test } from 'vitest'

const execFileAsync = promisify(execFile)
const gatewayCoreSourceDir = path.resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  '..',
  'gateway-core',
  'src',
)

test('murph no longer publishes legacy gateway-core compatibility exports', async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    exports: Record<string, { default?: string; types?: string }>
  }

  assert.equal(packageManifest.exports['./gateway-core'], undefined)
  assert.equal(packageManifest.exports['./gateway-core-local'], undefined)
})

test('gateway-core stays transport-neutral without a vault-backed local surface', async () => {
  const gatewayCoreManifest = JSON.parse(
    await readFile(path.resolve(gatewayCoreSourceDir, '..', 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string | undefined>
  }
  const packageIndex = await readFile(path.join(gatewayCoreSourceDir, 'index.ts'), 'utf8')

  assert.doesNotMatch(packageIndex, /from ['"]murph\/gateway-core['"]/u)
  assert.doesNotMatch(packageIndex, /local-runtime/u)
  assert.equal(gatewayCoreManifest.dependencies?.['@murphai/assistant-core'], undefined)
  assert.equal(gatewayCoreManifest.dependencies?.['@murphai/inboxd'], undefined)
  assert.equal(gatewayCoreManifest.dependencies?.['@murphai/runtime-state'], undefined)

  await assert.rejects(
    access(path.join(gatewayCoreSourceDir, 'local.ts'), constants.F_OK),
  )
  await assert.rejects(
    access(path.join(gatewayCoreSourceDir, 'local-service.ts'), constants.F_OK),
  )
  await assert.rejects(
    access(path.join(gatewayCoreSourceDir, 'local-runtime.ts'), constants.F_OK),
  )
  await assert.rejects(
    access(new URL('../src/gateway-core.ts', import.meta.url), constants.F_OK),
  )
  await assert.rejects(
    access(new URL('../src/gateway-core-local.ts', import.meta.url), constants.F_OK),
  )
  await assert.rejects(
    access(path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'src', 'gateway'), constants.F_OK),
  )
})

test('workspace source resolution points directly at gateway-core with no local gateway alias left behind', async () => {
  const tsconfig = JSON.parse(
    await readFile(new URL('../../../tsconfig.base.json', import.meta.url), 'utf8'),
  ) as {
    compilerOptions?: {
      paths?: Record<string, string[] | undefined>
    }
  }

  assert.deepEqual(tsconfig.compilerOptions?.paths?.['@murphai/gateway-core'], [
    './packages/gateway-core/src/index.ts',
  ])
  assert.equal(tsconfig.compilerOptions?.paths?.['@murphai/gateway-local'], undefined)
  assert.equal(tsconfig.compilerOptions?.paths?.['@murphai/gateway-core/local'], undefined)
  assert.equal(tsconfig.compilerOptions?.paths?.['murph/gateway-core'], undefined)
  assert.equal(tsconfig.compilerOptions?.paths?.['murph/gateway-core-local'], undefined)
})

test('built @murphai/gateway-core import stays free of assistant runtime warnings', async () => {
  const distPath = new URL('../../gateway-core/dist/index.js', import.meta.url)
  try {
    await access(distPath, constants.F_OK)
  } catch {
    return
  }

  const result = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    `import(${JSON.stringify(distPath.href)})`,
  ])

  assert.equal(result.stdout.trim(), '')
  assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/u)
})
