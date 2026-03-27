# Workspace source-truthful migration

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Remove the custom Turbopack rewrite-loader path from the local and hosted Next apps.
- Restore one minimal shared `config/workspace-source-resolution.ts` helper for source-aware Next/Vitest resolution.
- Make TypeScript own relative source-import extension rewriting so source-consumed workspace packages stop carrying misleading `./foo.js` specifiers.

## Success criteria

- `apps/web` and `packages/web` no longer depend on the custom Turbopack rewrite loader for workspace source resolution.
- `config/workspace-source-resolution.ts` is the shared repo-local helper for Next/Vitest workspace source mapping.
- `tsconfig.base.json` enables `rewriteRelativeImportExtensions`.
- The targeted workspace package set uses relative `./*.ts` imports instead of `./*.js` where the repo consumes source directly.
- Regression coverage shifts from the deleted loader-specific test to helper-focused coverage.
- `AGENTS.md` documents the guardrail so future changes do not reintroduce loader-based source rewriting in the hot dev path.

## Scope

- In scope:
  - `apps/web` and `packages/web` source-resolution config and tests
  - shared workspace source-resolution helper and base TS config
  - directly affected workspace packages/tests whose relative imports need `.ts` specifiers
  - repo guidance note in `AGENTS.md`
- Out of scope:
  - changing package public APIs or runtime behavior unrelated to source resolution
  - widening into unrelated active package refactors except where the live file state had to be preserved while merging this migration

## Constraints

- Preserve adjacent dirty edits in the current worktree; do not revert unrelated changes.
- Keep workspace package imports crossing package boundaries on package-name entrypoints only.
- Keep the fix aligned with the repo’s documented source-resolution helper and default Next/Turbopack path.
- Run the repo-required verification commands and mandatory audit passes unless blocked by unrelated pre-existing failures that can be defended clearly.

## Risks and mitigations

1. Risk: the patch overlaps many already-dirty files and active lanes.
   Mitigation: apply incrementally against the live tree, inspect conflicts, and preserve adjacent edits rather than force-applying stale hunks.
2. Risk: switching relative imports to `.ts` uncovers package-local type/runtime assumptions.
   Mitigation: run the required typecheck/test/coverage commands and inspect any package-local failures before handoff.
3. Risk: future contributors reintroduce a Turbopack loader workaround.
   Mitigation: add a concise AGENTS guardrail tied to the shared helper and TS rewrite-based approach.

## Tasks

1. Register the lane in the coordination ledger and inspect the provided patch against the current dirty tree.
2. Apply the shared-helper, TS-config, Next-config, and package import-rewrite changes while preserving overlapping edits.
3. Add the repo guidance note in `AGENTS.md`.
4. Run required verification, then required audit subagents, then commit the touched files.

## Outcome

- Completed the source-truthful migration by simplifying `config/workspace-source-resolution.ts`, enabling `rewriteRelativeImportExtensions`, and rewriting relative internal imports from `.js/.mjs/.cjs` to `.ts/.mts/.cts` across the targeted source-consumed workspace packages.
- Removed the custom Turbopack rewrite-loader path from `apps/web` and `packages/web`, restored both to the default Turbopack path, and switched `apps/web` back to plain `next dev`.
- Replaced the loader-specific regression test with a helper-focused Vitest regression and added an AGENTS hard-rule note to prevent reintroducing the loader workaround.
- Mandatory audit passes completed with no actionable simplify, coverage, or final-review findings.
- Verification outcomes:
  - `pnpm --dir packages/web test` passed.
  - `pnpm --dir apps/web test` passed.
  - `pnpm typecheck` passed.
  - `pnpm test` failed in unrelated CLI suites:
    - `packages/cli/test/runtime.test.ts` expected `endedOn` `2026-03-13` but received `2026-03-14`
    - `packages/cli/test/search-runtime.test.ts` missed an expected `sample_summary` entry
  - `pnpm test:coverage` hit the same unrelated CLI failures and then an existing coverage temp-file `ENOENT` for `coverage/.tmp/coverage-12.json`.
- Direct scenario proof:
  - `pnpm --dir apps/web exec next dev --port 3300` booted successfully on the default Turbopack path.
  - `curl -I http://127.0.0.1:3300/` returned `200 OK`.
  - `curl -i http://127.0.0.1:3300/api/device-sync` returned `200 OK` with the expected JSON payload and security headers.
