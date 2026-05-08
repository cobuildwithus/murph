# Fence browser-vault dashboard compatibility

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Fence legacy dashboard-replica/browser-vault compatibility so deploy-skew support stays available without growing the public `@murphai/hosted-execution` root API or reintroducing dashboard/source-hash freshness semantics as active behavior.

## Success criteria

- Dashboard compatibility helpers live behind explicit legacy modules/subpaths.
- The old `./dashboard-replica` package subpath remains only as a temporary deploy-skew wrapper through the deletion window.
- The hosted-execution package root does not export dashboard compatibility helpers.
- The legacy dashboard refresh fallback is documented with a deletion date/window.
- `expectedSourceStateHash` remains accepted only as an internal legacy parser/store compatibility field.
- Tests prove active browser-vault refresh publish requests omit `expectedSourceStateHash`.

## Scope

- In scope:
  - `packages/hosted-execution` browser-vault/dashboard compatibility exports and tests.
  - `apps/web` internal legacy source-hash browser-vault publish wrapper and tests.
  - Narrow Cloudflare legacy Durable Object method fallback annotation if needed.
- Out of scope:
  - Removing deploy-skew support during the current compatibility window.
  - Changing active browser-vault refresh scheduling or runtime publish behavior beyond test coverage.

## Constraints

- Technical constraints:
  - Preserve current deployed older callers during the compatibility window, including the old `./dashboard-replica` package subpath.
  - Do not expose dashboard helpers from package root.
  - Preserve unrelated dirty worktree edits.
- Product/process constraints:
  - Follow hosted runtime deploy compatibility rules.
  - Do not expose personal identifiers, secret values, or local paths in committed artifacts.

## Risks and mitigations

1. Risk: breaking older web/Cloudflare deploy skew while fencing public API.
   Mitigation: keep explicit legacy wrappers and parser compatibility, with focused tests.
2. Risk: overlapping dirty hosted work blocks a scoped commit.
   Mitigation: keep edits narrow and close/report plan state if commit tooling cannot safely isolate this task.

## Tasks

1. Inspect current hosted-execution exports, web publish route/store, and Cloudflare fallback.
2. Move/fence dashboard compatibility under legacy-named surfaces.
3. Fence web source-hash publish compatibility behind a legacy-named module.
4. Add/update tests for root export absence and active refresh request shape.
5. Run focused verification, then required completion checks/audits.

## Decisions

- Keep the old `./dashboard-replica` subpath only as a temporary compatibility wrapper; new compatibility imports use `./legacy-dashboard-replica`, and the package root stays clean.

## Verification

- Commands to run:
  - `pnpm test:diff packages/hosted-execution/src packages/hosted-execution/test apps/web/app/api/internal/hosted-workspace/browser-vault-replica apps/web/src/lib/hosted-workspace apps/web/test/hosted-runtime-internal-routes.test.ts apps/web/test/hosted-workspace-store.test.ts apps/cloudflare/src/index.ts apps/cloudflare/src/worker-routes/shared.ts`
  - `pnpm typecheck`
- Expected outcomes:
  - Focused diff tests pass.
  - Typecheck passes or any unrelated pre-existing blocker is identified.

## Outcomes

- Implemented `packages/hosted-execution/src/legacy-dashboard-replica.ts`.
- Kept `packages/hosted-execution/src/dashboard-replica.ts` and `./dashboard-replica` as temporary deploy-skew wrappers through the deletion window.
- Removed dashboard helper exports from the hosted-execution package root.
- Added `apps/web/src/lib/hosted-workspace/legacy-source-hash-browser-vault.ts` for legacy source-hash parsing/publishing.
- Removed the exact `@murphai/hosted-execution/dashboard-replica` alias from `apps/web/tsconfig.json`.
- Added/updated tests for the legacy subpath, root export absence, legacy source-hash publish path, and active publish request shape.

## Verification Results

- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-execution.test.ts test/hosted-runtime-control.test.ts --no-coverage` passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-runtime-internal-routes.test.ts test/hosted-workspace-store.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-platform.test.ts --no-coverage` passed before the final doc/tsconfig-only adjustment.
- `pnpm --dir apps/web lint` passed with unrelated warnings.
- `git diff --check` on touched task paths passed.
- `pnpm test:diff ...` and `pnpm typecheck` failed on unrelated active assistant-runtime dirty edits; root typecheck also proved `apps/web` and `packages/hosted-execution` before failing in `packages/assistant-runtime`.
- Required audits ran: coverage-write no changes; security/privacy found the old subpath removal risk, fixed by retaining the wrapper; task-finish found the plan wording and app exact-alias issues, both fixed.
Completed: 2026-05-09
