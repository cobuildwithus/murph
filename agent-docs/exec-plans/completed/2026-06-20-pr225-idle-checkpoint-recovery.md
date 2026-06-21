# PR 225 Idle Checkpoint Recovery

## Goal

Fix the hosted-local idle-checkpoint E2E waiter race where durable deferred
foreground progress is visible before a stale idle-checkpoint error is reported,
so PR 225 can merge on a clean CI signal without changing runtime recovery
semantics.

## Constraints

- Keep the change narrowly scoped to the E2E waiter.
- Do not weaken write-fence validation or snapshot authority checks.
- Use existing durable web status/log evidence; do not add a new scheduler or
  production branch.

## Plan

1. Check foreground deferred mailbox progress evidence before treating a
   completed hosted error as terminal in the E2E waiter.
2. Run focused static verification locally.
3. Push and let the GitHub E2E rerun prove the full hosted-local path.

## Verification

- `git diff --check` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- Full local hosted-local E2E remains unavailable in this checkout because the
  local Postgres role cannot create the temporary E2E database; GitHub Actions
  will rerun the failing hosted-local E2E after push.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
