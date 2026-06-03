# Linq Reminder E2E Harness

## Goal

Get the hosted-local Linq scheduled reminder E2E gate passing by fixing the
test harness setup when the runtime path is already producing and scheduling
the reminder.

## Constraints

- Prefer harness/E2E fixture changes only; do not touch production source unless
  direct evidence proves a runtime boundary is broken.
- Keep the fix simple and owner-local; do not add scheduler or delivery fallbacks.
- Do not expose direct provider identifiers, secrets, raw payloads, or local
  personal identifiers in code, tests, logs, docs, or handoff.
- Preserve unrelated assistant-engine scheduled-reminder edits.

## Current Evidence

- The failed CI job ran `pnpm hosted-local e2e linq-scheduled-reminder`.
- It timed out waiting for the setup reply send at
  `apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts`.
- Hosted status had already checkpointed a future `nextWakeAt`, but the outbox
  delivery attempt had `targetKindSummary: "none:1"` and
  `deliveryChannelSummary: "none:1"`.
- The synthetic E2E provider directive called `vault-cli automation save`
  without a Linq channel or delivery target, so the fixture created an
  undeliverable setup reply/reminder route before the scheduled wake assertion.
- The focused hosted-local E2E advanced past the setup-reply timeout after the
  fixture passed the explicit Linq route. The remaining local failure happened
  later during idle checkpoint upload to local MinIO/R2 (`ECONNREFUSED`), after
  the scheduled wake/send path was reached.

## Plan

1. Patch the scheduled-reminder E2E directive to pass the explicit Linq
   delivery route it already binds in the test setup. Done.
2. Run the focused hosted-local scheduled reminder E2E. Done; old timeout did
   not recur, local MinIO/R2 checkpoint blocked full green completion.
3. Run required scoped verification and hand off/commit only the harness fix.
   Done.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
