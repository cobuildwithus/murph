# Wearable source-list performance and parity

## Mechanism and scope

The source-list path reuses provider rows in the existing query SQLite owner and
`query_wearable_summaries` table. One exact canonical manifest in the existing
`query_meta.wearable_source_manifest` entry certifies the wearable portion
independently of global metrics, entities and search. Source reads retain the
existing canonical lock through freshness checking, stale derivation, atomic
row/manifest publication and stored-row capture. Repeats reuse those rows through
the existing codecs and composition path. A full query reuses current wearable
rows but still owns its required global work.

A partial store has no global tables, rows or global completion marker. Version
28 protects that state from older global readers across a reset; full schema
promotion and publication are transactional. A later source-only refresh cannot
certify stale global work. There is no new database, cache service, dependency,
background task or canonical source of truth.

The comparison uses base `5b4f8ac08d11afb546bd224f276fe85db02f10fe` and the runtime
implementation committed as `1330259345aa0c4cefad4c1a4a086f7a79402f35` for draft
PR #3432. The final correction changes reporting and documentation only. The
benchmark calls built public
`createIntegratedVaultServices().query.listWearableSources` and
`listWearableActivity`; it does not substitute source functions or preload an
index outside a measured query.

## Run and saved-result replay

Use independently prepared and built base/candidate checkouts, each resolving
its own core/query/vault-usecases/runtime packages, with **Node >=24.14.1**:

```sh
node packages/vault-usecases/bench/wearable-sources.ts \
  /absolute/base-checkout /absolute/final-candidate-checkout \
  > /tmp/wearable-sources-final.jsonl
```

For an already captured complete run, recompute validation, summaries and the
reporting verdict without executing workers or public queries:

```sh
node packages/vault-usecases/bench/wearable-sources.ts \
  --replay /tmp/wearable-sources-final.jsonl \
  > /tmp/wearable-sources-final-replayed.jsonl
```

Use a different output file: redirecting onto the input destroys the evidence.
Replay is valid **only after reporting/documentation-only changes**, with the
same runtime, worker, fixture, workload and measurement sequence. It is invalid
after runtime or workload changes, even if a file would still parse. The saved
format does not attest checkout identities or authenticate execution; retain
revision/build provenance with the original capture.

Live capture and replay share worker/pair validation and summary logic. Replay
requires exactly **27 unique scenario/pair slots**: pair IDs -2 and -1 are
warmups, and 0 through 6 are measured, for each of the three scenarios. It checks
alternating order, the captured runtime, fixed sample order/operations, fixture
bytes/counts, response hashes/bytes/cardinality, repeat and write semantics,
projection diagnostics, and totals recomputed from the samples. Missing,
duplicate, malformed, unknown or mismatched records fail closed. Warmups are
validated but excluded from medians. Only one recognized terminal summary may
be ignored; its earlier verdict never supplies acceptance. Replay re-emits the
complete raw pairs and produces a new summary. A failed invariant or acceptance
check exits nonzero in either mode.

## Fixed workload and oracle

Each worker owns a fresh temporary vault, removed in `finally`. Its environment
contains only PATH, TMPDIR and UTC timezone; account credentials are not
inherited. The fixture contains 365 days, three providers and eight metrics per
provider/day: **8,760 observations in 12 event ledgers, totaling 3,522,810 initial
event-ledger bytes**, plus vault metadata. This is synthetic cardinality, not a
production estimate. No provider/network, installation, Git or deployment work
is part of the harness.

**Source-only:** cold plus four repeats, an unrelated canonical note followed
by five reads, then a public Garmin steps import followed by five reads. These
are **15 primary source calls**, with no earlier global query.
`cumulativeSourceReadMs` sums their query timers. `cumulativeSequenceMs` also
includes the two writes and intervening verification.

An actual public `listWearableActivity(limit: 7)` then builds the full index.
Its timer and full response are retained; `sourceThenGlobalMs` includes that call
plus all 15 primary source calls. Four source reads exercise the fresh index.
A public Oura sleep-only import, using **`fields.metric: "total-sleep-minutes"`**,
then invalidates it, followed by five source reads. The complete scenario has
**25 timed calls: 24 source and one global**. Projection assertions require no
global publication before the global read, reuse of the wearable manifest by
that read, and unchanged global state after the later source-only refresh.
Focused tests additionally check rows and derivation/encoding/publication counts.

