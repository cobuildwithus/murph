## Goal

Split `scripts/verify-workspace-boundaries.mjs` into a thin entrypoint plus dedicated scanner and rule modules so workspace-boundary policy changes no longer require editing scanner mechanics in the same file.

## Scope

- `scripts/verify-workspace-boundaries.mjs`
- `scripts/workspace-boundaries/{scanner,typecheck-rules,package-export-rules,public-surface-rules,import-policy-rules}.mjs`

## Constraints

- Preserve exact verification behavior and failure messages.
- Extract scanner helpers first before moving rule groups.
- Keep the refactor scoped to the workspace-boundary verifier.
- Preserve unrelated dirty-tree edits outside this tooling lane.

## Verification

- `pnpm typecheck`
- `node --check` on the touched `.mjs` files
- Direct verifier smoke run for `scripts/verify-workspace-boundaries.mjs`

## Outcome

- Extracted shared scanner/import helpers into `scripts/workspace-boundaries/scanner.mjs`.
- Moved typecheck, package-export, public-surface, and import-policy rule groups into dedicated modules.
- Kept `scripts/verify-workspace-boundaries.mjs` as the thin entrypoint and preserved its helper re-exports.

## Evidence

- `node --check scripts/verify-workspace-boundaries.mjs`
- `node --check scripts/workspace-boundaries/scanner.mjs`
- `node --check scripts/workspace-boundaries/typecheck-rules.mjs`
- `node --check scripts/workspace-boundaries/package-export-rules.mjs`
- `node --check scripts/workspace-boundaries/public-surface-rules.mjs`
- `node --check scripts/workspace-boundaries/import-policy-rules.mjs`
- `node scripts/verify-workspace-boundaries.mjs`
- `pnpm typecheck`
- Required `simplify` audit: no findings
- Required `task-finish-review` audit: no findings
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
