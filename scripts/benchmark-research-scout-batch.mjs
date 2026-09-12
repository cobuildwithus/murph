import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

// Compare actual old/new clients against the same installed SDK and contracts.
// Export the old source with git show; no provider or runtime credentials are used.
const root = fileURLToPath(new URL('../', import.meta.url))
const clientPath = path.join(root, 'packages/cli/src/research-scout-client.ts')
const baselinePath = process.argv[2]
assert.ok(baselinePath && process.argv.length === 3,
  'Usage: node scripts/benchmark-research-scout-batch.mjs BASELINE_SOURCE.ts')
// Reuse the existing declared esbuild owner, as other repository benchmarks do.
const require = createRequire(path.join(root, 'apps/cloudflare/package.json'))
const { build } = require('esbuild')
const warmups = 2
const measured = 7
const delayMs = 40
const labels = ['sleep', 'recovery', 'nutrition', 'exercise']
const input = {
  lanes: labels.map((label) => ({ label, profile: { topics: ['sleep'] } })),
  since: '2026-04-18T00:00:00.000Z',
  until: '2026-06-17T00:00:00.000Z',
  maxCandidatesPerLane: 2,
}
const providerPayload = {
  results: [{ title: 'Synthetic source', url: 'https://example.test/paper' }],
  output: { content: { candidates: [] } },
}
const expected = JSON.stringify({
  provider: { name: 'exa', endpoint: 'search', mode: 'deep-reasoning' },
  privacy: {
    tokenSource: 'env', persistedByTool: false,
    sentProfileKind: 'tag_profile', rawVaultValuesSent: false,
  },
  lanes: labels.map((label) => ({ label, response: providerPayload })),
})
assert.equal(Buffer.byteLength(expected), 790)

async function sample(client, expectedPeak) {
  let active = 0
  let peak = 0
  let calls = 0
  const started = performance.now()
  const output = await client.fetchExaResearchScoutBatchCandidates(input, {
    env: { EXA_API_KEY: 'synthetic-exa-token' },
    async fetchImpl(target, init) {
      assert.equal(String(target), 'https://api.exa.ai/search')
      assert.equal(init?.method, 'POST')
      assert.ok(init.signal)
      calls += 1
      active += 1
      peak = Math.max(peak, active)
      try {
        await setTimeout(delayMs, undefined, { signal: init.signal })
        return new Response(JSON.stringify(providerPayload))
      } finally {
        active -= 1
      }
    },
  })
  const elapsedMs = performance.now() - started
  assert.equal(JSON.stringify(output), expected, 'Full ordered output must be byte-identical')
  assert.equal(calls, 4)
  assert.equal(peak, expectedPeak)
  assert.equal(active, 0)
  return { elapsedMs, calls, peak, bytes: Buffer.byteLength(expected) }
}

const scratchRoot = path.join(root, '.runtime/tmp')
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(path.join(scratchRoot, 'research-scout-bench-'))
try {
  const sources = await Promise.all([baselinePath, clientPath].map((file) => readFile(file, 'utf8')))
  const clients = []
  for (const [index, contents] of sources.entries()) {
    const outfile = path.join(scratch, `${index}.cjs`)
    await build({
      stdin: { contents, loader: 'ts', resolveDir: path.dirname(clientPath), sourcefile: 'research-scout-client.ts' },
      tsconfig: path.join(root, 'tsconfig.base.json'),
      bundle: true, platform: 'node', format: 'cjs', outfile,
      logLevel: 'silent',
    })
    clients.push(require(outfile))
  }
  const samples = [[], []]
  // Alternate order to avoid consistently favoring the second implementation.
  for (let round = 0; round < warmups + measured; round += 1) {
    for (const index of round % 2 === 0 ? [0, 1] : [1, 0]) {
      const result = await sample(clients[index], index + 1)
      if (round >= warmups) samples[index].push(result)
    }
  }
  const reports = samples.map((runs, index) => {
    const times = runs.map((run) => run.elapsedMs).sort((a, b) => a - b)
    return {
      label: index === 0 ? 'serial-baseline' : 'bounded-current',
      sourceSha256: createHash('sha256').update(sources[index]).digest('hex'),
      medianMs: times[Math.floor(times.length / 2)],
      minMs: times[0], maxMs: times.at(-1),
      calls: runs[0].calls, peak: runs[0].peak, bytes: runs[0].bytes,
      samplesMs: runs.map((run) => run.elapsedMs),
    }
  })
  console.log(JSON.stringify({
    syntheticOnly: true, node: process.version, warmups, measured, delayMs,
    labels, outputSha256: createHash('sha256').update(expected).digest('hex'),
    reports, medianRatio: reports[0].medianMs / reports[1].medianMs,
  }, null, 2))
} finally {
  await rm(scratch, { recursive: true, force: true })
}
