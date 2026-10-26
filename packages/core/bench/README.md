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
speedup. The baseline itself adds no cache, index or scan optimization.

### Synthetic constrained-runtime profile

Parent supplied a separate network-isolated Linux amd64 emulation run using
240,003 mixed-format rows. The container requested 2 CPU / 6 GiB, but the Docker
VM had 1.9 GiB; this is not a verified 6 GiB resource allocation. Ten warm pairs
returned owner wall median 10,410.756 ms (range 10,188.039–10,673.209) and
process CPU median 12,517.598 ms. The known-event control median was
5,382.796 ms; it cannot substitute for owner lookup's stronger contract.

A separate profile used three pairs and one warmup and covered the whole run,
including fixture setup: 123,834 ms of samples. These are profile sample
attributions, not timings isolated to one owner scan:

| Profile attribution | Sample ms | Share |
| --- | ---: | ---: |
| JSON `parseJsonlRow` | 54,881 | 44.3% |
| `parseJsonlRows` | 4,652 | 3.8% |
| GC | 9,661 | 7.8% |
| Decode `processChunkSync` | 7,462 | 6.0% |

Fixture compression accounted for a separate 4,457 ms and is not read work.
Do not pair these profile samples with the ten-pair timing run or infer hosted
CPU attribution from emulation and constrained memory. The result supports
CPU/JSON parsing as a realistic hypothesis; it does not establish the cause of
the production tail or justify a scanner rewrite. The bounded production-path
instrumentation remains the next observation boundary.

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
By default, `MURPH_EVENT_READ_TELEMETRY=off` strips any inherited CLI timing
endpoint and creates no receiver or extra timing-module import. To measure the same
production telemetry on both artifacts, use `on`. To measure the candidate's
telemetry overhead directly, use `compare` with `control` and that single
candidate artifact; its `base` label is disabled and `candidate` label enabled.
`compare` is invalid with `pairs` or `check`. Paired runs retain the same fixture,
two warmup pairs, alternating cold processes and full output/status parity.

```sh
MURPH_EVENT_READ_TELEMETRY=on node scripts/benchmark-event-read-import.mjs control "$BASE_BUNDLE"
MURPH_EVENT_READ_TELEMETRY=on node scripts/benchmark-event-read-import.mjs pairs "$BASE_BUNDLE" "$CANDIDATE_BUNDLE"
MURPH_EVENT_READ_TELEMETRY=compare node scripts/benchmark-event-read-import.mjs control "$CANDIDATE_BUNDLE"
```

`on` also supports the small `check` run. The parent loads the candidate
artifact's public `@murphai/runtime-state/cli-timing` normalizer once outside
measurement and reuses the existing runtime-state UDP test pattern. A fresh
loopback socket/key is bound before each enabled child's spawn timer. Receipt
validation waits at most one second after child close; that wait and receiver
setup are excluded from parent wall time. Child CPU/wall includes its actual
sender and scan instrumentation. Parent receiver CPU is excluded; scheduling
contention between parent and child is not isolated by this benchmark.

Every enabled success must supply exactly one authenticated, normalized report
with one successful `meal show` call, one sample of each existing coarse event
phase and zero drop/window/batch/truncation indicators. Enabled candidate runs
in `pairs`, `check` and `compare` must also supply all twelve fixed scan phases,
each with count one. `on control` accepts a coarse-only old baseline; if new
phases are present, all twelve are required. Missing or incomplete receipts
fail the run. `cliTiming` summaries retain only fixed phase names, counts and
numeric durations, and `timingReports` includes warmup receipts. Endpoints,
keys, ticks and raw packets never enter output.

Traced import probes use the selected telemetry mode but remain outside timing
samples. The adversarial correctness battery still runs with telemetry off;
enabled successful reads are compared byte-for-byte with the expected result
and checked for canonical-input preservation. `compare` directly checks
disabled/enabled output parity on the identical candidate. Enabled-telemetry
measurements and native validation results are recorded below.

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
allocation, and retain any regressions. A production speedup must not be
inferred from this local measurement.

### Accepted local measurement, 2026-10-25

The parent independently measured the initial narrow-import candidate using the
native assembled CLI on Node 24.22.1,
darwin arm64, with the same synthetic 24,003-row / 24-shard mixed-format
fixture: two warmup pairs, ten alternating cold-process pairs, load hooks off
during timing. Baseline loaded 380 modules / 5,827,629 bytes; candidate loaded
301 / 4,571,152, removing 79 modules / 1,256,477 bytes. CLI bundle size was
9,663,371 → 9,663,393 bytes; the work was not moved into preloading.

