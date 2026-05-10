# Murph Age Local Model Card Loader

## Goal

Let the query runtime load ignored-local Murph Age research model-card artifacts for Lab9/Lab5 scoring, so fitted benchmark cards can be used without callers manually passing model objects. Product mode must still abstain on research-only cards, and wearable inputs must remain context-only unless a future card policy explicitly authorizes them.

## Scope

- `packages/query/src/murph-age.ts`
- `packages/query/src/index.ts`
- `packages/query/test/murph-age-runtime.test.ts`

## Out Of Scope

- New fitted coefficients.
- Dataset parsing.
- Product authorization or promotion.
- Wearable score-bearing fusion.
- ReviewGPT gating for local implementation mechanics.

## Verification Plan

- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query test:coverage`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check`

## State

- Status: in progress
- Started: 2026-05-11
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