**Source -> global** and **global -> source:** separate fresh-process scenarios
run the named ordered pair and one repeat pair, append the same unrelated note
and repeat both pairs, then import the same Garmin observation and repeat both
pairs again. Each has **12 timed calls: six source and six global**.
`cumulativeReadMs` includes the complete composed workflow. Neither order hides
a warm index or an unmeasured public read.

All three scenarios use **two warmup pairs and seven measured pairs**,
alternating which revision runs first. Every response is hashed in full without
removing fields. Complete byte counts/hashes, output counts and diagnostic
cardinality must match across revisions and pairs. Within each worker, repeats
and unrelated-write responses match their segment's initial result, while
source writes change the corresponding responses. The public source and global
counts are three and seven respectively. Source-record/observation counts
reflect each write. Raw JSONL retains every sample's wall/CPU time, response
hash/bytes/counts, index existence, projection diagnostics, cumulative timers
and worker RSS. Setup, process startup and cleanup are outside query timers;
there is no forced GC.

## Position and cohort interpretation

The summary retains **every position's before/after median and paired wins** and
adds its operation. It retains all cumulative medians and paired wins. No raw
sample, response comparison, write, query or projection assertion is removed.

A repeated-query cohort is one **scenario + operation**. Sum all of that
operation's repeat positions **within each worker first**, including fresh-index
accelerator repeats, then compare the seven matched worker totals. Report the
before/after medians, strict paired wins, and median paired delta (after minus
before). These are not sums of position medians and not pooled individual calls.
The five nonempty cohorts contain 20 source repeats for source-only, and three
source plus three global repeats for each composed scenario.

Acceptance requires all of the following:

- The primary cold median improves, every primary/composed cumulative median
  improves, and the source-sequence-plus-next-global median does not increase.
- Every **source** repeat-position median is non-increasing, including fresh-index
  repeats and source positions in composed workloads.
- Every nonempty repeated-query cohort has a non-increasing median **and** a
  non-positive median paired delta.

`repeatedReadsAccepted` combines the source-position and cohort checks. Paired
win counts remain visible, not a newly added majority-vote threshold. Individual
global-position increases are explicitly retained in `globalPositionIncreases`
with medians and wins; they are not an automatic cohort-gate failure. **Every
flag requires investigation before acceptance.** A passing aggregate alone is
not a reason to dismiss a point regression. This retains protection against
source-only recomputation and sustained broader-query slowdowns without treating
one noisy call position as the sustained-regression criterion. Unit tests have
no machine-specific latency threshold.

## Parent-measured results

The parent completed all 27 pairs with the unchanged worker and workload. All
complete response hash/byte/cardinality and projection assertions passed. All
source-repeat position medians improved. Values below are milliseconds; these
are parent-supplied execution results, not new executions by the reporting edit.

| Workload | Before median | After median | Paired wins |
| --- | ---: | ---: | ---: |
| Primary cold source read | 2,783.767 | 1,914.646 | 7/7 |
| Primary 15-source cumulative | 13,375.033 | 10,142.504 | 7/7 |
| Source sequence plus next global | 13,938.005 | 11,651.207 | Not supplied |
| Source -> global combined | 12,027.313 | 11,924.602 | 3/7 |
| Global -> source combined | 11,955.430 | 11,325.334 | 7/7 |

**Source -> global is roughly flat; 3/7 paired wins do not support a reliable
speedup claim.** Improved cumulative medians do not mean every position improved.

The same run's parent-calculated repeated cohorts are:

| Scenario | Operation | Repeats/worker | Before median | After median | Paired wins | Median paired delta |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| source-only | source | 20 | 10,325.694 | 8,614.989 | 7/7 | -1,853.885 |
| source-global | source | 3 | 1,561.735 | 1,293.470 | 7/7 | -230.192 |
| source-global | global | 3 | 1,534.836 | 1,455.979 | 7/7 | -67.155 |
| global-source | source | 3 | 1,510.151 | 1,264.476 | 7/7 | -314.374 |
| global-source | global | 3 | 1,540.189 | 1,432.304 | 4/7 | -57.028 |

