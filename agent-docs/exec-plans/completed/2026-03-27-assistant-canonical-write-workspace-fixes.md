# Assistant canonical-write workspace fixes

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Keep provider turns out of the live vault filesystem by default.
- Serialize assistant turns per vault so concurrent turns cannot interleave state mutations.
- Preserve audited canonical writes that were staged before the guard snapshot and committed during the provider turn.
- Surface canonical-write guard blocks in Ink as an informational guardrail instead of a generic error state.

## Success criteria

- `sendAssistantMessage` runs under a vault-scoped turn lock and waits cleanly when another turn is in progress for the same vault.
- Codex-backed provider turns use an isolated assistant workspace when the requested working directory is inside the bound vault, while still binding the real vault through env/tooling.
- The bootstrap prompt and memory guidance describe the bound-vault model truthfully for the isolated-workspace path.
- The canonical-write guard replays committed operations that transition from pre-snapshot staged state to committed during the provider turn.
- Focused assistant tests prove workspace isolation/reuse, per-vault turn serialization, staged-before-snapshot committed writes, and existing canonical-write guard invariants.

## Scope

- In scope:
  - `packages/cli/src/assistant/service.ts`
  - `packages/cli/src/assistant/canonical-write-guard.ts`
  - new assistant helpers for turn locking and provider workspaces
  - `packages/cli/src/assistant/ui/ink.ts`
  - `packages/cli/test/assistant-service.test.ts`
  - `packages/cli/test/assistant-runtime.test.ts`
- Out of scope:
  - broader assistant session/runtime refactors
  - new vault mutation surfaces
  - unrelated active assistant/provider-config lanes outside the patch intent

## Constraints

- Preserve overlapping dirty edits in `packages/cli/src/assistant/service.ts`.
- Keep the provider workspace helper free of personal-path leakage in generated files.
- Do not widen this into a general assistant prompt rewrite.
- Match existing assistant lock/write patterns instead of inventing a second concurrency model.

## Risks and mitigations

1. Risk: a new turn lock could deadlock or fight the existing assistant runtime write lock.
   Mitigation: use the existing assistant-state directory-lock primitive, scope it to whole turns only, and keep it separate from the lower-level runtime mutation lock.
2. Risk: isolated provider workspaces could break CLI/MCP assumptions that previously relied on cwd.
   Mitigation: keep `VAULT` and assistant tool bindings authoritative, update prompt guidance, and prove the expected working directory explicitly in tests.
3. Risk: the guard snapshot fix could accidentally replay old committed operations repeatedly.
   Mitigation: snapshot prior operation status and only apply operations that newly reach `committed` during the guarded turn.

## Tasks

1. Add the vault-scoped assistant turn-lock helper and isolated provider-workspace helper.
2. Rewire `sendAssistantMessage` and shared-plan working-directory resolution onto those helpers.
3. Update the bootstrap/memory guidance and Ink canonical-write error handling.
4. Extend the canonical-write guard snapshot logic to track operation status transitions, not just new metadata files.
5. Add focused assistant-service regressions for workspace isolation/reuse, lock serialization, and pre-snapshot staged writes.
6. Run required verification, capture one direct scenario proof, then run the mandatory simplify, coverage, and final-review audit passes.

## Verification

- Focused commands:
  - `pnpm exec tsc -p packages/cli/tsconfig.typecheck.json --pretty false --noEmit` -> passed
  - `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1` -> passed (`127` tests)
- Required commands:
  - `pnpm typecheck` -> failed outside this lane in existing workspace build/type wiring (`packages/core/src/ids.ts`, `packages/core/src/operations/canonical-write-lock.ts`) while building against `packages/runtime-state/dist`
  - `pnpm test` -> failed outside this lane with pre-existing CLI/runtime-state/build drift and unrelated CLI expectation failures (`packages/cli/test/{cli-expansion-workout,incur-smoke,list-cursor-compat,runtime,search-runtime,setup-cli,stdin-input}.test.ts`)
  - `pnpm test:coverage` -> failed outside this lane with unrelated CLI expectation failures in `packages/cli/test/{runtime,search-runtime}.test.ts`
- Direct scenario target:
  - focused assistant-service/workspace regression proves provider cwd is outside the live vault while `VAULT` remains bound to the real vault

## Outcome

- Implemented the deferred patch intent with two additional helpers: `turn-lock.ts` for vault-scoped turn serialization and `provider-workspace.ts` for isolated direct-CLI workspaces inside `assistant-state/workspaces/<sessionId>`.
- `sendAssistantMessage` now runs under the turn lock, resolves isolated workspaces only for direct-CLI providers whose requested cwd is inside the vault, and uses updated bootstrap/memory guidance that keeps `VAULT` authoritative.
- The canonical-write guard now snapshots operation status and preserves writes that were staged before the snapshot but committed during the provider turn.
- Ink now treats `ASSISTANT_CANONICAL_DIRECT_WRITE_BLOCKED` as informational status UI and skips transcript error persistence for that guardrail.
- Focused regressions cover workspace reuse, non-shell/outside-vault cwd preservation, same-process and external lock wait/abort behavior, staged-before-snapshot committed writes, and the Ink canonical-write presentation helper.
- Follow-up regressions also cover nested in-vault workspace path preservation and blocked-turn recovery when the underlying provider failure is resumable.

## Audit passes

- `simplify` audit: completed; one actionable finding about over-eager workspace resolution for non-shell providers was fixed in this lane.
- `test-coverage-audit`: completed; gaps around outside-vault direct-CLI cwd, external lock behavior, and Ink canonical-write UX were covered in this lane.
- `task-finish-review`: completed on retry after follow-up fixes; final review reported no high or medium findings, with only a documentation-freshness note addressed in this close-out.
Completed: 2026-03-28
