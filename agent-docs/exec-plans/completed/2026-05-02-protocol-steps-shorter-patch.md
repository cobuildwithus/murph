# Protocol Steps Shorter Patch

## Goal

Land the supplied protocol-step copy patch by shortening Health Commons protocol `steps:` lists while preserving existing dirty work in the same content area.

## Scope

- `packages/health-commons/content/protocols/**`
- Content-only step-copy edits from the supplied patch.

## Constraints

- Preserve unrelated working-tree edits.
- Do not regenerate Health Commons generated artifacts unless validation requires it.
- Do not widen into schema, app UI, or protocol metadata changes.

## Verification

- Focused Health Commons/content validation where available.
- `git diff --check` for touched content.

## Status

- Done: applied supplied patch intent on top of the dirty tree and updated coupled deterministic hash expectations.
- Verified: focused Health Commons generation, package tests, package typecheck, root typecheck, and diff whitespace checks passed.
- Blocked: safe scoped commit is blocked by overlapping pre-existing dirty Health Commons content/test edits in the same files.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
