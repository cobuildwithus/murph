# Frontmatter Unifier

## Goal

Replace the three divergent frontmatter parsers with one shared parsing engine while preserving each caller's current public behavior for malformed input and body whitespace.

## Scope

- Add a shared parser engine in `packages/contracts`.
- Convert `packages/query/src/markdown.ts` to a tolerant wrapper.
- Convert `packages/query/src/health/shared.ts` to a strict wrapper with current trimmed-body semantics.
- Convert `packages/core/src/frontmatter.ts` to a strict wrapper with current `VaultError` and body-preserving semantics.
- Add regression tests for malformed frontmatter handling and body normalization.

## Constraints

- Do not change package layering by making `query` depend on `core`.
- Preserve current external behavior for each existing call site.
- Avoid touching files owned by other active ledger entries.

## Plan

1. Implement a shared engine with explicit parse mode and body-normalization options.
2. Swap each package parser to a thin wrapper around the engine.
3. Add focused tests for malformed frontmatter and body whitespace behavior.
4. Run simplify, coverage audit, final review, then required verification commands.

## Exit Criteria

- One shared parsing implementation remains.
- Existing behavior differences are expressed as wrapper options rather than duplicated parser logic.
- Tests cover tolerant vs strict failure behavior and trimmed vs preserved body handling.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
