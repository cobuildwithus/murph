# Core diagnostic benchmarks

## Meal owner read baseline

`meal-read.ts` is an opt-in, synthetic diagnostic of the actual `readOwnedEvent`
and canonical event-shard storage path. It makes no provider/production calls
and accepts no existing vault path. Each run creates its own `.artifacts` child
and removes that fixture on completion or handled failure. Output is JSON timing samples,
counts, byte totals, and parity results; no events, identifiers, or local paths.

From the repository root, after the normal frozen dependency install on the
repository-supported Node/pnpm versions:

```sh
node scripts/run-typescript.mjs package --project packages/core/bench/tsconfig.json --pretty false

apps/cloudflare/node_modules/.bin/esbuild packages/core/bench/meal-read.ts \
  --bundle --splitting --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json --outdir=.artifacts/meal-read-bench \
  --out-extension:.js=.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

node .artifacts/meal-read-bench/meal-read.mjs
```

| Environment variable | Default | Inclusive range |
| --- | ---: | ---: |
| `MURPH_MEAL_READ_ROWS` (unrelated rows) | 24,000 | 30–240,000 |
| `MURPH_MEAL_READ_MONTHS` | 24 | 3–120 |
| `MURPH_MEAL_READ_NOTE_BYTES` | 512 | 64–4,000 |
| `MURPH_MEAL_READ_ITERATIONS` (measured pairs) | 10 | 3–40 |
| `MURPH_MEAL_READ_WARMUPS` (unmeasured pairs) | 2 | 1–10 |

Rows must cover every month. For example:

```sh
MURPH_MEAL_READ_ROWS=120000 MURPH_MEAL_READ_MONTHS=48 \
  node .artifacts/meal-read-bench/meal-read.mjs
```

Setup validates every generated row, then writes each monthly shard once.
The fixed synthetic history ends in January 2026: older shards alternate gzip
and Brotli using core's compressor settings, and the newest shard remains plain.
Every eighth unrelated row is a note; the rest are observations with varying
metrics, values, timestamps, and external references. Three meal revisions span
both archive formats and plain storage, including an old owner and deliberately
out-of-order revisions. Byte totals cover ledger data, excluding vault metadata.

Every read must equal an independently constructed expected result, including
the complete event, canonical event ID, and logical ledger path. A separate,
untimed append proves both readers observe a new revision. These checks do not
replace the existing owner-conflict, reassignment, tombstone, corruption,
unrelated-record, archive, and path-safety tests; the benchmark changes none of
those owners or validation rules.

Warm pairs alternate reader order. `warm-reads` reports wall and process CPU
min/median/max, the paired **owned minus control** differences, ratios of medians,
and all numeric samples. Positive differences mean the control used less time
on this fixture. `readEvent` is a diagnostic one-scan control with a known event
ID; it does not discover owner candidates or detect duplicate live owners and
is **not a contract-equivalent replacement**. The difference includes owner
matching, grouping, and validation as well as the extra shard read/decode.

The split bundle keeps the first core import separately measurable. `core-import`
is one sample of loading/evaluating that bundled source graph; process-to-module
ready additionally includes Node/entry startup. Neither measures the production
CLI setup or its complete dispatch path. Fixture setup, validation, compression,
warmups, parity checks, and cleanup are excluded from read timings. Reads are
warm in-process measurements, not cold filesystem measurements; process CPU
includes GC and worker threads, and wall minus CPU is not a disk-wait estimate.

Next experiment: rerun fixed pairs at several row counts, then vary month count
at a fixed row count, on the same runtime and resource allocation. Compare effect
sizes and variability in both wall and CPU. If the owned/control gap grows with
ledger bytes, profile this synthetic workload to separate JSON/decompression CPU
from filesystem/path-check work before proposing an owner-preserving change.
This baseline does not establish the cause of production seconds or a production
speedup. No cache, index, telemetry patch, or production optimization is included.

## Cold CLI event-read import experiment

`scripts/benchmark-event-read-import.mjs` measures the actual assembled runner's
`node_modules/@murphai/murph/.bundle/bin.js` and installed native dependencies.
It does not measure a toy reader, an unbundled source CLI, or a replacement
resolver. Assembly bundles static imports with ESM splitting, but the variable
`loadRuntimeModule(specifier)` resolves core through its installed export map.
The existing assembler preserves that map and core's emitted files automatically.
Its shared external CLI timing owner stays unchanged. The root tsconfig already
maps `@murphai/core/*`; Web's independent source map names the semantic entry.

