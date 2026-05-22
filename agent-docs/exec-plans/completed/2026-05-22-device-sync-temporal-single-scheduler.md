# Device-sync Temporal single scheduler

Status: completed
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Make Temporal the only production device-sync recovery scheduler by removing
  the old Vercel dirty-sweeper cron and making the Temporal device-sync
  reconciler Schedule enabled by default.

## Success criteria

- `apps/web/vercel.json` no longer schedules the old device-sync dirty-sweeper
  cron.
- The old cron route is removed or made unreachable as a scheduler surface.
- The Temporal schedule ensure path defaults to enabled while still allowing an
  explicit env override to disable it.
- Recovery duplicate behavior remains bounded enough for Temporal retries and
  overlapping operator invocations.
- Focused tests cover scheduler ownership and retry/idempotency behavior.
- Durable docs describe Temporal as the active single scheduler rather than a
  migration target with a live Vercel safety net.

## Scope

- In scope:
  - Vercel cron config and route cleanup.
  - Temporal device-sync reconciler schedule defaults/tests/docs.
  - Web recovery dedupe behavior directly needed for scheduler cutover.
  - Focused web/Temporal tests and durable architecture docs.
- Out of scope:
  - Per-user workflow polling or demand global scans.
  - Provider ingress acceptance semantics.
  - Dirty recovery fanout redesign from per-connection to per-user nudges unless
    required to keep retries bounded.

## Constraints

- Preserve unrelated dirty work, especially the active wearable receipt
  compaction lane.
- Keep Temporal history pointer/count-only and keep canonical dirty/due facts in
  `apps/web`.
- Do not make provider ingress success depend on Temporal availability.
- Avoid changing command order in existing long-lived per-user workflows.

## Tasks

1. Inspect the current cron, schedule, wake, and runtime-control recovery seams.
2. Remove the old Vercel cron scheduler and make the Temporal schedule default
   enabled.
3. Add or adjust deterministic recovery dedupe where Temporal retries require it.
4. Update tests and durable docs.
5. Run focused verification, audits, and close the plan with a scoped commit.

## Verification

- PASS: focused hosted-web Vitest for device-sync wake/sweeper/recovery route,
  hosted-orchestration signal runtime, and Vercel cron guard tests.
- PASS: focused hosted-orchestrator-temporal Vitest for the device-sync
  reconciler workflow/schedule and recovery-sweep activity.
- PASS: `pnpm typecheck`.
- PASS: `pnpm test:diff` for the device-sync scheduler/recovery cutover paths,
  covering hosted-orchestrator Temporal typecheck/test and hosted-web verify.
- PASS: security/privacy review found no findings.
- PASS: coverage-write review found no missing high-value proof.
- PASS with follow-up fix: final task review found deterministic recovery
  re-signaling could be one-shot after mailbox import; fixed with explicit
  `device_sync_recovery_requested` signaling and stable mailbox checkpoint
  occurrence time, then reran focused Vitest, `pnpm typecheck`, and
  `pnpm test:diff` for the mailbox/signal delta.
Completed: 2026-05-22
