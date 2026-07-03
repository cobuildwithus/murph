# Service due checkpoint-gated wakes in-attempt; restore the idle linger

Status: completed
Updated: 2026-07-03

## Problem

Incident (member `<affected_member_id>`, 2026-07-03): a message sent 4s after a
reply waited 219s for a fresh attempt. Root cause chain, proven from the
Temporal history, prod traces, and Vercel logs:

1. The runtime's dirty linger (`idleCheckpointDelayMs`, 180s) is designed to
   keep an attempt alive after a turn so follow-up messages are served warm via
   the in-process wake. It worked mid-conversation for this member.
2. Commit `2531141e79` (2026-06-26) clamps the idle-shutdown checkpoint to the
   projected wake time when a due checkpoint-gated wake exists. Because the
   idle-shutdown checkpoint is the invocation's terminal act, the clamp
   collapsed the linger to zero: checkpoint 0.13s after the turn, attempt exit
   seconds later.
3. The clamp's promptness premise — return early with a due `nextWakeAt` so the
   orchestrator services it — has no transport: the DO alarm coordinator only
   schedules snapshot-orphan cleanup (`readRunnerNextAlarmAt` returns null),
   and the Temporal workflow reads facts only when it wakes. In the incident
   the workflow slept on the 215s owner recheck, so both the due wake AND the
   user's next message waited the full backstop.
4. PR #335 (2026-06-29) already had to patch this hole for one flavor: a
   post-checkpoint in-attempt servicing hatch gated to
   `pendingDurableCheckpointEffects.length === 0 && projectedWakeCheckpointGateFresh
   && reason === "assistant"`.
5. For this member the clamp trigger was permanently on (starved system-lane
   welcome items — being fixed separately in the `signup-welcome-supersede`
   lane), so every turn ended in instant teardown.

## Change (net deletion)

One rule replaces both patches: an invocation does not return while it knows
of due work it could do.

1. `packages/assistant-runtime/src/hosted-runtime.ts`: replace the PR-335
   fresh-assistant-gate condition on `checkpointBlockedProjectedWakeKey` with
   `blocked && reason === "assistant" && (gateFresh || !requiresCheckpoint)`.
   This adds exactly the incident flavor — a plain projected due wake blocked
   only by uncommitted durable effects (`requiresCheckpoint` false) — to the
   post-checkpoint in-attempt servicing branch, while keeping both
   load-bearing guards discovered from the pinned test suite:
   - `reason === "assistant"`: non-assistant wakes (`device-sync.reconcile`)
     are not serviceable by a foreground pass (device-sync checkpoint-gate
     tests).
   - stale carried post-checkpoint wakes (`requiresCheckpoint` true but not
     gate-fresh, e.g. an outbox retry wake preserved across a later foreground
     pass) keep returning to the orchestrator (retryable-outbox gate test).
   The existing post-checkpoint branch services the wake only after the
   checkpoint and its durable effects have run (ordering unchanged), and the
   existing `markIdleCheckpointTimerAfterDirtyWork()` in
   `runIdleWakeForegroundPass` re-arms the 180s linger when the serviced pass
   dirties state.
2. The June 26 clamp itself stays: checkpointing promptly when gated work is
   due is correct; exiting promptly with the work still due was the bug.

## Consequences

- Returned `nextWakeAt` is future-or-absent in the serviced cases, so the
  orchestrator's 215s owner recheck becomes an honest crash backstop instead
  of a user-visible latency cliff.
- A message arriving seconds after a reply is served warm by the restored
  linger (the incident class disappears even before the mailbox-wake collapse
  plan lands; that plan — `2026-07-03-mailbox-wake-collapse.md` — remains the
  owner of wake-trust semantics and is untouched).
- Coordinates with the `signup-welcome-supersede` lane (disjoint files): their
  fix removes the perpetual clamp trigger for new signups; this fix makes any
  remaining due gated wake serviced in-attempt instead of via the backstop.

## Invariants

- Checkpoint-gated wakes are never serviced before their gating checkpoint and
  durable effects complete (docs/contracts/00-invariants.md §44; preserved by
  servicing only in the post-checkpoint branch).
- Idle-only work stays preemptible by fresh input (§114-115; unchanged
  machinery — external wakes still interrupt the dirty window and checkpoint).
- Budget-exhausted invocations still checkpoint and hand off immediately.
- No new timers, fields, state, or wake machinery.

## Verification

- All pre-existing pins stay green unchanged: `checkpoint-gates projected
  wakes while durable effects remain pending after an external wake` (stale
  minted wake returns), `services a checkpoint-blocked projected assistant
  wake after idle checkpointing` (PR-335 flavor), the device-sync
  checkpoint-gate pair (non-assistant wakes return), and `late foreground
  input does not clear gate for selected retryable outbox wake` (stale outbox
  retry returns).
- New incident-shaped test `services a due wake blocked only by durable
  effects instead of exiting the attempt`: plain due assistant wake + pending
  durable effects → clamped idle checkpoint → effects commit → wake serviced
  in-attempt → second checkpoint → non-due return.
- Full `hosted-runtime-workspace-entrypoint.test.ts` suite (130 tests) +
  `pnpm test:diff` over the touched owner + typecheck.
Completed: 2026-07-03
