# Progress-sensitive runtime wake non-starvation

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Keep scheduled automations punctual while bounded background work is stuck or
  repeatedly re-presented, and prevent unchanged background state from causing
  an unbounded runtime-start storm.
- Preserve Web as reconciliation-fact owner, the public runtime as durable-work
  owner, and Temporal as the pointer-only admission/sleep owner.

## Success criteria

- Reconciliation facts expose an opaque durable system-progress witness and the
  runtime's distinct default-processing wake without exposing domain payloads.
- Temporal admits at most one background retry per bounded window for unchanged
  work, resets immediately on durable progress or a newer frontier, and lets
  foreground/default and retention deadlines bypass the background gate.
- Existing histories replay and the gate survives continue-as-new without using
  attempt ids, workspace versions, or raw wake timestamps as progress.
- A cross-repository full-stack journey keeps a recurring reminder deliverable
  while a device-sync backlog exceeds one runtime pass, proves bounded starts,
  then proves backlog drain and next recurrence projection.
- Focused tests, typechecks, required repository verification, exact-head CI,
  and required ReviewGPT gates pass for both repositories.

## Scope

- In scope:
  - Public runtime progress/wake facts, parser/wire compatibility, Web projection,
    focused runtime and API tests, owner documentation, and changelog.
  - Private Temporal admission state, replay-compatible migration, workflow
    tests, and continue-as-new/replay proof.
  - Cross-repository E2E coverage and exact public/private SHA pinning.
- Out of scope:
  - A new queue, scheduler, rate-limit service, per-member database table, or
    runtime capability toggle.
  - Dropping background work, weakening reminders, or changing member-facing
    automation semantics.
  - Production deployment before both repositories' compatible heads are ready.

## Constraints

- Technical constraints:
  - The progress witness changes only after durable system work advances; an
    unchanged retry must not manufacture progress.
  - The gate is bounded, deterministic workflow state. Foreground/default and
    retention work bypass it without clearing it.
  - Public contract additions remain optional during the compatibility window.
- Product/process constraints:
  - Patch-level Product UX: affected people are members awaiting a scheduled
    automation during device backlog, members sending current inbound messages,
    members with retention-only work, and operators containing runaway cost.
  - Direct proof must assert delivered output, unfinished backlog, and bounded
    accepted starts—not merely an active schedule or a selected wake.
  - Keep both PRs draft until focused proof and candidate review complete.

## Risks and mitigations

1. Risk: Gate suppresses useful work because churn is mistaken for progress.
   Mitigation: Reset only from the runtime-authored durable progress witness or
   a strictly newer canonical frontier; exclude workspace/attempt/fence churn.
2. Risk: Background suppression starves a reminder or current inbound reply.
   Mitigation: Carry the distinct default wake and explicitly bypass the gate
   for due default/foreground and retention owners while preserving gate state.
3. Risk: Temporal code becomes non-deterministic for open histories.
   Mitigation: Use one patch marker, carry state through continue-as-new, and run
   fixture replay plus a real Temporal restart/continue-as-new scenario.
4. Risk: Cross-repository rollout observes half a contract.
   Mitigation: Add optional public read/storage first, pin exact SHAs in the
   integration lane, and document the one-way deploy order.

## Tasks

1. [x] Prove the smallest existing runtime signals that can own durable progress and
   the distinct default wake; reject duplicate state.
2. [x] Add the optional public reconciliation contract and Web projection with
   focused parser/projection/runtime tests.
3. [x] Replace narrow retry suppression in the private workflow with one generic,
   progress-sensitive admission gate and replay-safe carry-forward state.
4. [x] Add focused workflow, continue-as-new, and history replay tests for reset,
   preservation, bypass, and capped retry behavior.
5. [x] Add the full-stack reminder-plus-device-backlog scenario to the canonical
   cross-repository CI lane and pin exact candidate SHAs.
6. [ ] Run focused verification, typechecks, full required checks, changelog/docs,
   candidate review, scoped commits, draft PRs, ReviewGPT, and CI.

## Decisions

- Treat this as a higher-risk cross-repository reliability patch, not a new
  product scheduler.
- Reuse the runtime's existing independent assistant-wake calculation as the
  default-processing witness instead of adding another scheduler.
- Persist one monotonic opaque generation because no existing durable fact can
  distinguish progress inside one long-lived system mailbox item.

## Verification

- Commands to run:
  - Focused public Vitest suites for runtime scheduling, reconciliation parsers,
    Web projection, and hosted local E2E.
  - Public affected package typechecks plus the verification selected by
    `agent-docs/operations/verification-and-runtime.md`.
  - Private workflow/parser tests, replay fixtures, real Temporal integration,
    `pnpm typecheck`, and `pnpm verify`.
  - Exact-head GitHub CI and both required ReviewGPT stages concurrently.
- Expected outcomes:
  - One timely reminder delivery while background backlog remains unfinished.
  - No more than the test's bounded background start count for an unchanged
    fingerprint window.
  - Progress and newer-frontier cases immediately regain admission; the next
    recurrence stays projected after the backlog drains.
Completed: 2026-08-30
