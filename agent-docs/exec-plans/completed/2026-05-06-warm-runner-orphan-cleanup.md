# Warm Runner Orphan Cleanup

Status: completed
Updated: 2026-05-06
Completed: 2026-05-06

## Goal

Make warm-container process cleanup catch daemonized/reparented job processes before the runner container is reused.

## Success criteria

- Normal descendant cleanup behavior is preserved.
- Same-user processes created during an invocation are killed even when their parent is PID 1 by cleanup time.
- Focused container-entrypoint tests cover the orphan cleanup path.

## Scope

- In scope: `apps/cloudflare/src/container-entrypoint.ts`, `apps/cloudflare/test/container-entrypoint.test.ts`.
- Out of scope: cgroup/process-namespace architecture, changing runner shutdown policy, changing container image layout.

## Constraints

- Keep the warm runner alive when cleanup succeeds.
- Retire the warm runner only when unexpected processes survive cleanup.
- Preserve unrelated dirty work.

## Tasks

1. Register active work. Done.
2. Add pre-invocation process baseline. Done.
3. Extend cleanup to kill same-user new processes plus descendants. Done.
4. Add focused tests. Done.
5. Run focused verification. Done.

## Decisions

- Kept the existing descendant-process cleanup and added a pre-job `/proc` baseline.
- Treat same-UID processes that appear after the baseline as invocation-owned even when they reparent to PID 1.
- Keep cleanup best-effort on the first pass, then fail and retire the warm runner if unexpected processes remain.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/container-entrypoint.test.ts` passed once after implementation.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/container-entrypoint.test.ts` passed after the oversized-request harness was made deterministic.
- `git diff --check -- apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/container-entrypoint.test.ts agent-docs/exec-plans/completed/2026-05-06-warm-runner-orphan-cleanup.md` passed.
- `pnpm test:diff apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/container-entrypoint.test.ts` passed.
