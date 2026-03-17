# Inbox Capture Replay Idempotency

## Goal

Fix inbox capture replay/rebuild semantics so a partial raw/event/audit failure cannot leave a capture permanently deduped while canonical ledger or audit evidence is missing.

## Scope

- Repair `packages/inboxd` capture replay and runtime rebuild behavior around raw inbox envelopes.
- Ensure dedupe only trusts captures with matching canonical event and audit evidence, or repairs missing rows before accepting them.
- Add failure-injection coverage for raw-only and raw-plus-event partial writes across retry and restart/rebuild flows.

## Constraints

- Preserve existing deterministic capture ids, stored envelope shape, and duplicate-envelope canonical selection.
- Keep the fix local to inboxd unless a minimal core write helper is required.
- Do not revert unrelated in-progress work elsewhere in the tree.
- Run completion-workflow audits and the required repo checks before handoff.

## Verification Plan

- Run focused `packages/inboxd` Vitest coverage while iterating.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Run the `simplify`, `test-coverage-audit`, and `task-finish-review` completion passes after implementation.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
