# Avoid unnecessary Linq preparation lock contention

Status: active
Created: 2026-09-25
Updated: 2026-09-25

## Outcome and protected boundary

Established direct Linq input should reach the existing mailbox admission owner while unrelated foreign-key inserts are in flight. Genuine member writers, deletion, identity/root/routing drift, and duplicate delivery remain governed by the existing locks and checks.

## Evidence and smallest correction

A synthetic PostgreSQL reproduction of the current preparation lock and two-attempt retry fails both attempts while an unrelated referencing-row insert holds KEY SHARE on an unchanged member. The canonical home-route owner already uses NO KEY UPDATE to permit this case. Align the preparation lock mode while preserving SKIP LOCKED; introduce no helper, retry, cache, schema, config, or state. Crypto preparation remains outside transactions. Historical production lock-holder identity is unproved and is not a claim of this fix.

## Product UX — Patch

- Outcome: avoid unnecessary retry delays accepting an established member's direct message.
- Reaches: ordinary eligible direct input under foreign-key contention; preserve genuine writer contention, revoked/deleted/wrong-member authority, and duplicate admission.
- Proof: composed real-PostgreSQL admission regression, red with the old lock and green with the corrected lock, plus existing focused authority/retry tests. No new reply text or model behavior.

## Tasks and verification

1. Obtain ReviewGPT implementation of the localized correction and minimal owner-level PostgreSQL proof.
2. Inspect the patch and run red/green concurrency proof, relevant Linq preparation/dispatch tests, Web typecheck, focused lint, docs drift, and complexity diff.
3. Add a concise reliability changelog; use existing owner docs only where the contract changes.
4. Commit, push, open draft PR, then mark Ready and start required final ReviewGPT concurrently with exact-head CI.
5. Close this plan, verify final CI and mergeability, and leave the functional PR for human merge.

## Ownership and rollout

Task-owned isolated branch from current main; unrelated contact-card work is untouched. The user explicitly authorized this follow-up functional PR after the completed telemetry sweep. No production mutation, merge, or deployment. Web-only lock mode change has no persisted or protocol shape and needs no coordinated rollout; old instances may retain the unnecessary conflict until replaced.

## Progress

- Diagnosis and eight-case local SQL mechanism reproduction complete; composed production-owner regression pending.
- Open PR inventory and relevant actual diffs show no same-root-cause correction.

- Baseline: 261 focused Linq tests and 28 real-PostgreSQL concurrency tests pass.
- Installed ReviewGPT staging cannot recognize the current Chat controls. The existing tooling correction is used read-only, without dependency changes; the same guarded snapshot and explicit Pro model were staged. Exact accepted-turn recovery is in progress after the capture selector failed. No duplicate request is sent.
- Existing ReviewGPT tooling PR #3713 owns the reproduced staging/capture friction; no duplicate tooling patch or Frog entry. Dependency manifests and other owners remain untouched.
- ReviewGPT implementation recovered on the exact accepted turn with completed marker and explicit Pro model evidence. Production patch is one lock-mode line. Parent corrected only the synthetic KMS project-name fixture and strengthened its HTTP status assertion.
- Composed PostgreSQL proof: old lock fails only the harmless foreign-key case with the expected preparation/member error; genuine member and route writer cases pass. Corrected lock passes all 31 PostgreSQL cases, including commit before holder release, exact duplicate convergence, two-attempt writer rejection, and admission after release.
- All 261 focused Linq tests pass. Web typecheck, focused lint (one unchanged fixture warning), docs drift, and whitespace pass. Complexity remains unchanged: debt 257, max 89; nine existing planner hotspots have no changed branching. A stale generated changelog module caused one content test failure when generation raced the test; the required generation-before-test order is restored.
- Candidate and privacy review: no provider calls, query count, retry budget, schema, state, dependency, or protocol change. Existing cross-member, changed-root, routing, and duplicate authority tests remain in the focused suites. Final PR review and exact-head CI remain pending.
