# PR 213 Delete Dormant Reactions

## Goal

Address ReviewGPT Round 5 for PR 213 by deleting the dormant assistant reaction vertical slice while preserving `finish_without_reply` and message delivery behavior.

Success criteria:

- No reaction-specific assistant tool, provider action, adapter capability, hosted side effect, or outbox payload branch remains.
- Assistant message outbox intents stay on the existing v1 wire/persistence shape.
- Focused assistant engine, daemon, CLI, hosted side-effect, and workspace verification pass or have documented unrelated blockers.

## Constraints

- Prefer deletion and simple message/no-reply primitives over speculative reaction abstractions.
- Preserve rollback compatibility for existing message outbox records.
- Do not alter unrelated active-plan lanes.

## Plan

1. Remove reaction tool parsing/result plumbing and channel adapter support.
2. Collapse outbox schemas and dispatch back to message-only v1 intents.
3. Remove hosted/runtime reaction callback and side-effect branches plus tests.
4. Run focused typechecks/tests, workspace diff verification, commit, and push.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
