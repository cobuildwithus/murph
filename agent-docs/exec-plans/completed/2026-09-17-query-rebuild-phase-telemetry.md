# Query rebuild phase telemetry

Date: 2026-09-17
Status: completed
Parent exact-head PR, final ReviewGPT and CI remain pending. Deployment
investigation is unresolved; not deployed and not observation-ready.

## Outcome and evidence

Separate the existing full and wearable-only rebuild tail into six bounded
operation timings before proposing an optimization. Parent supplied the fixed
72-hour interval `[2026-09-15T00:00:00Z, 2026-09-18T00:00:00Z)` from bounded,
validated initial-provider first-attempt CLI summaries:

| Command | OK calls | Total sum / max (ms) | Rebuild samples | Rebuild sum / max (ms) |
| --- | ---: | ---: | ---: | ---: |
| `search query` | 23 | 133095 / 38955 | 8 | 98828 / 37687 |
| `event list` | 72 | 155170 / 36390 | 7 | 80243 / 34879 |

Manifest/status and lock-wait aggregates do not explain the longest tails. The
suspected owner is `packages/query/src/projection/rebuild.ts`; the existing
`query-rebuild` aggregate cannot distinguish strict canonical reading, wearable
dataset derivation, global metrics, wearable encoding, search construction and
SQLite publication. This is attribution evidence, not a proven root cause.
No member content, arguments or results were inspected for this task.

PR3535's zero-sleep candidate prefilter might explain part of the tail, but this
instrumentation neither duplicates it nor edits `wearables/candidates.ts`.
PR3391's Patterns input-read work and PR3432's source-only projection optimization
remain independent and unchanged.

## Bounded implementation

1. Admit exactly six names in the existing portable `CLI_TIMING_PHASES` consumer:
   `query-source-read`, `query-wearable-dataset`, `query-metric-projection`,
   `query-wearable-summary`, `query-search-documents`, `query-publication`.
   The enum-driven command shape becomes exactly 17 names; no byte/span/command
   cap changes. Consumer artifacts must be verified before producer rollout.
2. Wrap existing operations in `projection/rebuild.ts`, using finally-balanced
   synchronous scopes and the existing async helper only for the async strict
   read. Full rebuild emits six subphases (five when wearable summaries are
   reused); wearable-only emits four. Publication includes open/setup,
   transaction and close, not just inserts. Preserve lock, transaction,
   exception and result ownership and disabled no-op behavior.
3. Reuse the synthetic source-health fixture for public-entrypoint parity,
   deterministic owner-boundary timing, source/open/close failures, existing
   encoding and transactional rollback cases, and opt-in paired measurement.
   Extend fixed-catalog, UDP and HTTP maximum-shape tests. Execute the real old
   reader from its reviewed base for both usage profile versions.
4. Keep the durable interpretation, residuals, histogram semantics and rollout
   contract in `docs/hosted-runtime-log-database.md`. No new state, pipeline,
   dependency, registry, optimization, workflow, changelog or real-Codex behavior.

## Compatibility and interpretation

The current eleven-phase normalizer rejects the **entire optional timing object**
for an unknown phase or oversized phase array. It does not retain selected legacy
CLI phases. Old usage parsing independently drops that object while retaining
legacy tool totals, durations, failures, outputs and token/provider accounting.
Tests must prove that behavior rather than asserting selective phase dropping.
The new reader still admits old reports. All eight bucket intervals and retained
count/sum/max semantics remain unchanged; missing/incomplete/hard-killed work is
unknown, not zero. Extra shapes still trim whole command summaries under the
existing UDP 8192 / HTTP 16384 limits, command32 and span64 caps.

Residuals outside the six include full reset, internal manifest, default entity
filter/read-model assembly and wearable freshness check; wearable-only reset is
also outside them. These operations can include their own SQLite reads. Outer
lock/manifest/status scopes retain their boundaries; final stored-row reads and
composition are not publication. Explicit manual rebuild has no invented outer
`query-rebuild` span. See the durable owner for exact boundaries and caution
against subtracting unequal aggregates.

## Verification and handoff

Authored tests use real public rebuild/source-health/search operations, the
existing synthetic canonical fixture and actual SQLite publication. They assert
output/freshness parity, expected finite microsecond spans, privacy, absence of
invented skipped spans, original rejection, balanced scopes, lock release,
transaction rollback and retry. The opt-in measurement runs seven rotated pairs
per operation after warmup; it reports raw wall-time samples, paired deltas and
fixed bounded shape, not precise overhead or a production-speedup claim.

Parent focused commands (with installed workspace dependencies and supported
Node version):

