# Fix Codex app-server sandbox mapping and setup probe stdin guards

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fix the remaining high-confidence Codex app-server integration gaps by sending protocol-correct sandbox values on thread start/resume and by making setup-time Codex RPC probing fail closed through guarded stdin writes/cleanup instead of brittle `EPIPE` or write-after-end races.

## Success criteria

- `packages/assistant-engine` maps Murph sandbox enums to Codex app-server protocol-form values for `thread/start` and `thread/resume`.
- Focused assistant-engine tests prove `readOnly`, `workspaceWrite`, and `dangerFullAccess` payloads on fresh and resumed threads.
- `packages/setup-cli` guards Codex probe stdin writes and cleanup close paths, including child stdin error handling.
- Focused setup-cli tests cover early child exit before `initialize` and cleanup-time stdin failure races.
- Required verification, audit passes, and a scoped handoff/commit path are completed or any unrelated blocker is recorded precisely.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/setup-cli/src/setup-assistant-account.ts`
- `packages/setup-cli/test/setup-assistant-account-rpc.test.ts`
- `agent-docs/exec-plans/active/2026-04-23-codex-app-server-fixes.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
- Broader Codex failover behavior beyond the provider-action-count path already fixed
- Onboarding lifecycle work already active in other assistant-engine rows
- Any protocol changes that require widening into `turn/start` behavior beyond what current tests need to prove

## Constraints

- Technical constraints:
- Preserve existing `codex app-server` launch behavior and the fail-closed `approvalPolicy=never` posture.
- Keep setup probe changes narrow and typed; do not weaken ordinary probe failures into silent success.
- Product/process constraints:
- Preserve unrelated dirty-tree edits, especially the active assistant-engine onboarding row.
- Follow the higher-risk repo change workflow with plan, ledger, scoped verification, required audit passes, and a scoped commit if staging can stay exact.

## Risks and mitigations

1. Risk: setup probe hardening can change cleanup timing and hide the original probe failure reason.
   Mitigation: route stdin write/close failures through one explicit error path and add focused tests for early-exit and cleanup-race cases.
2. Risk: sandbox mapping could drift between CLI flags and JSON-RPC payloads.
   Mitigation: keep the new mapper protocol-specific and cover the JSON-RPC payload seam directly in tests without changing CLI arg behavior.

## Tasks

1. Register the task in the coordination ledger and validate the existing runtime/setup seams plus official app-server protocol expectations.
2. Add a Codex app-server sandbox mapper for thread context params and extend assistant-engine payload tests.
3. Reuse runtime-style guarded stdin handling in the setup CLI probe and add focused early-exit/cleanup tests.
4. Run scoped verification, required audit passes, and the scoped commit path if the shared tree permits it.

## Decisions

- Use one protocol-only sandbox mapper at the JSON-RPC seam instead of changing CLI `-s` argument handling, because the CLI path already expects Murph's local enum strings while app-server thread payloads expect protocol-form values.
- Align setup probe stdin handling with the hardened runtime pattern so setup and runtime fail the same way on fast app-server exits.
- Treat only shutdown-time `EPIPE` / `ERR_STREAM_WRITE_AFTER_END` as ignorable setup-probe stdin cleanup errors; other cleanup-time stdin failures must still surface as probe failures.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/setup-cli/src/setup-assistant-account.ts packages/setup-cli/test/setup-assistant-account-rpc.test.ts`
- Focused Vitest for the touched assistant-engine and setup-cli tests if iteration needs narrower proof
- Required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- Focused Codex payload and probe-race coverage pass without widening into unrelated assistant-engine onboarding failures.
- Outcomes:
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-codex-runtime.test.ts` passed.
- `pnpm --dir packages/setup-cli exec vitest run --config vitest.config.ts test/setup-assistant-account-rpc.test.ts` passed after adding early-exit, async-stdin-error, cleanup `EPIPE`, cleanup non-ignorable, and cleanup `ERR_STREAM_WRITE_AFTER_END` probe coverage.
- `pnpm typecheck` passed on the final rerun.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/setup-cli/src/setup-assistant-account.ts packages/setup-cli/test/setup-assistant-account-rpc.test.ts` still fails for the unrelated pre-existing `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` export-surface expectation (`executeCodexPrompt` missing from the package index), outside this task's touched files.
- Required `coverage-write` and `task-finish-review` audit passes both ran; coverage-write added one extra cleanup-time `ERR_STREAM_WRITE_AFTER_END` regression test, and final review found one real shutdown-error masking bug plus one missing async-listener proof gap that were fixed locally before the final reruns.
Completed: 2026-04-23
