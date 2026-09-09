# Container sizing investigation

Synthetic evidence collected September 9, 2026. Baseline source: `58acfe349f`.
This record describes local measurements and their limits; it is not a production
sizing approval or a message-latency guarantee.

## Question and method

Compare the current custom 2-vCPU / 6-GiB runner with 1 vCPU / 3 GiB while
preserving a 6-GB disk allocation. Use the actual assembled production runner and
its pinned Node 24.14.1 / Codex 0.153.4 base. Workloads run sequentially in fresh
network-disabled Docker containers, with matching memory/swap limits (no swap),
a read-only benchmark mount, and synthetic vaults on the container writable layer.

The Docker VM has 16 CPUs and about 19.5 GiB RAM. The host is ARM and the
production image is AMD64, so these are emulated, same-host comparisons.
They do not reproduce Cloudflare CPU hardware, image demand loading, network,
provider inference, scheduling, or delivery. Task builds and tests are paused
during measured rounds. Existing unrelated containers are preserved.

Whole-container counters cover Node, child processes and file cache. Peak memory
includes synthetic setup and verification; it is not incremental runtime heap.
A 10-ms heartbeat is a responsiveness probe, not a member-message latency metric.
Short synchronous runs without a timer sample cannot claim zero event-loop delay.

## Initial paired matrix

Three alternating fresh-container rounds per configuration, using the same
unchanged image. Each restore container performs its own warmup and three
verified measured restores of an approximately 50-MiB encrypted / 125-MiB
unpacked fixture with 1,000 files.

| Median wall time | 2 vCPU / 6 GiB | 1 vCPU / 3 GiB | Difference |
| --- | ---: | ---: | ---: |
| Packaged healthy hydration | 2.762 s | 3.061 s | +0.299 s |
| Initial 8,000-event mixed-zone import | 1.780 s | 1.916 s | +0.136 s |
| Twelve-event update against history | 0.564 s | 0.793 s | +0.229 s |
| Disjoint session-cache import | 0.138 s | 0.290 s | +0.152 s |
| Authenticated encrypted restore | 1.136 s | 2.416 s | +1.280 s |

All 18 containers exited successfully, with no OOM events. Maximum cgroup
memory peaks were 326 / 281 MiB for hydration, 435 / 359 MiB for import,
and 831 / 826 MiB for restore (2-vCPU / 1-vCPU respectively).
One-vCPU runs were throttled in roughly 74–84% of quota periods; the larger
configuration ranged roughly 1–33%. Throttling frequency does not itself equal
the percentage of user-visible time lost.

The smaller shape has headroom for these individual workloads, but the measured
restore and update regressions reject a claim of unchanged latency from this
matrix alone. These tests do not include a provider turn, Codex children,
concurrent CLI work, or a complete large-vault query rebuild.

## CPU-only control and larger history

A single 1-vCPU / 6-GiB control produced hydration 3.134 s, incremental import
0.735 s, and median restore 2.515 s. Its peaks were 326 / 436 / 836 MiB.
This resembles the 1-vCPU / 3-GiB measurements and supports CPU quota, rather
than memory capacity, as the small-fixture constraint. A single control is not
an independent statistical certification.

The advertised 50,000-event benchmark initially exceeded the real 10,000-event
per-import limit. The fixture now seeds at most 8,000 events per call; the
50,000-event history uses seven valid canonical batches. This changes benchmark
setup only, without increasing the runtime ingestion limit.

| Large-history diagnostic | 2 vCPU / 6 GiB | 1 vCPU / 3 GiB |
| --- | ---: | ---: |
| Construct 50,000-event history | 72.49 s | 84.90 s |
| Twelve-event update | 9.76 s | 15.69 s |
| Update process CPU | 11.25 s | 14.78 s |
| Update identity-index wall time | 8.51 s | 11.21 s |
| Replay | 9.06 s | 15.68 s |
| Replay identity-index wall time | 8.73 s | 15.13 s |
| Disjoint session-cache hit | 0.67 s | 1.68 s |
| Maximum sampled event-loop delay | 8.62 s | 12.42 s |
| Cgroup peak | 838 MiB | 770 MiB |

