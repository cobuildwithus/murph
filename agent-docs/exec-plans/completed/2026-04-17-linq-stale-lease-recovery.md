## Goal

Stop hosted Linq reply runs from losing or replacing their active Cloudflare lease, including the pre-claim overlap where concurrent alarms can reclaim the same pending event before the first run writes its lease.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-dispatch-processor.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- focused `apps/cloudflare/test/**` regression coverage for stale-lease recovery

## Constraints

- Preserve legitimate crash recovery for genuinely stale in-flight leases.
- Do not broaden the hosted runner/public API surface beyond what the fix needs.
- Keep the patch limited to hosted runner recovery, run-loop serialization, and Linq-facing regressions.

## Verification

- Focused `apps/cloudflare` tests for the new stale-lease regression
- Focused `apps/cloudflare` tests for overlapping run-loop claim races
- App-level verification for touched `apps/cloudflare` slice per repo policy
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
