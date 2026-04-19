## Title

Retry alarm-driven hosted-wake drains when terminal or cursor callbacks backpressure before the drain finishes.

## Goal

Ensure alarm-driven hosted-wake draining does not return successfully after a retryable terminal-receipt or cursor-commit interruption, because that currently skips the bounded retry alarm path and can strand a pending commit until an unrelated nudge arrives.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused hosted-wake regression tests under `apps/cloudflare/test/**`
- `apps/cloudflare/test/sql-storage.ts` helper parity needed by the hosted-wake test lane

## Constraints

- Keep the public `wakeHostedWakes()` result shape stable unless a wider contract change is strictly necessary.
- Preserve clean no-due-wake exits; only retry truly interrupted drains.
- Reuse the existing bounded alarm retry behavior instead of inventing a second retry policy.
- Preserve overlapping dirty-tree hosted-wake work outside this exact retry-gap fix.

## Verification

- `pnpm typecheck`
- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/user-runner-hosted-wake.test.ts -t "reschedules alarm-driven|resumes and clears a finalized pending commit"`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/sql-storage.ts`

## Notes

- The preferred shape is an internal typed retry signal for alarm-driven drains, not scattered scheduler writes through the drain loop.
- Required proof includes terminal-receipt and cursor-commit callback failure during `alarm()` with no initial retry scheduled before the fix and bounded retry scheduling plus later resume/finalize after the fix.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
