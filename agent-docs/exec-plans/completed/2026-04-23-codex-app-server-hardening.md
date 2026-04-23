Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the Codex app-server hardening fixes around stdin shutdown races, approval-policy fail-closed behavior, stale-resume classification, resumed thread context parity, and non-replayable provider-action accounting without widening beyond the directly coupled assistant-engine and CLI surfaces.

## Success criteria

- `packages/assistant-engine/src/assistant-codex.ts` handles stdin write/end races as typed Murph failures, tightens stale-resume matching, reuses one authoritative thread-context builder for start and resume, and derives provider-action accounting from normalized event state without counting pure image-view reads.
- Codex provider execution fails closed before launching turns when approval policy is anything other than `never`, while server-initiated app-server requests still remain explicitly denied.
- CLI/schema wording matches the current fail-closed behavior for Codex approval policies.
- Focused regression coverage proves the five requested seams.
- Verification and required audit passes run, and the final scoped commit contains only this task's changes plus plan/ledger closeout.

## Scope

- In scope: `packages/assistant-engine/src/assistant-codex.ts`, directly coupled provider/failover tests and provider wiring under `packages/assistant-engine/**`, and the Codex assistant CLI/schema surface under `packages/assistant-cli/**` and `packages/cli/config.schema.json`.
- Out of scope: broader assistant routing changes, approval callback implementation, non-Codex provider behavior changes, and unrelated dirty-tree fixes.

## Constraints

- Preserve unrelated working-tree edits and active ledger rows.
- Keep approval modes fail-closed until Murph has a real interactive approval callback path.
- Keep changes narrow and additive around the current Codex app-server seam.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Harden Codex app-server RPC transport lifecycle and thread context behavior.
3. [x] Fail closed on unsupported Codex approval policies before provider launch and align CLI/schema wording.
4. [x] Add focused regression coverage for the requested app-server seams and failover semantics.
5. [x] Run scoped verification plus required audit passes.
6. [ ] Create a scoped commit.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/provider-execution.test.ts test/provider-turn-runner.test.ts` ✅
- `pnpm --dir packages/assistant-engine typecheck` ✅
- `git diff --check -- packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/test/provider-execution.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts packages/assistant-cli/src/commands/assistant.ts packages/cli/config.schema.json packages/cli/src/incur.generated.ts agent-docs/exec-plans/active/2026-04-23-codex-app-server-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` ✅
- `pnpm typecheck` ⚠️ blocked by unrelated dirty-tree failure in `apps/cloudflare/test/runner-run-processor.test.ts` (`Property 'mockRejectedValue' does not exist on type 'never'`).
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/provider-execution.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts packages/assistant-cli/src/commands/assistant.ts packages/cli/config.schema.json packages/cli/src/incur.generated.ts` ⚠️ blocked by unrelated pre-existing failure in `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` expecting legacy export `executeCodexPrompt`.
- Required final review pass (`gpt-5.4`, `xhigh`) ✅ no findings after forcing sparse Codex approval policy to explicit `never`.
Completed: 2026-04-23
