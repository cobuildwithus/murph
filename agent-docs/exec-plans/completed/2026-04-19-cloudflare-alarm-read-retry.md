## Title

Reschedule Cloudflare wake alarms when Durable Object state reads fail.

## Goal

Keep hosted wake processing from wedging when `HostedUserRunner.alarm()` cannot read Durable Object state by logging the failure and scheduling the same bounded retry used for downstream wake nudge failures.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused `apps/cloudflare/test/user-runner.test.ts`

## Constraints

- Preserve the existing alarm behavior for unbound or non-bootstrapped runners.
- Reuse the existing bounded retry cadence instead of introducing a new retry policy.
- Keep the fix narrow and avoid disturbing adjacent hosted wake work already in flight.

## Planned shape

1. Catch `stateStore.readState()` failures inside `alarm()` with a warning log.
2. Schedule `wakeScheduler.syncNextWake()` with the existing nudge retry delay before returning.
3. Add a regression test that stubs `readState()` to throw and proves the retry plus log.

## Verification

- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner.test.ts`

## Notes

- The proof should show the old wedge condition directly: a read failure during `alarm()` must no longer return silently without a retry signal.
