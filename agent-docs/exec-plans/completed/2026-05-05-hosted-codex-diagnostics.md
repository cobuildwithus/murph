# Hosted Codex Diagnostics

## Goal

Make hosted assistant Codex failures diagnosable when the provider error reaches auto-reply without structured Codex context or with an unsafe raw error message that redaction drops.

## Scope

- Hosted assistant automation failure logging.
- Auto-reply failure observability for `ASSISTANT_CODEX_FAILED`.
- Focused local tests that reproduce opaque production log shape without account data.

## Constraints

- Do not expose raw user ids, message bodies, secrets, full local paths, or direct personal identifiers.
- Preserve existing redaction behavior for unsafe diagnostic text.
- Avoid touching unrelated dirty worktree files.

## Verification

- Targeted assistant-engine and assistant-runtime tests.
- Package typecheck where feasible.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
