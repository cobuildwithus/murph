# Hosted runner bundle-slot storage refactor

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Move hosted runner bundle refs and bundle versions out of `runner_meta` into a canonical `runner_bundle_slots` table.
- Keep bundle read/write, compare-and-swap, and malformed-state cleanup aligned to the shared hosted-execution slot list.
- Hard-cut the old per-slot `runner_meta` storage shape because there are no live deployments to migrate.

## Success criteria

- Fresh runner schema creates `runner_meta` without per-slot bundle ref/version columns and creates canonical `runner_bundle_slots` rows instead.
- `RunnerQueueStore` reads, writes, sanitizes, and CAS-checks bundle refs and versions through `runner_bundle_slots` only.
- `RunnerBundleSync` reads and writes bundles by iterating the canonical hosted-execution slot list rather than hardcoding slot names.
- Malformed stored bundle refs still fail closed by clearing the bad ref while preserving that slot’s version counter.
- Focused regression tests cover the new table shape, canonical-slot CAS/version behavior, and malformed-state repair.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner/{runner-bundle-sync.ts,runner-queue-schema.ts,runner-queue-state.ts,runner-queue-store.ts,types.ts}`
- Focused Cloudflare tests that assert the storage contract and runner behavior.

- Out of scope:
- Preserving or migrating legacy `runner_meta` bundle columns.
- Broader hosted runner refactors unrelated to bundle-slot storage.

## Constraints

- No retained legacy migration code for old per-slot `runner_meta` columns.
- Preserve unrelated dirty-tree edits elsewhere in the repo.
- Keep the existing bundle compare-and-swap semantics and fail-closed malformed-state cleanup behavior.

## Risks and mitigations

1. Risk: Changing durable storage shape can break runner recovery or finalize flows.
   Mitigation: Update schema, pure projection helpers, queue-store persistence, and bundle-sync I/O together, then run focused plus required verification.
2. Risk: Hardcoding slot handling again would drift from the canonical hosted-execution slot list.
   Mitigation: Reuse `HOSTED_EXECUTION_BUNDLE_SLOTS` plus the slot-mapping helpers throughout the runner bundle paths.
3. Risk: Dropping malformed-ref cleanup would leave corrupt state stuck in Durable Object storage.
   Mitigation: Preserve the repair path, but apply it to `runner_bundle_slots` rows instead of the removed legacy columns.

## Tasks

1. Add the active ledger row and this plan.
2. Refactor the runner schema and state/store helpers to use `runner_bundle_slots` only.
3. Update bundle sync to use the shared canonical slot list for bundle reads, writes, and conflict checks.
4. Update focused tests and helpers for the new storage contract.
5. Run required verification and direct scenario proof.
6. Close the plan and create the scoped commit.

## Verification

- Required:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

- Focused:
- `pnpm --dir apps/cloudflare exec vitest run test/runner-queue-store.bundle-slots.test.ts test/runner-queue-store.test.ts test/runner-bundle-helpers.test.ts test/user-runner.test.ts`

## Verification results

- Passed:
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-queue-store.bundle-slots.test.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/user-runner.test.ts`
- Direct scenario proof via `pnpm exec tsx` in-memory SQLite harness: `runner_meta` no longer contained per-slot bundle columns, and `runner_bundle_slots` held the persisted ref/version rows after a compare-and-swap write.
- `git diff --check -- apps/cloudflare/src/user-runner apps/cloudflare/test/runner-queue-store.bundle-slots.test.ts apps/cloudflare/test/runner-queue-store.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/sql-storage.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-03-bundle-slot-storage-refactor.md`

- Blocked by unrelated existing worktree issues:
- `pnpm typecheck`
  Fails in an unrelated active lane because `packages/cli/test/inbox-model-harness.test.ts` imports `@murphai/assistant-core/assistant/web-fetch`, which the workspace-boundary guard rejects as a non-public entrypoint.
- `pnpm test`
  Fails for the same unrelated workspace-boundary violation before the full repo acceptance stack completes.
- `pnpm test:coverage`
  Fails in an unrelated active lane because `packages/assistant-core/src/assistant/web-fetch.ts` currently has `Document` typing errors that block dependent app typechecks.
Completed: 2026-04-03
