# Raise `@murphai/device-syncd` provider coverage above the shared root gate

Status: active
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Keep `packages/device-syncd/vitest.config.ts` on the shared `createMurphVitestCoverage(...)` helper with no package-local threshold override.
- Raise the owned provider files above the shared per-file coverage gate by adding real package-local tests first and only the smallest provider seams if tests alone cannot reach the gaps.
- Preserve unrelated dirty edits in `packages/device-syncd/**`.

## Success criteria

- `pnpm --dir packages/device-syncd typecheck` passes.
- The focused package-local test run for the owned provider seam passes.
- A package-local coverage run shows the owned provider files at or above `85 lines / 85 functions / 80 branches / 85 statements`.

## Scope

- In scope:
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-device-syncd-provider-coverage-worker.md}`
- `packages/device-syncd/src/providers/{garmin.ts,oura.ts,oura-webhooks.ts,shared-oauth.ts,whoop.ts}`
- `packages/device-syncd/test/{garmin-provider.test.ts,oura-provider.test.ts,oura-webhooks.test.ts,shared-oauth.test.ts,whoop-provider.test.ts,public-ingress.test.ts}`
- Out of scope:
- package/root coverage config
- non-provider `device-syncd` runtime seams owned by other lanes
- commits from this worker lane

## Current state

- The package already uses the shared coverage helper path with no lower override in `packages/device-syncd/vitest.config.ts`.
- Fresh failing provider metrics from the handoff are:
  - `src/providers/shared-oauth.ts`: branches `74.28`
  - `src/providers/oura-webhooks.ts`: lines `81.02`, functions `80`, statements `80.8`, branches `62.58`
  - `src/providers/garmin.ts`: functions `82.35`, statements `84.48`, branches `79.54`
  - `src/providers/whoop.ts`: lines `83.04`, statements `82.75`, branches `64.88`
  - `src/providers/oura.ts`: functions `84.28`, branches `69.68`
- Another lane already owns the non-provider `public-ingress.ts`, `http.ts`, `service.ts`, and `store.ts` coverage work. This lane should only touch `public-ingress.test.ts` or `http.test.ts` when the provider-owned branches genuinely require it.

## Risks and mitigations

1. Risk: overlapping device-syncd workers edit the same shared tests.
   Mitigation: keep edits in provider-focused test files first and touch `public-ingress.test.ts` only for provider callback coverage that cannot live elsewhere.
2. Risk: coverage is chased with broad behavioral changes instead of proof.
   Mitigation: prefer deterministic tests and add source seams only when a branch is otherwise unreachable.
3. Risk: the package coverage run is slow or noisy.
   Mitigation: iterate with focused package-local Vitest commands, then finish with package-local coverage evidence.

## Tasks

1. Inspect the live provider sources and existing provider tests to find the highest-value uncovered branches/functions.
2. Add focused deterministic package-local tests for shared OAuth, Oura webhooks, Garmin, WHOOP, and Oura provider branches.
3. Add only minimal provider-side seams if a branch cannot be reached cleanly from tests.
4. Run package-local typecheck and focused coverage verification, then close any remaining owned gaps.
5. Perform a final local review and report exact commands, coverage evidence, and changed files.

## Verification

- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/{shared-oauth.test.ts,oura-webhooks.test.ts,garmin-provider.test.ts,oura-provider.test.ts,whoop-provider.test.ts,public-ingress.test.ts}`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --coverage`
