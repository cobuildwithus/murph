# PR 572 deferred pending-input drain

Status: completed
Created: 2026-07-13

## Goal

Let a pending assistant input that already existed at pass start enter the
background automation lane, while preserving the existing preemption guard for
input staged during unrelated background work.

## Evidence

- Two independent hosted E2E jobs repeatedly imported every mailbox row and
  delivered the first reply, then persisted an overdue assistant wake with no
  Cloudflare alarm or successor provider turn.
- The post-delivery phase correctly re-read the pending-input index and exposed
  the sibling wake.
- On the checkpoint wake pass, the assistant phase found the already-pending
  input and returned that wake before calling the background automation lane.
  A replacement runtime repeats the same branch indefinitely.

## Scope

- Distinguish pending work present when the assistant pass begins from input
  staged while background work is running.
- Add focused phase coverage proving existing pending work reaches automation,
  still preempts system/device maintenance, and gets a bounded retry when the
  automation lane reports no progress.

## Constraints

- Keep the canonical pending-input index and one-input selector unchanged.
- Add no queue, manager, persisted lifecycle state, or wall-clock ordering.
- Preserve late-input preemption and the priority of user input over system
  mailbox, device-sync, and provider-cleanup work.

## Verification

- Run the focused assistant-phase regression and package typecheck.
- Run diff-aware verification and required completion audits.
- Push the corrected exact head, require green CI, then obtain a new
  substantive clean exact-head ReviewGPT audit because source/tests changed.
Updated: 2026-07-13
Completed: 2026-07-13
