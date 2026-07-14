# Hosted reminder route repair

## Goal

Restore hosted reminders after a Linq home-route change by removing the pending-input self-deferral loop and upgrading only legacy personal-home automation routes to the existing current-home route primitive.

## Evidence

- Production runtime state repeatedly returned an overdue assistant wake while mailbox imports found no new conversation input.
- The vault retained replyable pending input, so the July 7 pre-automation gate skipped the only lane that can consume that index and scheduled the same immediate wake again.
- Vercel recorded non-retryable Linq route-authority mismatches after the home route changed.
- The vault backup contains many active legacy bare Linq routes on one former target, while newly created automations use the current-route marker.
- An isolated backup copy proves the migration changes all 19 active/paused legacy bare routes into current-route bindings, preserves all 64 records, and leaves no active/paused bare route behind.

## Constraints

- Preserve foreground-message preemption: an actively arriving conversation input must still yield background work.
- Do not broaden Linq egress authority or infer that arbitrary legacy/group routes are personal.
- Reuse the existing current-home route fallback; add no scheduler, queue, service, or new persisted state.
- Preserve unrelated work and the mailbox consumed-at lane that overlaps hosted runtime files.

## Implementation

1. Let the automation lane consume already-persisted pending input; only the live foreground-yield predicate may skip the lane.
2. During built-in managed-automation reconciliation, use an existing personal managed automation on a legacy bare Linq target as the proof that target was a personal home route.
3. Mark active/paused automations sharing that exact target as direct current-route bindings. The existing web authority check then resolves the current home route only when the stored target is stale.
4. Prove pending-input progress, route migration scope, group-route preservation, and idempotence.

## Verification

- Focused assistant-runtime and assistant-engine tests pass.
- `pnpm test:diff` passed both guard cycles, every affected typecheck, assistant CLI, assistant-engine, assistant-runtime, and assistantd tests. Its later CLI source-test step self-deadlocked when a nested prepared-runtime build waited on the outer verifier's artifact lock.
- The documented fallback passed full coverage for both changed owners: assistant-engine 2,011 tests and assistant-runtime 1,494 tests.
- Required security/privacy review passed with no medium-or-higher findings.
- Required coverage-write audit added ambiguous-target and archived-anchor integration proof; the focused file passes 15 tests.
- Direct vault-backup repair preview with counts only passed; no identifiers or private contents were emitted.

## Completion

- Finish through `scripts/finish-task` with the plan and ledger row removed/archived.
- Report the safe deploy order and post-deploy runtime/egress checks.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
