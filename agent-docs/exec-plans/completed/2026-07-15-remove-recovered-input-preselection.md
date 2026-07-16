# Remove Recovered Input Preselection

Status: completed
Updated: 2026-07-15

## Goal

Delete the redundant outer background-input selection in the hosted assistant
automation lane and keep the inner selection immediately before automation as
the single owner of foreground and background input selection.

Success criteria:

- Remove `initialBackgroundSelection`, `hasRecoveredReplyableInput`, and
  `initialInputSelection` plumbing.
- Keep one authoritative selection before the automation pass.
- Preserve cron deferral for selected input and foreground-maintenance yield.
- Preserve pending-index compaction, causal input ordering, and scan sizing.
- Preserve explicit skip and unconfigured-assistant behavior.

## Constraints

- Do not change input eligibility, grouping, ordering, or pending-index rules.
- Do not move selection into the automation engine or add replacement state.
- Keep the change isolated from the broader active mailbox-consumption lane.
- Remove the selection result type's public export only if no consumer remains.

## Approach

1. Delete the lane-level background preselection and option forwarding.
2. Make the existing inner foreground/background selection unconditional.
3. Make the selection result type private if repository-wide search confirms it
   has no external consumer.
4. Adjust focused maintenance tests to prove readiness, selection, automation,
   cron deferral, scan sizing, and skipped behavior remain correctly ordered.
5. Run focused assistant-runtime tests, stale-symbol searches, diff hygiene, and
   the truthful diff-aware verification lane.

## Deployment Compatibility

This is an internal assistant-runtime control-flow simplification. It changes no
persisted data, mailbox schema, provider contract, or cross-deploy interface.

## State

Implementation and focused verification are complete. The maintenance and
turn-input suites pass, stale-symbol and diff-hygiene checks pass, and the
cleanup reduces both the runner entry chunk and static boot closure by 486
bytes in a same-source local comparison. The diff-aware gate passed typechecks
and repository guards, then reported three unrelated full-suite timing failures;
all three targets passed immediately in a serial isolated rerun. Coverage audit,
commit, PR publication, CI, and ReviewGPT remain pending the parent flow.
Completed: 2026-07-15
