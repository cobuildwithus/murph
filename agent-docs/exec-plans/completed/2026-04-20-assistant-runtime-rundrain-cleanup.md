# Clean assistant-runtime run-drain residue and env classification duplication

Status: completed
Created: 2026-04-20
Updated: 2026-04-21

## Goal

- Verify and fix issue 3 plus the assistant-runtime side of issue 6 within the allowed `packages/assistant-runtime` scope.
- Keep parser-level enforcement that hosted runtime requests require `request.runDrain` and reject legacy `request.wake`, while removing downstream runtime branches that still treat single-wake execution as live.
- Narrow `resolveHostedWake` to the current run-drain/event inputs and extract assistant-runtime-owned env classification maps used by `buildHostedRuntimeStartDetails` without changing category membership.

## Success criteria

- `parseHostedAssistantRuntimeJobInput` / `parseHostedAssistantRuntimeJobRequest` remain the only runtime-job entrypoints that validate required `runDrain` and reject legacy `request.wake`.
- `packages/assistant-runtime/src/hosted-runtime.ts` and `packages/assistant-runtime/src/hosted-runtime/execution.ts` stop carrying unreachable optional-`runDrain` / single-wake branches.
- `resolveHostedWake` no longer accepts legacy wake-envelope request shapes and still preserves the runtime-timer synthetic wake fallback from `runDrain`.
- `buildHostedRuntimeStartDetails` uses assistant-runtime-owned reusable env category maps with unchanged membership.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `packages/assistant-runtime/src/hosted-runtime/utils.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- directly coupled `packages/assistant-runtime/test/**`

## Constraints

- Do not touch `apps/cloudflare/**`.
- Preserve overlapping in-flight assistant-runtime edits, especially the naming-only hard-cut lane and the run-drain budget lane already active in this worktree.
- Keep behavior unchanged outside the requested parser/run-drain/env-classification cleanup.

## Risks and mitigations

1. Risk: Removing downstream guards could hide a real caller path that bypasses the parser.
   Mitigation: Verify all current in-package request construction/tests first, then move the invariant coverage to parser-focused tests instead of runtime-path tests.

2. Risk: Narrowing `resolveHostedWake` could break the runtime-timer synthetic wake fallback or existing event-only callers.
   Mitigation: Keep support for direct `HostedRuntimeEvent` inputs plus `HostedRuntimeDrainRequest`, and add focused utils/parser coverage around the synthetic fallback.

3. Risk: Refactoring env category maps could accidentally change classification membership.
   Mitigation: Lift the current exact key lists into assistant-runtime-owned constants and keep the existing runner start-detail assertions green.

## Tasks

1. Inspect current assistant-runtime usage and tests for `runDrain`, `resolveHostedWake`, and start-detail env classification.
2. Remove unreachable downstream `runDrain` checks and legacy wake-envelope handling in the allowed runtime files.
3. Extract assistant-runtime env classification key maps and keep `buildHostedRuntimeStartDetails` behavior unchanged.
4. Update directly coupled tests to prove parser-level validation and current run-drain wake resolution only.
5. Run scoped verification and record any required audit-pass blocker if subagent tooling is unavailable.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/models.ts packages/assistant-runtime/src/hosted-runtime/utils.ts packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/test/hosted-runtime-utils.test.ts packages/assistant-runtime/test/hosted-runtime-parsers.test.ts packages/assistant-runtime/test/hosted-runtime-parsers-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-runner.test.ts packages/assistant-runtime/test/hosted-runtime-run-drain-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-finalize-coverage.test.ts`
- planned: `git diff --check`
Completed: 2026-04-21
