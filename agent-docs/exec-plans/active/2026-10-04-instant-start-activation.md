# Run instant-start activation after answered foreground passes

Status: active
Created: 2026-10-04
Updated: 2026-10-04

## Goal

- When a hosted runtime first imports a new member's conversation and their
  `member.activated` item together (Linq instant start), apply activation right
  after the foreground pass. Today it waits about ten minutes for the idle
  checkpoint.

## Evidence

- Web's instant first turn answers the member's first messages and mirrors that
  reply into the mailbox. The runtime then suppresses those inputs, so its clean
  foreground passes report `progressed: false`.
- `withPostForegroundMemberMaintenanceAfterCheckpoint` attached the preemptible
  activation/member-action callback only to progressed passes. No other path ran
  a due imported activation before the idle checkpoint.
- Privacy-safe production runtime logs since 2026-09-21 show the gap:
  - Every activation imported together with conversation (20 canary runs and 3
    real instant-start members) ran about 10 minutes after runtime start.
  - Activations imported alone ran in 3–7 seconds.
  - When the canary texted again right after that checkpoint, activation was
    preempted. Its handled frontier then slipped to a second idle window
    (about 21 minutes), which raised runtime-progress stall alerts.
- Instant-start enrollment suppresses the signup welcome, so activation sends no
  member message on this path.

## Success criteria

- A clean, non-progressing foreground pass attaches the existing post-foreground
  member-maintenance callback when a due pending `member.activated` or
  `member.action.requested` item exists, and activation runs right after the pass.
- A not-yet-due item, an absent item, or a failed foreground reply leaves the
  pass unchanged: no progress, no callback.
- The handled record still waits for the durable checkpoint.

## Scope

- In scope: the foreground branch of the hosted assistant phase, focused real-vault
  tests, and the instant-start owner doc.
- Out of scope: Web instant-first-turn behavior, alert grace (separate PR),
  idle-checkpoint cadence, warm-loop wake handling, and Temporal.

## Constraints

- Reuse the existing selection, preemption (`shouldYieldBackgroundMaintenance`)
  and `afterDurableCheckpoint` recording. Add no new persisted state, queue or wake.
- The peek is one local state-file read, made only after a clean
  non-progressing foreground pass.

## Risks and mitigations

1. Risk: marking a no-progress pass dirty without work.
   Mitigation: attach only when the canonical local queue has a due, pending,
   allowed item.
2. Risk: activation delaying later foreground work.
   Mitigation: the reused callback keeps the foreground import loop running and
   yields to new conversation input.

## Tasks

1. Gate attachment on a due post-foreground member item for clean
   non-progressing foreground passes.
2. Add due and not-due real-vault tests.
3. Update the instant-start owner doc.
4. Run focused/full package tests, typecheck/build, complexity, review, PR and
   ReviewGPT.

## Decisions

- Use `findNextHostedSystemMailboxQueueItem` with `pendingOnly` so recording,
  sending or future-retry items never re-trigger the callback.
- Mark the pass `progressed` with `system_mailbox_receipt`, the reason the
  callback's own result uses, only when attaching.

## Verification

- `pnpm --dir packages/assistant-runtime build` (typecheck) passes.
- 26 assistant-phase/entrypoint/runner files, 998 tests, pass.
- The new due case fails on the unfixed source and passes with the fix.
- `pnpm complexity:diff`: debt 279 → 279, max unchanged.
