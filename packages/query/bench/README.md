# Query resource benchmarks

## Projection rebuild and indexed reads

Run this synthetic benchmark in a disposable Docker container. It uses the public
core import and query APIs to build metric history plus searchable canonical
notes, verify a full SQLite rebuild, repeat indexed 50-row reads, and trigger
rebuilds after appending or correcting twelve observations. Semantic hashes check
the complete expected metric history, and warm reads must preserve `builtAt`.
The fixture never uses credentials, network access, or production records.

From the repository root after the normal frozen dependency install:

```sh
node scripts/run-typescript.mjs package --project packages/query/bench/tsconfig.json --pretty false

apps/cloudflare/node_modules/.bin/esbuild packages/query/bench/query-projection.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/container-query/query-projection.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

docker run --rm --platform linux/amd64 --network none \
  --cpus 1 --memory 3g --memory-swap 3g --pids-limit 128 --user 0 \
  --mount "type=bind,src=$PWD/.artifacts/container-query,dst=/bench,readonly" \
  --mount "type=bind,src=$PWD/scripts/container-resource-probe.mjs,dst=/probe.mjs,readonly" \
  -e MURPH_QUERY_BENCH_EVENTS=8000 \
  --entrypoint node \
  ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.153.4 \
  --expose-gc --import /probe.mjs /bench/query-projection.mjs
```

Repeat sequentially at 2 CPUs / 6 GiB and 1 CPU / 6 GiB, keeping memory and swap
limits equal to disable swap. Keep the source, image, fixture, GC/probe options,
and host load fixed. For full runtime interference tests, use the assembled
runner image and run the relevant concurrent workload separately; this command
runs only the public query/import owners and benchmark instrumentation.

Inputs:

- `MURPH_QUERY_BENCH_EVENTS`: metric observations, default 8,000; range 12–50,000.
- `MURPH_QUERY_BENCH_NOTE_EVERY`: one additional note per this many observations,
  default 10; range 1–100. Lower values increase entity and search storage.
- `MURPH_QUERY_BENCH_WARM_RUNS`: repeated reads per warm phase, default 5; range 1–20.

For a small correctness run use 12 observations and one warm read. To exercise
more accumulated history use 50,000 observations; notes and observations are
imported in separate batches of at most 8,000, preserving the public ingest limit.

JSONL output reports per-operation wall/CPU time and process memory, SQLite
DB/WAL/SHM sizes, page/freelist counts, and table/source-file counts. No VACUUM or
cache deletion is performed. With `--expose-gc`, long operation samples collect
garbage before timing and mark `forcedGcBeforeRun=true`; quota consumption from
that collection can carry into the measured operation. Warm reads do not force
GC, so their timings do not deliberately create a post-GC quota stall.

The shared preload adds whole-container counters and event-loop measurements.
Peaks include fixture setup, correctness reads, cleanup, and file cache. They are
not incremental projection heap peaks. Optional HTTP heartbeat settings and
sampling limits are documented in
[the sizing investigation](../../core/bench/container-sizing.md).

This fixture has few ledger files even when its row count is large. It does not
establish performance for thousands of canonical Markdown files, resident Codex
children, hosted image loading, provider inference, or member-message delivery.
Use measured cache bytes when judging fixture coverage; event count alone does
not define a representative large cache.

## Automation history filtering

`automation.ts` uses public `listAutomations()` reads against synthetic canonical
files: one active, one paused, and the remaining archived. It writes fixtures in
batches of 16, then checks five reads for the exact selected IDs and matching
semantic hashes. `MURPH_AUTOMATION_BENCH_COUNT` defaults to 2,000 and accepts
integers from 2 to 50,000; use 12 for a small correctness run.

```sh
apps/cloudflare/node_modules/.bin/esbuild packages/query/bench/automation.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/container-query/automation.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

docker run --rm --platform linux/amd64 --network none \
  --cpus 1 --memory 3g --memory-swap 3g --pids-limit 128 --user 0 \
  --mount "type=bind,src=$PWD/.artifacts/container-query,dst=/bench,readonly" \
  --mount "type=bind,src=$PWD/scripts/container-resource-probe.mjs,dst=/probe.mjs,readonly" \
  -e MURPH_AUTOMATION_BENCH_COUNT=2000 \
  --entrypoint node \
  ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.153.4 \
  --import /probe.mjs /bench/automation.mjs
```

Use the same scoped typecheck and sequential comparison controls above. This
benchmark measures reading and validating automation history; it does not measure
scheduler execution, provider inference, or message delivery.
