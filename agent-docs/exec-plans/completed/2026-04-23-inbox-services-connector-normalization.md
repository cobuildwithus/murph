Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Fix inbox-services connector account normalization drift so persisted Telegram/Linq `accountId: null` configs resolve to the same runtime namespace, filters, cursors, and connector identity as their normalized runtime defaults, and make `sourceAdd` fail before persistence when auto-reply enablement fails.

## Success criteria

- One shared source-aware account-normalization helper owns Telegram/Linq default account ids and is used on both config read/write paths and runtime read paths.
- Persisted configs with `telegram.accountId = null` or `linq.accountId = null` normalize to the same effective connector namespace as `bot` / `default` everywhere the inbox-services layer reasons about namespaces, filters, cursors, or connector instantiation.
- `sourceAdd(... enableAutoReply: true)` no longer persists the connector when auto-reply enablement throws.
- Focused regressions cover config normalization, namespace/filter/cursor alignment, and the new `sourceAdd` failure ordering.

## Scope

- In scope:
- `packages/operator-config/src/inbox-cli-contracts.ts`
- `packages/inbox-services/src/inbox-app/{sources,runtime}.ts`
- `packages/inbox-services/src/inbox-services/{shared,state,query,connectors}.ts`
- `packages/inbox-services/tsconfig.typecheck.json`
- `tsconfig.base.json`
- directly coupled `packages/inbox-services/test/**` coverage for normalization and `sourceAdd`
- `agent-docs/exec-plans/active/{2026-04-23-inbox-services-connector-normalization.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader inboxd connector/runtime redesign
- Linq local connector reintroduction
- assistant auto-reply state model changes beyond the `sourceAdd` ordering fix

## Constraints

- Preserve unrelated dirty-tree work, especially the many active rows already touching other packages and the shared ledger churn.
- Keep the fix additive and owner-local to `operator-config` + `inbox-services`; do not widen into `packages/inboxd` unless verification exposes a blocker that cannot be handled in this owner slice.
- Treat this as persisted-state/operational behavior work: keep verification coverage-bearing and capture one direct scenario proof.

## Risks and mitigations

1. Risk: normalizing on read/write could silently rewrite stored configs in ways callers do not expect.
   Mitigation: keep normalization limited to the existing Telegram/Linq default-account behavior already assumed by runtime connector instantiation, and cover persisted round-trip behavior in focused tests.
2. Risk: changing namespace/filter/cursor keys could strand existing runtime state under the old null/default key split.
   Mitigation: align all read/write callsites on the same helper so future reads and writes converge on one key, and add a focused backfill regression for the cursor key.
3. Risk: moving auto-reply enablement ahead of config persistence could leave the assistant auto-reply state enabled if a later config write fails.
   Mitigation: keep the change minimal and targeted to the reported failure mode, and document any remaining residual side-effect risk in the final handoff if no rollback seam exists.

## Tasks

1. Add an operator-config-owned connector account normalization helper and thread it into schema parsing so config round-trips normalize source-aware account ids.
2. Update inbox-services shared/query/state/runtime/connector logic to derive namespace keys, filters, cursor ids, and connector instantiation account ids from the same helper.
3. Reorder `sourceAdd` auto-reply enablement so the command cannot throw after persisting the new connector.
4. Add focused tests for null-account Telegram/Linq normalization, cursor/filter alignment, and `sourceAdd` failure ordering.
5. Run scoped verification, required audits, and a scoped commit flow if the dirty tree allows it.

## Decisions

- Put the canonical source-aware normalization helper in `@murphai/operator-config/inbox-cli-contracts` so schema parsing and inbox-services runtime logic share the same owner.
- Keep `sourceAdd` behavior atomic relative to the reported failure mode by enabling auto-reply before writing config instead of expanding the public result contract for partial-success reporting.
- Add exact TypeScript path mappings for `@murphai/operator-config/inbox-cli-contracts` where inbox-services typecheck paths override the repo base config so the new source export resolves from `src/` instead of stale generated declarations.

## Verification

- Required commands:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/inbox-cli-contracts.ts packages/inbox-services/src/inbox-app/sources.ts packages/inbox-services/src/inbox-app/runtime.ts packages/inbox-services/src/inbox-services/shared.ts packages/inbox-services/src/inbox-services/state.ts packages/inbox-services/src/inbox-services/query.ts packages/inbox-services/src/inbox-services/connectors.ts packages/inbox-services/test/inbox-app-sources.test.ts packages/inbox-services/test/inbox-app-reads-runtime.test.ts packages/inbox-services/test/inbox-services-core-seams.test.ts packages/inbox-services/test/service-layer-coverage.test.ts`
- `git diff --check`
- Required audits:
- `coverage-write`
- `task-finish-review`
- Direct scenario proof to capture:
- a persisted Telegram connector with `accountId: null` reads back, filters, and backfills under the normalized `bot` namespace
- `sourceAdd(... enableAutoReply: true)` leaves config untouched when auto-reply enablement throws
Completed: 2026-04-24
