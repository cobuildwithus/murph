Goal (incl. success criteria):
- Reproduce and debug hosted Telegram scheduled reminders when the automation route has `channel=telegram` and `threadId` only.
- Success means a hosted-local e2e proves whether the due cron path sends to Telegram with no `deliveryTarget`, and any reproduced failure has a minimal fix with focused verification.

Constraints/Assumptions:
- Preserve existing hosted runtime ownership: web/Temporal wake orchestration, runtime cron execution, channel adapter delivery.
- Use synthetic Telegram ids and local stubs only; do not log secrets or real user/provider identifiers.
- Avoid existing hosted ingress and runner active lanes except for shared e2e registry wiring if required.

Key decisions:
- Start with a thread-only Telegram automation because it matches the reported stored route shape.
- Prefer hosted-local e2e proof over adding production-specific probes unless local execution cannot reproduce the boundary.

State:
- Verification complete; ready for scoped commit.

Done:
- Traced cron route validation/projection and Telegram adapter route inference.
- Added hosted-local Telegram scheduled-reminder e2e for a `threadId`-only automation.
- Hosted-local e2e could not reach test body because local MinIO exited during stack startup twice.
- Added lower-level cron/outbox regression coverage for Telegram `threadId`-only reminder delivery.
- Focused harness/assistant tests and typechecks passed.
- Required coverage-write audit found no missing in-scope proof.

Now:
- Commit scoped repro/coverage changes.

Next:
- Follow up on the local MinIO startup blocker before relying on a completed full-stack hosted-local Telegram scheduled-reminder run.

Open questions (UNCONFIRMED if needed):
- Whether the production miss was due-selection/wake starvation or Telegram delivery rejection if local thread-only delivery passes.
- Whether hosted E2E CI should add a dedicated `telegram-scheduled-reminder` scenario leg (UNCONFIRMED; harness now supports running it by name).

Working set (files/ids/commands):
- `apps/cloudflare/test/hosted-local-telegram-scheduled-reminder-e2e.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- `packages/hosted-local-harness/test/e2e-suite.test.ts`
- `packages/hosted-local-harness/test/hosted-local.test.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
- `pnpm hosted-local e2e telegram-scheduled-reminder --no-bundle` (blocked before test body: local MinIO exited during stack startup)
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts test/assistant-outbox-runtime.test.ts --no-coverage`
- `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts test/e2e-suite.test.ts test/hosted-local.test.ts --no-coverage`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
