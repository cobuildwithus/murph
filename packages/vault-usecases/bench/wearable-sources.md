# Wearable source-list performance and parity

## Design under test

Compare base `5b4f8ac08d11afb546bd224f276fe85db02f10fe` with the final
candidate, not the rejected request-local reconstruction design. The candidate
publishes reusable provider rows in the existing query SQLite owner. One exact
canonical manifest in existing projection metadata independently certifies those
rows. Source reads cannot certify global metrics/entities/search; subsequent
full rebuilds reuse current wearable rows. Version 28 protects partial stores
from older full rebuilders. No new cache, dependency, service or background work.

This synthetic benchmark imports built public package exports and calls the
actual `createIntegratedVaultServices().query` usecases. It never substitutes
source functions, accesses production, invokes providers, installs dependencies,
operates Git or preloads a projection outside a measured query.

## Run

Use independently prepared/built base and final-candidate checkouts with the
repository's supported **Node >=24.14.1**. The parent owns checkouts and builds.
Both must resolve their own built core/query/vault-usecases/runtime packages;
the candidate script orchestrates both revisions without copying code into base.

```sh
node packages/vault-usecases/bench/wearable-sources.ts \
  /absolute/base-checkout /absolute/final-candidate-checkout \
  > /tmp/wearable-sources-final.jsonl
```

Every worker owns a fresh temporary vault and removes it in `finally`. Worker
environment is limited to PATH, TMPDIR and UTC timezone; account credentials are
not inherited. The fixture has 365 days, three providers, eight metrics per
provider/day: **8,760 observations in 12 event ledgers**, plus vault metadata.
Exact initial event-ledger bytes and subsequent source-record/observation counts
are reported. This is not an estimate of production cardinality.

## Workload and oracle

**Source-only:** five calls without writes (cold plus four repeats), an unrelated
canonical note followed by five calls, then a public Garmin steps import followed
by five calls. These are the same **15 primary source-only calls** and write
segments used to reject uncached reconstruction. No global query occurs first.
`cumulativeSourceReadMs` sums all 15 query timers; `cumulativeSequenceMs` also
includes the two writes and intervening verification.

Next, an actual public `listWearableActivity(limit: 7)` call creates the full
index. Its timer, full response hash/bytes and `sourceThenGlobalMs` (15 source
calls plus this global call) expose rather than hide accelerator setup. Four
source reads exercise the fresh index. A public Oura sleep-only import then
invalidates that existing index, followed by five source reads. The attested
public import spelling remains **`fields.metric: "total-sleep-minutes"`**.
This scenario contains **25 timed calls: 24 source, one global**.

Projection diagnostics establish that the first segment publishes no global
tables/rows or global completion marker; the full read retains its wearable
manifest; and the later source refresh leaves global counts, manifest and
metadata untouched. Focused tests additionally assert complete row preservation
and count provider derivations/encodings/publications, so unchanged certificates
alone are not used as proof that work was skipped. Diagnostics and output hashing
are harness verification, not unmeasured public-query warmups.

**Source -> global** and **global -> source:** separate fresh-process scenarios
each run the ordered pair and one repeat pair, append the same unrelated note
and repeat both pairs, then import the same Garmin observation and repeat both
pairs again. Each has **12 timed calls**, six of each kind. All queries are
measured. `cumulativeReadMs` includes the complete composed workflow. No-write
and unrelated-write results must match; source and activity results must change
after the steps import.

Each scenario retains **two warmup pairs plus seven measured pairs**, alternating
which revision runs first. Every public result is hashed in full with no fields
removed; complete byte counts/hashes, output counts and source cardinality must
match across revisions. Repeated results must equal their segment's first
result. JSONL retains wall/CPU time, RSS, index existence, fixture cardinality,
source candidate/selection/day counts and every pair. Setup, process startup and
cleanup are outside query timers. There is no forced GC.

The summary reports per-stage medians/paired wins and cumulative medians/wins.
Acceptance requires a primary cold win, improved primary and composed cumulative
medians, no regression in source-sequence-plus-global time, and **no repeated-read
median regressions**, including fresh-index and composed repeats. A semantic or
invariant mismatch, or failed final acceptance, exits nonzero. Investigate noise
with retained pair evidence instead of dropping stages; unit tests have no
machine-specific latency threshold.

## Focused proof commands

From the prepared final-candidate checkout:

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

Also run the existing web changelog tests and changed-code complexity guard in
the parent's Git worktree. Prior-candidate test/typecheck results do not validate
this revision.

## Handoff limits

The authoring container has Node 22.16.0 and no workspace dependencies/lockfile.
Local checks passed TypeScript syntax/transpilation for the 13 changed TS files,
28 assertions exercising the actual schema/freshness/SQLite modules, and 14 PR
changelog-validator tests. These are not supported-runtime query/usecase tests,
semantic typechecks or performance evidence. Those, the web changelog suite and
the authoritative complexity guard remain parent-owned validation. No speedup
is claimed before execution, and no installation or external access was attempted.

A stale source read still parses the strict canonical snapshot and derives
provider rows once. Repeats still decode and compose stored evidence. A later
global read still parses canonical evidence and performs its required global
metric/entity/search work, but must not repeat provider-row derivation, encoding
or publication. Synthetic results cannot establish production cardinality,
contention, tail latency or end-to-end assistant timing.
