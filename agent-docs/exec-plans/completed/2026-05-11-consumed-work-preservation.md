# Consumed Work Preservation

## Goal

Make abnormal hosted runner active-invocation clear paths preserve foreground work because pending work was actually consumed, not because the active invocation reason happens to be `nudge`.

## Constraints

- Keep the change narrow and composable.
- Preserve unrelated working-tree edits.
- Do not weaken foreground recovery, idle checkpoint, or user deletion semantics.
- Follow hosted runner state schema/versioning rules for new persisted coordination state.

## Plan

1. Record whether `beginInvocation` consumed pending foreground work on the active invocation lease row.
2. Use that recorded fact for abnormal clear preservation.
3. Add a focused regression where non-`nudge` foreground-consuming work is restored after abnormal clear, plus a guard for non-consuming idle checkpoint work.
4. Run focused Cloudflare checks, typecheck, and required completion audits.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts -t "preserves consumed foreground work|does not preserve idle checkpoint work|does not recreate foreground work|adds invocation liveness metadata|migrates schema v3"` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-state-store-recovery.test.ts` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/runner-state-helpers.ts apps/cloudflare/src/user-runner/runner-state-schema.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts apps/cloudflare/test/sql-storage.ts` failed in overlapping `apps/cloudflare/test/user-runner-alarm.test.ts` idle-checkpoint/browser-vault cases unrelated to the consumed-work state-store invariant.

## Notes

- This is a hosted execution reliability/state change under `apps/cloudflare`.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
