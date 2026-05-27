# Query projection review fixes

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Address high-signal subagent findings from the query projection split review.
- Preserve the facade shape while tightening provider-scoped wearable summaries, public type boundaries, and the wearable-summary projection module boundaries.

## Success criteria

- Provider-scoped wearable projection reads do not invent sleep windows or duplicate out-of-scope source-health rows.
- Explicit old-date wearable summary reads are not silently truncated by storage.
- Wearable summary projection rebuilds collect the vault dataset once and derive provider-scoped bundles from public-provider dataset groups.
- Public query metric runtime types live in a public contract module instead of the SQLite store module.
- Wearable summary SQL storage, bundle projection, provider-row composition, and public JSON serialization live in separate focused modules.
- The default-hidden metric observation predicate is policy-named and kept behind the public query visibility helpers.
- Focused query tests and query typecheck pass.

## Scope

- In scope: `packages/query/src/query-projection-types.ts`, `packages/query/src/query-projection.ts`, `packages/query/src/query-visibility.ts`, `packages/query/src/search-shared.ts`, `packages/query/src/projection/wearable-summary-store.ts`, `packages/query/src/projection/wearable-summary-projector.ts`, `packages/query/src/projection/wearable-summary-compose.ts`, `packages/query/src/projection/wearable-summary-public-json.ts`, focused query tests.
- Out of scope: wider search parity, content-hash freshness, and full projection schema self-check redesign.

## Constraints

- Preserve overlapping active wearable/query edits in the worktree.
- Do not expose raw health payloads, source paths, record ids, provider secrets, local paths, or direct identifiers.
- Keep the fix simple and behavior-oriented; avoid a new abstraction unless it removes responsibility from the store.

## Risks and mitigations

1. Risk: recomposition changes alter existing provider arbitration.
   Mitigation: add focused tests around provider pair composition and total-sleep-only rows.
2. Risk: removing the storage limit expands projection row count.
   Mitigation: rows are compact public summaries; keep read-time limit behavior unchanged.

## Tasks

1. Move public metric runtime types to the public query projection contract module.
2. Tighten provider-scoped wearable summary row materialization.
3. Stop reconstructing projected sleep windows from aggregate total-sleep-only summaries.
4. Rename the low-level hidden metric-observation predicate around projection/search policy.
5. Add focused regressions for old summary rows, source-health scoping, and total-sleep-only recomposition.
6. Split wearable summary storage, projector, composition, and public JSON serialization into focused projection modules.
7. Build provider-scoped projection rows from one collected wearable dataset grouped by public provider.
8. Run focused query verification.

## Verification

- `pnpm --dir packages/query typecheck`
- Focused query projection/provider-scope tests
Completed: 2026-05-27
