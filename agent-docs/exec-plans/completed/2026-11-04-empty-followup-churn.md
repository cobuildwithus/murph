# Retire completed wakes during restored completion replay

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal

- Stop re-publishing a serviced assistant deadline when a restored device
  completion journal is replayed during the same invocation.

## Success criteria

- A regression fails on the task base and passes after the correction.
- Restored completion replay preserves the current pass's next wake and saves
  its cleanup. Fresh work keeps save-before-effect ordering.
- Focused runtime regressions and the package typecheck pass.

## Scope

- In scope: runtime recovery dirtiness and follow-up wake merging; synthetic
  runtime tests and the package behavior owner.
- Out of scope: Web/Temporal admission changes, device dirty-state suppression,
  deployments, commits and PRs.

## Constraints

- Keep canonical mailbox progress, device repair/backfill, deletion deadlines,
  and checkpoint ordering intact. Add no persisted state or new scheduler.
- Production access is read-only. Private evidence stays out of this plan.

## Risks and mitigations

1. Restored and fresh completion work have different durability boundaries.
   Use the existing alreadyCheckpointed evidence; test fresh snapshot ordering
   and recovered journal cleanup separately.
2. A due device continuation can represent unfinished dirty work.
   Keep that wake path; absence of import/pass logs alone is insufficient proof.

## Tasks

1. Trace checkpoint, reconciliation facts and workflow history (done).
2. Reproduce restored completion replay retaining an old assistant deadline (done).
3. Avoid dirtying state merely on journal discovery; avoid rebasing a current
   pass to the old checkpoint when replay effects publish no new workspace (done).
4. Verify preserved failure, continuation and checkpoint boundaries; document
   the result and hand off without committing (done).

## Decisions

- Existing ready effects already identify restored durable journals. Their
  actual replay owns cleanup dirtiness, not journal discovery.
- Internal scheduling correction; no changelog or model-prompt change.
- Runner-only change with no wire/schema evolution. Old runners retain churn;
  Web and Temporal continue consuming their existing checkpoint contract.

## Verification

- `pnpm install --frozen-lockfile` and `pnpm build:test-runtime:prepared`: passed.
- All three added regression variants fail with unchanged task-base source and
  pass with the correction: future assistant work, cleared assistant work, and
  a model-free predecessor ahead of a canonical future cron. Checks also cover
  journal cleanup in the snapshot, unchanged imported/handled progress, and one
  idle snapshot.
- Device snapshot/replay suite: 17 tests passed.
- Entrypoint collapse/preemption and device continuation suites: 73 tests passed.
- `pnpm --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed, unchanged measured debt and maximum.
- `git diff --check`: passed.
- Live model proof is inapplicable: this correction consumes the existing
  assistant phase result and changes no prompt, tool, model or reply policy.
- CI and external review remain with the parent; no commit, push or PR is
  authorized for this handoff.
Completed: 2026-11-04
