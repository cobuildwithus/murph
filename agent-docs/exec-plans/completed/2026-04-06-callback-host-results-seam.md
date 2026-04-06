# Collapse hosted runner callback fanout onto `results.worker`

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Collapse the hosted runner callback fanout for commit/finalize, side-effect journal access, and hosted email onto one internal `results.worker` seam.
- Replace the assistant-runtime callback configuration split across commit, email, and side-effect base URLs with one `resultsBaseUrl`.

## Success criteria

- Cloudflare runner outbound routing recognizes `results.worker` as the single internal callback host for runner results.
- Assistant-runtime event, email, and callback helpers build commit/finalize, side-effect, and hosted-email routes from one results base URL.
- Shared hosted-execution route builders expose the runner results paths needed by both runtime and worker code.
- Compatibility aliases for legacy symbolic callback hosts continue to resolve to the same worker seam.
- Hosted docs and architecture text describe the new seam without widening the trust boundary.
- Verification covers repo-required checks and at least one focused scenario proving the results routes still dispatch correctly.

## Scope

- In scope:
  - `apps/cloudflare/**`
  - `packages/assistant-runtime/**`
  - `packages/hosted-execution/**`
  - `ARCHITECTURE.md`
  - hosted execution docs/tests touched by the seam
- Out of scope:
  - removing legacy callback-host compatibility aliases entirely
  - collapsing `artifacts.worker`, `device-sync.worker`, or `usage.worker`
  - broader hosted runtime cleanup unrelated to the callback seam

## Constraints

- Preserve unrelated dirty worktree edits.
- Treat the supplied patch as intent; port only the intended behavior onto current file state.
- Keep the existing Cloudflare trust boundary and fail-closed routing guarantees intact.

## Risks and mitigations

1. Risk: Route mismatches between runtime and worker code break hosted commit/finalize or email callbacks.
   Mitigation: land shared route builders in `packages/hosted-execution` and run focused hosted tests after repo verification.
2. Risk: Legacy symbolic callback hosts still appear in configs and silently diverge.
   Mitigation: keep compatibility aliases explicit in `HOSTED_EXECUTION_CALLBACK_HOSTS` and normalize all runtime callback config through one results base URL.
3. Risk: Adjacent in-flight hosted test edits get overwritten.
   Mitigation: apply the supplied patch only after confirming the target runtime/source files are clean and leave unrelated test changes untouched.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - focused hosted tests for callback/email/Cloudflare route coverage if needed
  - one direct route-building or focused test scenario proving the new results seam handles commit/finalize and email paths

## Notes

- This is a supplied-patch landing, so the default audit path is a final `task-finish-review` pass without an extra `simplify` review.
- Actual verification:
  - `pnpm typecheck` failed before this patch's files were checked because `packages/cli/test/memory.test.ts` currently violates the workspace-boundary import rule on this branch.
  - `pnpm test:coverage` failed for the same pre-existing workspace-boundary reason before it reached this patch's subsystems.
  - Focused scoped checks passed:
    - `pnpm --dir packages/hosted-execution typecheck`
    - `pnpm --dir packages/assistant-runtime typecheck`
    - `pnpm --dir apps/cloudflare typecheck`
    - `pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts test/hosted-execution.test.ts --no-coverage`
    - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-http.test.ts test/hosted-runtime-events.test.ts --no-coverage`
    - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
    - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/index.test.ts --no-coverage -t 'persists runner commits through the outbound results\\.worker handler|persists finalized runner bundles through the outbound results\\.worker handler|sends hosted email through results\\.worker and returns a canonical serialized thread target|returns method and auth errors on protected routes in the same order as before'`
    - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.workers.config.ts apps/cloudflare/test/workers/runtime.test.ts --no-coverage`
- Residual unrelated red tests observed during scoped verification:
  - `pnpm --dir packages/hosted-execution test` still fails in `test/member-activated-outbox-payload.test.ts` because that branch now requires a staged `payloadRef` for `member.activated` reference payloads.
  - `pnpm --dir packages/assistant-runtime test` still fails in `test/hosted-runtime-context.test.ts` because current branch work generates vault metadata that no longer passes contract validation there.
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/node-runner.test.ts --no-coverage -t 'reconciles journaled hosted assistant deliveries only after the durable commit callback|journals hosted assistant deliveries after the durable commit before finalizing returned bundles|replays committed side effects on resume without rerunning compute or recommitting|posts a durable commit before returning when a commit callback is configured'` still fails because those branch-local tests are using old hosted bundle fields (`agentState` / missing `vaultBundle`) unrelated to the callback-host seam.
Completed: 2026-04-06
