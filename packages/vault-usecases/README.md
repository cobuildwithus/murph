# @murphai/vault-usecases

Workspace-private owner for CLI/headless vault usecase orchestration.

This package exists to give CLI shells, assistant runtimes, daemons, setup flows, hosted runtime code, and inbox-service helpers one neutral service layer over the real vault owners:

- `packages/core` owns canonical vault writes.
- `packages/importers` owns import parsing and normalization before core writes.
- `packages/query` owns read models, query projections, and export packs.

`@murphai/vault-usecases` composes those owners into command-shaped services and narrow helper seams. It owns shared CLI-style input normalization, typed service interfaces, lazy runtime loaders, assistant-safe vault path helpers, and the `@murphai/vault-usecases/vault-services` factory.

It does not own canonical record schemas, canonical write behavior, query entity-family contracts, query projection storage, device-sync runtime state, inbox daemon behavior, assistant/session state, hosted product facts, or CLI-only device/control-plane composition. Those stay with their owning packages.

Reminder-backed experiment logging receives a trusted `readAssistantOutboxIntent`
dependency through the service factory. CLI composition supplies the assistant
engine's public reader; vault usecases never open assistant outbox files. The
usecase still validates the exact intent, private accepted delivery, experiment
owner, and planned occurrence before the canonical write. The reader is not a
command or JSON input, and reminder-backed writes fail closed when it is absent.
Ordinary experiment logging does not require the assistant reader.

Keep this package thin. Add a surface here only when multiple CLI/headless callers need the same vault usecase orchestration and importing the lower-level owner internals would create the wrong dependency direction.

Exact command paths compose core-owned canonical readers or query-owned bounded
family readers; they must not call `query.readVault()`. Family aliases are
resolved only within their owning family. Family collection commands may use a
filtered projection API, while genuinely cross-family, aggregate, derived, or
global-invariant commands may still materialize the shared query projection.
When an exact read feeds a mutation, carry the observed lifecycle revision or
source revision into the canonical core writer rather than treating projection
state as write authority.

Experiment progress and outcome analysis share one canonical evidence snapshot
through `readExperimentQuerySource()`, deriving the selected metrics without
rebuilding the global query/search database. Outcome persistence keeps evidence
analysis and the canonical write under the existing reentrant lock. A linked
outcome replay resolves only the experiment family and saved outcome before
returning; it does not rebuild unrelated query state.

Experiment edit option compilation lives in `src/experiment-onboarding-options.ts`
alongside onboarding capture and assistant-support options. The pure builders
validate protocol references, run logging, analysis, and dates. The experiment
usecase owns schedule-file reads, current frontmatter, canonical locking, and
updates, preserving date and logging validation before schedule reads.

## Clinical FHIR snapshots

`@murphai/vault-usecases/clinical-records` is the explicit execution seam for a
retrieved FHIR snapshot. It validates bounded page files, atomically writes the
immutable pages plus manifest under
`raw/clinical/fhir/<connection>/<retrieval>/`, then lazily loads the clinical
importer and applies its event decisions through core. Stable raw paths allow a
byte-identical crash replay; conflicting bytes at the same retrieval identity
fail closed. Raw evidence commits before canonical projection, so a canonical
write failure can be retried without fetching or rewriting provider data.

## Event listing and paired benchmark

`event list` keeps the same filters, canonical order, visibility, lifecycle
collapse, post-filter limit and complete envelope. Its query-owned operation
reuses a fresh index or reads the strict event family under the existing reentrant
canonical write lock; it never builds global metrics, wearable summaries, search
or a partial cache. Unrelated malformed families intentionally do not block this
family-local read; malformed events still fail even when filters match nothing.
`packages/query/README.md` owns the freshness and family-isolation contract.

`bench/event-list.ts` uses the production
`createIntegratedVaultServices().query.listEvents` boundary without a provider or
query mock. Every public service call supplies the fixed synthetic request ID
`synthetic-event-list-benchmark`. `scripts/benchmark-event-list.mjs` runs two
warmup pairs and seven measured pairs in alternating base/head order. Each trial
collects seven scenarios, each in its own new subprocess at both revisions:
`cold` (also the one-read case), `event-only-2`, `event-only-3`,
`event-only-repeated` (20 reads), `event-then-global` (event/global/event/global),
`global-then-event` (global then four event reads), and `warm-global` (global then
three event reads). The last scenario exposes an already-warm read subtotal **and** includes its timed global
setup call in the whole-sequence total and output comparison. Small read sequences
are representative acceptance cases; the 20-read stress remains limitation
and crossover evidence. Stale event-only reads repeat the ledger scan; an
explicit later global read still builds its own required projections. Compare
mixed totals and warm reuse, not just first-call savings. Do not infer zero
mixed-sequence overhead or hide a stress regression behind representative gains.

