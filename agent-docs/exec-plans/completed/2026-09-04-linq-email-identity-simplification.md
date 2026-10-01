# Simplify Linq email identity creation

Status: completed
Created: 2026-09-04

## Outcome and authority

Continue PR #2820 with fewer duplicated reads and unreachable recovery paths.
The prior session is paused under an explicit handoff. Its exact-head
ReviewGPT capture remains running; the revised candidate requires review.

## Existing owners and invariants

- HostedMemberIdentity retains the unique blinded email handle; it remains
  distinct from verified email authorization.
- The existing participant advisory lock serializes lookup and identity
  creation for the same normalized email, including concurrent chats.
- Only the creation winner may admit a new instant-start grant. Keep the
  pending-route collision path for older writers that do not claim identity.
- Migration validation and backfill consume one transaction-scoped route set;
  all existing ambiguity and cross-owner rejection boundaries remain intact.

## Changes and proof

1. Materialize the migration route set once and retain all four rejection
   conditions, nullable identity semantics, and the unique index.
2. Use the existing identity write after the locked lookup; remove its
   redundant collision-recovery branch and consolidate selection inside the
   existing email-lock owner.
3. Run the relevant deterministic suites, real PostgreSQL migration and
   concurrent-creation proof, Web typecheck, lint, and complexity checks.
4. Review the exact delta, archive this plan with a scoped commit, update the
   draft PR evidence, and obtain exact-head review as the review lane permits.

## Product and deployment boundaries

This is an implementation-only simplification of the existing PR behavior.
The original affected-person walkthrough remains applicable. The required
live-Codex journey is still owned by PR #2802 and remains on Hold until that
lane is released. Do not edit that shared journey or mark the PR Ready while
required proof is missing. Apply the additive migration before the new Web
build; no Cloudflare change is part of this task.

## Local result and remaining gates

- Removed 109 net source lines: one materialized migration input replaces five
  repeated route queries; the locked identity write replaces duplicate
  collision recovery; the lock owner absorbs two single-purpose helpers.
- All four migration rejection boundaries now have real PostgreSQL proof,
  including rollback of the column and temporary relation. Successful
  backfill preserves uniqueness and leaves no temporary relation.
- Passed 270 focused dispatch and identity tests, seven PostgreSQL/contract
  cases, 68 production-migration guard tests, full Web typecheck, focused lint,
  complexity, whitespace, and changed-file privacy checks.
- All 213 migrations applied to a fresh isolated local database, which was
  removed after proof. No production operation was performed.
- Parent review found no remaining issue in this simplification. The existing
  PR changelog already describes the unchanged member outcome; no second
  release-note item is warranted for internal refactoring.
- PR completion remains on Hold for the original round-one ReviewGPT result,
  review of the revised pushed head, the separately owned live-Codex journey,
  and required CI. The archived plan records local completion only.
Updated: 2026-09-04
Completed: 2026-09-04