Both runs passed canonical readback and matched semantic hashes, with no OOM.
These later individual runs encountered increased host contention. Their exact
size comparison is noisy, but substantial process CPU and long event-loop
stalls establish real work to investigate. A later profiling run of the same source completed the whole workload in
about 24 s and measured incremental/replay around 2.70 / 2.44 s, several times
faster than the earlier runs. The emulation/host conditions are nonstationary;
the 15-second values must not be presented as native production predictions.
Small import batches do not bound historical-index work. Profiling that owner
identified ledger validation, stable serialization, index copying, and garbage
collection as substantial work; tool fingerprinting was comparatively small.

Native Codex initialization, with no authentication/provider request, was
0.420 s versus 0.610 s median across three fresh subprocesses. An already
initialized config/read RPC took approximately 4.0 / 2.9 ms. The combined
probe/Node/Codex cgroup peak was about 73 MiB. These measurements exclude thread
start, inference, shell execution and child-agent working sets; local Docker
sandbox restrictions prevented the command-execution smoke.

## Larger encrypted restore

One stress container per shape restored an approximately 256.2-MiB encrypted /
640-MiB unpacked, 1,000-file fixture: one warmup plus three measured restores.
Both configurations passed all content verification with swap disabled and zero
memory max/oom/oom_kill events. Peak cgroup memory was 2,736 / 2,832 MiB.
Endpoint anonymous memory was 332 / 325 MiB, which does not establish the
composition of the earlier peak. Local fixture construction, server buffers and
page cache contribute to this peak.

Medians were 11.88 / 10.77 s; measured Node CPU was 14.04 / 8.47 s. The reversed
CPU/wall trend across shapes reflects unstable host/emulation conditions and
must not be interpreted as a one-vCPU speedup. This is memory/correctness stress
proof, not a stable sizing latency comparison.

## Background responsiveness approximation

A fully hydrated packaged runner shared its process with an actual synthetic
import or restore workload. A separate worker thread issued warmed loopback
HTTP probes, pausing 100 ms after each completed response and excluding five
warmup requests. This completion-paced sampling has coordinated omission: it
does not issue additional arrivals while a request is blocked. Its percentiles
are sampled RTT, not fixed-arrival or member-message latency evidence.
The bundled workload loads a separate module copy, and measurements include
fixture creation and verification as well as useful operations.

The 8,000-event workload had roughly 340 / 336 ms HTTP p95 and 1.05 / 0.91 s
maximum, with 533 / 529 MiB cgroup peaks. The 50-MiB restore workload had roughly
48 / 87 ms p95 and 70 / 182 ms p99, with 1,065 / 1,042 MiB peaks. Counts are
small and work phases differ; do not interpret the maxima as an exact production
import stall or subtract them from member-response latency.

## Foreground audit

- Private reply planning reads active/paused follow-up automations. The query
  validates every automation file, including archived history, before returning a
  small result. Reusing already parsed frontmatter and filtering before retaining
  and sorting removes duplicate work while preserving all validation. It does
  not remove the historical file walk.
- Dirty assistant context can attempt a 64-continuation-step rebuild before
  provider start. The budget bounds checks, not source bytes. The event visitor
  reads a bounded whole shard, then originally decoded and split all rows before
  an early yield. Retain archive verification and canonical source ownership
  when eliminating unvisited-line allocation.
- Query cache freshness can trigger a complete source hydration and projection
  rebuild. Snapshots deliberately carry the validated query SQLite cache to
  avoid that cold foreground cost. Removing it shifts work onto later queries.
- Existing warm Codex process reuse and foreground interruption must remain.
  The root, up to three resident children, CLI processes, archive tools, and
  filesystem cache all share the proposed limit.

## Query projection rebuilds

Real canonical imports and public query calls exercised schema-26 SQLite cold
construction, repeated indexed reads, and append/correction invalidation. Each
shape has one container per history size; hashes and row counts match. These
fixtures put many events in few source files and therefore underrepresent the
warm manifest walk for vaults with thousands of markdown files.