The candidate re-exports the two unchanged readers directly from the ledger.
Its closure still includes shared validation, event-spine and write helpers;
this experiment does not split those owners. Source-closure counts do not prove
that work disappears from the production graph. The native probe must show it.

Use Node 24.22.1 and pnpm 10.33.0. Independently assemble the unchanged base and
candidate with the normal frozen install and `pnpm --dir apps/cloudflare runner:bundle`.
Do not substitute a source-path loader or hand-built package shim. From the
candidate checkout, with checkout variables naming those two local checkouts:

```sh
BASE_BUNDLE="$BASE_CHECKOUT/apps/cloudflare/.deploy/runner-bundle"
CANDIDATE_BUNDLE="$CANDIDATE_CHECKOUT/apps/cloudflare/.deploy/runner-bundle"
node --test scripts/benchmark-event-read-import.test.mjs
node scripts/benchmark-event-read-import.mjs check "$CANDIDATE_BUNDLE"
node scripts/benchmark-event-read-import.mjs control "$BASE_BUNDLE"
node scripts/benchmark-event-read-import.mjs pairs "$BASE_BUNDLE" "$CANDIDATE_BUNDLE"
```

`check` is a deterministic regression over the real assembled CLI and a small
48-row, three-month version of the existing fixture. Successful `meal show`
must load the installed semantic entry, omit the native core root and unrelated
automation/memory/scheduled-log modules, and return the entire expected payload.
It fails the root-import baseline without a wall-time threshold. Both `check`
and paired runs exercise exact-event show, old-owner absence, appended revision
freshness, duplicate-owner conflict, tombstone visibility and invalid JSONL.
Paired runs compare every byte of stdout and stderr and exit status for each
success/error case. Exact `event show` retains its independent static core
dependencies; it is a correctness control, not another import-saving claim.
Running `check` against the base must specifically reach
`meal-read-still-loads-core-barrel`; a setup or correctness failure is not the
expected baseline failure.

`control` compares the base artifact with itself. `pairs` uses the same generated
vault at the same path for both artifacts. The existing `meal-read.ts` fixture
is seeded once outside child processes: 24,000 unrelated observations/notes,
24 months, gzip/Brotli/plain shards and three out-of-order meal revisions with
an old owner. `MURPH_MEAL_READ_ROWS`, `MURPH_MEAL_READ_MONTHS` and
`MURPH_MEAL_READ_NOTE_BYTES` keep the ranges documented above.
`MURPH_EVENT_READ_PAIRS` defaults to 10 measured pairs (range 8–40), after two
discarded warmup pairs. Every invocation is a new native process; execution is
sequential and base/candidate order alternates. No command runs a provider.

Separate traced invocations use Node's successful `load` hook, deduplicated by
module URL, to report actual file-module counts, on-disk loaded-file bytes,
returned-source bytes, unavailable-source counts, loaded CLI chunk bytes, and
the public core module labels removed. These are load-input measures, not a
claim about exact parser/evaluator work. Unknown-source CJS/native files still
contribute their file bytes. The probe observes the whole process, including
normal CLI teardown, and rejects dependencies outside the supplied artifact.
The builtin-only observer loads before observation; fixture and report code are
outside the CLI inventory.

Timing children disable load hooks. A common builtin-only preload records
whole-process CPU and process-start-to-exit-callback wall time, before its
receipt write. Parent spawn-to-close wall also includes scheduling, output drain
and the receipt write. All raw numeric pairs, min/median/max, paired deltas and
ratios are retained. Filesystem caches may be warm; this is cold Node module
state, not cold storage. Wall minus CPU is not disk wait. Neither source byte
counts nor the existing aggregate production phase maxima establish CPU cost.
The isolated child environment supplies no CLI UDP telemetry endpoint; existing
deterministic owner tests retain the phase-count and timing-wrapper proof.

