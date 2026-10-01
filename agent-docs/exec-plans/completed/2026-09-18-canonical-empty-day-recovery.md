# Recover authoritative device days after empty imports

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Goal and invariant

Restore a provider-retracted complete day when a subsequent valid complete day
reasserts its facts, preserving canonical identity, monotonic event revisions,
member authority, and replay idempotency.

## Owner and evidence

`packages/core` owns canonical import admission and event reconciliation.
A synthetic original/corrected/empty/original sequence fails at the public
`importDeviceBatch` boundary: unversioned historical content stays deleted;
versioned content creates another ID. A composed Junction importer regression
also fails with zero live temporal facets after repopulation.
Historical replay protection runs before authoritative reconciliation; versioned
reassertion takes the generic deleted-event append branch. Trace and correct
these existing seams without another persisted owner.

## Scope and constraints

ReviewGPT authors production changes; the parent owns synthetic tests, docs,
verification and PR delivery. Production is read-only. No new service, queue,
state schema, migration, dependency, backfill, or manual resync. Preserve stale
revision rejection, member edits/deletions, unrelated sources, and exact receipt
repair behavior. The prior zero-sample PR is merged separately.

## Product UX (Patch)

Outcome: valid complete-day facts return after an empty provider response.
Reaches: existing connected-source canonical history and its normal readers.
Proof: public canonical import plus provider-shaped importer, latest-revision
readback, unchanged replay bytes, and protected member/stale-input journeys.

## Plan

1. Prove failing canonical and composed importer regressions and actual cause.
2. Apply a minimal ReviewGPT-authored correction using existing revision owners.
3. Verify affected canonical/provider paths, typecheck, complexity and docs.
4. Add a member-facing changelog; review candidate; scoped commit and draft PR.
5. Final ReviewGPT with CI on the stable pushed head; close plan and verify final
   required CI and mergeability. Leave the new PR unmerged.

## Evolution and failure

Canonical record schema and lock boundaries stay unchanged. Existing readers
must accept recovery revisions. Ordinary subsequent complete-day imports own
convergence; this task performs no production replay. Confirm deployment skew
and reversibility after implementation. Invalid input must not partially write.

## Verification

Before fix: canonical recovery tests fail for unversioned and versioned inputs;
composed blood-oxygen recovery fails (zero live facets versus three).
All four recovery cases pass after the exact ReviewGPT-authored production
patch. Junction importer suite: 266 tests pass. Core, importer and Web
typechecks pass; changelog archive rendering: 10 tests pass. Public lookup
confirms the original ID and restored value. Additional member-deletion cases
retain the deleted versioned spine. Core full suite: 190 tests pass; two additional member-deletion cases pass.
Final ReviewGPT round 1: PASS on 275003c8a01333e7810cb0a120e0ecface5e0efe.
Required exact-final-head CI and refreshed-base mergeability are the remaining
completion checks, tracked in the PR rather than this immutable closed record.

## Implementation and review

The existing replay-retention set keeps exact receipt authority. Reconciliation
protection is derived separately so a new complete-day delivery can reassert an
unambiguous, set-stamped provider tombstone. Shared current-membership lookup
and a small reassertion predicate reuse existing bounded sets and revision
staging. No new persisted state, network/database operation or history scan.
The new versioned path recognizes the set writer's existing timestamp stamp;
member deletion retains its original spine and existing behavior.

Parent source review confirms one production file (+64/-25), no schema or public
API changes, no new I/O, and existing atomic publication/repair protection.
Complexity passes: debt 255 to 254, maximum 64 to 63. Reconciliation drops to 63;
import orchestration remains 47. Other existing hotspots are untouched; a broad
split would add unrelated scope. Both new helpers remain below the threshold.
Production author response and model hashes match verified gpt-6-pro metadata.

Product UX: Ready for the selected local journeys. Complete-day recovery,
original identity, public lookup, exact replay, stale/equal revisions,
missing/unrelated authority and member deletion are covered. No presentation
change; existing synthetic changelog study inspected and new copy rendered by
its production component tests. No production recovery is claimed.

Authoring attempt on the first managed lane was rejected by the capability-limit
guard; its output is not implementation evidence. A fresh full-context authoring
request on another configured lane keeps the same required model.

PR: https://github.com/cobuildwithus/murph/pull/3575.

## Final candidate review

The parent accepted no unresolved findings. Verified ReviewGPT response and
model metadata hashes agree, with requested and response model both gpt-6-pro.
Response SHA-256: d897876fe7da116fc72776e683f5ac9934f996629e864d68f6b6f13a233af7f0.
The final change after review only archives this plan and updates its index;
production, tests, owner contract and changelog remain the reviewed content.
No second substantive review is required for that explanatory documentation.
The PR remains unmerged; no manual deployment or production import was performed.
Completed: 2026-09-18
