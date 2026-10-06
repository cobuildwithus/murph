# Focused wearable reads and whole-projection verification

Synthetic proof for base `938664ca9337bf72b4b83aa08f54dfdc0803f928` versus this
candidate. No production payloads, credentials, new dependencies or telemetry.
The existing sleep/source/experiment benchmarks and their fixture semantics are
unchanged. This harness reuses `wearable-sleep-fixture.ts`, not copied projection
logic. Unlike the older sleep experiment, this base already has focused sleep.

## Native paired run

Use the repository's Node >=24.14.1 and installed workspace dependencies. Build
both revisions' public packages with their normal build; do not map package
imports to source or install a loader. Put the **same** candidate
`global-projection.ts` in both checkouts' `packages/vault-usecases/bench/` before
running. The harness verifies its own and the existing fixture's SHA256 match
between checkouts. The base production sources must remain unmodified.

From the candidate checkout, with `BASE`, `CANDIDATE`, and `RESULTS` pointing to
local synthetic checkouts/output directories:

```sh
(cd "$BASE" && pnpm --filter @murphai/vault-usecases... build)
(cd "$CANDIDATE" && pnpm --filter @murphai/vault-usecases... build)
mkdir -p "$RESULTS"
node packages/vault-usecases/bench/global-projection.ts pairs "$BASE" "$BASE" full > "$RESULTS/global-base-base.jsonl"
node packages/vault-usecases/bench/global-projection.ts pairs "$BASE" "$CANDIDATE" focused > "$RESULTS/global-pairs.jsonl"
node packages/vault-usecases/bench/global-projection.ts pairs "$BASE" "$CANDIDATE" focused probe > "$RESULTS/global-stringify-probe.jsonl"
```

Each scenario uses two warmup pairs and seven measured pairs, alternating order.
A fresh native child handles every trial; cold imports are charged to the first
read. One seeded template is copied, preserving timestamps, to the **same vault
path** before each side. Seeding and copying are outside the measured workflow,
equally for both sides; the parent process measures complete child duration too.
The fixture has 90 days, three providers, 2,160 observations, 270 sleep sessions,
90 notes and three ledger files. Canonical corrections use the original fixture
writer. Only the application clock is fixed; filesystem mtimes and timers remain
real. This neither simulates nor asserts a restore/mtime bug.

Ten scenarios cover cold latest/activity/recovery, cold plus repeated reads,
current wearable rows with stale global state, already-fresh global reads, both
mixed orders, full global cold, and a relevant-edit full rebuild. The
current-wearable scenario includes the initial full read, edit, focused sleep
refresh, ordinary reads **and subsequent global work**. `global-edit` includes
both full reads and the canonical edit. No necessary deferred work is credited
as removed. Full global steps explicitly call the public canonical-entity reader
first, then the existing composite activity/search/metric proof; activity alone
is no longer a global-read surrogate. Every one of these reads is timed.

Every trial validates all phase counts, complete service/result JSON, byte counts
and SHA256, all 270 sleep-session and 90 note entities, all 90 note search hits
and metric coverage on all 90 days. The 2,160 dense observations still feed the
wearable/metric dataset; existing visibility policy excludes them from entity
rows. A missing required row or global phase fails the run. Full JSON is compared
across sides and all pairs before being omitted from JSONL output. Output retains
per-operation inclusive phase timings and counts, CPU, read-plus-edit work,
workflow including proof serialization, and complete child-process wall time.
The final `complete: true` summary retains all seven samples, min/median/max and
paired total deltas, plus per-step wall/CPU/phase variation. Phase spans overlap:
never add their durations to infer total elapsed time.

The separate `probe` observes native `JSON.stringify` calls, preserving arguments
and results. It counts total, replacer, metric-envelope and empty-metric calls,
including finite expected-string construction on cold import. It is **not** a
performance run (`performanceTimings: false`); proof/fingerprint serialization
outside each timed read is excluded from its per-step counts. Accept only a real
call reduction with complete `global-cold`/edited-global work and base/base
variation accounted for. Report targeted summary-substage gains separately from
whole-workflow wall time; neither an isolated codec microbenchmark nor deferred
work establishes a whole-rebuild gain. The measured codec result below removes
repeated serialization and improves the summary substage, while whole edited-
global workflow wall improvement is inconclusive. Keep all regressions and
variation visible.

For an uninstrumented native CPU profile, seed an owned temporary synthetic
vault using `node .../global-projection.ts seed "$VAULT"`, then run
`node --cpu-prof --cpu-prof-dir "$RESULTS" .../global-projection.ts trial "$VAULT" global-cold`.
Repeat on the other revision after restoring the same seeded fixture/path.
Profiled runs are diagnostic, separate from paired timing runs. Do not publish
local paths or raw profiles containing local environment details in the PR.

