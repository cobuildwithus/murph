import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', builds: 0, failBuild: false }))
const commandSuffix = '/packages/assistant-cli/'

function fixturePath(value: string): string | undefined {
  const offset = value.indexOf(commandSuffix)
  return offset < 0 ? undefined : path.join(fixture.root, value.slice(offset + commandSuffix.length))
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
        if (args[0] === 'build:test-runtime:prepared') {
          fixture.builds += 1
          if (fixture.failBuild) {
            callback(new Error('Synthetic compiler failure'))
            return
          }
          writeFileSync(path.join(fixture.root, 'dist/commands/assistant.js'), readFileSync(path.join(fixture.root, 'src/commands/assistant.ts')))
          writeFileSync(path.join(fixture.root, 'dist/commands/assistant.d.ts'), 'export declare const result: string\n')
        } else {
          assert.deepEqual(args, ['exec', 'node', '--import=tsx', 'packages/cli/scripts/verify-package-shape.ts'])
        }
        callback(null)
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
  writeFileSync(path.join(fixture.root, 'src/commands/assistant.ts'), `export const result = ${JSON.stringify(source)}\n`)
  writeFileSync(path.join(fixture.root, 'dist/commands/assistant.js'), `export const result = ${JSON.stringify(built)}\n`)
  writeFileSync(path.join(fixture.root, 'dist/commands/assistant.d.ts'), 'export declare const result: string\n')
  await utimes(path.join(fixture.root, 'dist/commands/assistant.js'), 100, 100)
  await utimes(path.join(fixture.root, 'src/commands/assistant.ts'), 200, 200)
}

function builtResult(): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', 'import { result } from "./dist/commands/assistant.js"; process.stdout.write(result)'], { cwd: fixture.root, encoding: 'utf8' })
}

describe.sequential('built assistant command artifacts', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS', '')
    fixture.root = await mkdtemp(path.join(tmpdir(), 'murph-cli-artifact-'))
    fixture.builds = 0
    fixture.failBuild = false
    await writeCommand('current', 'stale')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    // Use the unmocked cleanup boundary, never the actual workspace artifacts.
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    await actual.rm(fixture.root, { recursive: true, force: true })
  })

  test('rebuilds an importable stale assistant command before executing its built result', async () => {
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    assert.equal(builtResult(), 'stale')
    await ensureCliRuntimeArtifacts()
    assert.equal(builtResult(), 'current')
    assert.equal(fixture.builds, 1)
  })

  test('reuses an importable current command without rebuilding', async () => {
    await writeCommand('current', 'current')
    await utimes(path.join(fixture.root, 'dist/commands/assistant.js'), 300, 300)
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifacts()
    await ensureCliRuntimeArtifacts()
    assert.equal(builtResult(), 'current')
    assert.equal(fixture.builds, 0)
  })

  test.each(['assistant.js', 'assistant.d.ts'])('repairs missing %s even in a prepared runtime', async (file) => {
    vi.stubEnv('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS', '1')
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    await actual.rm(path.join(fixture.root, 'dist/commands', file))
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifacts()
    assert.equal(builtResult(), 'current')
    assert.equal(fixture.builds, 1)
  })

  test('trusts explicit prepared builds but force revalidation repairs stale output', async () => {
    vi.stubEnv('MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS', '1')
    const { ensureCliRuntimeArtifactsWithOptions } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifactsWithOptions()
    assert.equal(fixture.builds, 0)
    await ensureCliRuntimeArtifactsWithOptions({ forceReverify: true })
    assert.equal(builtResult(), 'current')
    assert.equal(fixture.builds, 1)
  })

  test('rechecks an edited command after this process has verified the runtime', async () => {
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await ensureCliRuntimeArtifacts()
    await writeCommand('edited', 'current')
    await ensureCliRuntimeArtifacts()
    assert.equal(builtResult(), 'edited')
    assert.equal(fixture.builds, 2)
  })

  test('propagates build failure and releases its repair lock for the next attempt', async () => {
    fixture.failBuild = true
    const { ensureCliRuntimeArtifacts } = await import('./cli-test-helpers.js')
    await assert.rejects(ensureCliRuntimeArtifacts(), /Synthetic compiler failure/u)
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    assert.equal(actual.existsSync(path.join(fixture.root, 'lock/cli-runtime-artifacts.lock')), false)
    fixture.failBuild = false
    await ensureCliRuntimeArtifacts()
    assert.equal(builtResult(), 'current')
  })
})
