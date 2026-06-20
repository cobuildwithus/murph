# PR 225 Linq Scheduled Reminder E2E

## Goal

Stabilize the hosted-local Linq scheduled-reminder E2E on PR 225 without changing production runtime behavior unless the repro proves a runtime bug.

## Scope

- `apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts`
- `apps/cloudflare/src/user-runner/hosted-user-runner-test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- CI/runtime evidence for the focused hosted-local Linq scheduled-reminder scenario

## Constraints

- Keep the fix small and local-harness-only if the runtime path is correct.
- Preserve the hosted runtime ownership split: runtime owns scheduling, web-visible workspace checkpoints are status/projection evidence.
- Do not add a second scheduler or extra production status path for a test predicate.

## Current Evidence

- CI failure showed setup delivery succeeded but the helper timed out waiting for exact `workspace.nextWakeAt`.
- Source `vault-cli automation save` and `getAssistantCronStatus` create and report the one-shot Linq automation correctly.
- A local hosted-local run with an isolated Postgres DB passed end to end.
- Local runtime logs showed the one-shot automation present and due internally, while the final checkpoint later stored the next managed wake.
- The hosted-local `/alarm` helper only syncs/clears runner alarms; it does not start a fresh runtime invocation from a checkpointed scheduled wake.
- A patched local rerun exposed the deeper flake: `run-until-idle` returned `scheduled` behind an active write fence without invoking the production stale-fence recovery path, leaving generic completion waits stuck on stale status even after Linq delivery succeeded.
- The due-time scheduled run should use one owner. In the full hosted-local stack that owner is Temporal, so the Linq E2E should sleep until the due time and wait for the Linq send rather than calling a test-side signed wake while Temporal is also handling backoff.
- The focused Linq scheduled-reminder E2E now passes locally without a due-time nudge.

## Plan

1. Stop asserting transient web-visible wake state in the Linq E2E.
2. Sleep until the scheduled due time, then wait for the Linq send so the test asserts the user-visible result under Temporal-owned scheduling.
3. Make the hosted-local `run-until-idle` test control delegate active-fence recovery to the production runtime-processing path.
4. Add a unit regression for active-fence run-until-idle recovery.
5. Run the focused hosted-local Linq scheduled-reminder E2E.
6. Run scoped verification and commit through `scripts/finish-task`.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
