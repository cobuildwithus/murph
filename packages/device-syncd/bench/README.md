# Device pass import cost

`device-pass.ts` is an opt-in synthetic benchmark of durable job execution through
`createDeviceSyncService`, the Junction snapshot importer, and core canonical
storage. It creates six monthly event shards with samples, sleep, and workout
observation families. A pass has 80 resource/reconcile job rows; every second
row re-imports the prior row's exact snapshot. The provider executor is local
and deterministic, so these numbers exclude provider network time, hosted
checkpoint callbacks, artifact upload, and query projection publication.

From the repository root after a frozen dependency install:

```sh
node scripts/run-typescript.mjs check --project packages/device-syncd/bench/tsconfig.json --pretty false
apps/cloudflare/node_modules/.bin/esbuild packages/device-syncd/bench/device-pass.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json --outfile=.artifacts/device-pass-bench.mjs \
  --banner:js='import { createRequire as benchCreateRequire } from "node:module"; const require = benchCreateRequire(import.meta.url);'
MURPH_DEVICE_PASS_SAVE_FIXTURE=.artifacts/device-pass-fixture \
  node .artifacts/device-pass-bench.mjs
MURPH_DEVICE_PASS_FIXTURE=.artifacts/device-pass-fixture \
  MURPH_DEVICE_PASS_PROFILE=.artifacts/device-pass.cpuprofile \
  node --cpu-prof --cpu-prof-dir=.artifacts .artifacts/device-pass-bench.mjs
node --test packages/device-syncd/bench/differential.test.mjs
```

The second run reuses identical seeded vault bytes. Output contains only
aggregate stage medians and a SHA-256 manifest of canonical vault files,
including receipts. `MURPH_DEVICE_PASS_HISTORY_ROWS` defaults to 105,000 and
`MURPH_DEVICE_PASS_JOB_ROWS` to 80. A small smoke run can set both to 200 and
4 respectively. `.artifacts` is disposable and ignored by Git. To compare
revisions, run the same fixture and job count on each build and require equal
manifest hashes. The differential test runs the same durable job sequence with
the original unscoped cache policy and the new pass scope, and compares every
canonical file byte through its SHA-256 manifest, including integration ingest
receipts. The CPU profile collected through Inspector covers only the
job pass; Node's `--cpu-prof` also captures fixture copying and startup.

The source history is intentionally larger than the core process cache's
100,000-row retention cap. This probes the repeated index scan seen in slow
jobs. Below that cap, the existing cache already avoids most repeated scans.
