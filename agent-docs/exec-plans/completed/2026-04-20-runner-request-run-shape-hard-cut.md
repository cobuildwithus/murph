## Title

Hard-cut `HostedExecutionRunnerRequest` to the run-shaped contract.

## Goal

Remove the first-class wake-shaped runner request surface so hosted execution always carries `run` plus `runDrain`, with the runtime deriving the primary wake from the drain events when it needs wake-oriented logging or helper behavior.

## Scope

- `agent-docs/references/hosted-run-protocol.md`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `packages/hosted-execution/test/**`
- `packages/assistant-runtime/src/hosted-runtime{.ts,/execution.ts,/models.ts,/parsers.ts}`
- `packages/assistant-runtime/test/**`
- `apps/cloudflare/src/{user-runner.ts,user-runner/runner-wake-processor.ts}`
- focused `apps/cloudflare/test/**` only where the shared contract hard cut requires it
- verification, audit, and commit artifacts required by repo policy for this slice

## Constraints

- Keep this as a hosted-run contract cleanup only; do not broaden into unrelated hosted-wake or onboarding work.
- Preserve unrelated dirty-tree edits and overlapping hosted-run hard-cut lanes.
- Remove the old wake-first mental model rather than adding new compatibility shims.
- If a wake field is still needed for runtime-only logging, it must be runtime-derived and named `primaryWake`.

## Verification

- done: `pnpm --filter @murphai/assistant-runtime typecheck`
- done: `pnpm --filter @murphai/cloudflare-runner typecheck`
- done: `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-runner.test.ts test/hosted-runtime-run-drain-coverage.test.ts`
- done: `git diff --check -- packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-runner.test.ts packages/assistant-runtime/test/hosted-runtime-run-drain-coverage.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/node-runner-abort.test.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/runner-container.test.ts`
- attempted: `pnpm --filter @murphai/cloudflare-runner run test:node`
  - blocked by overlapping `cloudflare-node-platform` failures and in-flight `cron.tick` removal churn outside this lane, plus the workspace test script ignoring focused file filters.

## Notes

- The desired end state is a runner request shaped around `run` plus `runDrain`; the runtime should derive `primaryWake` from `runDrain.events[0]?.wake` and fall back to the synthetic timer wake helper only when needed.
- The remaining Cloudflare runtime test failures observed during `test:node` were explicitly left alone after the user confirmed the `cron.tick` path is being removed in a separate lane.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
