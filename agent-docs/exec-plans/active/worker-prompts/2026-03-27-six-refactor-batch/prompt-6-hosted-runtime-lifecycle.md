You are Codex Worker W6 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `AGENTS.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Use the pre-registered ledger row `codex-worker-hosted-runtime-lifecycle`; update it if scope shifts, and remove it before finishing.
- Keep this behavior-preserving: do not change callback order, bundle semantics, side-effect replay semantics, or the public hosted runtime API.

After changes:
- Run the narrowest truthful tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Simplify the hosted execution lifecycle in `packages/assistant-runtime/src/hosted-runtime.ts`, especially the in-process path.

Relevant files/symbols:
- `packages/assistant-runtime/src/hosted-runtime.ts`
  - `runHostedAssistantRuntimeJobInProcess`
  - `runHostedAssistantRuntimeJobIsolated`
  - `prepareHostedDispatchContext`
  - `ingestHostedLinqMessage`
  - `runHostedAssistantAutomation`
  - `collectHostedExecutionSideEffects`
  - `drainHostedCommittedSideEffectsAfterCommit`
  - `commitHostedExecutionResult`
  - `finalizeHostedExecutionResult`
  - `withHostedProcessEnvironment`
  - `summarizeDispatch`
- `apps/cloudflare/src/node-runner.ts`

Regression anchors to preserve:
- `apps/cloudflare/test/node-runner.test.ts`
  - isolated process-env concurrency
  - durable-commit-before-reconcile/finalize ordering
  - resume replay without rerun/recommit
  - concurrent-run resilience when another commit fails

Best-guess fix:
1. Split `runHostedAssistantRuntimeJobInProcess` into restore/bootstrap/env scoping, execute-or-resume dispatch, and common post-commit finalization stages.
2. Extract a shared helper for the duplicated tail after the durable commit.
3. Replace the inline dispatch-kind branching with focused helpers or a small handler table.

Overlap notes:
- `packages/assistant-runtime/src/hosted-runtime.ts` and `apps/cloudflare/src/node-runner.ts` are already dirty in the live tree.
- Preserve adjacent hosted bootstrap/email/runtime edits and do not widen into the native runner container or Cloudflare routing surfaces.
