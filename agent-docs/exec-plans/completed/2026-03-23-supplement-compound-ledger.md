# Supplement Product + Compound Ledger

## Goal

Treat supplements as first-class regimen records with product/formulation metadata and ingredient breakdowns, then expose a derived canonical active-compound ledger that rolls duplicate ingredients up across active supplements.

## Constraints

- Preserve existing `regimen` behavior and backwards compatibility for simple supplement records that only use `substance`/`dose`/`unit`.
- Keep canonical vault writes in `@healthybob/core`; the compound ledger should stay derived/read-only unless a compelling persistence need appears.
- Keep the new operator surface payload-first and consistent with the existing CLI patterns.
- Avoid broad health-descriptor refactors while adjacent CLI cleanup work is active.

## Planned Scope

- `packages/contracts/src/{examples,health-entities,zod}.ts` plus generated regimen schema artifact if needed
- `packages/core/src/bank/{regimens,types}.ts` and focused tests
- `packages/query/src/health/{index,regimens,supplements}.ts` plus read-model/runtime exports if needed
- `packages/cli/src/{vault-cli-command-manifest,query-runtime}.ts`
- `packages/cli/src/commands/supplement.ts` and supplement/compound service plumbing in `packages/cli/src/usecases/**`
- targeted docs/fixture updates for the new supplement command surface

## Current Read

- The repo already supports a smaller version through `regimen` records with `kind: "supplement"` plus optional single `substance`/`dose`/`unit`.
- There is no first-class supplement product command group and no derived compound rollup across multiple supplement records.
- Registry/query infrastructure already supports projecting regimen Markdown records and is a good fit for a derived supplement read layer.

## Intended Outcome

- Supplement payloads can store brand/product metadata and a list of ingredient rows.
- `supplement` commands provide first-class scaffold/upsert/list/show flows for supplement products and a read-only compound ledger view.
- Query/runtime tests cover duplicate-compound aggregation and backwards compatibility with legacy supplement records.
Status: completed
Updated: 2026-03-23
Completed: 2026-03-23
