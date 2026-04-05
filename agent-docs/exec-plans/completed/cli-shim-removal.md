# CLI Shim Removal

## Goal

Remove the current one-line `packages/cli/src/**` re-export shim files and retarget callers to the owning packages directly so package boundaries are explicit and consistent.

## Success Criteria

- No one-line shim files remain under `packages/cli/src` for assistant, setup, or usecase surfaces.
- Internal repo imports point at the owning packages (`@murphai/assistant-cli`, `@murphai/setup-cli`, `@murphai/assistant-core`) instead of `packages/cli` source-path wrappers.
- `@murphai/murph` package metadata and root exports reflect the intended public API after shim removal.
- Tests and verification pass, or any unrelated blocker is documented concretely.

## Constraints

- Preserve the just-landed CLI split/OpenClaw baseline rather than reopening ownership decisions that are already settled.
- Avoid sibling relative cross-package imports; use package-name entrypoints only.
- Remove compatibility surfaces only when callers are updated in the same change.

## Planned Steps

1. Inventory every shim file and every caller that still depends on it.
2. Decide which `@murphai/murph` public exports remain intentionally supported versus removed.
3. Rewrite imports/exports/tests to owner packages and delete the shim files.
4. Run verification, final review, and commit the scoped cleanup.

## Outcome

- Removed all 54 one-line assistant/setup/usecase shim files from `packages/cli/src`.
- Retargeted repo callers and tests to the owning packages: `@murphai/assistant-cli`, `@murphai/setup-cli`, and `@murphai/assistant-core`.
- Hard-cut the old `@murphai/murph` assistant subpath exports in `packages/cli/package.json` and aligned `tsconfig.base.json`, docs, and package-shape checks with the new boundaries.
- Tightened `scripts/build-test-runtime-prepared.mjs` after audit feedback so the prepared-runtime lane now requires concrete owner-package subpaths for the new direct imports instead of relying on a possibly-empty generic scan.

## Verification

- `pnpm typecheck`
- `pnpm build:test-runtime:prepared`
- `pnpm docs:drift`
- `pnpm --dir packages/cli test`
- `pnpm test` ran package/app suites successfully, then hit the unchanged late `apps/cloudflare` Node Vitest teardown hang.
- `pnpm test:coverage` followed the same unchanged late `apps/cloudflare` Node Vitest teardown hang after the suites completed.

## Audit

- `simplify` audit: no findings.
- `task-finish-review` audit: one medium finding in `scripts/build-test-runtime-prepared.mjs`; fixed by adding required owner-package subpath assertions and rerunning `pnpm build:test-runtime:prepared`.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