| Paired candidate minus baseline, ms | Median | Range | Median paired ratio |
| --- | ---: | ---: | ---: |
| Wall | -32.410 | -141.764 to +6.970 | 0.93528 |
| Process CPU | -40.174 | -119.198 to -12.210 | 0.93933 |
| Base/base control wall | -2.006 | -13.890 to +22.748 | — |
| Base/base control CPU | -1.846 | -65.405 to +57.516 | — |

Separate wall medians were 499.826 → 461.881 ms; CPU medians were
663.519 → 624.182 ms. Paired deltas are not differences of separate medians.
Every stdout/stderr byte and exit status matched, adversarial cases passed,
canonical input stayed unchanged, and fixture cleanup passed. The parent also
reports 3 driver, 11 core, 20 usecase and 11 source-resolution tests passing;
both initial assemblies passed eight parity probes and budgets. These numbers
precede the additive scan instrumentation and the enabled-telemetry benchmark.

### Rebuilt candidate and telemetry measurements

The parent rebuilt after instrumentation and measured the same Node 24.22.1,
darwin arm64, 24,003-row / 24-shard fixture with two warmup pairs and ten
alternating cold-process pairs per comparison. The final inventory was
380 → 302 modules and 5,827,629 → 4,577,010 loaded-file bytes, removing
78 modules / 1,250,619 bytes. CLI bundle bytes were
9,663,371 → 9,666,876 (+3,505), with no displaced preload.

All durations below are milliseconds, rounded to three decimals. Ranges retain
the observed variation; paired medians are not differences of separate medians.
For candidate off/on, `base` means the same candidate with telemetry disabled.

| Comparison / metric | Base median [range] | Candidate median [range] | Paired delta median [range] | Median paired ratio |
| --- | ---: | ---: | ---: | ---: |
| Both off / wall | 480.114 [472.042, 485.208] | 446.908 [438.840, 475.015] | -35.008 [-44.375, -5.526] | 0.927724 |
| Both off / CPU | 656.084 [646.995, 663.747] | 612.922 [603.720, 640.650] | -45.484 [-52.155, -13.250] | 0.930774 |
| Both on / wall | 483.029 [477.137, 490.866] | 447.079 [444.135, 452.341] | -34.889 [-46.730, -29.219] | 0.927833 |
| Both on / child wall | 454.754 [449.132, 464.212] | 419.092 [417.179, 424.741] | -35.831 [-46.511, -28.232] | 0.921155 |
| Both on / CPU | 660.477 [651.233, 719.740] | 617.927 [604.874, 624.365] | -42.028 [-103.715, -35.152] | 0.936590 |
| Candidate off/on / wall | 444.604 [437.200, 453.378] | 449.063 [443.586, 455.320] | +5.106 [-9.793, +18.120] | 1.011474 |
| Candidate off/on / child wall | 417.139 [410.217, 422.374] | 419.007 [415.802, 427.315] | +4.900 [-5.400, +17.098] | 1.011770 |
| Candidate off/on / CPU | 615.156 [608.449, 624.463] | 621.764 [614.239, 655.035] | +5.306 [-7.364, +46.586] | 1.008597 |

The final endpoint-free run passed complete output/status parity, adversarial
cases, canonical-input hash and cleanup checks. Both rebuilt readers passed
eight parity probes and bundle budgets. Telemetry `check`, both-on `pairs` and
candidate off/on `control` passed every receipt gate, all twelve candidate
phases, zero dropped spans, complete output/canonical parity and cleanup.
The parent also reran all eight driver tests on Node 24.22.1 successfully.

Both-on paired median wall improved by 34.889 ms (about 7.2%) in this local
experiment. The same-candidate off/on comparison observed median wall overhead
of 5.106 ms and CPU overhead of 5.306 ms, with the variation shown above.
Enabling telemetry includes existing transport and coarse timing as well as the
new spans; this does not isolate the cost of the twelve new phases. No hosted
speedup or production scan-tail cause is established by these measurements.

Parent subsequently reports 27 core surface/owner/storage, 75 runtime-state
timing/process/CPU, 21 assistant-engine timing profile/transport and 6 Cloudflare
usage-port tests passing. The 20 runtime-state and 9 assistant-engine historical
compatibility skips were unrelated; the new mixed-version tests ran against
`7bcd0ffe430c8cba53da74dbb6d5c10a3560bdd8`. Runtime-state, core and assistant-engine
typechecks passed. Additional parent checks passed 40 compressed-ledger and
interruptible-reader tests, 46 Web changelog tests, Web typecheck, workspace
boundaries, privacy diff scan and diff check. Complexity remains ten changed
source files with zero hotspots; benchmark `main` is at most 20.
These are supplied parent results, not new author executions.

