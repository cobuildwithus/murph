# Repo Green Plan

Last updated: 2026-04-04

## Goal

Return the repository to a green verification state by fixing the current blocking `typecheck` / test failures with the smallest defensible code changes.

## Scope

- Run the required repo verification lanes to identify current failures.
- Fix only failures that are actually blocking green status.
- Preserve unrelated in-flight work and avoid opportunistic refactors unless they materially simplify a failing seam.

## Constraints

- Follow the dirty-tree preservation rules in `AGENTS.md`.
- Do not overwrite active work from other ledger rows.
- Keep fixes narrow and verification-driven.

## Verification target

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Notes

- Initial failures were stale CLI slice tests rather than product/runtime regressions.
- The custom slice harnesses needed the current `incurErrorBridge` middleware so `VaultCliError` codes surface correctly in test-only CLIs.
- Audit slice assertions were narrowed to deterministic date windows because repo init now contributes audit state, and one manifest expectation was updated to match the current workspace package graph.
- Final green verification commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
