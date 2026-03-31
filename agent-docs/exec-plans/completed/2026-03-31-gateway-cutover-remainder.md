# 2026-03-31 Gateway Cutover Remainder

## Goal

- Land the unapplied remainder of `murph-gateway-cutover.patch` against the live repo shape, including the dedicated `@murph/assistant-core` and `@murph/gateway-core` packages, the import migration for hosted/local consumers, and the local gateway runtime/store behavior changes that still differ from the supplied patch.

## Scope

- `agent-docs/exec-plans/active/2026-03-31-gateway-cutover-remainder.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `package.json`
- `tsconfig.base.json`
- `apps/cloudflare/**`
- `packages/assistant-core/**`
- `packages/gateway-core/**`
- `packages/assistant-runtime/**`
- `packages/assistantd/**`
- `packages/cli/src/gateway/**`
- `packages/cli/src/assistant/channels/**`
- `packages/cli/src/assistant-cli-contracts.ts`
- `packages/runtime-state/src/runtime-paths.ts`
- related gateway/assistant tests and package READMEs

## Findings

- The earlier landing adapted only the Cloudflare shared-event-log slice. The supplied patch still has 40+ untouched files.
- The live repo still imports assistant and gateway boundaries through `murph/...` subpath exports and does not yet contain `packages/assistant-core` or `packages/gateway-core`.
- The patch also carries local gateway behavior changes beyond package renames: SQLite-backed local gateway state, provider-native reply ids, title-source metadata, direct-route key changes, and runtime path updates.
- `package.json` and some docs/test-harness files already have unrelated active edits from another lane, so this remainder must merge carefully on top of those changes rather than overwriting them.

## Constraints

- Preserve unrelated active-lane changes.
- Keep existing `murph/*` compatibility exports working while adding the new dedicated packages.
- Do not regress the already-landed hosted stale-snapshot protection in `apps/cloudflare/src/gateway-store.ts`.
- Run required repo verification commands and mandatory audit passes before final handoff.

## Plan

1. Add the dedicated boundary packages and path/build wiring while preserving existing `murph/*` compatibility exports.
2. Migrate hosted and daemon consumers to the new `@murph/*` package names where the patch expects them.
3. Land the remaining local gateway runtime/store/behavior changes and update tests to match the new semantics.
4. Run focused and repo-required verification, then the mandatory simplify and final-review audits, address findings, and commit only this lane’s touched files.

## Verification

- Passed: `pnpm typecheck`
- Failed, unrelated to this lane: `pnpm test`
  - `packages/cli/test/search-runtime.test.ts > search includes sample rows when the caller scopes by stream`
- Failed after tests and coverage passed, unrelated to this lane: `pnpm test:coverage`
  - smoke/doc verification reported invalid scenario ids and missing smoke scenario mapping for `assistant cron target show/set`
- Passed after late follow-up fixes:
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli exec vitest run test/gateway-core.test.ts test/gateway-local-service.test.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/assistant-core-boundary.test.ts test/hosted-runtime-maintenance.test.ts --no-coverage`
  - `pnpm --dir packages/assistantd exec vitest run --config vitest.config.ts test/assistant-core-boundary.test.ts --no-coverage`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/gateway-store.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/outbox-delivery-journal.test.ts --no-coverage`

## Outcome

- Landed the remaining gateway cutover patch scope against the live repo shape, including the dedicated assistant/gateway boundary packages, hosted/local consumer import migration, local gateway SQLite projection store, provider delivery metadata, and the follow-up runtime fixes for reply-to validation and snapshot/event-log churn.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