## Deterministic, type and product gates

From the repository root; local checks are focused, with broad coverage left to required CI:

```sh
pnpm --filter @murphai/vault-usecases... build
pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearable-source-health-query.test.ts test/wearable-summary-stored-codec.test.ts test/query-projection-provider-scope.test.ts test/query-projection-canonical-write.test.ts test/wearable-summary-shapes.test.ts test/blood-test-focused.test.ts test/metric-aggregate-equivalence.test.ts test/browser-wearable-reuse.test.ts
pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts --no-coverage test/wearables-ordinary-focused.test.ts test/wearables-sleep-focused.test.ts test/wearables-sleep-service.test.ts
node --test packages/vault-usecases/bench/global-projection.test.ts
pnpm exec tsc -p packages/vault-usecases/bench/tsconfig.json --pretty false
pnpm --filter @murphai/query typecheck
pnpm --filter @murphai/vault-usecases typecheck
pnpm --filter @murphai/assistant-engine typecheck
pnpm --filter @murphai/murph... build
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-real-e2e.test.ts -t 'focused (activity|blood-test) projection production contract'
pnpm test:assistant:live -- --auth subscription --model gpt-6.1-sol --test 'real Codex focused wearable activity projection e2e'
node scripts/check-workspace-package-cycles.mjs
node scripts/verify-workspace-boundaries.mjs
node scripts/verify-dependency-policy.mjs
bash scripts/check-agent-docs-drift.sh
pnpm --dir apps/web changelog:generate
pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx
```

The query matrix exercises all eight readers, independent full-row composition,
empty/malformed sources, normalization/order/date/limit, current/focused/global
states, corrections/deletions, focused lock capture and rollback. It also checks
that all eight fully fresh global readers finish before an unrelated parked
writer without acquiring its lock, while sleep/source-health still take theirs.
Real core commit/rollback tests publish wearable rows inside an unreleased outer
writer, keep outside readers blocked, and exercise a reentrant ordinary read
while those readers wait. Post-status writes/reset races retain the baseline
stored-read boundary; a SQLite interleaving verifies dictionary/row generation
capture. The metadata timing test charges preflight plus focused recheck instead
of hiding the extra work. Existing codec and canonical-concurrency suites remain
the oracle. A finite-empty call-count test
must fail on the old encoder while exact stored/public bytes and mutation
isolation continue to pass. Public service tests independently rebuild full rows
and compare complete envelopes, including service normalization.

The native CLI contract runs both JSON and default TOON with synthetic Oura and
Garmin steps on two dates. The uniquely named live journey uses the generated
production manifest/system prompt, real CLI and normal dynamic-tool surface,
allowing one focused data read and at most one targeted help command. It checks
facts/provenance, no unrelated commands/provider/delivery, no canonical writes,
unchanged write-operation metadata, empty outbox and no global certification.
The parent inspected the actual reply and recorded the successful local
subscription `gpt-6.1-sol` result below. The exact Opus 5.5 investigative advice
did not change the Murph runtime model. A skipped or unavailable live run is not
PASS.

## Incremental additions: first packet versus this packet

Do not measure the original base against the additions and attribute all gains to
these changes. Let `FIRST` be the original base with only the original authored
query-projection and codec postimages applied, holding finite expected-empty
envelope reuse constant. Let `NEXT` be the incremental candidate, which includes
the narrow fresh-global correction as well as blood/browser changes; incremental
results cannot be attributed to blood/browser alone. Copy the same harness and
unchanged sleep fixture into both benchmark checkouts. Only these proof files may
differ from their respective production revisions. Build dependencies normally
in both checkouts using the public-package build command above. The original
`full`/`focused` runs still select the original ten scenarios; their fixture and
meaning are unchanged.

```sh
node packages/vault-usecases/bench/global-projection.ts pairs "$FIRST" "$FIRST" additions-control > "$RESULTS/additions-control.jsonl"
node packages/vault-usecases/bench/global-projection.ts pairs "$FIRST" "$NEXT" additions > "$RESULTS/additions-pairs.jsonl"
node packages/vault-usecases/bench/global-projection.ts pairs "$FIRST" "$NEXT" additions probe > "$RESULTS/additions-probe.jsonl"
```

These modes reuse the same pairing/byte-validation/reporting driver. Blood
scenarios add exactly one synthetic ApoB panel to a separate copy of the existing
90-day template. They cover cold/repeated lists, fresh global rows, both mixed
orders and a lifecycle correction, including the eventual explicit global work.
A focused blood list does not publish wearable rows: each stale/absent repeat
reads strict current events, and the eventual global read still builds wearables.
No cache or missing/deferred global phase may masquerade as saved work.

