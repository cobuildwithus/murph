# Hourly database-alert pacing and reviewed copy bank

## Goal

Reduce database-health alert repetition without weakening operator visibility:
admit at most one provider-attempt cycle per hour and select recurring
concrete-pressure copy from one reviewed bank of one hundred genuine openings.

## Evidence

- The database-health Durable Object currently uses one persisted 30-minute
  attempt fence at both alert admission and provider entry.
- Every admitted cycle already fans the same immutable body out to both
  configured direct operator chats with stable per-recipient idempotency keys.
- Concrete-pressure recurrence currently rotates through six openings, while
  telemetry-only alerts already use evidence-led one-per-window copy.

## Success criteria

- A new incident, recurrence, retry, or Worker restart cannot enter Linq more
  than once per hour for either configured operator destination.
- One eligible cycle still attempts both distinct healthy operator chats.
- Ambiguous or partially successful delivery retries the exact persisted body
  and the same per-recipient idempotency keys after the hourly fence opens.
- Concrete-pressure alerts select deterministically from exactly one hundred
  reviewed openings using the persisted incident and alert identities.
- The bank contains real operational wording only: no random padding, filler,
  invisible characters, or provider-generated text.
- Telemetry-only alerts retain their existing evidence-led, one-per-unresolved-
  window behavior and do not draw from the recurring-pressure copy bank.

## Architecture constraints

- Reuse the existing Durable Object alert state, immutable pending body,
  provider-attempt timestamp, destination health checks, and idempotency keys.
- Keep admission and provider-entry pacing on the same one-hour constant.
- Add no queue, table, dependency, background owner, or second source of truth.
- Preserve fail-closed chat and line-health suppression.

## Implementation

1. Change the shared database-health alert interval to one hour.
2. Replace the six-opening concrete-pressure rotation with a reviewed bank of
   one hundred openings and a stable incident/alert selection function.
3. Add focused tests for the one-hour boundary, recovery/new-incident pacing,
   exact retry behavior, two-chat fanout, and full-bank reachability.
4. Update the Cloudflare runtime, reliability, and testing contracts.
5. Run focused tests and typecheck, inspect the final diff, then push an exact
   stacked PR head for the required specialist, ReviewGPT, and CI gates.

## Verification log

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/database-health-monitor.test.ts --no-coverage`
  passed: 64 tests.
- `pnpm --filter @murphai/cloudflare-runner typecheck` passed.
- `git diff --check` passed.
- Focused coverage proves the one-hour closed/open boundary, cross-recovery
  fence, two-chat fanout, exact retry identity/body behavior, and all one
  hundred openings before the first repeat.
Status: completed
Updated: 2026-08-09
Completed: 2026-08-09