Reports contain fixture stored/decoded bytes, a canonical-input content digest,
assembled CLI output bytes/digests, and complete stdout/stderr bytes/digests.
Raw output stays in memory; no rows, identifiers, local paths or provider content
are published. Ordinary `--format json` is compared unchanged; `--full-output`
adds duration metadata and is deliberately not requested. Canonical bytes must
remain unchanged by reads. The correctness battery's synthetic edits are restored,
and the owned temporary fixture is removed on completion or handled failure.

`pairs` fails after reporting evidence if the candidate still loads the native
core root or does not reduce both whole-process loaded module count and file
bytes. Reject the runtime/export candidate in that case and retain only this
diagnostic harness. A passing import gate alone is not a speedup: compare paired
CPU/wall effects with base/base variation, repeat under the intended resource
allocation, and retain any regressions. No production speedup or changelog is
justified until the parent independently confirms a material benefit.

Focused source proof, in addition to the native `check` command:

```sh
pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/event-read-surface.test.ts test/event-owner-timing.test.ts
pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts --no-coverage test/runtime.test.ts test/narrow-query-readers-real.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-document-meal.test.ts packages/cli/test/error-recovery-events-documents.test.ts
pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/workspace-source-resolution.test.ts
pnpm --filter @murphai/core typecheck
pnpm --filter @murphai/vault-usecases typecheck
node scripts/run-typescript.mjs package --project packages/core/bench/tsconfig.json --pretty false
node scripts/verify-workspace-boundaries.mjs
```

The existing real-model journey, when needed, is
`real model canonical hosted meal uses local installed CLI under member permissions`.
No assistant behavior, protocol, prompt, discoverability or recovery changes are
part of this experiment.

## Device import CPU reproduction

Run this synthetic benchmark only in a disposable Docker container. It exercises
the real core import and canonical-write owners without provider credentials,
network access, production data, or host-mounted vault storage. Docker removes
the synthetic vault with the container. The optional CPU profile contains only
this synthetic workload.

From the repository root, after the normal frozen dependency install:

```sh
node scripts/run-typescript.mjs package --project packages/core/bench/tsconfig.json --pretty false

apps/cloudflare/node_modules/.bin/esbuild packages/core/bench/device-import.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/container-cpu/import.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

docker run --rm --platform linux/amd64 --network none \
  --cpus 1 --memory 3g --memory-swap 3g --pids-limit 128 --user 0 \
  --mount "type=bind,src=$PWD/.artifacts/container-cpu,dst=/bench,readonly" \
  --entrypoint node \
  ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.158.0-live1 \
  /bench/import.mjs
```

Repeat at `--cpus 2 --memory 6g --memory-swap 6g` for the shape comparison,
or retain 6 GiB at both CPU quotas to isolate CPU allocation.
Keep the harness, image, event count, filesystem,
and profiler settings identical when comparing source revisions, and keep the
memory allocation fixed for that comparison. Run containers
sequentially; do not mix profiling runs with unprofiled timing results. For a
profile, remove `readonly` from the benchmark mount and add
`-e MURPH_BENCH_PROFILE=/bench/import.cpuprofile`. Do not commit that artifact.
Optional inputs are `MURPH_BENCH_EVENTS` (default 8,000, range 12–50,000) and
`MURPH_BENCH_TIME_ZONES` (default `UTC`; comma-separated zones alternate by
event). For example, `UTC,America/Chicago` exercises mixed-timezone history.
Set `MURPH_BENCH_SIGNAL=1` to include the live cancellation signal used by device
sync, including cooperative event-loop yields. With a large seeded history,
`MURPH_BENCH_ABORT_AFTER_MS=100` also checks timer-driven cancellation, unchanged
seed ledger bytes, lock release, and successful retry/replay. It fails if the
import finishes before the timer; use a history large enough to exercise the
scan. Cancellation timings separate timer dispatch delay from abort-to-release
latency. This synthetic timer does not measure hosted message admission.

The harness reports process-to-module-ready time, initial import, a new batch,
a disjoint session-cache hit, replay, and correction. It asserts replay is not
applied, correction retains IDs and advances revisions, and canonical readback
contains the corrected value. Semantic hashes must match between compared
builds. Module-ready time is for the core benchmark, **not** the hosted runner's
listening port, full runtime hydration, or first useful invocation.

## September 2026 measurement

