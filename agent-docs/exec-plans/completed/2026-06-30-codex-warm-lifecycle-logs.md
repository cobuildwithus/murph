# Codex warm lifecycle logs

## Goal

Add minimal, metadata-only diagnostics that show why the hosted runner loses a
warm Codex app-server between turns.

Success criteria:

- Log warm Codex stop and process-isolation lifecycle events without command lines,
  environment values, paths, prompts, mailbox payloads, or user identifiers.
- Log hosted process-isolation cleanup counts and whether the expected Codex
  root was present or killed.
- Keep the change diagnostic-only; do not add persisted state or alter runner
  lifecycle behavior.
- Run focused tests and typecheck for the touched surfaces.

## Constraints

- Preserve unrelated active work and working-tree edits.
- Keep diagnostics redacted and metadata-only.
- Prefer deletion/simplicity; do not add a result journal or new lifecycle owner
  in this task.

## Approach

1. Add small hosted runtime process-isolation cleanup logs.
2. Add small hosted warm-Codex stop logs at the existing stop call sites.
3. Cover the new log contracts with focused tests.
4. Run scoped verification.

## State

Active.

## Notes

- Current investigation found the hosted runner with no live Codex app-server
  after idle checkpoint, while upstream v2 subagent result delivery depends on
  the parent process-local mailbox until the parent drains it.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
