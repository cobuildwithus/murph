# Murph Age Query Wearable Quality Context

## Goal

Let the query runtime carry the full Murph Age wearable context surface, including sleep quality/variability and wearable coverage quality metrics, into the calculator/display summary while preserving the current non-score-bearing wearable boundary.

Success criteria:

- `calculateMurphAgeFromVaultInputBundle` accepts the current wearable context metric set from `@murphai/health-metrics`.
- Query-runtime tests prove wearable quality metrics are selected as context and summarized as non-score-bearing.
- No product Murph Age claim, score-bearing wearable feature, or risk-to-age unlock is introduced.

## Scope

- `packages/query/src/murph-age.ts`
- `packages/query/test/murph-age-runtime.test.ts`
- `packages/health-metrics/src/murph-age.ts`
- `packages/health-metrics/test/index.test.ts`

## Constraints

- Preserve the ReviewGPT/Pro consensus: lab/BP/body can be score-bearing research inputs; wearables stay context/shadow until separately validated.
- Do not expose row values, private identifiers, source bodies, predictions, coefficients, or product claims.
- Keep the change narrow to query runtime allowlisting and proof.

## Plan

1. Extend query runtime's wearable context metric allowlist to match the current health-metrics bundle.
2. Add a public/shareable display-summary wrapper that omits internal point IDs from client-safe Murph Age display payloads.
3. Add focused health-metrics and query runtime assertions that sleep/coverage context survives the vault adapter and can be summarized without making wearables score-bearing or exposing point IDs in the public summary.
4. Run package-focused verification, typecheck, smoke, and required audit passes.
5. Close this plan with a scoped commit.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
