# Local Hosted Dev Refactor

## Goal

Split the repo-root hosted local-dev launcher into smaller modules and add focused tests for the extracted logic.

## Scope

- Refactor `scripts/dev-hosted-local.ts` into multiple local helper modules.
- Keep the existing `pnpm dev` behavior intact.
- Add tests around the extracted logic and launcher-specific parsing/config paths.

## Constraints

- Preserve unrelated dirty worktree edits.
- Keep the hosted local-dev contract stable while reducing file size and coupling.
- Prefer small focused modules over introducing new dependencies.

## Verification

- Run truthful diff-aware verification for touched owners.
- Add direct tests for the refactored launcher logic.

## Notes

- The current launcher works, but the file is too large and mixes config parsing, env normalization, process orchestration, and health checks in one script.
Status: completed
Updated: 2026-04-13

## Progress

- Split the launcher into focused modules under `scripts/dev-hosted-local/` while keeping `scripts/dev-hosted-local.ts` as the stable entrypoint.
- Added focused Vitest coverage for config parsing, env normalization/merging, and Vercel OIDC identity parsing under `scripts/dev-hosted-local/*.test.ts`.
- Added `pnpm test:repo-tools` plus `test:diff` fast-path wiring so script changes automatically run the repo-tools tests.

## Verification Run

- `pnpm test:repo-tools`
- `pnpm typecheck`
- `pnpm test:diff package.json scripts/dev-hosted-local.ts scripts/dev-hosted-local scripts/vitest.config.ts scripts/workspace-diff-scope.mjs scripts/workspace-verify.sh`
- `env NEXT_DIST_DIR_MODE=smoke MURPH_DEV_WEB_PORT=3017 MURPH_DEV_WORKER_PORT=8797 pnpm dev` (reached `Local hosted dev is ready.`; `Ctrl+C` still ends with pnpm's existing `ELIFECYCLE` noise)
Completed: 2026-04-13
