# Send runtime progress incidents overnight

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Alert operators immediately when durable hosted-runtime progress is stalled,
  including during the shared operational-email quiet window, without changing
  detection, recovery, or delivery ownership.

## Success criteria

- The existing runtime-progress monitor sends first alerts and reminders during
  operator quiet hours.
- Latency and allowance monitors retain the shared quiet-hours behavior.
- Existing pacing, idempotency, health rereads, send leases, and singleton
  incident state remain unchanged.
- Focused tests, typecheck, exact-head CI, and ReviewGPT pass.

## Scope

- In scope: one opt-in flag on the existing operational-alert specification,
  the runtime-progress opt-in, focused tests, and matching reliability/test-map
  documentation.
- Out of scope: new monitoring services, tables, queues, notification channels,
  runtime telemetry, automatic suspension, recovery behavior, or Temporal
  admission changes.

## Constraints

- Technical constraints: preserve the shared incident owner and make immediate
  quiet-hour delivery explicit per monitor rather than changing every alert.
- Product/process constraints: this is earlier incident awareness only; do not
  describe it as preventing or recovering a stalled workflow.

## Risks and mitigations

1. Risk: overnight alerts create operator noise.
   Mitigation: opt in only the durable-progress monitor after its existing
   15-minute stall threshold; preserve coalescing, pacing, and six-hour
   reminders.
2. Risk: changing the shared owner accidentally disables quiet hours for other
   alerts.
   Mitigation: retain the current default and run latency-monitor quiet-hours
   coverage alongside the progress tests.

## Tasks

1. Add the narrow per-monitor quiet-hours delivery option and opt in runtime
   progress.
2. Prove initial and reminder delivery overnight while retaining default
   quiet-hour behavior.
3. Update durable reliability and CI-test ownership docs.
4. Run focused verification, commit, open the PR, run ReviewGPT concurrently
   with exact-head CI, remediate accepted findings, and merge.

## Decisions

- Reuse the existing five-minute monitor, incident row, Resend sender, and
  privacy-safe aggregate payload; add no new operational owner.
- Defer invocation-ratio telemetry until the active wake-owner PR no longer
  owns the only correct accepted-progress instrumentation boundary.

## Verification

- Local proof:
  - `pnpm --dir apps/web test:prepared -- hosted-runtime-progress-alert-monitor.test.ts`
    passed 16 tests.
  - `pnpm --dir apps/web test:prepared -- hosted-runtime-latency-alert-monitor.test.ts`
    passed 45 tests.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`
    passed.
- Remaining release proof: exact-head required CI is green and final ReviewGPT
  reports PASS.
Completed: 2026-09-01
