# Hosted Delivery Dispatch Names

## Goal

Rename hosted assistant delivery dispatch code and trace events so the names match the current model: selected current-turn outbox intents dispatch in the foreground, while leftover prepared effects remain retryable background work.

Success criteria:

- Replace checkpoint-oriented helper and constant names with dispatch-oriented names.
- Replace delivery-effect phase metadata with `foreground_current_turn` and `background_retry`.
- Split misleading queued-retry auto-reply trace wording into intent-created, foreground-started, and sent events where the existing result paths can prove those states.
- Preserve hosted delivery behavior and retry/idempotency semantics.

## Scope

- Hosted assistant runtime delivery preparation/drain helpers and direct callers.
- Assistant automation event types/messages for reply intent creation and delivery outcomes.
- Focused tests for hosted delivery preparation/drain and auto-reply event text.

## Constraints

- Preserve unrelated dirty worktree edits.
- Do not expose secrets, contact identifiers, raw message contents, local usernames, or home paths in code, docs, tests, logs, or commits.
- Avoid new persisted state; this is naming and trace semantics, not a delivery model rewrite.
- Keep legacy checkpoint reasons unless changing them is necessary for the helper rename.

## Verification

- Focused assistant-runtime and assistant-engine tests covering changed helpers/events.
- `pnpm typecheck` plus truthful diff or package coverage lane.
- Security/privacy and completion review because this touches outbound delivery trace semantics and hosted retry behavior.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
