# Restore the local outbox checkpoint wake

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Ensure a long-running local assistant autonomously reconciles a delivered
  outbox checkpoint at its existing stale boundary, without replaying the
  provider effect or waiting for unrelated activity.

## Success criteria

- Dispatch eligibility and local wake projection derive the same ten-minute
  sending-recovery boundary from existing intent state.
- A missing or malformed sending timestamp remains immediately dispatchable
  and produces an immediate wake.
- Existing recovery terminalizes the intent, receipt, diagnostics, and pending
  recurring automation without another provider call.
- Focused policy, summary, production-path recovery, typecheck, exact-head CI,
  and ReviewGPT verification pass.

## Scope

- In scope: the assistant outbox retry-policy helper, local outbox summary, and
  focused recovery/lifecycle tests.
- Out of scope: durable schema changes, another retry state, hosted scheduling,
  new queues, timers, services, or lifecycle owners.

## Constraints

- Technical constraints: keep the no-replay checkpoint in `sending`; reuse
  `lastAttemptAt` and the existing stale threshold; do not persist a redundant
  `nextAttemptAt`.
- Product/process constraints: prefer one pure derivation shared by dispatch
  and wake projection, with no broader architecture expansion.

## Risks and mitigations

1. Risk: scheduling recovery before the existing stale boundary could replay a
   provider effect.
   Mitigation: derive the exact same boundary used by dispatch eligibility.
2. Risk: an invalid timestamp could leave durable work asleep again.
   Mitigation: preserve the current immediate-dispatch behavior and project an
   immediate wake from the same helper.

## Tasks

1. Add one pure retry-policy derivation for a sending intent's recovery time.
2. Reuse it in dispatch eligibility and outbox-summary wake projection.
3. Extend focused policy, mixed-summary, and persisted-checkpoint recovery
   coverage.
4. Run focused tests and typecheck, inspect and commit the scoped diff, push,
   and repeat exact-head ReviewGPT and CI.

## Decisions

- ReviewGPT round 14 found the gap introduced by the accepted round-7 no-replay
  correction. The finding is accepted because the local continuous loop has no
  independent deadline after a fresh checkpoint becomes the only pending work.
- Keep the checkpoint state unchanged. Project its existing dispatch boundary
  through the existing summary and wake controller rather than adding durable
  scheduling state.
- The retry-policy owner now exposes one pure recovery timestamp derived from
  `lastAttemptAt` and the existing stale threshold. Dispatch eligibility and
  summary wake projection both consume that result; missing or malformed input
  maps to the caller's current time, preserving immediate recovery.

## Verification

- Commands to run: focused retry-policy, outbox runtime, and automation runtime
  Vitest files; assistant-engine typecheck; exact-head required CI.
- Expected outcomes: the local pass exposes the exact stale boundary, the loop
  wakes there without unrelated input, recovery does not call the provider
  again, and the recurring automation advances normally.
- Results: 114 retry-policy/outbox-runtime tests pass, including the persisted
  checkpoint, actual local pass wake, no-provider-replay, receipt/diagnostic,
  and recurring-cron reconciliation path; 182 automation-runtime tests pass,
  including an inbox-independent continuous-loop timer wake. Assistant-engine
  typecheck and build pass, and diff validation is clean.
Completed: 2026-08-15