| Rebuild wall time | 8,000 events, 2 CPU | 8,000 events, 1 CPU | 50,000 events, 2 CPU | 50,000 events, 1 CPU |
| --- | ---: | ---: | ---: | ---: |
| Cold projection | 2.095 s | 1.963 s | 7.740 s | 9.008 s |
| Query after twelve appended events | 1.614 s | 1.708 s | 6.912 s | 8.639 s |
| Query after twelve corrections | 1.309 s | 1.682 s | 6.867 s | 9.679 s |

The 50,000-event projection contains 5,001 entity/search rows and grows to
50,012 metric rows. Its SQLite file is about 43.9 MiB; cgroup peaks were
1,122 / 838 MiB, with no OOM. Maximum event-loop delay was 6.816 / 8.934 s.
Returning only 50 rows does not bound an invalidated rebuild. This remains a
material foreground risk after the smaller allocation optimizations.

SQLite freelist counts were zero throughout the larger run; the smaller run
reached one free page. These fixtures do not support adding VACUUM or deleting
the persisted cache. Warm-read samples in this initial harness followed forced
GC outside the measured phase, which can still consume the same CPU quota
period; they are not normal steady-state latency estimates.

A subsequent maintained-harness stress run at 1 vCPU / 3 GiB used 50,000 metric
observations plus 25,000 notes. Its cache reached 112.7 MiB and cgroup peak was
about 1,017 MiB with no OOM. Cold, append-invalidated, and correction-invalidated
rebuilds each took about 9.8 s. Normal warm reads, with forced GC removed, had
5.5–5.7 ms medians; the ten samples included a 126-ms maximum. Freelist space
was only 19 of roughly 28,844 pages. This covers a larger cache in isolation,
still with only four source files and no resident Codex children.

## Measured optimizations

Each comparison below uses alternating baseline/candidate containers at 1 vCPU /
3 GiB. These are improvements within a shape, separate from the earlier shape
comparison. Correctness checks compare semantic hashes and canonical readback.

### Event-ledger allocation

Three pairs used a 61.9-MiB synthetic shard. Scanning verified bytes and decoding
only visited rows reduced RSS growth for a 64-check interrupted refresh from
124.1 to 62.3 MiB. Median process CPU fell from 79.8 to 43.3 ms. Its wall time
was noisy (67.6 to 74.0 ms), so this does not prove faster interruption.

A complete refresh fell from 532.7 to 355.5 ms process CPU and 536.6 to 314.9 ms
wall time. Maximum whole-run cgroup peak fell from 906 to 830 MiB. Full archive
integrity is still checked before any callback; only the unnecessary decoded
copy and unvisited-line allocations are removed.

### Identity-index allocation

Two pairs reused identical seeded 50,000-event histories. Reusing temporary
serialization tuples, skipping singleton selection work, and sharing immutable
owner sets reduced median incremental import CPU from 2,541 to 2,472 ms and
replay CPU from 2,238 to 2,148 ms. Maximum whole-run cgroup peak fell from 751
to 722 MiB. These are modest gains: multi-second scans and roughly 1.6-second
event-loop stalls remain in this allocation-only candidate.

### Snapshot creation

Three pairs archived a 256-MiB plaintext, 1,000-file fixture, yielding about
102.6 MiB encrypted. Connecting tar output directly to the compressor's input
removes Node's copy of the expanded archive. Median archive wall time fell from
1,630 to 1,396 ms, Node CPU from 1,159 to 944 ms, and whole-cgroup CPU from
1,587 to 1,371 ms. All three candidate rounds were faster and every archive
passed authenticated restoration and per-file content checks.

The change retains hashing, encryption, emitted-entry verification, child exit
checks, and failure cleanup. Whole-run peak and timer-lag measurements do not
establish a separate memory or foreground-response improvement.

### Follow-up automation queries

Three pairs queried 2,000 synthetic automation documents dominated by archived
history, with fifteen reads per variant. Reusing the parsed document and
filtering before retention/sorting reduced median process CPU from 268 to
235 ms and wall time from 276 to 247 ms. Maximum cgroup peak fell from 258 to
238 MiB. Selected rows and hashes match; malformed archived files still fail
validation even when the requested result limit has already been satisfied.

