# Exercise Library

## Goal

Add a read-only public exercise catalog package and CLI command family:

- `@murphai/exercise-library/runtime` owns generated movement catalog reads.
- `murph exercise list`, `murph exercise show`, and `murph exercise facets` expose compact catalog lookup.
- Workout templates may optionally reference a catalog item through `sourceExerciseId`.

## Constraints

- Keep the catalog separate from user-specific workout sessions and formats.
- Ship generated JSON metadata only, not image bytes.
- Use deterministic local search and lookup; no remote service, SQLite, or embeddings.
- Keep package exports narrow and avoid sibling package internals.
- Preserve PR-56 assistant media work in this worktree.

## Verification

- Run the exercise-library generator/check/verify path.
- Run package/CLI/operator-config focused tests and typecheck required by the repo verification docs, reporting any unrelated dirty-branch blocker.
- Run required completion audits for standard multi-package repo code changes.

## Status

In progress.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
