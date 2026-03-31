# Land external composability cleanup patch for gateway-core and hosted device-sync stores

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Land the external composability refactor for `packages/gateway-core` and `apps/web` without changing behavior, while preserving the current live-tree gateway capture-sync shape and any unrelated dirty worktree edits.

## Success criteria

- `packages/gateway-core/src/store.ts` delegates schema, permission, snapshot-state, and source-sync internals into focused modules without regressing the current capture-cursor-based sync behavior.
- `apps/web/src/lib/device-sync/prisma-store.ts` is split into focused helper modules that preserve the existing hosted device-sync Prisma behavior.
- Required verification for the touched scopes passes, or any unrelated pre-existing failure is explicitly identified with evidence.
- Required audit passes run and any material findings are resolved before handoff.

## Scope

- In scope:
- Land the supplied `gateway-core` store composability refactor, reconciling current-tree drift manually where needed.
- Land the supplied hosted device-sync Prisma store composability refactor in `apps/web`.
- Add only the minimal plan/ledger updates needed for this task and use the scoped commit helper at the end.
- Out of scope:
- Behavior changes outside the supplied patch intent.
- Unrelated dirty worktree edits already present in other subsystems.

## Constraints

- Technical constraints:
- Preserve the current gateway store's capture cursor / incremental sync design already present in the live tree instead of reverting to older signature-based capture sync from the supplied patch.
- Do not overwrite unrelated in-flight edits in the repo.
- Product/process constraints:
- Follow the standard repo change workflow: required verification, required audit passes, and scoped commit.

## Risks and mitigations

1. Risk: The external patch was produced against an older `packages/gateway-core/src/store.ts` and does not apply cleanly.
   Mitigation: Apply only clean file additions directly, then port the intended modularization into the current store implementation by hand.
2. Risk: The hosted device-sync refactor touches auth- and OAuth-adjacent persistence helpers in `apps/web`.
   Mitigation: Keep the change behavior-preserving, preserve existing type surfaces, and run the full required verification for `apps/web`.

## Tasks

1. Apply the cleanly matching `apps/web` and new `packages/gateway-core/src/store/**` patch hunks.
2. Reconcile and port the intended `packages/gateway-core/src/store.ts` modularization on top of the current capture-cursor implementation.
3. Run required verification for the touched scopes and fix any regressions.
4. Run required `simplify` and `task-finish-review` audit passes, address findings, and re-run affected verification.
5. Finish with a scoped commit using the plan-aware helper.

## Decisions

- Keep the current live-tree gateway capture-cursor sync contract and modularize around it, rather than trying to force the patch's older capture-signature flow back into the file.
- Treat the hosted device-sync raw-DB escape-hatch tightening noted during the simplify audit as follow-up work, not part of this supplied-patch landing.
- Fix the local gateway permission-resolution event-log bug uncovered by the final audit by rebuilding from the pre-update snapshot state rather than the already-mutated permission row.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- All required commands pass for the landed refactor, and focused evidence shows the modularization did not alter behavior.
- Actual outcomes:
- `pnpm typecheck` failed for unrelated pre-existing `packages/cli` / `@murph/assistant-core` export and interface drift already present in the working tree.
- `pnpm test` failed for the same unrelated `packages/cli` / `@murph/assistant-core` migration fallout while other app/package lanes continued.
- `pnpm test:coverage` failed for the same unrelated `packages/cli` / `@murph/assistant-core` migration fallout while other app/package lanes continued.
- `pnpm --filter @murph/gateway-core typecheck` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/prisma-store-oauth-connection.test.ts apps/web/test/prisma-store-browser-auth-nonce.test.ts apps/web/test/prisma-store-device-sync-signal.test.ts apps/web/test/prisma-store-agent-session.test.ts apps/web/test/prisma-store-local-heartbeat.test.ts apps/web/test/prisma-store-refresh-lock.test.ts --no-coverage` passed.
- `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config packages/cli/vitest.workspace.ts --project cli-inbox-setup packages/cli/test/gateway-local-service.test.ts --no-coverage` passed after adding local permission-resolution proof coverage.
Completed: 2026-03-31
