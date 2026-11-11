import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

it('preflights selected benchmark prerequisites before all provider work without blocking ordinary selection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-benchmark-preflight-'))
  const marker = path.join(root, 'provider-calls.txt')
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'PRIVATE_DATABASE_FAILURE_MUST_NOT_ESCAPE' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback address')
  try {
    await mkdir(path.join(root, 'test'))
    await writeFile(path.join(root, 'test', 'fixture.test.ts'), `
import { beforeAll, describe, it } from 'vitest'
import { appendFileSync } from 'node:fs'
const { preflightSelectedMealIntakeBenchmarks } = await import(process.env.PREFLIGHT_MODULE!)
beforeAll(async ({}, suite) => preflightSelectedMealIntakeBenchmarks(suite, JSON.parse(process.env.PREFLIGHT_ENV!)))
it('ordinary provider', () => appendFileSync(process.env.PROVIDER_MARKER!, 'ordinary\\n'))
describe('real Codex meal intake speed benchmark', () => {
  it('meal intake speed: restaurant-big-mac-fries', () => appendFileSync(process.env.PROVIDER_MARKER!, 'benchmark\\n'))
  it('meal intake speed: photo-sushi-rolls', () => appendFileSync(process.env.PROVIDER_MARKER!, 'photo\\n'))
})
`)
    const run = async (pattern: string, preflightEnv: NodeJS.ProcessEnv = {}) => {
      try {
        const result = await execFileAsync(process.execPath, [
          fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
          'run', '--config', fileURLToPath(new URL('../vitest.config.ts', import.meta.url)),
          '--root', root, '--no-coverage', '--testNamePattern', pattern,
        ], { timeout: 60_000, env: {
          ...process.env,
          PREFLIGHT_MODULE: fileURLToPath(new URL('./support/meal-intake-benchmark.ts', import.meta.url)),
          PREFLIGHT_ENV: JSON.stringify(preflightEnv), PROVIDER_MARKER: marker,
        } })
        return { status: 0, output: result.stdout + result.stderr }
      } catch (error) {
        if (!(error instanceof Error) || !('stdout' in error) || !('stderr' in error)) throw error
        return { status: 1, output: String(error.stdout) + String(error.stderr) }
      }
    }
    const ordinary = await run('^ordinary provider$')
    expect(ordinary.status, ordinary.output).toBe(0)
    expect(await readFile(marker, 'utf8')).toBe('ordinary\n')
    await rm(marker)

    const missing = await run('ordinary provider|restaurant-big-mac-fries')
    expect(missing.status).toBe(1)
    expect(missing.output).toContain('MEAL_BENCHMARK_PREREQUISITE')
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    const configured = { MURPH_MEAL_INTAKE_BENCH_IMAGE_DIR: root,
      MURPH_MEAL_INTAKE_BENCH_DATA_API_PROXY: `http://127.0.0.1:${address.port}` }
    const denied = await run('ordinary provider|restaurant-big-mac-fries', configured)
    expect(denied.status).toBe(1)
    expect(denied.output).toContain('local labels read failed')
    expect(denied.output).not.toContain('PRIVATE_DATABASE_FAILURE_MUST_NOT_ESCAPE')
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    const absentImage = await run('ordinary provider|photo-sushi-rolls', configured)
    expect(absentImage.status).toBe(1)
    expect(absentImage.output).toContain('image unavailable for photo-sushi-rolls')
    await writeFile(path.join(root, 'photo-sushi-rolls.jpg'), 'synthetic wrong bytes')
    const wrongImage = await run('ordinary provider|photo-sushi-rolls', configured)
    expect(wrongImage.status).toBe(1)
    expect(wrongImage.output).toContain('image hash mismatch for photo-sushi-rolls')
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })

    server.removeAllListeners('request')
    server.on('request', (request, response) => {
      expect(request.url).toBe('/api/foods?q=egg&limit=1')
      response.writeHead(200, { 'content-type': 'application/json' })
      // A valid empty search still proves database read access, not corpus coverage.
      response.end(JSON.stringify({ items: [] }))
    })
    const ready = await run('ordinary provider|restaurant-big-mac-fries', configured)
    expect(ready.status, ready.output).toBe(0)
    expect((await readFile(marker, 'utf8')).trim().split('\n').sort()).toEqual(['benchmark', 'ordinary'])
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 360_000)