### Foreground interruption during sync

The service already polls foreground demand and aborts the active provider job,
but its signal previously stopped before snapshot import. Real-owner probes
confirmed that an already-aborted request still reached core and wrote an event.
The signal now flows through the existing importer and core execution options.
Ledger and identity-index preparation yield to native event-loop work at bounded
row intervals so timers and incoming I/O can deliver cancellation.

Cancellation before publication discards partial index state and releases the
canonical lock. The existing service requeues the same job without consuming
retry budget. Once publication starts, it completes and reports durable progress
even if the signal aborts. Focused tests exercise timer-driven interruption,
unchanged ledger bytes, lock release, canonical retry/replay, and cancellation
at actual publication entry. This does not bound synchronous normalization,
archive decompression, index copying, duplicate-group sorting, or query rebuilds.
The existing foreground polling interval remains 100 ms, and a request already
queued for the canonical lock waits for that owner before observing cancellation.

## Final assembled candidate

The final AMD64 diagnostic image is
`murph-container-efficiency-final-58acfe349f-ea7c7fb26a`, with image ID
`sha256:8438229226777d0395a794bbe36bf754999515dbc18d63ccbc8a3b02c111a3ff`.
Its production bundle was assembled from the corrected, verified working-tree
source; a manifest confirmed the relevant source stayed unchanged during
assembly. The tag identifies the baseline and candidate source digest. This
local diagnostic build preceded the scoped commit.

All seven assembled-candidate containers passed at 1 vCPU / 3 GiB:

- Three fresh packaged hydration samples: 3.510, 4.339, and 3.441 s; median
  3.510 s and maximum cgroup peak 285 MiB. These establish assembled
  compatibility, not a matched speed comparison with earlier host conditions.
- The 50,000-event import with a live signal passed canonical readback, replay,
  correction, and cancellation. A timer scheduled for 100 ms dispatched at
  103.79 ms; abort-to-return/lock-release was 3.45 ms. Seed ledger bytes stayed
  unchanged and retry/replay succeeded. Peak was 849 MiB. Whole-workload sampled
  HTTP maximum remained 873 ms, including setup and other import phases.
  Incremental import took 3.190 s wall / 3.175 s process CPU, and replay took
  3.183 / 3.193 s. These unpaired final samples include the live signal and
  additional instrumentation; they cannot establish a throughput regression
  against the earlier allocation-only pairs.
- Both the 8,000-event and large-shard context workloads passed semantic and
  timer-interruption checks against the final visitor. Full-refresh wall/CPU
  was 323 / 289 ms for 8,000 events and 1,031 / 978 ms for the 61.9-MiB shard.
  Those larger final CPU values triggered a further matched overhead check.
  Both timer probes stopped after 512 visits; timer lag was about 3.5 ms, but
  the large-shard operation took 285 ms total because the complete source read
  precedes the timer-armed scan.
- A warmed actual runner plus the real restore port processed a 256.2-MiB
  encrypted / 640-MiB plaintext fixture with 1,000 files. Warmup was 12.223 s;
  the single measured restore was 9.457 s with 8.366 s Node CPU. Every file
  verified and measured cleanup took 55 ms. Peak was 2,739 MiB, only 333 MiB
  below the proposed limit, with no memory max/OOM events. This includes local
  fixture/server/archive/file-cache overhead and warmed modules, but excludes
  provider turns and resident Codex children. No HTTP heartbeat was collected
  in this final capacity run; the earlier warmed HTTP evidence is separate.

Across the investigation, 112 task-owned containers completed: 104 successful
workload/proof runs and eight unsuccessful discovery probes caused by corrected
synthetic fixture assumptions or the local Codex sandbox restriction. No OOM
was observed. All owned containers were removed; the baseline and final images
remain available. No unrelated containers were stopped or removed.

## Native-yield throughput tradeoff

Follow-up comparisons used the same final source and preserved 50,000-event
seed, with three alternating containers per variant and no HTTP sampling.
Changing only signal presence increased median incremental import CPU from
3,057 to 3,366 ms (10.1%) and wall time from 3,023 to 3,376 ms (11.7%). Replay
CPU was essentially flat at 2,573 / 2,580 ms. Individual pairs varied, including
a reversed incremental result; this is a measured cost with uncertainty, not
evidence that all later differences were host drift.

