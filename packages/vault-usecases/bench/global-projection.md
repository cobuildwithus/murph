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
call reduction and reproducible whole `global-cold`/edited-global improvement
beyond base/base noise, not an isolated codec microbenchmark or a deferred-work
headline. Keep all regressions/variation visible. No gain is established here.

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
The parent must inspect the actual reply and record model/auth/result separately;
Opus is not the Murph runtime model. A skipped or unavailable live run is not PASS.

## Incremental additions: first packet versus this packet

Do not measure the original base against the additions and attribute all gains to
these changes. Let `FIRST` be the original 16 postimages (including the envelope
optimization) and `NEXT` this incremental candidate. Copy this revised harness
and the unchanged sleep fixture into both benchmark checkouts. Only these proof
files may differ from their respective production revisions. Build dependencies
normally. The original `full`/`focused` runs above still select the original ten
scenarios; their fixture and meaning are unchanged.

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

The metric aggregate deletion is **deferred**, not claimed as implemented.
`metric-aggregate-equivalence.test.ts` uses the exported producers to construct a
seven-point cross-producer counterexample: one metric row dated `b`, and glucose
sample summaries dated composed/decomposed `é` and `a`. Those evidence interfaces
accept arbitrary strings; neither public constructor validates these dates. The
unchanged comparator returns locale equality before its id tie-break. Sorting
producer groups before the aggregate can therefore differ from sorting once.
The source-derived identity/comparator diagnostic found the mismatch, and the
parent reports the actual-public-path regression passed. It asserts current
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
policy changes. The original unique live activity journey remains the focused
real-model gate; this patch does not claim it ran.

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

## Handoff status

Before this repair, the parent reports dependency build and benchmark/query/
usecase/assistant typechecks PASS, seven validator controls PASS, all 17 native
scenario smokes PASS, three native activity/blood CLI contracts PASS, and 14
usecase tests PASS. These are not paired timing acceptance. The query/browser
run had 35 passing tests and three fixture failures: unrelated-family blood
input and cancellation checkpoints 3/4. This patch uses the known malformed
canonical goal fixture and aborts on the exact real timer scheduling point;
production cancellation yields are unchanged. Native reruns remain pending.

The author environment remains Node 22.16.0 without pnpm, installed workspace
dependencies, built outputs or Codex. The unchanged seven validator controls and
workspace-boundary/package-cycle guards pass here; they do not validate native
query/browser execution. New runtime suites, semantic typechecks, paired gain,
real-Codex and exact-head CI remain parent-owned pending gates. The active plan
separates these reports; no measured speedup or new native PASS is claimed.
