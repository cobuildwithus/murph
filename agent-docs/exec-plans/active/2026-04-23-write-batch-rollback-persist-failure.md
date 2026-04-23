# Decouple write-batch rollback from metadata persist failures

Status: active
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Ensure `WriteBatch.commit()` always attempts rollback after a commit-time failure even when persisting error or rollback-status metadata also fails.

## Success criteria

- A metadata persist failure that happens after an action mutates canonical state no longer prevents `rollbackAppliedActions()` from running.
- Successful rollback keeps canonical files restored even if the intermediate or final rollback metadata persist fails.
- `WriteBatch` still records `failed` only for real rollback failures, not for best-effort status-write failures around an otherwise successful rollback.
- Focused `packages/core` regression coverage proves the post-mutation metadata-persist failure path.
- Required verification, audit passes, and the scoped commit complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
  - `packages/core/src/operations/write-batch.ts`
  - directly coupled `packages/core/test/core.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-write-batch-rollback-persist-failure.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - the separate active lock-order/write-policy refactor in `packages/core/src/{operations/canonical-resource-lock.ts,write-policy.ts}`
  - write-operation schema changes or new persisted metadata fields
  - broader cleanup of unrelated rollback/status-reporting behavior outside this commit failure path

## Constraints

- Technical constraints:
  - Keep rollback prerequisites in memory and do not make rollback contingent on any follow-up metadata write succeeding.
  - Preserve the current caller-facing behavior of rethrowing the original commit failure after rollback handling.
  - Keep the fix additive on top of the clean current `write-batch.ts` file so it does not fight the separate active core refactor row.
- Product/process constraints:
  - Treat this as high-risk canonical write reliability work and capture direct proof in addition to scripted verification.
  - Follow the plan-bearing repo workflow, including the required completion audits and scoped commit path.

## Risks and mitigations

1. Risk: A narrow patch could still treat post-rollback bookkeeping failures as rollback failures and leave the operation marked unresolved.
   Mitigation: Separate rollback execution from best-effort metadata/stage-cleanup follow-up and add a regression test that fails `persist()` after a canonical mutation.
2. Risk: Failure injection could hit the wrong persist call and miss the real regression.
   Mitigation: Gate the injected failure on the action being marked `applied` while the operation is still `committing`, so the test exercises the post-mutation metadata persist specifically.

## Tasks

1. Register the active plan/ledger row and confirm the current `commit()` failure path against the reported issue.
2. Patch `WriteBatch.commit()` so rollback always runs after a commit-time failure, with metadata writes around rollback treated as best effort.
3. Add a focused regression test for a post-mutation metadata persist failure and verify the canonical file is restored.
4. Run scoped `packages/core` verification, capture direct proof, complete the required audit passes, and land a scoped commit.

## Decisions

- Treat the pre-rollback error metadata persist and post-rollback status persist as best-effort only in the `commit()` failure path.
- Preserve `failed` status for real rollback failures only; do not escalate a successful rollback into `failed` just because follow-up metadata persistence also failed.
- Keep the regression coverage in `packages/core/test/core.test.ts` to avoid widening into the separate `operations-thresholds` lane already claimed by another active plan.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/core/src/operations/write-batch.ts packages/core/test/core.test.ts`
  - `pnpm test:smoke`
- Direct proof:
  - Run the focused `WriteBatch` regression proving a post-mutation metadata persist failure still rolls the mutated canonical file back to its original contents.
- Expected outcomes:
  - Scoped `packages/core` verification passes with the new rollback regression covered.
  - The operation metadata remains recoverable when possible, but rollback no longer depends on metadata writes succeeding first.
