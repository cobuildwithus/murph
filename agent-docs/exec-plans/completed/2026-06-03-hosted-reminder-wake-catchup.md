# Hosted Reminder Wake Catch-Up

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Fix hosted-local scheduled reminders so a saved one-shot reminder fires without requiring a later inbound message, and overdue reminders catch up when the runtime wakes.

## Success criteria

- Confirm the missed 2026-06-03 15:43 ET reminder failed at the orchestration/scheduler boundary, not at Linq delivery.
- Identify the minimal Cloudflare/Temporal/runtime owner path responsible for wake scheduling or catch-up.
- Patch the smallest durable fix with focused regression coverage.
- Restart the local hosted dev stack and verify a fresh iMessage/Linq reminder is delivered end to end.

## Scope

- In scope:
  - Hosted-local Temporal demand/wake scheduling.
  - Cloudflare runner invocation lifecycle and `nextWakeAt` propagation.
  - Assistant automation overdue catch-up behavior only where needed for the root cause.
- Out of scope:
  - New scheduler owners, fallback queues, or broad runtime redesigns.
  - Unrelated device-sync, billing, onboarding, or frontend changes.

## Constraints

- Technical constraints:
  - Web remains owner of mailbox ordering and workspace checkpoints.
  - Temporal owns runtime-returned `nextWakeAt` sleeps.
  - Cloudflare Durable Objects coordinate execution and write fences only.
  - Runtime logs and diagnostics must stay metadata-only and redacted.
- Product/process constraints:
  - Preserve foreground reply priority.
  - Do not expose local identifiers, secrets, raw prompt contents, or message payloads.

## Risks and mitigations

1. Risk: Fixing scheduler wake by adding a second owner could duplicate delivery.
   Mitigation: Trace existing Temporal/Cloudflare ownership first and patch only that path.
2. Risk: Local dev has multiple active hosted stacks.
   Mitigation: Keep active `pnpm dev` stack evidence separate from e2e/stale containers.

## Tasks

1. Query persisted workspace/mailbox/runtime state around the missed reminder.
2. Trace Temporal wake and Cloudflare invocation code paths for `nextWakeAt`.
3. Add the smallest regression test around the failing wake/catch-up path.
4. Patch implementation.
5. Run focused tests plus required verification.
6. Restart hosted-local dev and run an end-to-end reminder through iMessage/Linq.

## Decisions

- Treat this as a hosted runtime orchestration bug until evidence shows the assistant delivery path failed.
- Confirmed root cause is assistant wake projection after hosted queue-only cron deferral:
  due cron jobs could return a past `nextRunAt`, and hosted runtime discarded that
  stale timestamp instead of scheduling a catch-up wake.
- Preserve foreground reply priority. Do not process cron in the same hosted
  queue-only foreground reply pass; checkpoint a short future catch-up wake when
  due cron exists. Use a 10-second catch-up margin so hosted normalization does
  not discard the wake if checkpoint handoff takes more than a moment.

## Verification

- Completed:
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-automation-runtime.test.ts` passed.
  - `pnpm exec vitest --config apps/cloudflare/vitest.config.ts run apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm test:diff packages/assistant-engine/src/assistant/automation/run-loop.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts` passed.
  - Required security/privacy, coverage, and task-finish audits completed.
- Direct hosted-local evidence:
  - The Linq scheduled-reminder E2E delivered the scheduled reminder through
    Temporal/Cloudflare/Linq stub without an inbound nudge.
- Remaining live-dev gap:
  - Computer Use is blocked by local connector profile configuration.
  - The restarted `pnpm dev` stack lacks the Linq webhook secret/conversation
    environment required for a real iMessage-triggered local webhook.
Completed: 2026-06-03