A single disposable synthetic vault contains three providers, 365 days, eight
observations per provider/day and one visible daily note. Weekly resting-heart-rate
observations are display-grade. Seed validation requires all three providers to
be recognized by the real wearable source-health projector. Repeated reads include
kind, date, tag, experiment and limit selection.

Each scenario starts without query SQLite or WAL/SHM; canonical files and mtimes
stay unchanged. Workers run sequentially, never concurrently against the shared
derived files. No earlier scenario can warm one revision's global projector.
Both revisions share the **same fixture path**, preserving exact
full-envelope JSON SHA256, UTF-8 byte length and count across every pair. No output
field is removed or normalized. Existing inclusive query phases are reported per
step and must not be added to their parents. Timings exclude fixture seeding,
DB removal, hashing, serialization and subprocess startup, not a required read.
Production workload imports and service initialization occur inside the first
timed read in each scenario. Module/JIT reuse occurs only between that scenario's
reads; warmups warm the host file cache, not later workers' JavaScript state.
Cold means absent query DB, not cold host file cache or a full CLI/Codex cold start.
The report declares `scenarioIsolation: "process"`; earlier single-process
scenario timings are not comparable acceptance evidence. Synthetic wall/CPU
measurements do not establish production speedup.

Use Node >=24.14.1 and the repository's frozen install in parent-prepared
base/head checkouts. Base is the unchanged production runtime; head includes the
candidate. Copy the **same current** `packages/vault-usecases/bench/event-list.ts`
and its `tsconfig.json` into base without copying runtime changes. Build public
packages and check the harness in **each** checkout:

```sh
pnpm --filter @murphai/vault-usecases... build
node scripts/run-typescript.mjs package --project packages/vault-usecases/bench/tsconfig.json --pretty false
```

From head, with base prepared in the sibling `event-list-base` checkout, run the
same worker twice first for baseline/noise:

```sh
node scripts/benchmark-event-list.mjs \
  ../event-list-base/packages/vault-usecases/bench/event-list.ts \
  ../event-list-base/packages/vault-usecases/bench/event-list.ts
node scripts/benchmark-event-list.mjs \
  ../event-list-base/packages/vault-usecases/bench/event-list.ts \
  packages/vault-usecases/bench/event-list.ts
```

Node strips worker types and resolves public imports from that worker's own
checkout. The real factory, dynamic loader and timing owner stay intact. The
driver rejects different worker-source hashes or any output hash/bytes/count
mismatch, including setup. Published JSON identifies workers by base/head labels
and source hashes, never resolved worker or home paths. It reports medians of
paired whole-sequence totals and separately labelled read subtotals; no synthetic
threshold certifies a production win. Inspect per-step phases for deferred work
and warm or mixed-order regressions.

Focused checks from the repository root:

```sh
node --test scripts/benchmark-event-list.test.mjs
pnpm exec vitest run --config packages/vault-usecases/vitest.config.ts test/event-list-contract.test.ts --no-coverage
pnpm exec vitest run --config packages/query/vitest.config.ts test/query-projection-canonical-write.test.ts test/narrow-family-readers.test.ts --no-coverage
pnpm --dir packages/query typecheck
pnpm --dir packages/vault-usecases typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm --filter @murphai/vault-usecases... build
```

Public-boundary tests compare direct/fresh filters and histories, preserve
`VAULT_INVALID_JSONL` for malformed event rows, and isolate goal frontmatter that
is missing its closing delimiter at `bank/goals/**`. The same malformed goal
must fail an explicit global read with `QUERY_SOURCE_INVALID` and the precise
source details. Tests also assert no global computation or partial publication,
and cover canonical freshness, parked commit/rollback,
reentrancy and a global publication while waiting. The existing query lock suite
also owns cross-process writer proof. Family isolation changes a prior tool error
into a successful result; its focused real-Codex regression command, after
deterministic checks, is:

```sh
pnpm test:assistant:live -- --test "event-list isolation recalls two saved facts despite malformed goal frontmatter"
```

The opt-in journey uses production assembled instructions, dynamic tools and the
shipped CLI over a synthetic vault. It requires exactly one successful event-list
read with the requested kind/date/tag filters, both saved facts in a concise
reply, no unrelated data commands, no canonical writes or delivery, and no repair
claims. The [completed verification record](../../agent-docs/exec-plans/completed/2026-09-25-event-list-candidate.md)
contains the accepted isolated measurements and full-context live PASS with
parent UX `Ready` review. Reruns still require inspection of the synthetic reply.

