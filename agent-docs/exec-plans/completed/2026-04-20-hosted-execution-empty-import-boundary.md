## Title

Remove the empty `@murphai/device-syncd/hosted-runtime` import from hosted execution parsers and harden workspace-boundary checks against empty workspace imports.

## Goal

Delete the no-op cross-package import edge from `packages/hosted-execution/src/parsers.ts`, then add a narrow workspace-boundary rule plus focused repo-tools proof so empty imports from workspace packages fail mechanically in the future.

## Scope

- `packages/hosted-execution/src/parsers.ts`
- `scripts/workspace-boundaries/import-policy-rules.mjs`
- `scripts/verify-workspace-boundaries.mjs` only if export wiring needs a narrow adjustment
- `scripts/workspace-boundaries/import-policy-rules.test.ts`

## Constraints

- Keep the runtime change minimal: remove the empty import only; do not broaden hosted execution parser ownership.
- Implement the guard in the existing workspace-boundary import-policy seam instead of adding a second checker.
- Limit the new rule to empty imports from workspace package specifiers so ordinary side-effect imports from non-workspace packages are not affected.
- Preserve overlapping dirty-tree edits in the workspace-boundary split lane and work carefully on top of them.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/hosted-execution/src/parsers.ts scripts/workspace-boundaries/import-policy-rules.mjs scripts/workspace-boundaries/import-policy-rules.test.ts`
- `pnpm --dir packages/hosted-execution test:coverage` only if the diff-aware lane does not provide truthful coverage for the touched owner

## Notes

- This is a package-boundary hygiene follow-up, not a behavior change.
