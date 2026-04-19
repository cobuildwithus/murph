## Title

Collapse hosted-wake retry signaling to one internal exit shape and keep retry scheduling alarm-only.

## Goal

Remove greenfield cleanup residue from the hosted-wake alarm retry fix by eliminating duplicated retry-state tracking and avoiding scheduler side effects from the public `wakeHostedWakes()` method.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused hosted-wake regression tests under `apps/cloudflare/test/**`

## Constraints

- Keep the external `wakeHostedWakes()` return contract stable.
- Do not weaken the alarm-driven retry proof added in the prior fix.
- Keep clean “no due wake” exits separate from retryable backpressure exits.
- Preserve overlapping dirty-tree hosted-wake work outside this exact cleanup.

## Verification

- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/user-runner-hosted-wake.test.ts -t "reschedules alarm-driven|resumes and clears a finalized pending commit"`
- `pnpm --dir apps/cloudflare test:node apps/cloudflare/test/user-runner.test.ts -t "does not schedule a retry alarm when a direct wake drain exits backpressured"`
- `pnpm --dir apps/cloudflare typecheck`

## Notes

- Prefer a single internal drain exit signal over parallel `retryableExit` and `stoppingState` flags.
- Public wake-drain callers should observe drain progress only; retry scheduling policy belongs to `alarm()`.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
