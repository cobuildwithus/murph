# Workout Format Upsert Locking

## Goal

Prevent concurrent workout format upserts from overwriting each other by ensuring each upsert resolves the existing registry record while holding the canonical mutation resource it will rewrite.

Success criteria:

- Concurrent upserts for the same workout format serialize through the canonical workout-format resource.
- Each partial upsert merges with the latest persisted record, not a stale pre-lock snapshot.
- Focused tests cover the race and existing workout format behavior remains intact.

## Constraints

- Keep the fix small and local to the workout-format bank owner path unless a shared registry abstraction is clearly necessary.
- Preserve unrelated dirty working-tree edits.
- Do not add new persisted state.

## Plan

1. Inspect workout format and shared registry write paths.
2. Add resource-scoped locking around workout-format read-modify-write.
3. Add a focused concurrent-upsert regression test.
4. Run package verification required for `packages/core`.
5. Run required completion audits and commit scoped changes if the worktree allows it.

## Verification

- `pnpm --dir packages/core exec vitest run --config vitest.config.ts test/health-bank.test.ts -t "workout format upserts merge concurrent"` passed.
- `pnpm --dir packages/core test:coverage` passed locally.
- Coverage-write pass reran `pnpm --dir packages/core test:coverage` and reported pass.
- `pnpm --dir packages/core typecheck` passed.
- `git diff --check -- packages/core/src/bank/workout-formats.ts packages/core/test/health-bank.test.ts agent-docs/exec-plans/active/2026-05-06-workout-format-upsert-locking.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm test:smoke` passed.
- `pnpm typecheck` failed in unrelated `scripts/dev-hosted-local/stack.test.ts` tuple/implicit-any errors outside this task's files.

## Handoff Notes

- Security/privacy review found no issues.
- Coverage-write found the workout-format concurrency regression sufficient and made no file changes.
- Final review found no code/test issues; it only flagged this plan's pending verification text, now resolved.
- Scoped plan commit is blocked by unrelated dirty edits in `packages/core/test/health-bank.test.ts` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.

Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
