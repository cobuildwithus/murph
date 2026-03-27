# Workspace Import Hardening

Status: completed
Created: 2026-03-25
Updated: 2026-03-25

## Goal

- Remove brittle cross-package typecheck wiring that depends on sibling `dist/` artifacts.
- Keep repo-local Next/Vitest source-resolution logic centralized in `config/workspace-source-resolution.ts`.
- Add a lightweight boundary audit so the workspace import contract is enforced instead of implied.

## Success criteria

- Package-local typecheck configs no longer redirect sibling workspace imports to `dist/*.d.ts`.
- Package-local `typecheck` scripts stop prebuilding sibling workspace packages first.
- `packages/inboxd` and `packages/parsers` reuse the shared workspace source-resolution helper instead of local alias duplication.
- Repo verification runs a guard that blocks sibling-`dist` tsconfig aliases, relative cross-package imports, undeclared `@murph/*` subpath imports, and sibling-prebuild typecheck scripts.

## Scope

- In scope:
  - shared workspace source-resolution helper reuse in Vitest config
  - package-local typecheck/build config cleanup for source-based workspace resolution
  - one repo-level workspace-boundary verification script plus root script wiring
  - doc and agent-rule updates for the internal package import contract
- Out of scope:
  - publish-time `dist/` entrypoints for external consumers
  - broad package export redesign
  - new monorepo orchestration or task-runner infrastructure

## Constraints

- Preserve current unrelated worktree edits.
- Keep built-artifact checks that intentionally exercise published/runtime surfaces.
- Do not add new raw CSS or unrelated app/runtime behavior changes.

## Tasks

1. Merge the provided hardening patch intent onto the current repo state.
2. Remove sibling-`dist` redirects from the targeted package configs and scripts.
3. Add the workspace-boundary verifier and wire it into root verification.
4. Update docs/rules and run the required checks that are available here.

## Outcome

- Reused the existing `config/workspace-source-resolution.ts` helper in `packages/inboxd/vitest.config.ts` and `packages/parsers/vitest.config.ts` so workspace source aliasing stays centralized.
- Removed sibling-`dist` path redirects and sibling-prebuild typecheck scripts from the targeted package configs (`cli`, `device-syncd`, `importers`, `inboxd`, `parsers`, `query`) and from `packages/cli/tsconfig.json`.
- Added `scripts/verify-workspace-boundaries.mjs` and wired it into root `pnpm typecheck` and `pnpm test`.
- Replaced the brittle relative cross-package import in `packages/importers/test/importers.test.ts` with `@murph/core`.
- Updated repo guidance and verification docs to describe public-entrypoint-only workspace imports and the shared source-resolution helper.
- Kept `device-syncd`, `inboxd`, and `parsers` package-local typecheck include scope limited to `src/**/*.ts` in the live repo, because widening them to tests surfaced unrelated existing test-type failures and was not required for the workspace-boundary goal.
