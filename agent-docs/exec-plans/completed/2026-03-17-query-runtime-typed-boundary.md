# Query Runtime Typed Boundary

## Goal

Eliminate CLI-local hand-rolled query/read-model mirrors and replace them with a single authoritative typed boundary sourced from `packages/query`.

## Scope

- Export query-owned record/read-model/filter/result types from `packages/query/src/index.ts`.
- Centralize the CLI dynamic-import contract in `packages/cli/src/query-runtime.ts`.
- Replace local CLI mirror interfaces in query helpers and vault/provider use cases with imports from that shared boundary.
- Preserve runtime behavior; this is a type/structure cleanup only.

## Constraints

- Do not widen query payloads to `any`.
- Prefer deleting shadow interfaces over repairing them in place.
- Keep the CLI runtime boundary compatible with the existing dynamic import of `@healthybob/query`.

## Verification

- Targeted CLI/runtime tests covering document/meal, export/intake, provider/event/samples, experiment/journal/vault, plus repo-required checks.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
