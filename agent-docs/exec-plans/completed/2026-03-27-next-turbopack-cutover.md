# Next Turbopack Cutover

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Remove repo-owned reliance on `--webpack` for the two Next apps.
- Upgrade both app packages from Next `16.1.6` to the latest available release, `16.2.1`.
- Preserve workspace source-package resolution under Turbopack so default `next dev` and `next build` succeed.

## Success criteria

- `apps/web` and `packages/web` start and build without `--webpack`.
- The shared source-resolution contract works under Turbopack for explicit `.js` workspace imports.
- Focused tests cover the new bundler/config contract instead of asserting webpack-only behavior.
- Runtime/docs no longer direct operators to use webpack-specific flags.

## Scope

- In scope:
  - Next package/version bumps for `apps/web` and `packages/web`
  - shared source-resolution config needed for Turbopack
  - web app scripts/config/tests/docs that still force or describe webpack mode
- Out of scope:
  - unrelated hosted-execution package-graph work already in the tree
  - non-web package bundler/runtime behavior outside what the two Next apps need
  - broad React/tooling upgrades beyond what the Next bump requires

## Constraints

- Preserve overlapping dirty edits, especially the current `apps/web/next.config.ts` hosted-execution source-entry change.
- Keep workspace-package imports flowing through declared package names and public entrypoints.
- Prefer deleting webpack-specific glue when Turbopack can express the same behavior directly.

## Tasks

1. Add Turbopack-compatible workspace source-resolution helpers for explicit source-file extensions.
2. Remove forced `--webpack` usage from app scripts and the local `next-local` wrapper.
3. Upgrade `next` to `16.2.1` where used and refresh affected lockfile entries.
4. Update focused tests/docs for the new default-bundler path.
5. Run targeted web validation, then required repo checks and completion-workflow audits.

## Outcome

- Upgraded `apps/web` and `packages/web` from Next `16.1.6` to `16.2.1`.
- Removed repo-owned `--webpack` usage from app scripts and the local `next-local` wrapper.
- Added shared Turbopack source-resolution support for workspace packages, including a repo-owned loader that rewrites relative `.js` / `.mjs` / `.cjs` specifiers to on-disk TS-family sources during Turbopack builds.
- Added the missing `@murph/hosted-execution` source mapping for the local web package and updated focused tests/docs to describe the default Turbopack path.

## Verification

- `pnpm --dir packages/web test` passed, including the focused web Vitest suite and the package-local Next.js production build on Turbopack.
- `pnpm --dir apps/web exec next build` passed on Turbopack. The build still emits pre-existing NFT tracing warnings through `apps/web/next.config.ts`, but the production build completed successfully.
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts apps/web/test/next-config.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm --dir ../.. exec vitest run --config packages/web/vitest.config.ts packages/web/test/turbopack-rewrite-relative-js-imports-loader.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm typecheck` still fails outside this lane in `packages/cli/src/index.ts` because `AssistantStateDocumentListEntry` is exported twice.
- `pnpm test` and `pnpm test:coverage` still fail outside this lane on the tracked `apps/web/postcss.config.mjs` artifact hygiene guard.

## Completion workflow

- Simplify pass: removed the dead CLI-args helper from `packages/web/scripts/next-local.ts`, collapsed the shared Turbopack source-resolution helper to the minimum needed API, and cleaned stale webpack-default wording in active docs.
- Test-coverage audit: added direct regression coverage for the custom Turbopack loader and tightened the package-web config test to assert the intended rule globs.
- Task-finish review: no actionable findings in this lane. Residual risk is limited to the standing `apps/web` NFT tracing warnings and the lack of an automated live `next dev` end-to-end proof.
Completed: 2026-03-28
