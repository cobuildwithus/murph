# Wearables Semantic Correctness

## Goal

Fix semantic wearable read-model correctness gaps in `packages/query` so partial provenance does not silently drop usable records, metric and sleep-window selection uses scored evidence instead of provider-first hard ordering, sleep fallbacks are explicit in resolved metrics, and selection reasons are stable enough for product-facing explanations.

## Scope

- `packages/query/src/wearables.ts`
- `packages/query/src/wearables/**`
- `packages/query/test/query.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve unrelated dirty-tree edits elsewhere in the repo.
- Keep the change scoped to the semantic wearables query layer; do not broaden into importer or core mutation changes in this turn.
- Follow the `packages/query` verification lane plus repo-required typecheck and test commands.
- Run the required completion-workflow audit pass before handoff.

## Plan

1. Read the current semantic wearables collection, ranking, and summarization paths and capture the current failure modes.
2. Add partial-provenance handling so records with a usable provider can still contribute, while surfacing explicit diagnostics for records excluded because the provider could not be derived.
3. Replace provider-first candidate/window ordering with scored ranking that balances provider preference, specificity, recency, and cross-source agreement, and emit stable selection reasons from that scoring.
4. Make sleep fallbacks explicit in resolved metric selections and add focused tests for partial provenance, ranking, fallback labeling, and explainability.
5. Run required verification, complete the required audit pass, address any findings, then commit only the touched files with the repo helper.

## Verification

- `pnpm --dir packages/query typecheck` ✅
- `pnpm --dir packages/query exec vitest run test/query.test.ts --no-coverage` ✅
- `pnpm test:smoke` ✅
- `pnpm typecheck` ✅
- `pnpm --dir packages/query test` ❌ pre-existing `packages/query/test/import-warning.test.ts` SQLite experimental-warning assertion
- `pnpm test:packages` ❌ unrelated `packages/cli/test/release-script-coverage-audit.test.ts` release-manifest ordering assertion

## Notes

- No durable architecture update is expected unless the change grows beyond query-layer behavior.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
