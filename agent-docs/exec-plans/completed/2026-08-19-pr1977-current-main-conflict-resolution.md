# Resolve PR #1977 against current main

Status: completed
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- Reconcile PR #1977 with current `origin/main` through an ordinary merge that
  preserves both the reviewed Google Health cutover behavior and the newer
  Junction/device-sync safety behavior from `main`.

## Success criteria

- Current `origin/main` is an ancestor of the pushed PR head.
- All 14 content conflicts are resolved by verified owner intent, with no
  conflict markers or accidental regression of either side's invariants.
- Focused device-sync, importer, assistant-runtime, and Web tests plus affected
  typechecks pass.
- The PR head is pushed, GitHub reports it mergeable, and required exact-head
  checks are green or any concrete external blocker is reported.
- The final handoff explains the 9,650 added lines by source, tests, docs, and
  the largest owning files.

## Scope

- In scope: ordinary `main` merge, the 14 conflict resolutions, focused proof,
  scoped merge commit, push, PR status verification, and line-count analysis.
- Out of scope: redesigning the Fitbit migration, changing its member-facing
  behavior, broad cleanup, or modifying unrelated primary-checkout work.

## Constraints

- Technical constraints: keep source epochs, logical-fact replay fencing,
  terminal history proof, provider-day ownership, current `main` Junction
  safety reconstruction, and existing retry ownership intact.
- Product/process constraints: preserve the already-reviewed member journey and
  copy; classify the source-identity integration as substantive because it
  combines two runtime contracts rather than claiming the base-only exception;
  follow exact-head CI, review-cap, and privacy rules.

## Risks and mitigations

1. Risk: choosing one conflict side drops a coupled safety invariant from the
   other side.
   Mitigation: inspect stage 1/2/3 blobs and adjacent tests for every conflict,
   then retain both behaviors at the existing owner boundary.
2. Risk: conflict resolution silently changes the reviewed PR patch.
   Mitigation: compare the post-merge PR diff against the pre-merge patch and
   classify every difference as base-only integration or explicit resolution.
3. Risk: the large diff is mistaken for one large source rewrite.
   Mitigation: report category totals and the largest source/test contributors.

## Tasks

1. Record the pre-merge head, base, conflict set, and line-count breakdown.
2. Merge current `origin/main` and resolve each conflict by owner intent.
3. Run focused tests, typechecks, marker scans, and diff review.
4. Archive this plan in the merge commit, push the exact head, and verify PR
   mergeability plus required checks.
5. Report the conflict outcome and explain the change shape.

## Decisions

- Reuse the existing dedicated PR worktree because it is clean, exactly matches
  the pushed head, has no active process CWD, and has no active handoff record.
- Use an ordinary merge rather than rebasing or rewriting the reviewed history.

## Verification

- Commands to run: focused owner tests selected after hunk inspection, affected
  package/Web typechecks, `git diff --check`, conflict-marker scan, current-base
  ancestry/merge-tree proof, and exact-head GitHub check inspection.
- Expected outcomes: all focused checks pass, no markers remain, the final
  patch preserves both sides' behavior, and GitHub reports a cleanly mergeable
  exact head.
- Local result: 1,087 focused tests passed across Core, Importers, Device Sync,
  assistant runtime, and Web; the prepared webhook authority proof also passed
  10/10 against a fresh migrated PostgreSQL database. All five affected package
  typechecks and the Web prepared typecheck passed.
Completed: 2026-08-19
