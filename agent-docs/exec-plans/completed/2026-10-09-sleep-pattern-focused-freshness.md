# Sleep-pattern focused freshness

Status: completed
Base: `6e17cee941f46b8a65f32913d2127ff1374dd795`.

## Outcome

Remove unrelated global metric/search work from stale sleep-pattern reads while
preserving the complete public result and strict source validation. A fresh
global projection must keep its existing unlocked stored-metadata/stored-row
path, including when an unrelated canonical writer is parked.

## Reaches

The runtime preflight retains the existing global freshness policy. Only its
stale branch captures validated optional canonical metadata and bounded
`sleep`/`source_health` rows under the existing reentrant canonical write lock.
`readFreshWearableSummaryRows` remains the freshness/publication owner; its
filter type is widened to the existing `ReadWearableSummaryRowsFilters`.
Composition and pattern calculation occur after capture and outside the lock.

The outer acquisition has its own `query-wait` span; the focused owner's
reentrant wait remains a separate span. Inclusive timing spans are not additive.
No new cache, markers, persistence, orchestration, dependency or source policy.
No change to provider authorization, adjacent-date widening, source-health
retention, suppression, result ordering or pagination. Personal Patterns and
PR3391's source transition are out of scope.

## Proof

All execution results below are supplied by parent verification, not runs by
this patch author. Coverage:
- Existing synthetic fixtures compare complete serialized cold/focused-warm
  results with the existing public fresh-global runtime, including provider
  scopes, missing metadata, explicit zones and localized adjacent dates.
- Gate-based tests cover fresh-global reads ahead of a parked writer and
  cold/stale metadata-plus-row coherence. Phase counts distinguish focused
  publication from global metric/search work and retain outer wait accounting.
- Strict-source failures cover out-of-window malformed input, empty/unknown
  provider scopes and invalid metadata, with failed reads leaving the database
  unchanged. Suppression and old source-health fixtures cover both owners.
- The public-runtime benchmark has deterministic year-long, multi-provider
  synthetic history, cold and repeated warm reads, a stale canonical revision,
  full JSON bytes/SHA-256, fixture SHA-256 and actual phase counts/timings.
- One gated real-Codex journey uses the complete generated production CLI
  contract/prompt and native CLI: one Oura sleep-pattern read, three usable
  nights averaging 450 session minutes, no extra reads/mutations/outbox work.
  It prints the synthetic reply for parent inspection.

Parent verification for [PR #4118](https://github.com/cobuildwithus/murph/pull/4118):
- Candidate query coverage: 116 passed, 1 skipped across sleep runtime,
  suppression, calculation, source health and concurrency; CLI contract: 2 passed.
- Query and assistant-engine typechecks, full native CLI dependency build,
  complexity diff, docs drift and gardening passed. Maximum source complexity:
  14, with no debt.
- The new phase regression fails at base: metric phase count 1 instead of 0.
- Real-Codex journey passed on `gpt-6.1-sol` with the exact native production CLI
  and generated prompt/contract: one read, mean session duration 450 minutes,
  3 usable nights and no extra reads, writes or outbox work. Parent inspected
  the synthetic reply, full diff, strict invalid-source failures, coherent
  metadata/row capture and the fresh-global unlocked path.

### Controlled synthetic benchmark

Parent ran seven alternating base/head process pairs and three base/base
control pairs with the same 365-day, three-provider, 3,219-event fixture and
Oura-only 28-day filters. Corresponding per-state full results were byte/hash
identical at 2,096 bytes. Explicit global rebuilds were outside measured intervals.

| State | Base median ms (range) | Head median ms (range) | Paired reduction median % (range) |
| --- | --- | --- | --- |
| cold | 633.76 (631.04-640.68) | 449.50 (446.52-451.69) | 29.0 (28.8 to 30.2) |
| stale | 570.74 (567.28-578.88) | 384.90 (382.96-395.89) | 32.6 (30.9 to 33.5) |
| warm-3 | 6.97 (6.74-7.23) | 9.41 (8.72-9.60) | -34.0 (-40.4 to -24.3) |
| warm-4 | 7.04 (6.34-7.23) | 9.23 (9.08-9.76) | -30.9 (-54.0 to -28.5) |
| warm-5 | 6.98 (6.84-7.31) | 9.23 (8.81-9.41) | -29.0 (-34.9 to -22.0) |
| fresh-global-control | 6.71 (6.69-6.99) | 7.16 (6.77-7.99) | -6.7 (-19.0 to 2.2) |
| stale-warm | 7.28 (6.17-7.38) | 9.72 (9.35-10.06) | -33.6 (-55.4 to -28.4) |
| stale-global-control | 6.90 (6.46-7.20) | 6.82 (6.45-7.29) | 0.9 (-10.4 to 7.9) |

Base/base control reductions, rounded to two decimal places: cold
[0.87%, 1.75%, -0.88%]; stale [1.64%, 0.10%, 9.46%].
Negative reductions mean slower head reads; focused-warm reads add roughly
2-3 ms. Actual metric and search phase counts each changed from 1 to 0 for
cold/stale reads. Later global commands still do distinct global work;
no mixed-workflow gain is claimed.

### Validation gates

Gate status: parent validation of this plan/changelog delta,
final ReviewGPT and exact-head CI passed.
Content-only validation requires changelog generation, the focused archive
test and Web typecheck; no presentation or visual changes are included.
All gates passed; parent archives the plan via `scripts/finish-task`.

## Evidence and limits

Parent reports baseline query tests (25), CLI tests (2) and dependency builds
passing. Candidate verification is recorded above.
The supplied 72-hour aggregate attributes 17.561s to three global rebuilds,
including 7.179s of metric projection, among five successful sleep-pattern calls
totaling 19.779s. This patch does not fix the separate 30.069s canonical-lock
wait or explain severe Personal Patterns tails. Both remain unresolved in
[issue #3997](https://github.com/cobuildwithus/murph/issues/3997#issuecomment-6091507289).
Benchmark timings are local only; no production speedup is claimed.

Changelog: updated; meaningful member performance improvement.
Items: 2026-10-09 · `faster-sleep-pattern-reads` (PR #4118).
Query README: unchanged; public inputs, outputs and selection contracts are
unchanged. This plan records the internal freshness-owner reuse and its proof.
Updated: 2026-10-09
Completed: 2026-10-09