## Focused experiment lists

`query.listExperiments` uses query's strict experiment-family source under the
existing reentrant canonical lock; query remains the projection owner. Status
filtering precedes the limit and the mapper/envelope are unchanged. Selected
source errors stay strict; unrelated malformed families do not block this list.

With the supported Node runtime and installed dependencies, set BASE to a
baseline checkout at `3d2ba92f9035ea19a3be04450517c6d7086f32d9` and CANDIDATE to
this PR checkout, using distinct absolute paths. Copy only the three experiment
benchmark files and bench tsconfig below into BASE; leave its runtime source
unchanged. The existing `wearable-sleep-fixture.ts` must match in both checkouts.
No separate baseline-proof patch is required.

```sh
for file in experiment-list.ts experiment-list-fixture.ts experiment-list-pairs.ts tsconfig.json; do
  cp "$CANDIDATE/packages/vault-usecases/bench/$file" "$BASE/packages/vault-usecases/bench/$file"
done
(cd "$BASE" && pnpm --filter @murphai/vault-usecases... build)
cd "$CANDIDATE"
pnpm --filter @murphai/vault-usecases... build
pnpm exec vitest run --config packages/vault-usecases/vitest.config.ts packages/vault-usecases/test/experiment-list-contract.test.ts
pnpm --dir packages/vault-usecases typecheck
pnpm exec tsc -p packages/vault-usecases/bench/tsconfig.json --pretty false
pnpm --dir packages/assistant-engine typecheck
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts packages/assistant-engine/test/assistant-codex-real-e2e.test.ts -t 'focused experiment list production contract'
node packages/vault-usecases/bench/experiment-list-pairs.ts "$BASE" "$BASE" full > experiment-base-base.jsonl
node packages/vault-usecases/bench/experiment-list-pairs.ts "$BASE" "$CANDIDATE" focused > experiment-pairs.jsonl
# Only after deterministic checks/builds and review of their results:
pnpm test:assistant:live -- --test 'real Codex focused experiment list e2e'
```

The identical harness reuses `wearable-sleep-fixture.ts`: 30 days, 3 providers,
720 observations, 90 sleep sessions, 30 notes, plus 12 sparse/rich experiments
covering every status and unrelated event revisions/tombstones. Each scenario
uses a fresh process and a reset copy at one shared temporary path. Two warmup
pairs precede seven alternating measured pairs; JIT state is isolated per process.
Complete list/global JSON bytes,
hashes and counts must agree; no output fields are stripped for comparison.
Artifacts omit raw envelopes and temporary paths. They include inclusive timing
phases, native SQLite method-call counts, bytes and min/median/max samples.

Parent-run base/base and base/candidate benchmarks completed all six scenarios
at candidate `9ab1ee8fd26787de44d024149eb6520a44565017`. Complete list/global
envelopes matched, including the 14,042-byte cold list on both revisions. Median
synthetic wall times in milliseconds (totals include global setup and edits):

| Scenario | Base | Candidate |
| --- | ---: | ---: |
| Cold list | 577.88 | 358.30 |
| Two consecutive lists, total | 576.21 | 371.05 |
| Three consecutive lists, total | 623.44 | 389.18 |
| Fresh global + three lists | 671.53 | 692.57 |
| Global setup + edit + two lists + global | 878.56 | 893.96 |
| List/global mixed, total | 697.98 | 699.28 |

Cold-list paired median delta was -212.35 ms (range -231.30 to -177.30 ms).
Base/base control paired median ratios were 0.979-1.008 across scenarios;
individual ratios ranged 0.864-1.103. Cold-list native SQLite method calls fell
from 1,437 to zero (not unique SQL). Global rebuild/source/dataset/metric/summary/
search/publication phases were removed from list calls; global reads retain work.

There is no demonstrated warm/mixed total gain. Fresh-global first-list time
fell from 6.59 to 4.65 ms, but the total was noisy. After a relevant edit, the
first list fell from 151.01 to 4.07 ms while the later global read rose from
52.24 to 198.39 ms: work was deferred, not removed from that workflow. Repeated
lists still rescan experiments under the canonical lock; no fresh-index reuse
was added. Step wall includes actual public-service imports and native-call
observation, excludes fixture setup and process launch, and is distinct from
separately reported process wall. These synthetic results show neither a precise
production speedup nor smaller results or a mixed-workflow gain. Focused local
checks and live reply review passed; final ReviewGPT, exact-head CI, plan closeout
and final mergeability remain pending in the
[active plan](../../agent-docs/exec-plans/active/2026-10-02-experiment-list-latency.md).
