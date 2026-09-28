# Focused sleep-list projection read

Status: active; parent deterministic and benchmark proof passed, corrected live proof pending
Created: 2026-09-28
Updated: 2026-09-28

## Outcome and reach

A member asking for sleep history should not wait for unrelated global metrics,
search publication and compaction. Change only `summarizeWearableSleepRuntime`,
reached by the integrated `query.listWearableSleep` service and sleep-list CLI.
Compose the normal public bundle from `readFreshWearableSummaryRows`, retaining
original filters and the existing sleep summarizer. No `sourceHealthOnly`, new
state, schema, cache, dependency, telemetry, or background work. Sleep-pattern,
other wearable readers, event-list, Patterns and seven-day work are out of scope.

Issue #3729's refreshed aggregate window is September 25 17:25Z through September
28 17:25Z: 29 successful first-attempt sleep calls, 101.506 seconds total, maximum
28.382 seconds. Three independent slow calls spent 55.130 of 59.646 seconds in
rebuilds, including 18.021 seconds in global metrics. Phases are inclusive, not
additive; traffic counts differ from the preceding window. The metadata-only
handoff has no member payloads or exact vault cardinalities. Necessary source,
dataset, sleep-summary and wearable-publication work remains. This evidence is
not a production speedup estimate.

## Invariants and proof

Strict full canonical validation and exact manifest invalidation stay with the
existing reentrant lock/atomic wearable-publication owner. Empty selected scopes
must not hide malformed sources. Current global indexes remain reusable; partial
publication must not certify global freshness. Later global work is measured in
full and must reuse current wearable rows without skipping its own metrics.

The [focused benchmark and proof guide](../../../packages/vault-usecases/bench/wearable-sleep.md)
owns commands and result interpretation. Synthetic fixtures include competing
providers, actual sleep windows, stages, prior/next nights, non-sleep metrics and
searchable notes. Full service/query bytes, units, provenance, filters, ordering,
corrections/deletions, public errors and writer/reader consistency are checked.
Existing source-health and canonical-writer suites remain authoritative for
unchanged shared-owner rollback, reset and cross-process behavior.

## Sequence and acceptance

1. Apply proof patch to `00001e1f796f5fa17dfba94e3a38215b0a87d656` without runtime
   changes. Parent builds public packages, runs focused deterministic proof and
   base/base control. Retain this built baseline before applying the candidate.
2. Apply the separate sleep-only candidate and its mechanism assertions. Parent
   repeats proof and runs the same harness across independent baseline/candidate
   subprocesses: two warmup plus seven alternating measured pairs per scenario.
   Require exact outputs, complete samples and expected phase counts. Report cold,
   repeated, stale, global-first and complete mixed-workflow costs, including
   imports/startup and noise; do not promote a stopwatch-only win.
3. Run the one focused local-subscription Codex journey using production
   instructions/generated CLI contract and the real synthetic-vault CLI. Inspect
   its printed reply: one correct Oura sleep data read, no unrelated reads,
   writes or sends, truthful duration rather than time in bed. Default TOON is
   preserved; targeted syntax help and explicitly requested JSON remain allowed.
4. Parent owns final review, PR and exact-head CI; return validation facts for
   author-only plan closure. No merge or deploy is authorized. Request the
   author's `sourcePullRequests` replacement after a PR exists; do not invent a source PR or measured production claim.

## Handoff state

Patch 1 has no runtime change and no candidate-only default assertions. Patch 2
changes only sleep's fresh-row acquisition/composition, adds candidate phase and
partial/global publication proof, and documents the precise query contract.
The modest member changelog uses an empty `sourcePullRequests` placeholder until
the parent requests the author's real PR-number update. No measured claim is made.
The dependency-free benchmark-validator tests and syntax checks ran in this
archive. The archive lacks installed workspace dependencies and its lockfile; its Node 22 runtime is below the benchmark's Node 24.14.1 minimum.
Frog reports it is not installed; no machine-setup friction entry was invented.
Parent reports independently built public baseline/candidate packages, focused
deterministic checks and types passing. Base/base and base/candidate each completed
54 pairs with exact output parity and expected phase counts. Synthetic cold/stale
reads improved; fresh sleep cost more and mixed totals were noisy, not a total
workflow or production speedup claim.

Parent reports revision 04's deterministic JSON/TOON companion and assistant
typecheck passed. The next live run completed targeted help and one correctly
scoped Oura sleep read with a parent-reviewed Ready-quality reply, but stopped at
the native shell-wrapper assertion before output/canonical checks. This follow-up
admits direct commands or the observed single `/bin/zsh -c` wrapper, with cheap
deterministic accept/reject coverage. No prompt, CLI, runtime, result, canonical,
reply or effect assertion is relaxed. The benchmark include array also preserves
the sleep/source entries and adds `event-list.ts` from PR #3728; the parent merges
that source unchanged through its ordinary main reconciliation.

Parent reruns the focused deterministic contract and assistant typecheck, then the
same live journey on the same subscription. Full live completion, final review
and CI remain pending; the good reply alone is not a passing journey. This is
proof-only, with no new member changelog item. Keep this plan active. Completed
plans are historical evidence, not authority.
