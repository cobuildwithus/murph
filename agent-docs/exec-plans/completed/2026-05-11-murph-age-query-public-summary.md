# Murph Age Query Public Summary

## Goal

Expose a query-layer helper that returns the public-safe Murph Age display summary directly from vault-backed inputs.

Success criteria:

- Callers can request a public-safe Murph Age summary from `packages/query` without receiving internal point ids.
- Existing calculator behavior, model selection, and wearable context-only boundaries remain unchanged.
- Focused tests prove the query helper strips internal provenance fields while preserving user-facing status and context metadata.

## Scope

- `packages/query/src/murph-age.ts`
- `packages/query/src/index.ts`
- `packages/query/test/murph-age-runtime.test.ts`

## Constraints

- Do not promote wearables to score-bearing inputs.
- Do not introduce product-facing Murph Age claims, recommendations, protocols, or risk-to-age promotion.
- Keep raw/internal calculator output available only for internal/research callers; public surfaces should use the sanitized summary helper.
- Preserve unrelated active ledger rows and working-tree edits.

## Plan

1. Add a query runtime wrapper over the health-metrics public summary sanitizer.
2. Export the helper through the query package index using existing lazy-import patterns.
3. Add focused runtime assertions for public-safe output shape.
4. Run package verification, typecheck, smoke, and required audit passes.
5. Close this plan with a scoped commit.

Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