Three matched large-context pairs with fast RSS sampling measured first-complete
CPU of 410 ms for the allocation-only visitor and 763 ms with cooperative
yielding. An additional pair with periodic RSS sampling removed still measured
402 / 731 ms for that phase; its repeated refresh measured 722 / 702 ms.
Sampling alone did not explain the difference. Cooperative cancellation worked,
whereas the allocation-only visitor exhausted the full shard before the timer
could run. The 64-check foreground refresh exits before the first native yield;
this throughput cost affects full refreshes.

A proposed increase from 256 to 1,024 physical lines between native yields was
rejected after two matched pairs: it did not improve full-refresh CPU and
increased median timer lag from 2.62 to 10.24 ms. Per-line cancellation checks
were unchanged. The retained visitor keeps the more responsive cadence.

A separate two-pair experiment increased only the three index-postprocessing
cadences to 1,024. Incremental CPU improved about 10%, but index time itself
improved only 3.4%, replay CPU worsened 3.5%, and the disjoint phase varied
substantially. That candidate was also rejected for lack of a consistent gain.
No cadence experiment changed the retained runtime or final image.

The cold seeded import probes provide an important cancellation limit: at the
retained cadence, a 100-ms timer dispatched at 132–238 ms, followed by 74–102 ms
to return and release the lock. Both preserved seed bytes and passed retry and
replay. These differ from the earlier warmed full-run result of 104 ms plus
3.45 ms; neither is a hosted message deadline or universal interruption bound.

The maintained context benchmark now records phase-boundary memory snapshots
and uses the shared cgroup peak, without periodic RSS sampling. This keeps the
final throughput method simple; it does not retroactively change or explain
the earlier measured values. Native AMD64 profiling is needed before turning
the emulated yield cost into a production CPU forecast.

## Rejected speculative optimization

Real tool-contract owners were measured in Docker using synthetic capabilities:

| Catalog | Tools | Schema bytes | Decorated declaration bytes | Median fingerprint, 1 vCPU |
| --- | ---: | ---: | ---: | ---: |
| Private direct, all capabilities | 40 | 46,075 | 161,225 | 4.36 ms |
| Entire exported catalog | 49 | 74,658 | 231,290 | 5.97 ms |

Three rounds of 50 calls preserved declaration and fingerprint hashes.
Best-case precomputation saved only about 3.4–4.5 ms per fingerprint.
Catalog objects and nested schemas are mutable; identity caching would hide
mutations currently observed by the contract. No cache was added.

## Cost interpretation

Cloudflare bills provisioned RAM and disk while a container runs, and actual
CPU use. At current marginal rates, 6 GiB costs $0.054 per running hour and
3 GiB costs $0.027. Actual CPU remains $0.072 per vCPU-hour consumed.
Longer running time can offset savings. Use a custom instance shape:
the named `standard-2` offering retains 6 GiB.

