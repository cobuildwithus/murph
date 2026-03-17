# Inbox Raw Metadata Redaction

## Goal

Prevent secret-bearing inbox `raw` metadata from being persisted into canonical inbox envelopes, runtime SQLite, or default CLI capture detail output.

## Scope

- Add a shared inbox raw-metadata sanitizer that redacts common secret-bearing keys/values and path-like strings recursively.
- Replace connector raw passthrough with connector-specific allowlists for Telegram and iMessage capture metadata.
- Stop returning full `raw` payloads from `vault-cli inbox show` by default.
- Add regression tests for nested secret-bearing keys and persistence/runtime redaction.

## Constraints

- Preserve existing capture ids, attachment persistence, and inbox search/list behavior.
- Keep changes local to inboxd/CLI raw-metadata handling.
- Avoid reverting unrelated dirty worktree edits.

## Verification

- Targeted inboxd and CLI tests for raw metadata handling.
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Completion workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
