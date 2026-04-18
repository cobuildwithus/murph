# Assistant runtime wake-native request-shape fix

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Finish the in-progress wake-native migration inside `packages/assistant-runtime`
  so the package compiles and its hosted-runtime tests align with the current
  runner request contract.

## Success criteria

- `packages/assistant-runtime/**` no longer relies on the stale
  `request.wake` field as the primary hosted job-request surface.
- Hosted runtime request typing matches the current contract/tests around
  `request.dispatch`.
- Targeted assistant-runtime typecheck and hosted-runtime tests pass without
  touching `apps/cloudflare/**`, `apps/web/**`, or
  `packages/hosted-execution/**` beyond reporting blockers.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime*.ts`
  - focused hosted-runtime tests under `packages/assistant-runtime/test/**`
- Out of scope:
  - `apps/cloudflare/**`
  - `apps/web/**`
  - `packages/hosted-execution/**` implementation changes unless a blocker
    proves they are unavoidable

## Constraints

- Preserve unrelated dirty-tree edits.
- Make the smallest coherent forward fix for the request-shape seam.
- Stay compatible with the broader hosted hard-cut migration already in flight.

## Verification

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-*.test.ts --no-coverage`
Completed: 2026-04-18
