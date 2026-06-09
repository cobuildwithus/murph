# PR66 Cloudflare DO Migration Simplification

Status: completed
Created: 2026-06-08
Updated: 2026-06-08

## Goal

- Simplify the PR66 hard-cut deployment by making Cloudflare runner Durable
  Objects drop the retired `runner_bundle_slots` table during schema migration
  instead of requiring an operator-managed Durable Object wipe.

## Success criteria

- Runner state schema migration drops `runner_bundle_slots` when present.
- Focused Cloudflare runner state tests cover the retired-table drop.
- Hard-cut docs and PR body no longer require manual Cloudflare DO state reset
  for `runner_bundle_slots`.
- Temporal workflow-history reset remains documented as required.

## Scope

- In scope: Cloudflare runner state schema/test, hard-cut deploy docs, PR body
  wording.
- Out of scope: changing Temporal workflow reset requirements, adding new
  runtime wake behavior, or preserving retired split-bundle state.

## Constraints

- `runner_bundle_slots` is execution-side coordination residue, not canonical
  product truth.
- Keep the deployment runbook simple and explicit.

## Tasks

1. Replace the fail-closed retired-table assertion with a drop migration.
2. Update focused tests.
3. Update docs and PR body wording.
4. Run focused Cloudflare verification and required checks.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-state-store.bundle-slots.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare verify` passed.
- `pnpm docs:drift` passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
Completed: 2026-06-08
