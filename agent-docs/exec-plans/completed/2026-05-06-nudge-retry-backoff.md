# Nudge Retry Backoff

## Goal

Bound repeated hosted runner nudge fallback retries so the first failed nudge can retry quickly, but persistent runner/container failures back off instead of scheduling a 1-second tight loop.

## Constraints

- Preserve existing max-attempt guard and nudge coalescing behavior.
- Preserve unrelated active Cloudflare runner work in the dirty worktree.
- Keep retry metadata opaque and free of user identifiers or payload contents.

## Implementation Notes

- Inspect current `apps/cloudflare/src/user-runner.ts` retry scheduling and matching alarm tests.
- Add or adjust focused coverage that proves the first nudge retry is fast and later failures back off.
- Preserve `retry_failure_count` across accepted nudges; successful invocations remain the reset path.
- Nudge retry delay is now 1s for the first failure, then doubles per stored failure count until capped by the configured default retry delay.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-alarm.test.ts` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-06-nudge-retry-backoff.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` failed in unrelated `apps/cloudflare/test/container-entrypoint.test.ts` timeout; the timed-out test passed when rerun directly.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/cloudflare verify` failed in unrelated `apps/cloudflare/test/container-entrypoint.test.ts` oversized-request `ECONNRESET`; that exact test passed when rerun directly.
- `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/completed/2026-05-06-nudge-retry-backoff.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