Baseline source: `0a1616a9e2e7`. Both builds used this same harness; the candidate
only added bounded result reuse to `normalizeIanaTimeZone`. Three alternating,
unprofiled runs used 8,000 UTC events and the historical
`node24.14.1-codex0.151.0` AMD64 base on an ARM Docker host. These are emulated relative measurements, not production latency
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

## Required one-vCPU regression check

The existing `Production runner bundle budget (ubuntu)` CI job also runs:

```sh
node --test candidate/scripts/check-container-latency-ci.test.mjs
node candidate/scripts/check-container-latency-ci.mjs base candidate
```

Both arguments are independently installed checkouts with their complete
production runner bundles already assembled. CI supplies the exact candidate
and its proven first parent on native Linux AMD64; the job remains part of the
required release aggregate. It uses each checkout's production Dockerfile and
existing base-image preparation, without a separate service or dependency.

Three fresh-container samples per revision run sequentially in alternating
order. Every workload has a hard one-vCPU quota, 6 GiB memory with no swap, no
network, and only a read-only synthetic benchmark mount. The container writable
layer owns the synthetic vault. Exact created container IDs and unique task
image tags own cleanup, including workload failures and timeouts.

The candidate's identical harness is bundled against each revision's core code.
Three paths are guarded: packaged Node startup through healthy heavy-runtime
hydration, initial import of 8,000 alternating-timezone observations, and a
12-event update against that history. Replay, correction, canonical readback,
and matching semantic hashes remain prerequisites, even though only those
three timings are budgeted. The boot probe does not accept work, restore a
vault, invoke a provider, or measure image pulling or the outer init process.

For each path, median CPU time must stay within the larger of 25% growth or
100 ms; median wall time within the larger of 40% growth or 250 ms. One outlier
does not dominate the median, and CPU plus wall checks distinguish added work
from added waits. These deliberately coarse same-host budgets catch material
individual regressions, not every small slowdown or gradual subthreshold
accumulation. They are not production SLOs or authorization to downsize.
Do not raise them to hide a regression: inspect the emitted measurements,
profile the affected owner, and retain the correctness assertions.

A local negative control injected five seconds of actual CPU work inside only
the candidate's measured incremental import. Three fresh-container runs kept
the same semantic hashes/readbacks, but the comparator correctly rejected
incremental CPU (5.98 s against a 1.12 s allowance) and wall time. The injection
is not part of production code or the committed benchmark.

## Additional work elimination

The follow-up removes two redundant copies of the read-only import identity
baseline; mutating reconciliation still takes its own copy. Imports without a
session no longer prepare an unused session fingerprint/index, and new external
references only compute content fingerprints when historical owners exist.
Ledger-change and overlapping-dependency invalidation remain unchanged.

Three alternating one-vCPU mixed-zone Docker samples against the preceding
timezone-cache revision had median CPU times of 7.28 s to 5.95 s for bulk import,
3.35 s to 2.72 s for incremental import, and 0.80 s to 0.44 s for the disjoint
session hit. All semantic hashes and canonical readbacks matched. Host/emulation
variation changed absolute timings substantially from the earlier experiment;
compare paired revisions within a run, not separate measurement rounds.

The later final-packaged three-pair run passed every committed regression
budget: median hydration wall time was 6.02 s baseline to 4.75 s candidate
(CPU 6.50 s to 5.09 s). Bulk-import CPU was 2.45 s to 2.85 s, and incremental
CPU 0.73 s to 0.90 s. Thus that rerun did **not** confirm the earlier additional
import speedups. The eliminated work is explicit in the code, but the size of
its latency benefit needs native-AMD64 confirmation. Neither the coarse budget
nor these noisy emulated samples establish strict performance equivalence.

Audio configuration also no longer eagerly loads the generated ElevenLabs SDK.
The existing validated audio-request function loads it before starting its
provider timeout. Configuration and non-audio hydration avoid that module graph;
the first actual audio request still pays its load cost. Deterministic coverage
proves both the unloaded and real-SDK request paths, including existing provider
error, abort, and timeout behavior.

## CPU and memory sizing

See [the September 2026 sizing investigation](container-sizing.md) for paired
2-vCPU / 6-GiB and 1-vCPU / 3-GiB Docker measurements, resource counters,
foreground-path profiling, and remaining hosted validation requirements.
