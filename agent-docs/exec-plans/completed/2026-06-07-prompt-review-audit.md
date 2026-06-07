# Prompt Review Audit

## Goal

Add a completion-workflow audit pass for changes where prompt edits are the primary scope.

## Scope

- Add a reusable `prompt-review` audit prompt.
- Route prompt-primary changes to `prompt-review` without the normal completion audit stack.
- Keep mixed prompt/runtime or sensitive-surface changes on the normal workflow.

## Constraints

- The prompt-review worker must read the OpenAI prompt guidance every time.
- Keep the workflow rule simple and avoid adding speculative mechanics.
- Preserve unrelated active ledger/worktree edits.

## Verification

- Read back changed docs.
- Run `pnpm typecheck` and direct checks required for low-risk repo-internal workflow docs.

## Status

Implementation complete; verification and closeout in progress.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