Sources: [Container pricing](https://developers.cloudflare.com/containers/platform/pricing/)
and [custom resource constraints](https://developers.cloudflare.com/containers/platform/limits/).
Fleet CPU percentiles alone do not establish per-message CPU demand or peak
memory, and their percentage denominator must be verified before translating
them into cores.

## Reproduction

Use [the core benchmark commands](README.md) for canonical import seeding and
[the query benchmark commands](../../query/bench/README.md) for SQLite rebuilds
and follow-up queries. The shared `scripts/container-resource-probe.mjs` preload
records cgroup memory, CPU throttling, OOM counters, and event-loop measurements;
its optional HTTP sampling has the limitation described above.

`apps/cloudflare/scripts/benchmark-workspace-restore.ts` also supports
`MURPH_BENCH_OPERATION=create`, `MURPH_BENCH_PLAIN_MIB=256`,
`MURPH_BENCH_BUNDLE_MIB=102`, `MURPH_BENCH_FILES=1000`, and
`MURPH_BENCH_ITERATIONS=3`. Its default remains restore. Each creation is
authenticated and verified through the existing restore port outside timing.

To reproduce context allocation and timer interruption from the checkout:

```sh
apps/cloudflare/node_modules/.bin/esbuild packages/assistant-engine/bench/context-refresh.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --tsconfig=tsconfig.base.json \
  --outfile=.artifacts/container-efficiency/context-refresh.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'

docker run --rm --platform linux/amd64 --network none \
  --cpus 1 --memory 3g --memory-swap 3g --pids-limit 128 --user 0 \
  -e MURPH_CONTEXT_SCENARIO=large-shard -e MURPH_CONTEXT_REQUIRE_PREEMPTION=1 \
  --mount "type=bind,src=$PWD/.artifacts/container-efficiency,dst=/bench,readonly" \
  --mount "type=bind,src=$PWD/scripts/container-resource-probe.mjs,dst=/resource-probe.mjs,readonly" \
  --entrypoint node \
  ghcr.io/cobuildwithus/murph-cloudflare-runner-base:node24.14.1-codex0.153.4 \
  --import /resource-probe.mjs --expose-gc /bench/context-refresh.mjs
```

Other context scenarios are `small`, `events8000`, `shards80`, `experiments64`,
and `health-bodies`. The required timer proof needs a scenario with a populated
event shard. For live-signal device imports, use `MURPH_BENCH_SIGNAL=1` and
`MURPH_BENCH_ABORT_AFTER_MS=100` with a large history as documented in the core
benchmark README. Existing latency CI leaves that optional mode disabled, so
its current throughput gate does not exercise the new service signal path.

## Correctness and static verification

| Owner | Focused result |
| --- | --- |
| Core import/session, generic event import, ledger visitor/storage, health history, migration | 354 tests passed in eight files; final visitor/preemption batch passed 31 tests after error-preservation and read-boundary refinements |
| Assistant context and active experiments | 31 tests passed |
| Snapshot archive and interruption | 36 tests passed |
| Importer forwarding and Junction alias repair | 23 tests passed |
| Device-sync interruption/retry | 7 tests passed |
| Automation queries and memory/knowledge coverage | 15 tests passed |
| Resource probe | 4 tests passed; syntax checks passed |

Core, assistant-engine, Cloudflare, importers, device-syncd, and query typechecks
passed. Scoped core/query benchmark typechecks also passed. Documentation drift,
diff whitespace, and task-file privacy checks passed.

`pnpm complexity:diff` remains a **reported failure**: core mutation complexity
debt increases from 371 to 376 while its pre-existing maximum remains 135. The
added branches expose cancellation, original-error preservation, and the atomic
publication boundary in an existing large function. Parent review retained
those checks; no threshold, waiver, or helper introduced merely to relocate the
score. All other changed source files pass this guard, including the new
benchmarks. The candidate has not completed PR CI, external review, or hosted
canary verification.

## Remaining proof

Before a production sizing decision, require native AMD64 evidence and a hosted
canary covering accepted
message through provider start and accepted delivery, cold and warm paths,
large validated query caches, foreground interruption, and resident child/CLI
working sets. Historical production peak RAM and OOM attribution are separate
observability requirements.

Prioritize the remaining work in this order:

1. Reduce complete query rebuild work at the existing projection owner. Preserve
   canonical freshness and indexed-query correctness; the result limit currently
   does not bound preparation. The fixtures do not justify cache deletion or
   periodic VACUUM.
2. Measure real foreground requests during full device-sync jobs, including
   normalization, canonical publication, and the portions of index preparation
   that remain synchronous. Cooperative cancellation is a narrower guarantee
   than a latency deadline.
3. Measure native cold restore and startup with representative saved state and
   image loading. Container-local HTTP excludes those network and platform costs.
4. Capture peak cgroup memory and OOM events while the root, resident children,
   CLI tools, and background work overlap. The large local restore approached
   the proposed cap; isolated low-RSS workloads cannot certify this mixture.
5. Reconcile running duration, useful background work, standby, and repeated
   checkpoint work with the bill. Reducing provisioned RAM saves per running
   hour; slower work and additional starts can consume part of that saving.
