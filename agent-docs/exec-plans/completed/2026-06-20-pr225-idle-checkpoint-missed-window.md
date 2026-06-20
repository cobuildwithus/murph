# PR 225 Idle Checkpoint Missed Window

## Goal

Fix the hosted-local idle-checkpoint E2E so it does not fail when the runner
commits the idle checkpoint before the test observes the short post-turn
pre-checkpoint window.

## Constraints

- Keep the change in the E2E harness flow only.
- Accept the missed window only when committed idle-checkpoint progress proves
  the expected conversation sequence.
- Do not change production runtime checkpoint, write-fence, or retry behavior.

## Plan

1. Let the post-turn waiter return either the pre-checkpoint window or already
   committed idle-checkpoint progress for the expected sequence.
2. Use that result to skip the foreground wait when progress is already
   committed.
3. Run focused local verification, then push and wait for CI.

## Verification

- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-idle-checkpoint-deferred-progress-e2e.test.ts -t "hosted local idle checkpoint deferred progress log helpers" --no-coverage` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
