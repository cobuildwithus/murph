# Prevent a stale assistant wake from delaying a newer reminder

Status: completed
Created: 2026-08-18
Updated: 2026-08-18

## Goal

- Ensure a reminder created inside an already-running hosted invocation is
  serviced at its due time even when an older assistant wake remains the
  invocation's carried projection.

## Success criteria

- A focused regression reproduces the observed sequence: foreground turns
  defer cron work, an idle checkpoint persists an older due assistant wake, a
  runtime nudge performs an empty mailbox probe, and a newer reminder becomes
  due before the next idle checkpoint.
- The newer due reminder is scanned without waiting for the next idle
  checkpoint or another inbound message.
- Existing foreground-message priority, outbox retry wakes, durable checkpoint
  barriers, and the single Temporal/Web/Cloudflare/runtime owner chain remain
  intact.
- The correction introduces no scheduler, queue, polling loop, persisted field,
  or alternate wake owner.
- Focused tests, exact-head CI, preliminary specialist review, final ReviewGPT,
  and a deployed reminder canary pass.

## Evidence

- A short reminder arrived more than three minutes late even though provider
  delivery followed Murph's outbound send immediately.
- The active runtime checkpointed an older assistant wake. Its due projection
  was dispatched, but the runtime imported no mailbox work and did not scan
  scheduled work.
- The next idle checkpoint exposed the newer overdue reminder wake. The
  orchestrator dispatched it immediately and delivery followed promptly.
- The preceding stale-wake fix deliberately covered carried non-assistant wakes
  only. Its assistant-wake preservation rule still allows an older due assistant
  token to shadow a newer assistant obligation inside one dirty invocation.

## Scope

- In scope: hosted runtime wake projection/consumption, dirty-window wake
  handling, focused runtime tests, and the existing hosted reminder scenario if
  needed for end-to-end proof.
- Out of scope: reminder copy, automation storage format, Temporal workflow
  ownership, provider delivery, new persistence, and unrelated maintenance
  scheduling.

## Tasks

1. Build a synthetic, test-only reproduction on the current main branch.
2. Ask ReviewGPT to validate the evidence, reproduce independently, and identify
   the smallest invariant-level correction.
3. Apply only the accepted existing-owner fix and retain the red regression.
4. Run focused assistant-runtime and Cloudflare proof plus required typechecks.
5. Push the exact candidate, open the PR, and run specialist/final ReviewGPT
   gates concurrently with CI.
6. Resolve accepted findings, merge, deploy the affected runtime surface, and
   verify a fresh reminder canary.

## Decisions

- Treat the production trace as evidence, not repository content; tests use
  synthetic times, ids, and messages only.
- Require a failing repository regression before changing production code.
- Prefer deleting or relaxing the incorrect wake-preservation branch at the
  existing owner boundary over adding coordination state.
- Do not make Temporal repeatedly dispatch the same due token; the runtime must
  make progress under the already-accepted owner handoff.
- Retain the later assistant obligation in the existing
  `pendingWakeAfterDueAssistantService` slot while the older due assistant wake
  crosses its service/checkpoint barrier.
- Promote and immediately checkpoint that retained successor after the exact
  predecessor's hot attempt is committed. Do not add a scheduler, queue,
  persisted field, or polling path.

## Progress

- A production-shape regression reaches the distinct later reminder, the empty
  persisted-wake dispatch, and the exact lost-owner assertion.
- ReviewGPT isolated the assistant-to-assistant projection loss. Two proposed
  harness corrections were rejected after local execution because they still
  let the live foreground watcher consume the only wake notification; the third
  correction established the outer-loop ownership barrier used by the final
  regression.
- The existing held-wake owner now retains and promotes the later assistant
  obligation after the predecessor is checkpointed.

## Verification

- Run the narrow assistant-runtime entrypoint/workspace-runner regression first.
- Run the affected assistant-runtime package tests and typecheck after the fix.
- Run the hosted-local scheduled-reminder scenario when the synthetic harness
  proves the exact boundary.
- Require green exact-head CI and both routed ReviewGPT stages before merge.

Completed local proof:

- Focused wake-barrier tests: 4 passed.
- Assistant-runtime typecheck: passed.
- Full assistant-runtime suite: 89 files passed; 2,375 tests passed and 4
  skipped.
Completed: 2026-08-18
