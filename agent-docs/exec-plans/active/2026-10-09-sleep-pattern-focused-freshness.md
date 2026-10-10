# Sleep-pattern focused freshness

Status: active; implementation authored, parent validation pending.
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

Authored, not run here:
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

Pending parent validation:
1. Before runtime edits, copy only `packages/query/bench/sleep-pattern-runtime.ts`
   to the unchanged base. Run the identical file/fixture on base and candidate
   with the repository's TS runner and dependency builds. Alternate independent
   processes; compare fixture and per-label result hashes/bytes plus phase
   counts and timings. Explicit global controls are outside measured rebuilds.
2. Run query sleep/runtime/suppression and CLI sleep-pattern tests, query/bench
   and assistant-engine typechecks, focused lint/complexity and docs-drift checks.
3. Build the native production CLI and run the single new gated real-Codex
   journey. Inspect its printed reply, command count and no-effect assertions.
4. Record actual results and close this plan after parent validation/review.

## Evidence and limits

Parent reports baseline query tests (25), CLI tests (2) and dependency builds
passing. No candidate checks, benchmark runs or live Codex calls were run here.
The supplied 72-hour aggregate attributes 17.561s to three global rebuilds,
including 7.179s of metric projection, among five successful sleep-pattern calls
totaling 19.779s. This patch does not fix the separate 30.069s canonical-lock
wait or explain severe Personal Patterns tails. No production speedup is claimed.

Changelog: not applicable; behavior-preserving internal query work elimination.
Query README: unchanged; public inputs, outputs and selection contracts are
unchanged. This plan records the internal freshness-owner reuse and its proof.
