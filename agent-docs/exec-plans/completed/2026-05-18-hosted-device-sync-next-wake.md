# Hosted device-sync next wake

Status: completed
Created: 2026-05-18
Updated: 2026-05-18

## Goal

Fix hosted WHOOP/device-sync scheduled reconcile wakes so a successful
device-sync mailbox wake preserves its follow-up wake and scheduled
device-sync alarms run the device-sync lane instead of being skipped forever.

## Success Criteria

- A processed `device-sync.wake` mailbox item carries its follow-up
  `nextWakeAt` through post-checkpoint recording.
- Follow-up device-sync wakes preserve a `device-sync.reconcile` reason so the
  alarm path can distinguish background sync from assistant/chat work.
- Active user input and nudge paths still skip device sync on the hot path and
  reschedule the skipped sync wake.
- An end-to-end hosted runtime regression proves the first device-sync wake
  persists a follow-up wake and the follow-up alarm runs device sync.
- Focused assistant-runtime tests and typecheck pass, or unrelated blockers are
  recorded.

## Scope

- In scope:
  - Hosted assistant-runtime wake selection and device-sync skip logic.
  - Focused hosted runtime and hosted-local/runtime e2e tests for the skipped
    wake path.
- Out of scope:
  - Provider token handling.
  - WHOOP API behavior.
  - Cloudflare runner alarm caching.
  - Local database mutation or repair.

## Constraints

- Do not log or expose health payloads, provider responses, tokens, user ids,
  account ids, local paths, usernames, or secrets.
- Preserve unrelated dirty working-tree edits and active hosted-runner work.
- Keep the hot chat/nudge path from doing background device-sync work.

## Tasks

1. Register the active work and inspect the mailbox/device-sync wake handoff.
2. Preserve device-sync next-wake timestamps and reason through mailbox
   post-checkpoint handling.
3. Allow due background `device-sync.reconcile` alarms to run device sync while
   continuing to skip active-input paths.
4. Add focused regression tests.
5. Add an e2e-style hosted runtime regression covering first wake through
   follow-up alarm.
6. Run assistant-runtime verification, required audits, and commit/close if the
   checkout allows a safe scoped commit.

## Verification

Passed:

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-assistant-phase.test.ts hosted-runtime-workspace-entrypoint.test.ts hosted-runtime-events-coverage.test.ts hosted-runtime-maintenance.test.ts`
  - 52 test files passed; 568 tests passed, 2 skipped.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
  - Covered `packages/assistant-runtime` typecheck/test and dependent
    `apps/cloudflare verify`.
- `git diff --check -- <task files>`

Audits:

- `simplify` and `security-privacy-review` found reason propagation gaps in
  hot-path deferral and post-checkpoint delivery; both were fixed.
- `coverage-write` added a fast-dispatch hot nudge assertion for preserving
  `device-sync.reconcile`.
Completed: 2026-05-18