```bash
pnpm --dir packages/runtime-state test test/cli-timing.test.ts test/cli-timing-process.test.ts
pnpm --dir packages/query test test/wearable-source-health-query.test.ts test/query-projection-concurrency.test.ts test/query-projection-canonical-write.test.ts
pnpm --dir packages/assistant-engine test test/cli-timing-transport.test.ts
# BASE_SHA must be the reviewed pre-admission main SHA (40 hex characters).
MURPH_CLI_QUERY_REBUILD_COMPAT_BASE="$BASE_SHA" \
  pnpm --dir packages/hosted-execution test test/query-rebuild-timing-compatibility.test.ts
MURPH_QUERY_REBUILD_PHASE_MEASURE=1 pnpm --dir packages/query test \
  test/wearable-source-health-query.test.ts -t 'synthetic rebuild phase measurement'
```

Parent validated the HTTP budget, focused actual-bundle mechanism and affected
typechecks below; exact-head review/CI remain pending. No production destination
is part of these tests. Existing transport integration applies because scopes share
the unchanged runtime-state timing module and existing result-independent route;
no real-Codex prompt, output, tool routing, environment admission or model call is
changed. Parent owns application, commits, PR, final review and checks.

Parent-verified closeout evidence (local validation, not final review/CI or
production deployment):

| Check | Result |
| --- | --- |
| Query | 41 passed / 1 opt-in skip |
| Runtime-state timing/process | 31 passed / 2 unrelated history skips |
| Transport/profile | 13 passed / 3 unrelated history skips |
| Actual reviewed-base compatibility | 1 passed, both v1/v2 |
| HTTP body budget | 6 passed |
| Focused actual-bundle mechanism | 1 passed / 16 filtered |

Compatibility used reviewed base `4d4209fd87bd721451b08683aa22b07186df7e17`.
Query/runtime-state/hosted-execution typechecks, public build, docs drift and
artifact guard passed. Complexity passed with no hotspots (query maximum 3;
runtime-state maximum 19). Parent manual inspection identified no production-code
issue, not a production health conclusion. The reporting-only variation patch
and final hashes were verified; runtime sources remained unchanged.

The opt-in actual-public-path measurement passed with one warmup plus seven
rotated enabled/disabled pairs per mode; outputs, freshness and spans matched.

| Operation | Disabled median / range (ms) | Enabled median / range (ms) | Median paired delta (ms) | Max envelope (bytes) |
| --- | --- | --- | ---: | ---: |
| Full | 89.699 / 35.607–107.407 | 85.803 / 28.253–150.605 | -6.739 | 1272 |
| Wearable-only | 68.412 / 37.908–82.444 | 63.590 / 45.796–115.476 | -4.710 | 1524 |

Noise precludes a precise incremental-overhead or speedup estimate. The in-memory
sink excludes transport; span cardinality and payload are bounded. Raw seven-value
arrays remain private.

The existing public global-source benchmark (8760 observations, 12 ledger
entries, 3522810 bytes) used one CPU-profiled worker per base/candidate. All 12
full-response hashes/bytes/counts and projection state matched. Cold times were
2.769 to 3.104 s; totals were 11.848 to 13.347 s. These single profiled runs prove
parity only, not a timing regression or improvement; underlying operation counts
and required work are unchanged. The synthetic fixture lacks Apple sleep windows:
it cannot explain the production tail or certify PR3535. Optimization cause
remains unproven.

Parent next archives this implementation plan, then owns the exact-head PR,
final ReviewGPT and CI. None of those pending gates is claimed passed here.

## Deployment and observation gates

Parent confirmed the protected private workflow resolves **only public main**
and has **no candidate-ref/source-SHA input**. Unmerged telemetry deployment is
blocked by source selection. The user must supply a reviewed protected
candidate-SHA deployment route or separate authorization for merge plus normal
release. No merge, workflow change or deployment is authorized here. Deployment
investigation remains unresolved and not observation-ready; no production health
conclusion is established. Do not call a staged candidate deployed or start an
observation clock before production verification.

After a separately authorized route is available, verify reader artifacts before
producer rollout, then verify production producer identity and natural end-to-end
phase admission. Start the 24-hour preliminary and 72-hour baseline natural-traffic
windows only **after verified production deployment**. Examine only bounded
validated aggregates and coverage/drop counters; no private content or synthetic
production requests. This task introduces no optimization and claims no speedup.

## Packaging friction

Reuse the exact existing Frog entry `20260915214405-reviewgpt-packaging-exceeds`;
create no duplicate and do not modify it. Parent reported that the non-PR branch
of `package-audit-context-full.sh` execs the packager directly, whereas its PR
branch summarizes known exclusion warnings. The initial non-PR capture overflowed
on more than 1 MiB of expected warnings before submission. Parent's ignored,
invocation-only wrapper kept complete stderr privately and summarized only known
warnings; the canonical guarded ZIP was unchanged. No tooling fix is in scope.
The initial Apollo lane accepted no composer request; this fresh managed-lane
patch makes no claim of a staged or deployed predecessor.
Updated: 2026-09-17
Completed: 2026-09-17
