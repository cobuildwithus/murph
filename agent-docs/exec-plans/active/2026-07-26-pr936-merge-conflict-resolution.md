# PR 936 merge conflict resolution

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Reconcile PR #936 with the current `origin/main` without weakening its
  receipt-anchored 14-day inbound-message content retirement or the current
  hosted runner, retention, and migration owners already on `main`.

## Success criteria

- The branch contains a normal merge of current `origin/main`.
- All six observed conflicts are resolved at their current owner boundaries,
  with no duplicate state, compatibility machinery, or unrelated cleanup.
- The retention migration still advances the existing workspace CAS version
  while leaving checkpoint time unchanged, stale checkpoints cannot clear the
  rearmed wake, and accepted-runtime recovery still distinguishes
  migration-only version movement from a genuine runtime checkpoint.
- Incoming `main` behavior in the runner-bundle entrypoint, hosted retention
  cleanup, migration inventory, and current runtime protocol is preserved.
- Focused conflict-path tests, the canonical diff-aware verification lane, and
  `pnpm verify:acceptance` pass on the merged head.
- The merged head is committed through `scripts/finish-task`, pushed, and the
  PR body change-shape/current-head metadata is refreshed.
- CI is green, the PR is conflict-free, and the manual conflict-resolution
  delta receives the required next final ReviewGPT correction-verification
  `ROUND_OUTCOME: PASS`.

## Scope

- In scope:
  - `agent-docs/references/hosted-runtime-protocol.md`
  - `apps/cloudflare/scripts/runner-bundle/bundle-entrypoint.ts`
  - `apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts`
  - `apps/web/src/lib/hosted-retention/cleanup.ts`
  - `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
  - `apps/web/test/hosted-retention-cleanup.test.ts`
  - Merge-generated updates to already-touched non-conflicting files, this
    plan, its exact ledger row, PR metadata, verification, CI, and ReviewGPT
    evidence.
- Out of scope:
  - New retention features, state owners, migrations, compatibility paths, or
    unrelated cleanup.
  - Reopening the already-passed round-7 remediation except where the merge
    directly affects its code path.

## Constraints

- Technical constraints:
  - Preserve one durable receipt owner and the current workspace checkpoint
    CAS; do not add a marker, queue, dispatcher, or reconciliation path.
  - Resolve conflicts from code-path and test evidence rather than choosing a
    side wholesale.
  - Preserve unrelated working-tree and coordination-ledger work.
- Product/process constraints:
  - The content-retirement outcome remains automatic and content-free after
    expiry while structural conversation facts and promoted memory survive.
  - This is a manual-conflict-resolution head change, so it requires canonical
    verification, CI, and another final ReviewGPT correction round.
  - The user's request to continue the saved completion session is the current
    continuation decision for the already-retrospected beyond-cap review loop.

## Risks and mitigations

1. Risk: Resolving retention cleanup conflicts by taking either side wholesale
   could drop a newly added carrier or reintroduce destructive legacy
   inference.
   Mitigation: Trace the current cleanup owner and compare both sides against
   focused retention tests before editing.
2. Risk: Runner-bundle conflict resolution could omit a newly required
   production closure.
   Mitigation: Preserve current `main` bundle ownership, add only the PR's
   still-required retention closure, and run the bundle-entrypoint regression.
3. Risk: A clean textual merge could still change checkpoint/recovery ordering.
   Mitigation: Re-run the real-PostgreSQL stale-checkpoint proof, focused
   Cloudflare transport/alarm tests, and canonical acceptance.

## Tasks

1. Inspect the merge-base, PR, and current-`main` versions of every conflicted
   file and identify the owner-level intent on both sides.
2. Merge `origin/main` normally and resolve only the six conflicts with the
   smallest combined implementation.
3. Run conflict-path tests and direct diff/readback checks; correct any proven
   regression.
4. Run `pnpm test:diff` for the resolved files and `pnpm verify:acceptance`.
5. Perform the parent final review, privacy scan, and diff-shape check.
6. Close this plan and commit through `scripts/finish-task`, push, and refresh
   the PR body.
7. Start CI and final ReviewGPT correction verification concurrently; resolve
   only accepted findings and finish with green CI, a conflict-free PR, and
   `ROUND_OUTCOME: PASS`.

## Decisions

- Use a normal merge rather than rewriting already-reviewed branch history.
- Treat round 7 as valid: its exact-head response ran above the trust floor,
  carried the requested model-family evidence, returned no findings, and ended
  with `ROUND_OUTCOME: PASS` plus `REVIEW_COMPLETE`.

## Verification

- Commands to run:
  - Focused Vitest commands for the six conflict owners and the existing
    real-PostgreSQL stale-checkpoint regression.
  - `pnpm test:diff <resolved paths...>`
  - `pnpm verify:acceptance`
  - `git diff --check`, privacy/identifier scan, merge-tree or GitHub
    conflict-state proof, and PR CI checks.
- Expected outcomes:
  - All commands pass on the exact pushed merged head.
  - No unresolved accepted ReviewGPT finding remains.