Implementation and focused parent proof are complete. Draft PR #4364 still
requires final ReviewGPT, exact-head CI, merge, deployment and the
post-deployment observation below. There has been no production deployment.
Heartbeat scheduling remains a concrete completion blocker: no scheduler is
currently exposed. Record and verify that follow-up before treating observation
as arranged; do not mark the 72-hour window started from these local results.

These results accept the narrow import mechanism and support the restrained
saved-meal lookup changelog. They are local native evidence, not a precise hosted
speedup or an explanation of multi-second owner scans. Keep the recorded
variation, including the initial run's slower candidate pair. Scan-tail
evidence and the bounded observation plan belong to
`agent-docs/exec-plans/active/2026-10-25-event-read-import.md`.

The follow-up meal-owner telemetry uses the existing pipeline and fixed
`event-owner-{candidates,revisions}-{source,path,read,decode,parse,select}`
categories: six aggregate samples per reached scan, including zero for
unreached categories, independent of shard count. Existing parent spans and the
64-span limit remain.
The split measures awaited source/path/read work and synchronous
decode/parse/selection wall time; it is not CPU attribution. No content, IDs,
paths or cardinalities are emitted. See `docs/hosted-runtime-log-database.md`
for the exact boundaries and consumer-first compatibility contract. Start the
plan's 72-hour natural-traffic window only after verified deployment; check
health, coverage and dropped/trimmed timing during the first four hours.
The bounded observation SQL passed `EXPLAIN` against the current control-plane
schema with no row data returned; this validates query shape, not observations.

Focused source proof, in addition to the native `check` command:

```sh
pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/event-read-surface.test.ts test/event-owner-timing.test.ts
pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts --no-coverage test/runtime.test.ts test/narrow-query-readers-real.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-document-meal.test.ts packages/cli/test/error-recovery-events-documents.test.ts
pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/workspace-source-resolution.test.ts
MURPH_CLI_EVENT_OWNER_WORK_COMPAT_BASE=7bcd0ffe430c8cba53da74dbb6d5c10a3560bdd8 \
  pnpm --dir packages/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/cli-timing.test.ts
MURPH_CLI_EVENT_OWNER_WORK_COMPAT_BASE=7bcd0ffe430c8cba53da74dbb6d5c10a3560bdd8 \
  pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/cli-timing-profile.test.ts test/cli-timing-transport.test.ts
pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/usage-record-port.test.ts
pnpm --dir apps/web changelog:generate
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx
pnpm --filter @murphai/core typecheck
pnpm --filter @murphai/vault-usecases typecheck
pnpm --filter @murphai/runtime-state typecheck
pnpm --filter @murphai/assistant-engine typecheck
pnpm --dir apps/web typecheck
node scripts/run-typescript.mjs package --project packages/core/bench/tsconfig.json --pretty false
node scripts/verify-workspace-boundaries.mjs
```

The save-only canonical hosted meal journey does not prove this read path.
`asks-for-essential-missing-information-on-manual-app-photo` asserts `meal show`
but its fixture runs `packages/cli/src/bin.ts` through `tsx`, so it does not
prove shipped package-export resolution. Parent reran that journey on the
current candidate: 40.2 seconds, `gpt-6.1-sol`, local subscription auth, reply
review Ready. It saved one meal, acknowledged the photo and asked for essential
food/portion information, with no invented nutrition, card or extra save.

The additional canonical-launcher exact-read attempt exited 64 before any
provider request: both available Codex binaries lack `--ignore-user-config`,
and no compatible built binary was available in the known sibling targets.
Keep the canonical launcher's prerequisite and permission profiles unchanged.
The new exact-read test instead reuses the existing ordinary-provider fixture
and native built-CLI subprocess helper. After the normal prepared CLI build,
run it with:

```sh
pnpm test:assistant:live -- --test "saved meal exact read uses the built CLI"
```

`real model saved meal exact read uses the built CLI without mutation` executes
`packages/cli/dist/bin.js` with native package resolution. It requires an actual
successful exact read, a truthful reply from saved synthetic facts absent from
the request, and unchanged canonical bytes and write metadata, with no outbox
item or external delivery. Parent passed this journey on Node 24.22.1 with
`gpt-6.1-sol` and local subscription auth in 17.184 seconds: exactly one provider
request and one successful actual `meal show`, truthful saved food, calorie and
protein details, unchanged canonical snapshot/write metadata, and no outbox, card,
media or runtime issues. The actual reply review was Ready.
It covers the ordinary local provider plus built CLI, not the canonical hosted
permission profile. The already-passed assembled-native benchmark independently
proves production imports and byte parity; neither proof substitutes for the
other or for deployment observation.
No assistant behavior, protocol, prompt, discoverability or recovery change is
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
