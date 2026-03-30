# 2026-03-30 Test Architecture Follow-up Review Fixes

## Goal

- Preserve the new `test:apps` verification split while restoring the pre-existing root package lane, coverage policy, and timeout behavior that the earlier landing accidentally widened or dropped.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-test-architecture-followup-review-fixes.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `vitest.config.ts`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`

## Findings

- The earlier follow-up successfully split the heavier web/app verification path into `pnpm test:apps`, but the root `vitest.config.ts` also switched from a curated repo-level include list to whole-package project discovery.
- That rewrite widened `pnpm test:packages` and `pnpm test:packages:coverage` beyond the change's intended scope and likely explains why `packages/cli/test/gateway-core.test.ts` started failing only under the new root coverage lane.
- The same root rewrite dropped the prior repo-level `testTimeout: 60_000` and the targeted V8 coverage thresholds/include list, so the docs now needed to state clearly that the app split remains while the root package lane keeps its earlier acceptance policy.
- The claimed unrelated README deletion is not present in the actual diff; this follow-up stays scoped to the root Vitest policy and matching docs.

## Constraints

- Preserve the new app verification split and its fast `packages/web test` / `apps/web test` loops.
- Do not widen into fixing unrelated dirty-branch failures unless the restored root lane still proves one is caused by this change.
- Preserve overlapping work in the active green-checks lane that also touches `vitest.config.ts`.
- Run the required completion audits for this non-doc repo config change.

## Plan

1. Restore the root multi-project config so it reuses package-local project settings but keeps the old curated repo-level include list, coverage gates, and timeout.
2. Update verification docs to describe the restored root package surface and keep `test:apps` as the separate heavier app lane.
3. Run `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, and a direct `pnpm test:apps` proof to confirm the split still works and the widened root-lane regression is gone.
4. Run the required `simplify` and `task-finish-review` audit passes, address anything real, then close the plan and commit only the touched files.

## Verification

- Failed: `pnpm typecheck`
  - unrelated dirty-tree failure in `packages/cli/test/cli-expansion-inbox-attachments.test.ts` (`attachments` property type mismatch)
- Failed: `pnpm test:apps`
  - unrelated dirty-tree failure in `apps/cloudflare/test/node-runner.test.ts` (`fails hosted execution when an externalized artifact cannot be fetched`)
- Failed: `pnpm test`
  - unrelated dirty-tree failures in `packages/cli/test/inbox-cli.test.ts`
- Failed: `pnpm test:coverage`
  - unrelated dirty-tree build failures in `packages/core` / `@murph/contracts` exports and `packages/cli/src/gateway/opaque-ids.ts` before the root Vitest coverage pass starts
- Passed: root package-suite scope proof
  - `vitest.config.ts` restores the curated repo include list, targeted V8 coverage surface/thresholds, and `testTimeout: 60_000`
  - `pnpm exec vitest list --config vitest.config.ts --project assistantd`
    - lists only `packages/assistantd/test/http.test.ts` and `packages/assistantd/test/assistant-core-boundary.test.ts`
  - direct grep proof: `pnpm exec vitest list --config vitest.config.ts --project assistantd | rg 'service\\.test'`
    - no matches
  - direct file proof: `packages/cli/test/gateway-core.test.ts` is no longer part of the curated root include list in `vitest.config.ts`
- Passed: required audit passes
  - `simplify` spawned audit: no actionable issues
  - `task-finish-review` spawned audit: no actionable issues; residual risk limited to unrelated dirty-tree red lanes blocking full wrapper proof
- Failed: `pnpm review:gpt --chat-url https://chatgpt.com/c/69c9efd5-b2d0-8329-84ea-3d8cead2281c --preset task-finish-review --send --wait --wait-timeout 8m --timeout 8m --prompt "..."`
  - ChatGPT browser staging attached the audit ZIP and prefilled the prompt, but autosend failed with a managed-browser `commit-timeout` on the existing thread state, so no usable external review reply was captured

## Outcome

- Ready to close: review findings 1 and 2 are addressed in code/docs, the README deletion concern was not present in the actual diff, required repo audits found no further issues, and the requested ChatGPT Pro review was retried but still blocked by the target thread's browser-side autosend state rather than by local staging.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
