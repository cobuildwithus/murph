# PR 213 ReviewGPT Round 6 Fixes

## Goal

Resolve accepted ReviewGPT round-6 findings for PR 213 with the smallest durable fixes.

Success criteria:

- Suppressed no-reply assistant text cannot remain in resumable native Codex history.
- An older no-reply patch cannot suppress a later steered message that has no final answer.
- Remaining one-variant reaction-era scaffolding is either removed where clearly low-risk or explicitly rejected with code evidence.
- Focused tests and scoped verification pass, then the PR branch is pushed and ReviewGPT is rerun.

## Constraints

- Preserve `finish_without_reply` and message-only v1 outbox behavior.
- Prefer deletion and direct primitives over new compatibility layers.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Plan

1. Verify each Round 6 finding against current code.
2. Patch accepted no-reply/history correctness issues first.
3. Remove any low-risk one-variant scaffolding that remains after reaction deletion.
4. Run focused tests, scoped verification, commit, push, and rerun ReviewGPT.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
