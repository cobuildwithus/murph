# 2026-03-31 Test Harness Speedup Round 3

## Goal

- Land the supplied Vitest-harness patch so the active project configs stop forcing file-level serialization, local worker defaults better use local machines without changing CI defaults, and hosted structured logs stay quiet during Vitest unless explicitly re-enabled.

## Scope

- `agent-docs/exec-plans/active/2026-03-31-test-harness-speedup-round3.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`
- `config/vitest-parallelism.ts`
- `vitest.config.ts`
- `scripts/workspace-verify.sh`
- `apps/{cloudflare,web}/vitest*.ts`
- `packages/{assistant-runtime,assistantd,cli,core,device-syncd,hosted-execution,importers,inboxd,parsers,query,runtime-state,web}/vitest.config.ts`
- `packages/hosted-execution/src/observability.ts`
- `packages/hosted-execution/test/hosted-execution.test.ts`

## Findings

- The supplied patch applies cleanly to the current tree and matches the live Vitest harness layout.
- The repo's `pnpm test` wrapper still requires an active execution plan for this multi-file harness/config lane; a coordination-ledger row alone is not sufficient.
- Durable verification docs currently describe the older local worker defaults, so they must be updated in the same change to keep the repo truth accurate.

## Constraints

- Keep CI conservative by default.
- Preserve the curated root `vitest.config.ts` suite selection.
- Do not weaken coverage or drop test files.
- Preserve unrelated dirty worktree edits outside this narrow harness lane.

## Plan

1. Land the supplied harness delta plus the smallest supporting test/doc updates needed for the live tree.
2. Run the required verification commands and record any failures as either fixed issues or clearly unrelated pre-existing red targets.
3. Run the required audit workflow if session policy permits it; otherwise note the constraint explicitly in handoff.
4. Close the active plan before final handoff.

## Verification

- Passed: `pnpm typecheck`
- Failed before scoped fallback: `pnpm test`
  - first blocked by the repo guard until the active plan and durable verification docs were added
  - later blocked by an unrelated dirty-tree compile error in `packages/cli/src/gateway/store.ts`
- Failed before scoped fallback: `pnpm test:coverage`
  - progressed into the coverage suite after `build:test-runtime`, then failed in `packages/cli/test/health-tail.test.ts` under the broader current dirty tree
- Passed: `pnpm exec vitest run --config vitest.config.ts --project hosted-execution --no-coverage` (from `packages/hosted-execution`)
- Passed: `pnpm exec vitest run --config vitest.config.ts --project inboxd --no-coverage` (from `packages/inboxd`)
- Passed: `pnpm --dir . exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/runtime.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/setup-cli.test.ts --no-coverage`
- Passed: `pnpm test` (from `packages/web`)
- Passed: `pnpm prisma:generate && pnpm test` (from `apps/web`)
- Passed: `pnpm test:node` (from `apps/cloudflare`)
- Passed: `pnpm test:workers` (from `apps/cloudflare`)
- Passed: `pnpm install --frozen-lockfile`
  - repaired broken local `node_modules/.bin` shims after they started resolving workspace executables through malformed duplicated absolute paths

## Outcome

- Completed with scoped verification because the repo-wide wrappers were blocked first by repo-policy docs/plan requirements, then by unrelated dirty-tree failures outside this lane, and finally by a broader existing/root-suite coverage failure not isolated to the changed Vitest configs themselves. The touched harness files and the timing-sensitive tests hardened in this pass are green under focused runs.
Status: completed
Updated: 2026-03-31
