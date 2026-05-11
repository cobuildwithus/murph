# Murph Age Wearable Context Contract

## Goal

Extend the Murph Age wearable context surface with the missing aggregate wearable quality and sleep-context metrics recommended by the current lab-plus-wearable architecture work, while keeping all wearable inputs non-score-bearing.

## Scope

- Add neutral metric definitions for wearable coverage/valid-window summaries and sleep efficiency/variability.
- Include those metrics in the Murph Age context-only bundle.
- Add focused tests proving they resolve and remain context-only.

## Verification

- `pnpm --dir packages/health-metrics test -- test/index.test.ts`
- `pnpm --dir packages/health-metrics test:coverage`
- `pnpm typecheck`
- `pnpm test:smoke`

## Status

Implemented and verified.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
