# Replace the synthetic device-sync contract with owner-path proof

Status: completed
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Resolve the accepted ReviewGPT findings on PR #1806 by deleting the synthetic
  checkpoint/recovery model and proving the incident-shaped lifecycle through
  the existing Web admission and hosted workspace/runtime owners.

## Success criteria

- One canonical schedule event and one durable mailbox item survive a later
  recovery-bucket re-signal without another mailbox append.
- One lost post-pull record checkpoint causes exactly one bounded replay of the
  same four read-only WHOOP method/path classes.
- Checkpoint attempts, commits, cadence publication, convergence, and terminal
  quiescence are asserted from observed owner calls.
- The correction adds no production state, service, queue, dependency, or
  compatibility path and deletes obsolete test-only scaffolding.
- Focused tests, both affected typechecks, docs drift, exact-head CI, required
  ReviewGPT gates, and parent final review pass.

## Scope

- In scope: the existing hosted workspace entrypoint suite, focused Web wake
  identity coverage, truthful reliability/protocol/test-map documentation, and
  deletion of the superseded synthetic testkit surface.
- Out of scope: a provider-effect journal, SQLite snapshot protocol, production
  scheduling changes, production rollout controls, and the deferred full-stack
  replay/load-test idea.

## Tasks

1. [x] Triage the preliminary and final ReviewGPT findings.
2. [x] Have ReviewGPT author the real owner-path correction and measured bounds.
3. [x] Apply and locally prove the owner regression and affected boundaries.
4. [ ] Commit and push the remediated exact head.
5. [ ] Run the required new full ReviewGPT audit with exact-head CI.
6. [ ] Perform parent final review, merge, and retire the worktree.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts -t "system mailbox device-sync preserves one canonical schedule event"`
  - Passed: 1 test; 303 skipped.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-sync-settings --no-coverage apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts apps/web/test/device-sync-hosted-wake.test.ts`
  - Passed: 2 files; 133 tests.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config --no-coverage apps/web/test/prisma-store-due-reconcile-connections.test.ts`
  - Passed: 1 file; 1 test.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-system-mailbox-notification.test.ts test/package-entrypoints.test.ts`
  - Passed: 2 files; 74 tests.
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/workspace-source-resolution.test.ts scripts/workspace-boundaries/import-policy-rules.test.ts`
  - Passed: 2 files; 42 tests.
- `pnpm --dir packages/assistant-runtime typecheck`
  - Passed.
- `pnpm --dir apps/web typecheck`
  - Passed.
- `pnpm docs:drift`
  - Passed.
- `git diff --check`
  - Passed.
- `node scripts/verify-workspace-boundaries.mjs`
  - Blocked by two pre-existing unrelated violations in
    `apps/web/test/device-sync-hosted-wake.test.ts` and
    `apps/web/test/hosted-crypto-gcp-kms.test.ts`; ReviewGPT's before/after
    comparison found identical output.
- Exact-head GitHub Actions and the replacement full ReviewGPT audit run after
  this remediation commit is pushed.
Completed: 2026-08-14
