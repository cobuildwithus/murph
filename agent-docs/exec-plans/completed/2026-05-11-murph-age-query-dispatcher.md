# Murph Age Query Dispatcher

## Goal

Expose a vault-backed Murph Age input-bundle calculator from `@murphai/query` so stored labs, body/BP measurements, and wearable context metrics flow through the product-safe `health-metrics` dispatcher instead of requiring callers to assemble points manually.

## Scope

- `packages/query/src/murph-age.ts`
- `packages/query/src/index.ts`
- `packages/query/test/murph-age-runtime.test.ts`
- `packages/health-metrics/src/murph-age.ts`

## Out Of Scope

- New fitted model coefficients.
- New dataset parsing.
- Product-facing Murph Age claims.
- Changing the lower-level explicit-model scorer beyond what tests require.
- ReviewGPT gating for mechanical implementation.

## Verification Plan

- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query test:coverage`
- `pnpm --dir packages/health-metrics typecheck`
- `pnpm --dir packages/health-metrics test:coverage`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check`

## State

- Status: in progress
- Started: 2026-05-11
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
