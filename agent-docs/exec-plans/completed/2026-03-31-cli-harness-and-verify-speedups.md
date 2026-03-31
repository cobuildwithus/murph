# 2026-03-31 CLI Harness And Verify Speedups

## Goal

- Land the supplied speedup patch set cleanly against the live tree so CLI integration tests can reuse a persistent subprocess harness, the prepared CLI runtime build stops forcing full rebuilds on every run, and `apps/web verify` overlaps more of its existing heavy steps locally.

## Scope

- `agent-docs/exec-plans/active/2026-03-31-cli-harness-and-verify-speedups.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/src/bin.ts`
- `packages/cli/src/cli-entry.ts`
- `packages/cli/test/cli-test-helpers.ts`
- `packages/cli/test/cli-test-helpers.test.ts`
- `packages/cli/vitest.workspace.ts`
- `scripts/build-test-runtime-prepared.mjs`
- `scripts/cli-command-harness.mjs`
- `apps/web/scripts/verify-fast.sh`
- `apps/web/scripts/dev-smoke.ts`
- `vitest.config.ts`
- `agent-docs/index.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`

## Findings

- The live tree already landed the fake-timer retry tests from the external patch intent, so that portion should not be reworked.
- The live tree already overlaps `pnpm test` with `pnpm dev:smoke` in `apps/web verify`; the remaining hosted-web delta is adding `next build` to that overlap and tightening the smoke poll interval.
- The supplied harness helper adds a handwritten `.mjs` file under `packages/cli/test`, but this repo's source-artifact guard forbids handwritten `.js` and `.mjs` files under `packages/**`, so the harness script must live outside `packages/`.

## Constraints

- Preserve unrelated dirty-tree edits and the existing active lanes.
- Keep stdin-driven CLI tests on the isolated process path.
- Keep the persistent harness opt-out via env override.
- Update durable verification docs if the app verify contract or prepared-build behavior materially changes.
- Run the required `simplify` and `task-finish-review` audit passes before handoff.

## Plan

1. Extract the current CLI entrypoint logic into a reusable module and add the persistent test harness path without regressing isolated stdin cases.
2. Land the remaining hosted-web verify overlap and dev-smoke polling changes.
3. Update verification docs to match the new verify/build behavior if needed.
4. Run focused and required checks, then complete the mandatory audit workflow and a scoped commit.

## Verification

- `pnpm build:test-runtime:prepared`
- `pnpm --dir packages/cli test`
- `pnpm --dir apps/web verify`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Landed the persistent CLI harness path for non-stdin test commands with an extracted reusable CLI entrypoint, retained isolated execution for stdin and the assistant CLI Vitest project via the documented env escape hatch, fixed harness exit-code propagation, and added focused helper coverage for routing, env reset, and harnessed failure output.
- Landed the hosted-web verify overlap so `next build` now runs beside `pnpm test` and `pnpm dev:smoke`, tightened the smoke readiness poll interval to 250ms, and fixed verify-script background-job cleanup so failed runs do not leave a stray `next build` behind for retries.
- Landed the prepared-runtime build changes so the `cli-entry` artifact is verified, the first pass stays incremental, and retry smoke imports bypass Node's ESM cache before forced rebuild retries.
- Updated durable verification docs to match the landed behavior and addressed the required simplify/task-finish-review audit findings before final verification.

Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
