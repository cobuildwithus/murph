# Murph Age Dispatcher

## Goal

Add a narrow `@murphai/health-metrics` API that applies the current Murph Age research posture:

- choose Lab9 + BP/body first,
- fall back to Lab5 + BP/body,
- attach wearable data as context only,
- abstain when no validated score-bearing model card is supplied.

## Scope

- `packages/health-metrics/src/**`
- `packages/health-metrics/test/**`

## Out Of Scope

- Product claims.
- New fitted coefficients.
- User-facing UI.
- New dataset parsing.
- ReviewGPT gating for mechanical implementation.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/health-metrics`
- `pnpm test:smoke`

## Status

In progress.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
