# Assistant UI Polish Merge

## Goal

Merge the provided assistant Ink UI polish patch into the current `packages/cli` assistant chat implementation without overwriting overlapping in-flight runtime and streaming work.

## Scope

- `packages/cli/src/assistant/ui/theme.ts`
- `packages/cli/src/assistant/ui/view-model.ts`
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/test/assistant-runtime.test.ts`
- coordination ledger updates for this lane

## Constraints

- Preserve adjacent assistant runtime, streaming, and status-copy work already present in the dirty tree.
- Keep the change presentation-focused; do not reshape session/runtime semantics.
- Run completion workflow audit prompts plus required repo verification commands.
- Commit only exact touched files for this task if verification is acceptable.

## Planned Steps

1. Compare the supplied patch against the current assistant UI files and identify drift.
2. Merge the polish changes manually where the patch no longer applies cleanly.
3. Update tests to match the merged UI behavior.
4. Run simplify, coverage-audit, and task-finish-review passes.
5. Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
6. Remove the coordination row and commit the touched files with `scripts/committer`.
Status: completed
Updated: 2026-03-19
Completed: 2026-03-19