Browser scenarios pass both raw and explicitly default-filtered read models to
the native `browser-replica-server` export. This does not assume the current source
reader will remain filtered: it composes both variants from the same public raw
fixture reader and the existing public visibility predicate. Preparation plus
metric projection remain in workflow/step totals; `replicaBuildMs` and
`replicaBuildCpuMs` isolate the entire replica builder, including its final hash.
The full output JSON and dataVersion must be identical between revisions for
**each** variant (not between raw and filtered variants). No timestamps, ids,
provenance or fields are stripped. Input immutability is checked as well.
Actual dataset-build call-count tests cover three old derivations versus one
when no entities were removed, or two when Personal Patterns needs raw input.
Probe output separates replica-build stringify counts from preparation. Native
CPU profiles remain optional diagnostics, not paired timing evidence.

The one-pass metric aggregate deletion was **rejected for this candidate**;
metric production source remains unchanged.
`metric-aggregate-equivalence.test.ts` uses the exported producers to construct a
seven-point cross-producer counterexample: one metric row dated `b`, and glucose
sample summaries dated composed/decomposed `é` and `a`. Those evidence interfaces
accept arbitrary strings; neither public constructor validates these dates. The
unchanged comparator returns locale equality before its id tie-break. Sorting
producer groups before the aggregate can therefore differ from sorting once.
The source-derived identity/comparator diagnostic found the mismatch, and the
parent's actual-public-path regression passed. It asserts current
old-composition equality and inequality with the one-pass proposal. Canonical
mixed/duplicate fixtures and forced id-collision ties also have differential
coverage. No comparator change, fallback, early suppression or cache is added.
Do not infer a new public date-validation contract from canonical production
fixtures. The existing canonical date/provenance owners remain unchanged.

The additions modes include `global-cold`/`global-edit` as full-rebuild controls
with the envelope optimization present on **both** sides. `metricIdentity` counts
observe the existing 13-element identity tuples separately from envelopes. With
no metric production deletion, do not claim the proposed 8,100-to-5,400 reduction
or any whole-rebuild gain from it. A future accepted deletion needs its own
isolated paired comparison; no replacement hash or caching is authorized here.

The blood CLI proof uses actual core writes, the assembled production manifest
and native CLI JSON/TOON. It selects a dated ApoB panel ahead of a newer nonmatch
and an older matching panel, verifies the bounded matched analyte, unchanged
canonical/write metadata, empty outbox, and no query database. No blood command,
assistant prompt, generic entity reader, journal input or source visibility
policy changes. The original unique live activity journey passed as the focused
real-model gate; its exact model/auth and parent-inspected outcome are recorded
below.

## Fresh-global repair and timing expectations

The worker and its 17 native scenarios are unchanged by this repair. Rebuild
phase expectations remain unchanged: cold/stale ordinary readers still perform
only required wearable work; mixed scenarios still pay for later global work.
For an individual ordinary operation, full-global freshness now means one
manifest/status preflight and no `query-wait`. Fallback performs that preflight
**plus** the existing locked wearable manifest/status check, even for current
wearable-only rows. These are two separately charged `query-freshness` spans,
not one overlapping wrapper. Compound benchmark commands can invoke several
public operations; their phase counts reflect all of them. The existing report
already retains these spans and complete workflow/child-process time.

The parked-writer regression is a causal ordering test, not a speedup threshold
or production estimate. The parent supplied an identical-output blocked-read
reproduction; the new tests additionally require no lock acquisition. Keep
fresh-global and stale-path measurements, base/base noise and all regressions in
the paired report. Neither wearable-only freshness nor a certificate published
inside an outer writer is a new nonblocking-read contract. No worker alteration,
background task, new telemetry or benchmark normalization is introduced.

## Measured evidence and remaining gates

