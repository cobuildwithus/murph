# PR 679 selected-input wake ownership and main reconciliation

## Goal

Source foreground wake provenance from the selected conversation input before
global automation scheduling is aggregated, then reconcile the PR with current
`main` without losing either side's reviewed runtime behavior.

## Evidence

- ReviewGPT round 5 traced `assistantMetrics.nextWakeAt` to the automation pass's
  earliest reply, routing, cron, and outbox wake rather than a selected-input
  wake.
- A terminal no-reply foreground turn can therefore label an unrelated future
  canonical reminder as invocation-local, skip the bounded incomplete-index
  probe, and strand an older accepted input.
- Static merge proof against current `main` reports four content conflicts:
  runner bundle ratchets and tests, the outer hosted runtime, and the assistant
  phase test suite.

## Decisions

1. Keep the single ephemeral provenance field and source it from the existing
   selected-input reply/retry result before aggregate schedule selection.
2. Preserve the explicit inbox-bootstrap retry as selected-input-owned.
3. Do not promote canonical cron, inherited workspace, routing, outbox, or
   cleanup wakes into foreground ownership.
4. Add no durable state, scheduler, queue, lifecycle, compatibility layer, or
   second reconciliation path.
5. Resolve `main` with an ordinary merge, preserving both branches' behavior
   and rerunning exact affected verification.

## Plan

1. Add a failing automation-lane/phase proof for aggregate reminder exclusion
   and an opposing genuine selected-input retry.
2. Expose the narrow selected-input wake through existing in-memory metrics and
   consume only that value in the foreground phase.
3. Merge current `main`, resolve the four conflicts deliberately, and measure
   the combined runner bundle rather than guessing ratchets.
4. Run focused tests, affected typechecks, bundle assembly, truthful
   `test:diff`, required coverage audit, scoped commit, push, exact-head CI, and
   the user-authorized continuation ReviewGPT round.

## Constraints

- Preserve accepted-input terminalization, bounded pending-index repair,
  boundary-tail retries, reminder scheduling, and checkpoint ordering.
- Preserve unrelated working-tree and coordination-ledger edits.
- Historical completed plan snapshots remain immutable.

## State

Status: completed
user-authorized ReviewGPT continuation remain after push.

- Current `main` merged with all four conflicts resolved by composing both
  branches' behavior.
- The pre-fix regression failed at the maintenance and assistant-phase
  boundaries; the selected-input provenance correction made all four focused
  cases pass.
- Assistant-runtime typecheck and all 74 test files passed (1,682 tests, 2
  skipped). Cloudflare typecheck and all 105 test files passed (1,819 tests).
- Exact bundle assembly passed at 1,498,679B entry, 7,189,331B static boot
  closure, and 8,877,691B total without widening the merged ratchet.
- The exact affected-owner `test:diff` lane passed dependency, boundary,
  architecture, logging, typecheck, assistant-runtime, and Cloudflare gates.
- Required coverage-write added one opposing positive phase-handoff assertion;
  no production or unrelated files changed and no actionable proof gap remains.

Updated: 2026-07-15
Completed: 2026-07-15
