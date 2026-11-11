import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', builds: 0 }))
const commandSuffix = '/packages/cli/'

function fixturePath(value: string): string | undefined {
  const offset = value.indexOf(commandSuffix)
  if (offset < 0) return undefined
  const relative = value.slice(offset + commandSuffix.length)
  return (relative.includes('commands/assistant-onboarding.') || relative === 'dist/commands') ? path.join(fixture.root, relative) : undefined
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync(value: string) {
      const mapped = fixturePath(String(value))
      return mapped ? actual.existsSync(mapped) : true
    },
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  function mapped(value: string) {
    return fixturePath(value) ?? path.join(fixture.root, 'lock', path.basename(value))
  }
  return {
    ...actual,
    stat: (value: string) => actual.stat(mapped(value)),
    mkdir: (value: string, options: Parameters<typeof actual.mkdir>[1]) => actual.mkdir(mapped(value), options),
    rm: (value: string, options: Parameters<typeof actual.rm>[1]) => actual.rm(mapped(value), options),
  }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFile(command: string, args: string[], options: { cwd: string }, callback: (error: Error | null) => void) {
      if (command === 'pnpm') {
        fixture.builds += 1
        callback(new Error('Test workers must not build artifacts'))
        return
      }
      const mapped = fixturePath(options.cwd)
      if (mapped) {
        return actual.execFile(command, args, { ...options, cwd: mapped }, callback)
      }
      // Unrelated package import smoke checks are outside this regression.
      callback(null)
    },
  }
})

async function writeCommand(source: string, built: string) {
  for (const directory of ['src/commands', 'dist/commands']) {
    mkdirSync(path.join(fixture.root, directory), { recursive: true })
  }
  writeFileSync(path.join(fixture.root, 'package.json'), '{"type":"module"}')
  writeFileSync(path.join(fixture.root, 'src/commands/assistant-onboarding.ts'), `export const result = ${JSON.stringify(source)}\n`)
  writeFileSync(path.join(fixture.root, 'dist/commands/assistant-onboarding.js'), `export const result = ${JSON.stringify(built)}\n`)
  writeFileSync(path.join(fixture.root, 'dist/commands/assistant-onboarding.d.ts'), 'export declare const result: string\n')
  await utimes(path.join(fixture.root, 'dist/commands/assistant-onboarding.js'), 100, 100)
  await utimes(path.join(fixture.root, 'src/commands/assistant-onboarding.ts'), 200, 200)
}

function builtResult(): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', 'import { result } from "./dist/commands/assistant-onboarding.js"; process.stdout.write(result)'], { cwd: fixture.root, encoding: 'utf8' })
}

describe.sequential('built assistant command artifacts', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS', '')
    fixture.root = await mkdtemp(path.join(tmpdir(), 'murph-cli-artifact-'))
    fixture.builds = 0
    await writeCommand('current', 'stale')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // Use the unmocked cleanup boundary, never the actual workspace artifacts.
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    await actual.rm(fixture.root, { recursive: true, force: true })
  })

  test('rejects stale output without building inside the test worker', async () => {
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await assert.rejects(ensureCliRuntimeArtifacts(), /pnpm build:test-runtime:prepared/u)
    assert.equal(builtResult(), 'stale')
    assert.equal(fixture.builds, 0)
  })

  test('reuses an importable current command without rebuilding', async () => {
    await writeCommand('current', 'current')
    await utimes(path.join(fixture.root, 'dist/commands/assistant-onboarding.js'), 300, 300)
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifacts()
    await ensureCliRuntimeArtifacts()
    assert.equal(builtResult(), 'current')
    assert.equal(fixture.builds, 0)
  })

  test.each(['assistant-onboarding.js', 'assistant-onboarding.d.ts'])('rejects missing %s even in a prepared runtime', async (file) => {
    vi.stubEnv('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS', '1')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    await actual.rm(path.join(fixture.root, 'dist/commands', file))
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await assert.rejects(ensureCliRuntimeArtifacts(), /pnpm build:test-runtime:prepared/u)
    assert.equal(fixture.builds, 0)
  })

  test('trusts explicit prepared builds but force revalidation rejects stale output', async () => {
    vi.stubEnv('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS', '1')
    const { ensureCliRuntimeArtifactsWithOptions } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifactsWithOptions()
    assert.equal(fixture.builds, 0)
    await assert.rejects(ensureCliRuntimeArtifactsWithOptions({ forceReverify: true }), /pnpm build:test-runtime:prepared/u)
    assert.equal(fixture.builds, 0)
  })

  test('rejects a later source edit after this process verified the runtime', async () => {
    await writeCommand('current', 'current')
    await utimes(path.join(fixture.root, 'dist/commands/assistant-onboarding.js'), 300, 300)
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifacts()
    await writeCommand('edited', 'current')
    await assert.rejects(ensureCliRuntimeArtifacts(), /pnpm build:test-runtime:prepared/u)
    assert.equal(fixture.builds, 0)
  })
})
