# Hosted Runner Progress Reconciliation

## Goal

Remove local promise liveness from hosted runner progress decisions so mailbox
backlog cannot be masked by a stale Durable Object-local drain promise.

## Success Criteria

- A runtime wake result of `not-wakeable:no-active-child` never reports
  `alreadyRunning` or `local-drain-active`.
- An active write fence remains only a commit fence; if the exact runtime child
  cannot be woken, the fence is cleared by identity and replacement processing
  starts immediately.
- `drainPromise` is used only for local coalescing/waiting, not as proof of
  durable progress.
- Focused tests cover the production stuck signature.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/**` only if needed
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- hosted runtime protocol docs if the liveness wording changes

## Out Of Scope

- New durable tables or mailbox counters.
- Moving write-fence ownership into `RunnerContainer`.
- Runner container image, provider egress, or web ingress changes.
- Cloudflare deploy changes.

## Plan

1. Inspect the current coordinator and test seam.
2. Replace the `drainPromise` liveness branch with exact-fence reconciliation.
3. Start replacement work immediately when the exact child is not wakeable.
4. Add regression coverage for local in-flight plus no active child.
5. Run focused Cloudflare tests and typecheck.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` passed after adding exact-wake, stale-fence, fresh-startup, and stale-completion coverage.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/hosted-local-stale-deferred-replay-e2e.test.ts --no-coverage` first reproduced the stale-fence failure, then passed after the startup-grace and retired-drain failure handling fix.
- Coverage-write audit added stale-failure proof; simplify/final audits found a stale compare-and-clear race, fixed by retiring the local drain only after identity clear succeeds and adding a concurrency regression test.
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner-alarm.test.ts --no-coverage` passed after audit fixes (20 tests).
- `pnpm --dir apps/cloudflare typecheck` passed after audit fixes.
- `pnpm --dir apps/cloudflare verify` passed after audit fixes (74 files, 919 tests).
- `git diff --check -- ARCHITECTURE.md agent-docs/references/hosted-runtime-protocol.md apps/cloudflare/README.md apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/exec-plans/active/2026-05-13-hosted-runner-progress-reconciliation.md` passed.
Status: completed
Updated: 2026-05-14
Completed: 2026-05-14