All five cohorts satisfy both proposed cohort conditions. The original strict
position-based exit was **1**, solely because global-source's
`after-source-write-repeat-global` increased from **497.423 to 516.385 ms**
(**2/7 wins**, an 18.962 ms increase in position medians). That result is retained,
not relabeled as an improvement. Its global repeat cohort totals improved from
**1,540.189 to 1,432.304 ms**, with **4/7 wins** and a **-57.028 ms median paired
delta**. Replaying the saved run with this reporting correction remains a
parent-owned verification step; the original exit status is not rewritten.

The parent also completed an independent diagnosis: the same public global-source
workload, then **eight additional source -> global repeat pairs per worker**,
using two warmup and seven alternating measured pairs and complete response-hash
equality. This diagnostic is separate evidence, not extra samples silently added
to the fixed benchmark or its replay format.

| Additional repeated-query totals | Before median | After median | Paired wins |
| --- | ---: | ---: | ---: |
| Combined | 8,015.184 | 7,081.654 | 7/7 |
| Source | 4,119.867 | 3,328.025 | 7/7 |
| Global | 3,918.216 | 3,785.038 | 5/7 |

These independently measured repeat totals did not reproduce the isolated
approximately 19 ms increase as a sustained broader-query slowdown. This is the
current flag's disposition, not a claim that all global timings improved.
Combined and operation medians are calculated separately and need not add up.

## Validation and remaining gates

Parent validation covered 196 query tests across focused runs. The initial
eight-file run was 73/74: its sole failure incorrectly assumed hidden metric
observations produce ordinary visible entity rows. The separate attested
test-only correction added a visible manual note and an exact restored entity
oracle; the final full source-health test file passed **18/18**. The broader
**122 query tests**, **six public-usecase tests**, **17 web changelog tests** and
**14 PR changelog-validator tests** passed, as did query/usecase/benchmark
semantic typechecks and public package builds. These reported run counts are
not added together as a new unique-test total.

Actual version-27/version-28 public-reader compatibility across both read orders
and canonical writes matched complete source/metric outputs. The complexity
guard passed: composition debt 1 -> 0 and maximum 21 -> 19; schema maximum
10 -> 7; freshness 7 -> 12. Only the unchanged existing
`summarizeWearableMetricFromBundle` score of 39 remains.

Relevant commands from a prepared checkout are:

```sh
pnpm --dir packages/query typecheck
pnpm --dir packages/vault-usecases typecheck
node scripts/run-typescript.mjs package --project packages/vault-usecases/bench/tsconfig.json --pretty false
pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage \
  test/wearable-source-health-query.test.ts test/wearable-summary-stored-codec.test.ts \
  test/wearables-source-health-final.test.ts test/wearable-summary-store.test.ts \
  test/query-projection-provider-scope.test.ts test/query-projection-concurrency.test.ts \
  test/query-projection-canonical-write.test.ts test/vault-source-manifest.test.ts \
  test/vault-reader.test.ts test/query.test.ts
pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts --no-coverage \
  test/wearables-query-services.test.ts
node --test scripts/check-pr-changelog.test.mjs
```

The reporting correction still needs its benchmark semantic typecheck, saved-run
replay and negative controls (missing/duplicate/mismatched evidence and increased
repeated latencies). Final ReviewGPT and exact-head CI are PR completion gates,
not claimed passed by prior execution evidence.

## Limitations

Stale source reads still parse the strict canonical snapshot and derive provider
rows once. Repeats still decode and compose stored evidence. A later global read
still parses canonical evidence and performs global metric/entity/search work,
while reusing the current wearable portion. Hashes and diagnostic snapshots in a
saved capture can be validated for consistency, not reconstructed into proof of
an execution that never happened. Keep the original capture and build provenance.

Local synthetic results do **not** establish production cardinality, contention,
tail latency or end-to-end assistant timing. Position flags remain relevant even
when cohort gates pass, and the roughly flat source -> global result must not be
marketed as a reliable measured speedup.
