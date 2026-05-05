# Codex Resume Developer Instructions

## Goal

Send updated Murph developer instructions on Codex `thread/resume` only when the existing thread-instruction fingerprint says instructions are missing or changed, while keeping ordinary resume params thin.

## Scope

- Update Codex app-server resume request construction in `packages/assistant-engine`.
- Add focused tests for thin ordinary resume and instruction-refresh resume.

## Constraints

- Do not send model, model provider, cwd, sandbox, approval policy, or base instructions on resume.
- Preserve resumed Codex session context; do not force fresh threads for instruction drift.
- Preserve unrelated working-tree edits.

## Verification

- Focused assistant-engine tests for Codex app-server runtime/request params.
- Assistant-engine typecheck.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
