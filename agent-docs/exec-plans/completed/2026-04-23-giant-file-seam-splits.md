# Land the requested giant-file seam splits without changing behavior

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Split the five user-named oversized modules along the documented responsibility seams while keeping current public entrypoints and runtime behavior stable.

## Success criteria

- `packages/assistant-engine/src/assistant/cron.ts` delegates canonical projection helpers and execution helpers into narrower `assistant/cron/**` modules.
- `apps/web/src/lib/hosted-run/store.ts` delegates projection/sanitization plus acquire/lifecycle/status helpers into narrower `hosted-run/**` modules.
- `apps/cloudflare/src/user-runner/runner-run-processor.ts` moves web log forwarding and transient cleanup helpers into dedicated `user-runner/**` modules while keeping `RunnerRunProcessor` focused on run invocation/finalization.
- `packages/query/src/browser-replica.ts` moves the parser cluster into `browser-replica/**` modules without changing the exported contract.
- `packages/assistant-engine/src/assistant-codex.ts` moves config/env resolution and image staging helpers into `assistant-codex/**` modules while preserving `executeCodexAppServerTurn` and `buildCodexAppServerArgs` as the stable entrypoints.
- Focused verification plus required audit passes complete, or any unrelated pre-existing blockers are documented precisely.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/cron.ts`
- `packages/assistant-engine/src/assistant/cron/**`
- directly coupled assistant cron tests
- `apps/web/src/lib/hosted-run/store.ts`
- `apps/web/src/lib/hosted-run/**`
- directly coupled hosted-run tests/callers
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `apps/cloudflare/src/user-runner/**`
- directly coupled Cloudflare runner tests/callers
- `packages/query/src/browser-replica.ts`
- `packages/query/src/browser-replica/**`
- directly coupled query/browser-replica tests/callers
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/**`
- directly coupled assistant-engine Codex tests/callers
- `agent-docs/exec-plans/active/{2026-04-23-giant-file-seam-splits.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Splitting `apps/cloudflare/src/user-runner.ts`
- Splitting `packages/core/src/mutations.ts`
- Splitting `packages/core/src/operations/write-batch.ts`
- behavioral redesigns of cron, hosted-run, Cloudflare runner, browser replica, or Codex RPC protocols

## Constraints

- Technical constraints:
- Preserve current exports, persisted data contracts, and caller-visible behavior during the extraction.
- Prefer moving one helper cluster at a time behind the existing facade instead of broad API reshaping.
- Keep module ownership disjoint enough for parallel worker edits.
- Product/process constraints:
- Preserve unrelated dirty-tree edits already present in `cron.ts`, `hosted-run/store.ts`, and `runner-run-processor.ts`.
- Treat the Cloudflare runner slice as overlap-sensitive because an active row already owns a narrow observability change in the same file family.
- Follow the high-risk repo workflow: active plan, ledger row, truthful verification, required `coverage-write`, and required `task-finish-review`.
- Use `gpt-5.4` `xhigh` worker subagents for the implementation slices requested by the user.

## Risks and mitigations

1. Risk: extracted helpers could accidentally change which paths remain the public owner surface.
   Mitigation: keep the existing top-level files as facades first and change imports/callers incrementally.
2. Risk: dirty-tree overlap in `runner-run-processor.ts` could accidentally absorb unrelated observability work.
   Mitigation: restrict this task to moving existing helper clusters into adjacent modules and preserve any pre-existing behavior-only edits already in the file.
3. Risk: package-local refactors can strand unupdated imports or circular dependencies.
   Mitigation: inspect current imports before delegation, keep worker write sets disjoint, and run package/app-focused verification before the required audit passes.

## Tasks

1. Register this task in the coordination ledger and inspect each target seam closely enough to define safe worker ownership.
2. Spawn five `gpt-5.4` `xhigh` worker subagents with one bounded split each.
3. Integrate the returned module extractions, resolve any dirty-tree overlap carefully, and keep stable facades/export points intact.
4. Run truthful focused verification and the required audit passes, then commit only if staging can stay exact.

## Decisions

- Use one worker per requested split so each worker owns one file family and can edit directly in its forked workspace without overlapping write scope.
- Keep the legacy top-level files exporting the same stable entrypoints while the helper clusters move underneath them.
- Move the lowest-risk leaf clusters first inside each family: canonical projection in cron, projection/sanitization in hosted-run, web observability in Cloudflare runner, parser cluster in browser-replica, and config/images in assistant-codex.

## Verification

- Commands run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/2026-04-23-giant-file-seam-splits.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/assistant-engine/src/assistant/cron.ts packages/assistant-engine/src/assistant/cron/canonical-jobs.ts packages/assistant-engine/src/assistant/cron/execution.ts packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant-codex/config.ts packages/assistant-engine/src/assistant-codex/images.ts packages/assistant-engine/test/food-recurring-cron.test.ts apps/web/src/lib/hosted-run/store.ts apps/web/src/lib/hosted-run/shared.ts apps/web/src/lib/hosted-run/sanitize.ts apps/web/src/lib/hosted-run/projection.ts apps/web/src/lib/hosted-run/acquire.ts apps/web/src/lib/hosted-run/lifecycle.ts apps/web/src/lib/hosted-run/status.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/src/user-runner/runner-cleanup.ts apps/cloudflare/src/user-runner/runner-web-observability.ts packages/query/src/browser-replica.ts packages/query/src/browser-replica/shared.ts packages/query/src/browser-replica/build.ts packages/query/src/browser-replica/parse.ts packages/query/src/browser-replica/query.ts packages/query/src/browser-replica/views.ts packages/query/test/browser-vault-replica-coverage.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-cron-runtime.test.ts test/assistant-cron-thresholds.test.ts test/food-recurring-cron.test.ts test/assistant-codex-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/cli exec vitest run test/assistant-cron.test.ts test/assistant-codex.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/query test:coverage`
- `pnpm exec vitest run apps/web/test/hosted-run-store.test.ts apps/web/test/browser-vault-session-route.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts --config apps/web/vitest.config.ts --no-coverage`
- `pnpm --dir apps/web exec eslint src/lib/hosted-run`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-run-processor.test.ts --no-coverage`
- `pnpm test:smoke`
- `pnpm exec tsx --eval "import { buildCodexAppServerArgs } from './packages/assistant-engine/src/assistant-codex.ts'; import * as browser from './packages/query/src/browser.ts'; ..."`
- `git diff --check`
- Required `simplify`, `coverage-write`, and `task-finish-review` audit passes

- Actual results:
- `pnpm typecheck` is still red for unrelated branch issues: pre-existing `packages/cli` workspace-boundary failures and unrelated `apps/web` type errors.
- `bash scripts/workspace-verify.sh test:diff ...` is still red for unrelated branch issues before owner verification: the same `packages/cli` workspace-boundary failures and a pre-existing `packages/assistant-cli` source-vs-dist `VaultServices` type mismatch.
- All focused owner proofs above passed after one local follow-up fix in `runner-run-processor.ts` restored Telegram cleanup env handling and one coverage-write test update aligned `packages/cli/test/assistant-codex.test.ts` with the already-proven assistant-engine RPC contract.
- The direct smoke scenario printed `{"codexArgs":["-s","workspace-write","-a","never","app-server"],"browserFacadeOk":true}`.

## Outcome

- Completed the requested seam splits while keeping the top-level facades stable:
- `assistant/cron.ts` now delegates to `assistant/cron/canonical-jobs.ts` and `assistant/cron/execution.ts`.
- `assistant-codex.ts` now delegates config/env and image staging to `assistant-codex/{config,images}.ts`.
- `hosted-run/store.ts` now delegates to `hosted-run/{shared,sanitize,projection,acquire,lifecycle,status}.ts`.
- `runner-run-processor.ts` now delegates cleanup and web log forwarding to `runner-cleanup.ts` and `runner-web-observability.ts`.
- `browser-replica.ts` now delegates to `browser-replica/{shared,build,parse,query,views}.ts`.
- The simplify audit caught a real food auto-log target regression; that was fixed and covered with a new regression test.
- The coverage-write pass updated the stale CLI Codex proof so the focused CLI consumer lane is green again.

## Audits

- `simplify`: found one real regression in create-time `foodAutoLog` target preservation; fixed by resolving target defaults before branching and adding regression coverage in `packages/assistant-engine/test/food-recurring-cron.test.ts`.
- `coverage-write`: updated `packages/cli/test/assistant-codex.test.ts` so the CLI proof matches the already-proven assistant-engine `thread/start` / `turn/start` contract.
- `task-finish-review`: no findings after the fixes above. Residual risk is limited to unrelated branch-level failures blocking repo-wide `typecheck` and `test:diff`.

## Commit note

- No scoped commit was created. The checkout carries extensive unrelated dirty-tree churn, and the shared `COORDINATION_LEDGER.md` plus overlapping active rows make an exact task-only commit unsafe in this turn.
Completed: 2026-04-24
