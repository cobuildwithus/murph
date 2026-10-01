import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Export the baseline route with git show. Both variants use the current shared
// dependencies. This measures fresh Node module evaluation, not Vercel startup.
const root = fileURLToPath(new URL('../', import.meta.url))
const baselinePath = process.argv[2]
assert.ok(baselinePath && process.argv.length === 3,
  'Usage: node scripts/benchmark-hosted-checkpoint-startup.mjs BASELINE_ROUTE.ts')
const routePath = path.join(root, 'apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts')
const { build } = createRequire(path.join(root, 'apps/cloudflare/package.json'))('esbuild')
const scratchRoot = path.join(root, 'apps/web/.runtime/tmp')
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(path.join(scratchRoot, 'checkpoint-startup-'))
const probe = `
  const assert = require('node:assert/strict');
  const Module = require('node:module');
  const original = Module._load;
  const loaded = new Set();
  Module._load = function(id, ...args) {
    loaded.add(id);
    return original.call(this, id, ...args);
  };
  const started = performance.now();
  const route = require(process.argv[1]);
  const elapsedMs = performance.now() - started;
  assert.equal(typeof route.POST, 'function');
  console.log(JSON.stringify({elapsedMs,
    temporalLoaded: loaded.has('@temporalio/client'),
    kmsLoaded: loaded.has('@google-cloud/kms')}));
`
try {
  const sources = await Promise.all([baselinePath, routePath].map(file => readFile(file, 'utf8')))
  const outputs = []
  for (const [index, contents] of sources.entries()) {
    const outfile = path.join(scratch, `${index}.cjs`)
    await build({
      stdin: { contents, loader: 'ts', resolveDir: path.dirname(routePath), sourcefile: 'route.ts' },
      absWorkingDir: root, tsconfig: path.join(root, 'apps/web/tsconfig.json'),
      bundle: true, platform: 'node', format: 'cjs', conditions: ['react-server'],
      // Keep heavy SDKs as real installed Node imports so the probe can observe
      // their initialization. This deliberately is not a Next production build.
      external: ['next/*', '@prisma/client', '@prisma/adapter-pg', '@temporalio/client',
        '@google-cloud/kms', '@vercel/oidc', 'google-auth-library', 'pg'],
      outfile, logLevel: 'silent',
    })
    outputs.push(outfile)
  }
  const samples = [[], []]
  for (let round = 0; round < 8; round += 1) {
    for (const index of round % 2 === 0 ? [0, 1] : [1, 0]) {
      const result = spawnSync(process.execPath,
        ['--conditions=react-server', '-e', probe, outputs[index]],
        { cwd: root, encoding: 'utf8', timeout: 30_000 })
      assert.equal(result.status, 0, 'Checkpoint import probe failed')
      const sample = JSON.parse(result.stdout.trim())
      if (index === 1) {
        assert.equal(sample.temporalLoaded, false, 'Checkpoint import must not initialize Temporal')
        assert.equal(sample.kmsLoaded, false, 'Checkpoint import must not initialize KMS')
      }
      if (round > 0) samples[index].push(sample)
    }
  }
  console.log(JSON.stringify(samples.map((runs, index) => ({
    label: index === 0 ? 'baseline' : 'current',
    medianMs: runs.map(run => run.elapsedMs).sort((a, b) => a - b)[3],
    runs,
  })), null, 2))
} finally {
  await rm(scratch, { recursive: true, force: true })
}