The parent independently supplied the following final evidence for
[PR #4018](https://github.com/cobuildwithus/murph/pull/4018) at
`eeac8b2651bfb5707c944958b18cb96725db8aef`. This documentation update records
those results; it does not represent a new author-run native acceptance pass.

All four candidate runs completed: primary timing/probe runs over ten scenarios
and incremental timing/probe runs over nine scenarios, with two warmup and seven
alternating measured pairs each. The overlapping full-global controls make 17
unique scenarios. Both sides of the candidate comparisons were measured on
October 5, 2026 on a busy shared host; base/base controls were captured October 2.
These are same-method paired synthetic comparisons, not production speedup
estimates. Whole JSON, SHA256 and phase checks passed before complete JSON was
stripped from the private local reports. All seven samples, min/median/max and
signed paired variation are retained; no extra samples were collected to seek a
desired answer. Medians below summarize those runs without selecting samples.

Primary comparisons use baseline `938664ca9337bf72b4b83aa08f54dfdc0803f928`;
incremental comparisons use `FIRST` as defined above and include the fresh-global
correction in `NEXT`. Replica builder intervals include the final hash; source
preparation and metric projection remain in the complete workflow totals.

| Comparison | Workflow or measured interval | Before median ms | After median ms |
| --- | --- | ---: | ---: |
| Primary | Cold latest | 1325.64 | 987.77 |
| Primary | Cold activity | 1435.03 | 1086.76 |
| Primary | Cold recovery | 1227.41 | 906.48 |
| Primary | Repeated wearable reads | 1194.35 | 1042.33 |
| Primary | Wearable-to-global mixed workflow | 1907.79 | 1947.51 |
| Primary | Cold full global | 1293.90 | 1210.88 |
| Primary | Edited full-global workflow | 1821.13 | 1865.55 |
| Incremental | Cold blood list | 848.19 | 410.16 |
| Incremental | Repeated blood lists | 838.12 | 440.70 |
| Incremental | Blood-to-global mixed workflow | 1300.04 | 1307.16 |
| Incremental | Filtered Browser Vault builder | 180.85 | 139.57 |
| Incremental | Raw Browser Vault builder | 302.32 | 284.10 |
| Incremental | Raw Browser Vault whole workflow | 969.99 | 957.17 |

Mixed workflows include later global work and do not show a general speedup.
Whole edited-global workflow wall improvement is **inconclusive**, with signed
paired deltas from -504.86 to +471.59 ms. Fresh-global ordinary reads remain
comparable. Focused wearable-only repeats pay their existing lock plus the new
global manifest/status preflight, about 4-6 ms extra in this fixture. Required
global rebuilds remain synchronous under the existing CLI boundary; source-only
reads still validate strictly and capture under the existing lock.

The finite expected-empty codec removes 13,715 cold or 13,770 warm JSON
serializations. Cold full-global calls fall from 64,072 to 50,357; the edited
rebuild falls from 64,021 to 50,251. Necessary metric identity operations remain
8,100. Cold/edited wearable-summary stage medians improve, but this does not
establish a robust whole edited-rebuild wall gain. Browser actual derivations
fall from 3 to 1 for equivalent default-visible input, or 3 to 2 when Personal
Patterns needs raw input. Complete replica JSON/dataVersion and input
immutability match; its raw whole-workflow timing is nearly unchanged.

Complete output bytes match before and after: latest 4,241; activity 2,025;
recovery 1,962; blood list 789; filtered/raw replicas 1,562,950/2,085,893. No result
truncation or omitted facts accounts for the measured differences. The parked-
writer reproduction measured 21.46 ms for the old fresh-global reader, 407.87 ms
for the initial candidate and 15.80 ms after correction, with identical 67,645
bytes. Deterministic barriers cover all eight readers. These single timings prove
the blocking regression and its repair, not a production speedup or a guarantee
that every fresh read is nonblocking; the prior global check/read window remains.

Final parent verification:

- Query: 133 PASS, one existing skip; usecases: 14 PASS; native activity/blood
  CLI: 3 PASS; benchmark validator: seven PASS.
- Query/usecase/assistant/benchmark semantic typechecks and dependency/native CLI
  builds PASS. Workspace cycles, boundaries, dependency policy, documentation
  drift and raw-log guards PASS. Changelog generation and ten page tests PASS.
- The focused real-Codex command above passed with local subscription auth and
  `gpt-6.1-sol`. The parent inspected the actual reply: Oura, 8,800 steps; one
  native activity data read, no unrelated lookup, write, provider call or
  delivery. Parent Product UX verdict: Ready.
- The validator-only refactor passed all seven controls, semantic benchmark
  typecheck and `pnpm complexity:diff`. Complexity fell from 33 to 8, with helpers
  at 8/15/5; pre-existing `summarizeWearableMetricFromBundle` remains 39, unchanged.
  Timed `runTrial` and paired-driver bytes are identical to the measured version.
  Harness SHA256 before refactoring:
  `252684cd324086144c44d211f8badcd0b81832fb7ea54c1ed910710c5facae85`;
  current harness SHA256:
  `24384326f9bd53b9acbc3b066efab7a09f32ef1a2decbce2055af12e812d97ba`.

Negative investigations remain explicit: the public Unicode-date counterexample
rejects the one-pass metric deletion, with no metric source change. The existing
fractional-mtime snapshot test reports 1 PASS/38 SKIPPED; that issue was already
fixed and this optimization makes no restore change. Exact device redeliveries
already skip writes. The repeated-rebuild screen found no grouped rebuild count
greater than call count; it does not establish that all redundant rebuilds are
absent. Production evidence for September 29 through October 2 UTC used only
typed aggregate metadata, with no private payloads inspected or published, and
does not estimate candidate speedup.

Final external ReviewGPT and required exact-head CI remain pending. The execution
plan stays active for those gates. This evidence update performs no commit,
push, merge or deployment.
