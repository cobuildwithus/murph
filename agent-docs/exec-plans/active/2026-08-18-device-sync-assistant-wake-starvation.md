# Device Sync Assistant-Wake Starvation

## Goal

Restore queued hosted device-sync progress when an obsolete due assistant wake
produces no assistant work. Success means foreground work retains priority, then
one already-durable device-sync mailbox item can run and project its canonical
continuation instead of the workspace repeating no-work checkpoints.

## Evidence

- The deployed bounded-resource fix advances connections that enter the device
  lane, but a remaining production cohort repeatedly checkpoints without any
  device-pass marker.
- An affected workspace has queued device-sync mailbox work beyond its handled
  system-lane frontier while its persisted wake remains assistant-labeled.
- The assistant phase explicitly declines device maintenance for an
  assistant-labeled wake, and the outer wake resolver preserves that due wake
  after a no-progress assistant pass.
- The idle-maintenance refactor removed the former post-assistant legacy
  recovery path without adding an equivalent handoff for already-queued
  canonical device-sync items.

## Constraints

- Preserve fresh conversation, accepted completion, and real due assistant work
  ahead of device maintenance.
- Execute only the existing canonical `device-sync.wake` mailbox owner; do not
  add a scheduler, queue, persisted field, polling loop, or broad resync.
- Keep provider payloads, member identifiers, and production row contents out
  of code, tests, docs, logs, and PR artifacts.
- Preserve the exact wake/checkpoint and mailbox completion fences.

## Plan

1. Add a focused production-shape regression for a due no-progress assistant
   wake shadowing a queued device-sync mailbox item.
2. After the assistant lane proves it has no current work, rerun the existing
   system-mailbox phase with a background device-sync selection that preserves
   the live foreground-yield hook.
3. Merge the resulting checkpoint and wake through existing phase-result
   composition and retain foreground-yield behavior.
4. Run focused tests, assistant-runtime typecheck, scoped coverage verification,
   ReviewGPT, required CI, and protected deployment.
5. Confirm runtime device-pass markers and sync frontiers resume for the
   affected production cohort.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-assistant-phase.test.ts`
  passes all 298 focused assistant-phase tests.
- `pnpm --dir packages/assistant-runtime typecheck` passes.
- Product UX journeys: an idle member with a shadowed durable sync item resumes
  that item after a no-work assistant pass; fresh member input and actual
  assistant progress retain priority; no durable device item produces no
  synthetic sync work.
- Exact pushed-head ReviewGPT, required CI, protected deployment, and production
  convergence proof remain pending.

## State

Status: active
Updated: 2026-08-18
