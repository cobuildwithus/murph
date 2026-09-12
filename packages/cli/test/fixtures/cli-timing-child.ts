import assert from 'node:assert/strict'
import { foodLabelResponse, syntheticOats } from './food-label-response.ts'

const [expectedRequests, ...argv] = process.argv.slice(2)
let requests = 0
// Test-only provider seam, shared response helper with the existing client
// tests. Never delegate to a live fetch, even for unexpected requests.
globalThis.fetch = async (input, init) => {
  requests += 1
  const url = new URL(String(input))
  assert.equal(url.origin, 'http://murph-data-api.worker')
  assert.equal(url.pathname, '/api/foods')
  assert.equal(url.searchParams.get('q'), 'synthetic oats')
  assert.equal(url.searchParams.get('limit'), '1')
  assert.equal(url.searchParams.get('nutritionOnly'), 'true')
  assert.equal(init?.method, 'GET')
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer SYNTHETIC_SECRET_TOKEN')
  return foodLabelResponse([syntheticOats])
}
process.on('exit', () => { assert.equal(requests, Number(expectedRequests)) })
process.loadEnvFile = () => { assert.fail('Child must not load .env') }
// Batch duration is result data. Freeze its existing wall clock, not timing's
// monotonic clock, so telemetry-on/off stdout can be compared byte for byte.
Date.now = () => 1_900_000_000_000

// Same source entry as production batch actions. Unlike old tests, do NOT
// inject exit/stdout: Incur's failure path really terminates this process.
const { runMurphCliAction, renderMurphCliEntrypointError } = await import('../../src/cli-entry.ts')
try {
  await runMurphCliAction(argv, { argv0: 'vault-cli' })
} catch (error) {
  // Use the bin's real renderer for errors before Incur can own the exit.
  const rendered = await renderMurphCliEntrypointError(error, argv)
  const stream = rendered.machineReadable ? process.stdout : process.stderr
  stream.write(`${rendered.output}\n`)
  process.exitCode = rendered.exitCode
}
