# Focused sleep-list projection read

Status: completed
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
4. Parent completed final review; PR #3752 records the changelog source reference.
   Completion workflow step 7 archives this plan through `scripts/finish-task`;
   step 8 still requires exact-head CI and mergeability on the final docs-only
   commit. No PR merge or deployment is authorized.

## Closeout and remaining PR gate

Patch 1 has no runtime change and no candidate-only default assertions. Patch 2
changes only sleep's fresh-row acquisition/composition, adds candidate phase and
partial/global publication proof, and documents the precise query contract.
Parent verified and applied patches 01-05. PR #3752 supplies the
changelog's `sourcePullRequests: [3752]`; member-facing copy is unchanged.
Candidate `c6f6fe538e42` was reconciled with main
`7b97cbe7d646b92c9d8987b4fb6dbf9a2b04916a` by merge `51530202764`, preserving
both independent index entries and the exact combined benchmark include array.
The production runtime diff remains the same two lines relative to that main.

Parent's earlier baseline/candidate proof stands: independently built public
packages, base/base and base/candidate reports each complete at 54 pairs, exact
output parity and expected removed/global-promotion phase counts. Synthetic cold
sleep wall medians were 502.57 -> 353.04 ms (7 measured pairs; before range
463.58-752.59 ms, after 336.08-484.05 ms); stale sleep was 352.84 -> 239.60 ms.
Full sleep output remained 13,806 bytes. Fresh sleep was roughly 2-3 ms higher;
mixed totals were noisy with no demonstrated total improvement. No production
speedup claim is made.

After patch 05, the same default subscription with `gpt-6-sol` passed every live
assertion: one targeted sleep-list help, one date-scoped Oura read, correct public
output, unchanged canonical bytes and no unrelated actions/effects. Parent rated
the actual-sleep reply (7 hours 30 minutes, night ending January 3) `Ready`.
Deterministic JSON/TOON contract plus direct/wrapped cases: 3 passed; assistant
typecheck passed. Post-main public query build, three package typechecks and
dedicated benchmark types passed; focused sleep plus independent event regression:
18 passed. Post-merge source-health/canonical-writer/codec proof: 59 passed,
1 opt-in measurement skipped, superseding the earlier 55-pass shared run.
Parent ran installed-dependency suites locally on Node 24.14.1.

Parent verified final ReviewGPT round 1 `PASS` on
`f83801e1f7b704b91fb9a755d4c1b56f7ce08537`, with no qualifying findings:
[review conversation](https://chatgpt.com/c/6abaedd5-d21c-83ea-b536-f8cc5d204e90).
Exact committed turn/hash, requested `gpt-6-pro` / selected `6Pro`, full snapshot
1/1, round metadata and 14 postimages were verified. Capture exceeded the
180-second minimum: submission 22:44:33Z, still waiting at 22:49:41Z before capture.
The reviewer traced CLI/service/vault-share and shared owners and passed all
6 benchmark-validator tests; installed-dependency suites were unavailable there
(Node 22, no installed dependencies), not substituted for the parent's local proof.
Parent final diff review: `Ready`.

Implementation, local proof and external review are complete; required GitHub CI
is queued/running, not passed. Parent will push the final docs-only closeout after
`scripts/finish-task`, then require green CI on that exact final commit and verify
mergeability. Parent proved a clean merge-tree against main
`506fd170644b6490a85c95e881d85d9f281fc56b` without modifying the candidate;
final-head verification remains required. [PR #3752](https://github.com/cobuildwithus/murph/pull/3752)
owns the pending CI gate and any follow-up. No PR merge or deployment is authorized
or performed.

Parent retired baseline and temporary tooling detached worktrees cleanly; the
open-PR worktree is retained. Known ReviewGPT tooling friction was deduplicated;
no new Frog entry. This record closes implementation and review, not CI or release.
Completed plans are historical evidence, not current operating authority.
Completed: 2026-09-28
