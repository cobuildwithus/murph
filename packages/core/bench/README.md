# Device import CPU reproduction

Run this synthetic benchmark only in a disposable Docker container. It exercises
the real core import and canonical-write owners without provider credentials,
network access, production data, or host-mounted vault storage. Docker removes
the synthetic vault with the container. The optional CPU profile contains only
this synthetic workload.

From the repository root, after the normal frozen dependency install:

```sh
apps/cloudflare/node_modules/.bin/esbuild packages/core/bench/device-import.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/container-cpu/import.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

docker run --rm --platform linux/amd64 --network none \
  --cpus 1 --memory 6g --pids-limit 128 --user 0 \
  --mount "type=bind,src=$PWD/.artifacts/container-cpu,dst=/bench,readonly" \
  --entrypoint node \
  ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.151.0 \
  /bench/import.mjs
```

Repeat at `--cpus 2`. Keep the harness, image, memory, event count, filesystem,
and profiler settings identical when comparing source revisions. Run containers
sequentially; do not mix profiling runs with unprofiled timing results. For a
profile, remove `readonly` from the benchmark mount and add
`-e MURPH_BENCH_PROFILE=/bench/import.cpuprofile`. Do not commit that artifact.
Optional inputs are `MURPH_BENCH_EVENTS` (default 8,000, range 12–50,000) and
`MURPH_BENCH_TIME_ZONES` (default `UTC`; comma-separated zones alternate by
event). For example, `UTC,America/Chicago` exercises mixed-timezone history.

The harness reports process-to-module-ready time, initial import, a new batch,
a disjoint session-cache hit, replay, and correction. It asserts replay is not
applied, correction retains IDs and advances revisions, and canonical readback
contains the corrected value. Semantic hashes must match between compared
builds. Module-ready time is for the core benchmark, **not** the hosted runner's
listening port, full runtime hydration, or first useful invocation.

## September 2026 measurement

Baseline source: `0a1616a9e2e7`. Both builds used this same harness; the candidate
only added bounded result reuse to `normalizeIanaTimeZone`. Three alternating,
unprofiled runs used 8,000 UTC events and the pinned AMD64 image above on an ARM
Docker host. These are emulated relative measurements, not production latency
predictions. Host contention was visible across experiment rounds; three local
runs do not establish production non-regression at the smaller quota.

| Median wall time | Baseline, 2 vCPU | Candidate, 1 vCPU |
| --- | ---: | ---: |
| Initial 8,000-event import | 4.83 s | 1.75 s |
| New 12-event batch with history scan | 1.15 s | 0.61 s |
| Replay with history scan | 1.13 s | 0.40 s |
| Disjoint session-cache hit | 0.15 s | 0.13 s |
| Correction | 0.15 s | 0.15 s |

All semantic hashes and canonical readbacks matched. The original one-vCPU CPU
profile identified repeated native timezone validation as the dominant history
scan cost. The candidate retains up to 64 successful explicit-zone resolutions,
clearing the lookup on the next distinct successful resolution. Aliases count
toward that bound. Only normalized zone identifiers are retained, never invalid
inputs or date-specific offsets/DST calculations. There is no TTL, persisted
state, or new invalidation owner. ICU
remains authoritative on every miss. This replaced an initial single-result
experiment that left repeated ICU work in mixed-zone scans.

A paired 2,000-event alternating-zone run at one vCPU also preserved every
semantic hash and canonical readback. New-batch wall time was 0.54 s baseline
and 0.21 s candidate; replay was 0.25 s and 0.13 s. These are individual samples,
not a general latency guarantee.

The actual assembled runner also reached its listening port, reported healthy
heavy-runtime hydration, and closed cleanly in network-disabled Docker at both
CPU quotas. An isolated whitespace-minification experiment reduced total JS
bytes from 11,853,874 to 9,969,313, but three one-vCPU trials showed no reliable
full-hydration improvement. That packaging change was rejected; boot and
hydration architecture remain unchanged. A final-artifact pair reached heavy
hydration at 5.38 s on one vCPU versus 3.66 s on two vCPUs, reinforcing the need
to keep production sizing unchanged. These are emulated individual samples.
This proof did not restore a live vault or start a provider turn.

This is not approval to downsize production. Recheck on native AMD64 and a
protected hosted canary at one vCPU, including mixed-zone history, large vault
restore, concurrent foreground work, full hydration, first provider start, and
sync completion. Preserve the current two-vCPU configuration until those paths
meet the existing latency expectations. Sync cadence, admission, mailbox,
orchestration, and canonical-write durability are unchanged.
