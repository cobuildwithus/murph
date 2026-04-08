# Package-local Vitest surface for @murphai/contracts

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Add a clean package-local Vitest surface for `@murphai/contracts`.
- Preserve the package's existing build/schema verification path.
- Make the package ready for later root coverage inclusion without editing root config in this task.

## Success criteria

- `packages/contracts` has a package-local `vitest.config.ts` in repo style.
- `packages/contracts/test/**` contains deterministic tests for the highest-value pure seams.
- `packages/contracts test` still proves the existing build/schema/package-shape checks and now also exercises the new Vitest suite.
- The task reports the minimal root-integration follow-up needed for root package coverage to include `@murphai/contracts`.

## Scope

- In scope:
  - `packages/contracts/package.json`
  - `packages/contracts/vitest.config.ts`
  - `packages/contracts/test/**`
- Out of scope:
  - Root `vitest.config.ts`
  - `config/**`
  - Other workspace packages
  - Runtime behavior changes

## Constraints

- Preserve unrelated worktree edits.
- Keep tests pure, deterministic, and package-local.
- Reuse existing repo Vitest patterns where possible.
- Keep shared test scaffolding minimal and justified.

## Planned seams

1. `ids.ts`, constants exports, and `current-profile.ts`
2. `frontmatter.ts`, `validate.ts`, and selected schema behavior
3. `automation.ts`, `memory.ts`, `shares.ts`, and `event-lifecycle.ts`

## Verification

- Package-local loop:
  - `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts`
- Required package verification:
  - `pnpm --dir packages/contracts test`
- Repo-required checks for this package lane:
  - `pnpm typecheck`
  - `pnpm test:packages`
  - `pnpm test:smoke`

## Notes

- Root coverage wiring is intentionally deferred to the parent/root integration lane.
Completed: 2026-04-08
